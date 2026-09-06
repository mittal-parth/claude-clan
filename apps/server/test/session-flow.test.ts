import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { CityId, WorldSnapshot } from "@sudo-city/protocol";
import { shouldDeliverEvent } from "../src/event-routing.js";

const fake = vi.hoisted(() => {
  class FakeSessionRunner {
    readonly sessionId: string;
    readonly sendCalls: Array<{ prompt: string; contextPaths: string[] }> = [];
    readonly resolvedPermits: Array<{
      toolCallId: string;
      decision: "allow" | "allow-always" | "deny";
    }> = [];
    readonly pendingPermits = new Set<string>();
    interruptCalls = 0;
    disposeCalls = 0;
    readonly options: Record<string, unknown>;
    private running = false;
    private live = true;
    private readonly emit: (event: unknown) => void;

    constructor(options: { sessionId: string; emit: (event: unknown) => void } & Record<string, unknown>) {
      this.sessionId = options.sessionId;
      this.emit = options.emit;
      this.options = options;
      runners.push(this);
    }

    async send(prompt: string, contextPaths: readonly string[] = []): Promise<string> {
      this.sendCalls.push({ prompt, contextPaths: [...contextPaths] });
      this.running = true;
      this.emit({ type: "session.status", status: "thinking" });
      return `turn-${this.sendCalls.length}`;
    }

    async interrupt(): Promise<void> {
      this.interruptCalls += 1;
      this.running = false;
      this.emit({
        type: "session.status",
        status: "interrupted",
        outcome: "interrupted",
      });
    }

    async dispose(): Promise<void> {
      this.disposeCalls += 1;
      this.running = false;
      this.live = false;
    }

    resolvePermit(
      toolCallId: string,
      decision: "allow" | "allow-always" | "deny",
    ): boolean {
      if (!this.pendingPermits.delete(toolCallId)) {
        return false;
      }
      this.resolvedPermits.push({ toolCallId, decision });
      return true;
    }

    async setModel(_model: string): Promise<void> {}

    setEffort(_effort: "low" | "medium" | "high" | "xhigh" | "max"): void {}

    async setPermissionMode(_mode: "default" | "auto"): Promise<void> {}

    isRunning(): boolean {
      return this.running;
    }

    isLive(): boolean {
      return this.live;
    }

    setIdle(): void {
      this.running = false;
      this.emit({ type: "session.status", status: "idle", outcome: "success" });
    }

    completeTurn(): void {
      this.emit({
        type: "turn.completed",
        turnId: `turn-${this.sendCalls.length}`,
        outcome: "success",
        costUsd: 0,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        durationMs: 1,
        numTurns: 1,
      });
      this.setIdle();
    }
  }

  const runners: FakeSessionRunner[] = [];
  return { FakeSessionRunner, runners };
});

vi.mock("@sudo-city/agent", () => ({ SessionRunner: fake.FakeSessionRunner }));

import { Workspace, type WorkspaceOptions } from "../src/workspace.js";

const log = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as FastifyBaseLogger;

const snapshot: WorldSnapshot = {
  id: "test-world",
  repoPath: "/tmp/sudocity-session-flow",
  revision: "test",
  generatedAt: "2026-08-08T00:00:00.000Z",
  size: { width: 16, height: 16 },
  districts: [],
  buildings: [],
};

function workspaceOptions(repoPath: string, onEvent: WorkspaceOptions["onEvent"]): WorkspaceOptions {
  return {
    key: "test-workspace",
    repoPath,
    log,
    remainingBudget: () => 100,
    onSpend: vi.fn(),
    onEvent,
    onSessionChanged: vi.fn(),
    onCitiesChanged: vi.fn(),
    onIssuesChanged: vi.fn(),
  };
}

function constructWorkspace(
  repoPath: string,
  onEvent: WorkspaceOptions["onEvent"] = vi.fn(),
): Workspace {
  const Constructor = Workspace as unknown as new (options: WorkspaceOptions) => Workspace;
  const workspace = new Constructor(workspaceOptions(repoPath, onEvent));
  const registry = (workspace as unknown as {
    registry: { add: (city: { id: CityId; cwd: string; readOnly: boolean; snapshot: WorldSnapshot }) => void };
  }).registry;
  registry.add({ id: "main", cwd: repoPath, readOnly: false, snapshot });
  registry.add({ id: "pr-51", cwd: repoPath, readOnly: true, snapshot });
  return workspace;
}

async function openSession(workspace: Workspace, cityId: CityId = "main", prompt = "inspect the city") {
  const result = await workspace.openSession(cityId, { prompt });
  if ("error" in result) {
    throw new Error(`${result.error.code}: ${result.error.message ?? ""}`);
  }
  return result.session;
}

let temporaryDirectories: string[] = [];
let workspace: Workspace | undefined;

beforeEach(() => {
  fake.runners.length = 0;
});

afterEach(async () => {
  await workspace?.dispose();
  workspace = undefined;
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories = [];
});

async function createWorkspace(onEvent?: WorkspaceOptions["onEvent"]): Promise<Workspace> {
  const directory = await mkdtemp(join(tmpdir(), "sudocity-session-flow-"));
  temporaryDirectories.push(directory);
  workspace = constructWorkspace(directory, onEvent);
  return workspace;
}

describe("Workspace session flow", () => {
  it("opens concurrent sessions without interrupting either runner", async () => {
    const current = await createWorkspace();
    const first = await openSession(current, "main", "first order");
    const second = await openSession(current, "main", "second order");

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(current.sessionSummaries()).toHaveLength(2);
    expect(fake.runners).toHaveLength(2);
    expect(fake.runners.every((runner) => runner.interruptCalls === 0)).toBe(true);
  });

  it("sends a follow-up to the existing session rather than creating another one", async () => {
    const current = await createWorkspace();
    const session = await openSession(current);
    const runner = fake.runners[0]!;
    runner.setIdle();

    await expect(current.sendToSession(session.sessionId, "follow up")).resolves.toEqual({ ok: true });

    expect(current.sessionSummaries()).toHaveLength(1);
    expect(runner.sendCalls.map(({ prompt }) => prompt)).toEqual(["inspect the city", "follow up"]);
  });

  it("refuses the 26th city session before constructing another runner", async () => {
    const current = await createWorkspace();
    for (let index = 0; index < 25; index += 1) {
      await openSession(current, "main", `order ${index}`);
      fake.runners.at(-1)!.setIdle();
    }

    const result = await current.openSession("main", { prompt: "order 25" });

    expect(result).toEqual({
      error: {
        code: "TOO_MANY_SESSIONS",
        message: "This city has reached its session limit.",
      },
    });
    expect(fake.runners).toHaveLength(25);
    expect(current.sessionSummaries()).toHaveLength(25);
  });

  it("refuses a fourth concurrently running session", async () => {
    const current = await createWorkspace();
    await openSession(current, "main", "order one");
    await openSession(current, "main", "order two");
    await openSession(current, "main", "order three");

    const result = await current.openSession("main", { prompt: "order four" });

    expect(result).toEqual({
      error: {
        code: "TOO_MANY_RUNNING_SESSIONS",
        message: "Too many crews are running at once.",
      },
    });
    expect(fake.runners).toHaveLength(3);
  });

  it("routes permit resolution to the addressed session only", async () => {
    const current = await createWorkspace();
    const first = await openSession(current, "main", "first order");
    const second = await openSession(current, "main", "second order");
    const firstRunner = fake.runners[0]!;
    firstRunner.pendingPermits.add("permit-1");

    expect(current.resolvePermit(second.sessionId, "permit-1", "allow")).toBe(false);
    expect(firstRunner.pendingPermits.has("permit-1")).toBe(true);
    expect(current.resolvePermit(first.sessionId, "permit-1", "allow")).toBe(true);
    expect(firstRunner.resolvedPermits).toEqual([
      { toolCallId: "permit-1", decision: "allow" },
    ]);
  });

  it("keeps transcripts isolated by session", async () => {
    const current = await createWorkspace();
    const first = await openSession(current, "main", "first order");
    const second = await openSession(current, "main", "second order");

    const firstTranscript = current.transcript(first.sessionId);
    const secondTranscript = current.transcript(second.sessionId);

    expect(firstTranscript?.events.length).toBeGreaterThan(0);
    expect(secondTranscript?.events.length).toBeGreaterThan(0);
    expect(firstTranscript?.events.every((event) => event.sessionId === first.sessionId)).toBe(true);
    expect(secondTranscript?.events.every((event) => event.sessionId === second.sessionId)).toBe(true);
    expect(firstTranscript?.events.some((event) => event.sessionId === second.sessionId)).toBe(false);
  });

  it("disposes a closed session while leaving its transcript readable", async () => {
    const current = await createWorkspace();
    const session = await openSession(current);
    const runner = fake.runners[0]!;

    expect(await current.closeSession(session.sessionId)).toBe(true);

    const transcript = current.transcript(session.sessionId);
    expect(runner.disposeCalls).toBe(1);
    expect(transcript?.events.some((event) => event.type === "session.status" && event.status === "closed")).toBe(true);
    expect(current.sessionSummaries()[0]?.status).toBe("closed");
  });

  it("queues a follow-up while a turn is running", async () => {
    const current = await createWorkspace();
    const session = await openSession(current);
    const runner = fake.runners[0]!;

    await expect(current.sendToSession(session.sessionId, "queued order")).resolves.toEqual({ ok: true });

    expect(runner.sendCalls).toHaveLength(1);
    expect(runner.sendCalls[0]?.prompt).toBe("inspect the city");
    expect(current.sessionSummaries()[0]?.queuedCount).toBe(1);
  });

  it("drains only one queued turn after each completion", async () => {
    const current = await createWorkspace();
    const session = await openSession(current);
    const runner = fake.runners[0]!;

    await current.sendToSession(session.sessionId, "queued one");
    await current.sendToSession(session.sessionId, "queued two");
    await current.sendToSession(session.sessionId, "queued three");
    expect(runner.sendCalls).toHaveLength(1);

    runner.completeTurn();
    await vi.waitFor(() => expect(runner.sendCalls).toHaveLength(2));

    expect(runner.sendCalls.map(({ prompt }) => prompt)).toEqual(["inspect the city", "queued one"]);
    expect(current.sessionSummaries()[0]?.queuedCount).toBe(2);
  });

  it("interrupts the current turn, clears queued orders, and records a notice", async () => {
    const current = await createWorkspace();
    const session = await openSession(current);
    const runner = fake.runners[0]!;

    await current.sendToSession(session.sessionId, "queued one");
    await current.sendToSession(session.sessionId, "queued two");
    expect(current.sessionSummaries()[0]?.queuedCount).toBe(2);

    expect(await current.interruptSession(session.sessionId)).toBe(true);
    await Promise.resolve();

    expect(runner.interruptCalls).toBe(1);
    expect(runner.sendCalls).toHaveLength(1);
    expect(current.sessionSummaries()[0]?.queuedCount).toBe(0);
    const transcript = current.transcript(session.sessionId);
    expect(transcript?.events).toContainEqual(
      expect.objectContaining({
        type: "session.message",
        role: "system",
        kind: "notice",
        text: "2 queued orders discarded by the mayor.",
      }),
    );
  });

  it("routes cross-city events only to subscribed clients and deltas only to subscribers", () => {
    const subscribed = {
      workspaceKey: "workspace",
      cityId: "main" as const,
      subscriptions: new Set(["pr-session"]),
    };
    const unsubscribed = {
      ...subscribed,
      subscriptions: new Set<string>(),
    };
    const pullRequestMessage = { type: "session.message" as const };
    const delta = { type: "session.delta" as const };

    expect(shouldDeliverEvent(subscribed, "workspace", "pr-51", "pr-session", pullRequestMessage)).toBe(true);
    expect(shouldDeliverEvent(unsubscribed, "workspace", "pr-51", "pr-session", pullRequestMessage)).toBe(false);
    expect(shouldDeliverEvent(subscribed, "workspace", "pr-51", "pr-session", delta)).toBe(true);
    expect(shouldDeliverEvent(unsubscribed, "workspace", "pr-51", "pr-session", delta)).toBe(false);
    expect(shouldDeliverEvent(unsubscribed, "workspace", "main", "other-session", delta)).toBe(false);
    expect(shouldDeliverEvent(subscribed, "other-workspace", "pr-51", "pr-session", pullRequestMessage)).toBe(false);
  });

  it("injects GH_TOKEN into runner env when workspace has githubToken", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sudocity-token-test-"));
    temporaryDirectories.push(directory);
    const Constructor = Workspace as unknown as new (options: WorkspaceOptions) => Workspace;
    const current = new Constructor({
      ...workspaceOptions(directory, vi.fn()),
      key: "token-workspace",
      githubToken: "ghs_user_session_token_xyz",
      userId: 42,
    });
    const registry = (current as unknown as {
      registry: { add: (city: { id: CityId; cwd: string; readOnly: boolean; snapshot: WorldSnapshot }) => void };
    }).registry;
    registry.add({ id: "main", cwd: directory, readOnly: false, snapshot });

    const session = await openSession(current, "main", "push branch");
    const runner = fake.runners.find((r) => r.sessionId === session.sessionId)!;
    expect(runner.options.env).toEqual(
      expect.objectContaining({
        GH_TOKEN: "ghs_user_session_token_xyz",
      }),
    );
  });

  it("emits WRITE_ACCESS_REQUIRED when tool.completed reports 403 permission error on git push", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sudocity-write-access-test-"));
    temporaryDirectories.push(directory);
    const onError = vi.fn();
    const Constructor = Workspace as unknown as new (options: WorkspaceOptions) => Workspace;
    const current = new Constructor({
      ...workspaceOptions(directory, vi.fn()),
      key: "write-error-workspace",
      onError,
    });
    const registry = (current as unknown as {
      registry: { add: (city: { id: CityId; cwd: string; readOnly: boolean; snapshot: WorldSnapshot }) => void };
    }).registry;
    registry.add({ id: "main", cwd: directory, readOnly: false, snapshot });

    const session = await openSession(current, "main", "fix issue");
    const emitAgentEvent = (current as unknown as {
      emitAgentEvent: (sessionId: string, event: unknown) => void;
    }).emitAgentEvent.bind(current);

    // Simulate tool start for git push
    emitAgentEvent(session.sessionId, {
      type: "tool.started",
      toolCallId: "call_1",
      tool: "Bash",
      input: { command: "git push -u origin feature" },
    });

    // Simulate tool completion failing with 403
    emitAgentEvent(session.sessionId, {
      type: "tool.completed",
      toolCallId: "call_1",
      outcome: "error",
      resultPreview: "fatal: unable to access 'https://github.com/org/repo.git/': The requested URL returned error: 403",
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "WRITE_ACCESS_REQUIRED",
        sessionId: session.sessionId,
      }),
    );
  });

  it("emits WRITE_ACCESS_REQUIRED when hasWriteAccess is false and user prompts to push/pr", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sudocity-write-access-readonly-test-"));
    temporaryDirectories.push(directory);
    const onError = vi.fn();
    const Constructor = Workspace as unknown as new (options: WorkspaceOptions) => Workspace;
    const current = new Constructor({
      ...workspaceOptions(directory, vi.fn()),
      key: "write-readonly-workspace",
      onError,
    });
    current.hasWriteAccess = false;
    const registry = (current as unknown as {
      registry: { add: (city: { id: CityId; cwd: string; readOnly: boolean; snapshot: WorldSnapshot }) => void };
    }).registry;
    registry.add({ id: "main", cwd: directory, readOnly: false, snapshot });

    await openSession(current, "main", "please push and open pr");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "WRITE_ACCESS_REQUIRED",
      }),
    );
  });
});
