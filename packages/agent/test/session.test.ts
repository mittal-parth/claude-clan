import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { AgentSessionManager } from "../src/index.js";

describe("AgentSessionManager", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("ignores stale permit resolutions", async () => {
    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    expect(manager.resolvePermit("missing", "deny")).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits tool.completed when a permit is denied", async () => {
    type CanUseTool = NonNullable<
      import("@anthropic-ai/claude-agent-sdk").Options["canUseTool"]
    >;
    let canUseTool: CanUseTool | undefined;

    queryMock.mockImplementation(({ options }) => {
      canUseTool = options.canUseTool;
      return {
        async *[Symbol.asyncIterator]() {
          // The test only needs to observe permit lifecycle events.
        },
      };
    });

    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    const session = manager.start("write the readme");
    await vi.waitFor(() => expect(canUseTool).toBeDefined());

    void canUseTool!("Write", { file_path: "README.md" }, {
      toolUseID: "tool-1",
      requestId: "req-1",
      signal: new AbortController().signal,
      title: "Permit · Write",
      description: "Write README.md",
    });

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "permit.requested",
          toolCallId: "tool-1",
        }),
      );
    });

    expect(manager.resolvePermit("tool-1", "deny")).toBe(true);
    expect(emit).toHaveBeenCalledWith({
      type: "tool.completed",
      toolCallId: "tool-1",
      outcome: "denied",
    });

    await session;
  });

  it("emits tool.completed for pending permits on interrupt", async () => {
    type CanUseTool = NonNullable<
      import("@anthropic-ai/claude-agent-sdk").Options["canUseTool"]
    >;
    let canUseTool: CanUseTool | undefined;

    queryMock.mockImplementation(({ options }) => {
      canUseTool = options.canUseTool;
      return {
        async *[Symbol.asyncIterator]() {
          // The test only needs to observe permit lifecycle events.
        },
      };
    });

    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    const session = manager.start("write the readme");
    await vi.waitFor(() => expect(canUseTool).toBeDefined());

    const pendingPermit = canUseTool!("Write", { file_path: "README.md" }, {
      toolUseID: "tool-1",
      requestId: "req-1",
      signal: new AbortController().signal,
      title: "Permit · Write",
      description: "Write README.md",
    });
    void pendingPermit.catch(() => {
      // interrupt rejects the permit promise by design
    });

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "permit.requested",
          toolCallId: "tool-1",
        }),
      );
    });

    emit.mockClear();
    await manager.interrupt();
    await session;

    expect(emit).toHaveBeenCalledWith({
      type: "tool.completed",
      toolCallId: "tool-1",
      outcome: "denied",
    });
  });

  it("accepts a read-only configuration -- disallowedTools, a system prompt append, and a mutable budget -- without needing an active query", async () => {
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit: vi.fn(),
      disallowedTools: ["Write", "Edit", "NotebookEdit"],
      systemPromptAppend: "You are reviewing a pull request. Do not edit files.",
      maxBudgetUsd: 1,
    });

    // A global budget ledger rations the remaining balance into each city's
    // manager before every start() -- must be settable after construction.
    expect(() => manager.setMaxBudgetUsd(0.25)).not.toThrow();
    await expect(manager.interrupt()).resolves.toBeUndefined();
  });

  it("passes the order mode to the SDK and session event", async () => {
    const activeQuery = {
      async *[Symbol.asyncIterator]() {
        // The test only needs to observe query construction.
      },
    };
    queryMock.mockReturnValue(activeQuery);

    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    await manager.start("ship the endpoint", "auto", {
      contextPaths: ["src/index.ts"],
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("ship the endpoint"),
        options: expect.objectContaining({
          permissionMode: "auto",
          effort: "high",
        }),
      }),
    );
    expect(queryMock.mock.calls[0]?.[0]?.prompt).toEqual(
      expect.stringContaining("src/index.ts"),
    );
    expect(emit).toHaveBeenCalledWith({
      type: "session.started",
      model: "sonnet",
      effort: "high",
      permissionMode: "auto",
    });
  });

  it("forwards model and effort overrides into the SDK query", async () => {
    const activeQuery = {
      async *[Symbol.asyncIterator]() {
        // The test only needs to observe query construction.
      },
    };
    queryMock.mockReturnValue(activeQuery);

    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    await manager.start("plan the tower", "default", {
      model: "opus",
      effort: "xhigh",
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          model: "opus",
          effort: "xhigh",
        }),
      }),
    );
    expect(emit).toHaveBeenCalledWith({
      type: "session.started",
      model: "opus",
      effort: "xhigh",
      permissionMode: "default",
    });
  });
});
