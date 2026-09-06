import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { SessionRunner } from "../src/index.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function budget() {
  return {
    reserve: vi.fn(() => 1),
    settle: vi.fn(),
  };
}

function installQueryMock() {
  queryMock.mockImplementation(({ prompt, options }) => ({
    options,
    prompt,
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ percentage: 42 }),
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for await (const _message of prompt) {
        // The runner's queue is the behaviour under test. SDK output is
        // injected directly into handleMessage by the focused tests below.
      }
    },
  }));
}

function runner(emit = vi.fn()) {
  return {
    emit,
    budget: budget(),
    instance: new SessionRunner({
      sessionId: SESSION_ID,
      cwd: process.cwd(),
      emit,
      model: "sonnet",
      effort: "high",
      permissionMode: "default",
      budget: budget(),
    }),
  };
}

describe("SessionRunner", () => {
  beforeEach(() => {
    queryMock.mockReset();
    installQueryMock();
  });

  it("passes sessionId on first open and resume on the second cold open", async () => {
    const emit = vi.fn();
    const budgetState = budget();
    const instance = new SessionRunner({
      sessionId: SESSION_ID,
      cwd: process.cwd(),
      emit,
      model: "sonnet",
      effort: "high",
      permissionMode: "default",
      budget: budgetState,
    });

    await instance.send("first order");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const firstOptions = queryMock.mock.calls[0]![0].options;
    expect(firstOptions.sessionId).toBe(SESSION_ID);
    expect(firstOptions.resume).toBeUndefined();
    expect(firstOptions.includePartialMessages).toBe(true);
    expect(typeof queryMock.mock.calls[0]![0].prompt).not.toBe("string");

    await instance.goCold();
    await instance.send("follow-up");
    expect(queryMock).toHaveBeenCalledTimes(2);
    const secondOptions = queryMock.mock.calls[1]![0].options;
    expect(secondOptions.resume).toBe(SESSION_ID);
    expect(secondOptions.sessionId).toBeUndefined();
    await instance.goCold();
  });

  it("passes environment variables to query options", async () => {
    const emit = vi.fn();
    const instance = new SessionRunner({
      sessionId: SESSION_ID,
      cwd: process.cwd(),
      emit,
      model: "sonnet",
      effort: "high",
      permissionMode: "default",
      budget: budget(),
      env: { GH_TOKEN: "test_github_token_123" },
    });

    await instance.send("run with env");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const options = queryMock.mock.calls[0]![0].options;
    expect(options.env).toBeDefined();
    expect(options.env?.GH_TOKEN).toBe("test_github_token_123");
    await instance.goCold();
  });

  it("keeps two sends in one warm query", async () => {
    const instance = runner().instance;
    await instance.send("one");
    await instance.send("two");
    expect(queryMock).toHaveBeenCalledTimes(1);
    await instance.goCold();
  });

  it("interrupts the Query without aborting its controller", async () => {
    const instance = runner().instance;
    await instance.send("long order");
    const activeQuery = queryMock.mock.results[0]!.value as {
      interrupt: ReturnType<typeof vi.fn>;
      options: { abortController?: AbortController };
    };

    await instance.interrupt();
    expect(activeQuery.interrupt).toHaveBeenCalledOnce();
    expect(activeQuery.options.abortController?.signal.aborted).toBe(false);
    await instance.goCold();
  });

  it("expires pending permits on interrupt", async () => {
    const emit = vi.fn();
    const instance = runner(emit).instance;
    await instance.send("write the readme");
    const canUseTool = queryMock.mock.calls[0]![0].options.canUseTool as (
      tool: string,
      input: Record<string, unknown>,
      options: {
        toolUseID: string;
        signal: AbortSignal;
        title?: string;
        description?: string;
        requestId: string;
      },
    ) => Promise<unknown>;
    const pending = canUseTool("Write", { file_path: "README.md" }, {
      toolUseID: "tool-1",
      signal: new AbortController().signal,
      requestId: "request-1",
    });
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "permit.requested", toolCallId: "tool-1" }),
      ),
    );
    void pending.catch(() => undefined);

    await instance.interrupt();
    expect(emit).toHaveBeenCalledWith({
      type: "permit.resolved",
      toolCallId: "tool-1",
      decision: "expired",
    });
    await instance.goCold();
  });

  it("uses a session-scoped rule for allow-always", async () => {
    const instance = runner().instance;
    await instance.send("run a command");
    const canUseTool = queryMock.mock.calls[0]![0].options.canUseTool as any;
    const pending = canUseTool("Bash", { command: "pnpm test" }, {
      toolUseID: "tool-2",
      signal: new AbortController().signal,
      requestId: "request-2",
    });
    await vi.waitFor(() => expect(instance.pendingPermitCount).toBe(1));

    expect(instance.resolvePermit("tool-2", "allow-always")).toBe(true);
    await expect(pending).resolves.toMatchObject({
      behavior: "allow",
      updatedPermissions: [{
        type: "addRules",
        rules: [{ toolName: "Bash" }],
        behavior: "allow",
        destination: "session",
      }],
    });
    await instance.goCold();
  });

  it("maps a turn limit to idle rather than failed", async () => {
    const emit = vi.fn();
    const instance = runner(emit).instance;
    await instance.send("inspect the repository");
    (instance as any).handleMessage({
      type: "result",
      subtype: "error_max_turns",
      uuid: "result-1",
      session_id: SESSION_ID,
      total_cost_usd: 0.2,
      duration_ms: 100,
      num_turns: 50,
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed", outcome: "max-turns" }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.status", status: "idle" }),
    );
    await instance.goCold();
  });

  it("emits per-turn cost differences rather than a running total", async () => {
    const emit = vi.fn();
    const instance = runner(emit).instance;
    await instance.send("first");
    (instance as any).handleMessage({
      type: "result",
      subtype: "success",
      uuid: "result-1",
      session_id: SESSION_ID,
      total_cost_usd: 0.4,
      duration_ms: 100,
      num_turns: 1,
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    await instance.send("second");
    (instance as any).handleMessage({
      type: "result",
      subtype: "success",
      uuid: "result-2",
      session_id: SESSION_ID,
      total_cost_usd: 0.7,
      duration_ms: 100,
      num_turns: 1,
      usage: { input_tokens: 1, output_tokens: 2 },
    });

    const costs = emit.mock.calls
      .filter(([event]) => event.type === "turn.completed")
      .map(([event]) => event.costUsd);
    expect(costs).toHaveLength(2);
    expect(costs[0]).toBeCloseTo(0.4, 10);
    expect(costs[1]).toBeCloseTo(0.3, 10);
    await instance.goCold();
  });

  it("ignores input_json deltas", async () => {
    const emit = vi.fn();
    const instance = runner(emit).instance;
    await instance.send("use a tool");
    emit.mockClear();
    (instance as any).handleMessage({
      type: "stream_event",
      uuid: "stream-1",
      session_id: SESSION_ID,
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{\"x\":" },
      },
    });
    expect(emit).not.toHaveBeenCalled();
    await instance.goCold();
  });

  it("acknowledges redacted thinking without exposing its data", async () => {
    const emit = vi.fn();
    const instance = runner(emit).instance;
    await instance.send("think carefully");
    (instance as any).handleMessage({
      type: "assistant",
      uuid: "assistant-1",
      session_id: SESSION_ID,
      message: {
        content: [{ type: "redacted_thinking", data: "encrypted-secret" }],
      },
    });

    const event = emit.mock.calls.find(([value]) => value.type === "session.message")?.[0];
    expect(event).toMatchObject({ kind: "thinking" });
    expect(event.text).not.toContain("encrypted-secret");
    await instance.goCold();
  });

  it("denies tool access to paths outside the workspace directory", async () => {
    const instance = runner().instance;
    await instance.send("read server env");
    const canUseTool = queryMock.mock.calls[0]![0].options.canUseTool as any;

    const deniedRead = await canUseTool("Read", { file_path: "/opt/claude-clan/.env" }, {
      toolUseID: "tool-outside-1",
      signal: new AbortController().signal,
      requestId: "req-1",
    });
    expect(deniedRead).toMatchObject({
      behavior: "deny",
    });

    const allowedRead = await canUseTool("Read", { file_path: "src/index.ts" }, {
      toolUseID: "tool-inside-1",
      signal: new AbortController().signal,
      requestId: "req-2",
    });
    expect(allowedRead).toMatchObject({
      behavior: "allow",
    });

    const deniedBash = await canUseTool("Bash", { command: "cat /run/sudo-city.env" }, {
      toolUseID: "tool-bash-1",
      signal: new AbortController().signal,
      requestId: "req-3",
    });
    expect(deniedBash).toMatchObject({
      behavior: "deny",
    });

    const deniedProcBash = await canUseTool("Bash", { command: "cat /proc/1/environ" }, {
      toolUseID: "tool-bash-2",
      signal: new AbortController().signal,
      requestId: "req-4",
    });
    expect(deniedProcBash).toMatchObject({
      behavior: "deny",
    });

    const deniedTraversalBash = await canUseTool("Bash", { command: "cat ../../../.env" }, {
      toolUseID: "tool-bash-3",
      signal: new AbortController().signal,
      requestId: "req-5",
    });
    expect(deniedTraversalBash).toMatchObject({
      behavior: "deny",
    });

    const deniedImdsBash = await canUseTool("Bash", { command: "curl http://169.254.169.254/latest/meta-data/" }, {
      toolUseID: "tool-bash-4",
      signal: new AbortController().signal,
      requestId: "req-6",
    });
    expect(deniedImdsBash).toMatchObject({
      behavior: "deny",
    });

    const deniedNotebook = await canUseTool("NotebookEdit", { notebook_path: "/opt/claude-clan/notebook.ipynb" }, {
      toolUseID: "tool-notebook-1",
      signal: new AbortController().signal,
      requestId: "req-7",
    });
    expect(deniedNotebook).toMatchObject({
      behavior: "deny",
    });
    await instance.goCold();
  });
});
