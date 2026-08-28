import { describe, expect, it } from "vitest";
import { SessionStatusSchema, TurnOutcomeSchema } from "@sudo-city/protocol";
import { presentStatus } from "./status";

describe("presentStatus", () => {
  it("provides a presentation for every protocol status", () => {
    for (const status of SessionStatusSchema.options) {
      const presentation = presentStatus(status, "success");
      expect(presentation.label).toBeTruthy();
      expect(presentation.tone).toMatch(/^--color-/);
    }
  });

  it("makes only permits urgent and labels live statuses", () => {
    for (const status of SessionStatusSchema.options) {
      const presentation = presentStatus(status);
      expect(presentation.urgent).toBe(status === "awaiting-permit");
      expect(presentation.live).toBe(
        ["starting", "thinking", "working", "awaiting-permit", "compacting"].includes(status),
      );
    }
    expect(presentStatus("awaiting-permit").label).toBe("PERMIT");
    expect(presentStatus("idle", "success").label).toBe("DONE");
    expect(presentStatus("idle", "budget-exhausted").label).not.toBe("DONE");
  });

  it("covers every terminal outcome in the protocol", () => {
    for (const outcome of TurnOutcomeSchema.options) {
      expect(presentStatus("idle", outcome).label).toBeTruthy();
    }
  });
});
