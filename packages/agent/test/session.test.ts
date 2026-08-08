import { describe, expect, it, vi } from "vitest";
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
});
