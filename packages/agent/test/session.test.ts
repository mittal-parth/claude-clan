import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { AgentSessionManager } from "../src/index.js";

describe("AgentSessionManager", () => {
  it("ignores stale permit resolutions and interrupts cleanly", async () => {
    const emit = vi.fn();
    const manager = new AgentSessionManager({
      cwd: process.cwd(),
      emit,
    });

    expect(manager.resolvePermit("missing", "deny")).toBe(false);
    await expect(manager.interrupt()).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
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

    await manager.start("ship the endpoint", "auto", ["src/index.ts"]);

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("ship the endpoint"),
        options: expect.objectContaining({ permissionMode: "auto" }),
      }),
    );
    expect(queryMock.mock.calls[0]?.[0]?.prompt).toEqual(
      expect.stringContaining("src/index.ts"),
    );
    expect(emit).toHaveBeenCalledWith({
      type: "session.started",
      model: "sonnet",
      permissionMode: "auto",
    });
  });
});
