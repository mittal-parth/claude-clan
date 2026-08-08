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
});
