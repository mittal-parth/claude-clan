import { describe, expect, it } from "vitest";
import type { GameEvent, SessionSummary } from "@sudo-city/protocol";
import { toChatItems } from "./transcript";
import type { SessionView } from "./types";

const TIMESTAMP = "2026-08-25T12:00:00.000Z";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "session-1",
    cityId: "main",
    title: "Order",
    autoTitled: true,
    status: "idle",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    turnCount: 1,
    costUsd: 0.04,
    pendingPermitCount: 0,
    queuedCount: 0,
    live: false,
    readOnly: false,
    lastSequence: 20,
    ...overrides,
  };
}

function view(events: GameEvent[], streaming: Record<string, string> = {}, status: SessionSummary["status"] = "idle"): SessionView {
  return {
    summary: summary({ status }),
    events,
    streaming,
    seenSequence: 20,
    hydrated: true,
    pending: [],
    trimmed: false,
    eventIds: new Set(events.map((event) => event.id)),
  };
}

function event(sequence: number, type: GameEvent["type"], extra: Record<string, unknown>): GameEvent {
  return {
    id: `event-${sequence}`,
    cityId: "main",
    sessionId: "session-1",
    sequence,
    timestamp: TIMESTAMP,
    type,
    ...extra,
  } as GameEvent;
}

describe("toChatItems", () => {
  it("keeps chat order ascending and mutates a tool card on completion", () => {
    const items = toChatItems(view([
      event(2, "tool.completed", { toolCallId: "tool-1", outcome: "success", durationMs: 120 }),
      event(1, "tool.started", { toolCallId: "tool-1", tool: "Bash", target: "pnpm test" }),
      event(3, "session.message", { messageId: "message-1", role: "agent", text: "done" }),
    ]));

    const tool = items.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({ toolCallId: "tool-1", status: "success", durationMs: 120 });
    expect(items.map((item) => item.sequence)).toEqual([1, 3]);
  });

  it("renders an orphan tool completion rather than dropping the denial", () => {
    const [item] = toChatItems(view([
      event(1, "tool.completed", { toolCallId: "tool-1", outcome: "denied" }),
    ]));
    expect(item).toMatchObject({ kind: "tool", status: "denied", toolCallId: "tool-1" });
  });

  it("keeps a resolved permit visible with its decision", () => {
    const items = toChatItems(view([
      event(1, "permit.requested", {
        toolCallId: "tool-1",
        tool: "Bash",
        message: "Run command",
        input: { command: "pnpm test" },
      }),
      event(2, "permit.resolved", { toolCallId: "tool-1", decision: "allow-always" }),
    ]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "permit", decision: "allow-always" });
  });

  it("maps thinking and system messages without inspecting their prose", () => {
    const items = toChatItems(view([
      event(1, "session.message", { messageId: "thinking-1", role: "agent", kind: "thinking", text: "maximum number of turns" }),
      event(2, "session.message", { messageId: "notice-1", role: "system", kind: "notice", text: "ordinary notice" }),
    ], {}, "failed"));

    expect(items[0]).toMatchObject({ kind: "thinking", text: "maximum number of turns" });
    expect(items[1]).toMatchObject({ kind: "notice", tone: "error" });
  });

  it("adds live deltas only when a final message has not arrived", () => {
    const items = toChatItems(view([
      event(1, "session.message", { messageId: "final", role: "agent", text: "final" }),
    ], { final: "duplicate", live: "still streaming" }));

    expect(items.filter((item) => item.kind === "crew")).toHaveLength(2);
    expect(items.find((item) => item.id === "stream:final")).toBeUndefined();
    expect(items.find((item) => item.id === "stream:live")).toMatchObject({ streaming: true });
  });

  it("renders turn dividers and excludes turn.started and usage events", () => {
    const items = toChatItems(view([
      event(1, "turn.started", { turnId: "turn-1", prompt: "start", contextPaths: [] }),
      event(2, "session.usage", { costUsd: 0.01, inputTokens: 10, outputTokens: 4 }),
      event(3, "turn.completed", { turnId: "turn-1", outcome: "max-turns", costUsd: 0.01, inputTokens: 10, outputTokens: 4, durationMs: 100 }),
    ]));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "turn", outcome: "max-turns" });
  });

  it("collapses repeated file, subagent, and task updates", () => {
    const items = toChatItems(view([
      event(1, "file.changed", { path: "src/a.ts", change: "modified" }),
      event(2, "file.changed", { path: "src/a.ts", change: "added" }),
      event(3, "subagent.changed", { subagentId: "agent-1", status: "started", agentType: "Explore" }),
      event(4, "subagent.changed", { subagentId: "agent-1", status: "stopped", agentType: "Explore" }),
      event(5, "task.changed", { taskId: "task-1", status: "created", subject: "Inspect" }),
      event(6, "task.changed", { taskId: "task-1", status: "completed", subject: "Inspect" }),
    ]));

    expect(items).toHaveLength(3);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "file", change: "added" }),
      expect.objectContaining({ kind: "subagent", running: false }),
      expect.objectContaining({ kind: "task", done: true }),
    ]));
  });
});
