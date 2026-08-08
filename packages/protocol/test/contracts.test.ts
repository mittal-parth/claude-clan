import { describe, expect, it } from "vitest";
import {
  GameEventSchema,
  MayorCommandSchema,
  ServerMessageSchema,
} from "../src/index.js";

const base = {
  id: "evt_1",
  sessionId: "session_1",
  sequence: 0,
  timestamp: "2026-08-08T05:38:00.000Z",
};

describe("protocol contracts", () => {
  it("parses a file change event envelope", () => {
    const result = ServerMessageSchema.parse({
      kind: "event",
      event: {
        ...base,
        type: "file.changed",
        path: "src/index.ts",
        change: "modified",
      },
    });

    expect(result.kind).toBe("event");
  });

  it("rejects unknown event variants", () => {
    expect(() =>
      GameEventSchema.parse({ ...base, type: "city.exploded" }),
    ).toThrow();
  });

  it("trims and validates mayor prompts", () => {
    const command = MayorCommandSchema.parse({
      type: "session.prompt",
      prompt: "  add an endpoint  ",
    });

    expect(command).toEqual({
      type: "session.prompt",
      prompt: "add an endpoint",
    });
  });
});
