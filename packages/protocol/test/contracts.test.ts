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

const snapshot = {
  id: "world:commit-a",
  repoPath: "/fixture/tiny-app",
  revision: "commit-a",
  generatedAt: "2026-08-08T05:38:00.000Z",
  size: { width: 64, height: 64 },
  districts: [
    // Root-level files land in a district whose path is "", and squarify
    // divides by area, so rectangles are fractional.
    { path: "", x: 0, y: 0, width: 21.333, height: 64, weight: 40 },
    { path: "src", x: 21.333, y: 0, width: 42.667, height: 64, weight: 120 },
  ],
  buildings: [
    {
      path: "src/index.ts",
      district: "src",
      language: "TypeScript",
      loc: 120,
      plot: { x: 22, y: 1 },
    },
  ],
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

  it("carries world size and district geometry on world.ready", () => {
    const result = GameEventSchema.parse({
      ...base,
      type: "world.ready",
      snapshot,
    });

    if (result.type !== "world.ready") {
      throw new Error("expected a world.ready event");
    }
    expect(result.snapshot.size).toEqual({ width: 64, height: 64 });
    expect(result.snapshot.districts).toHaveLength(2);
    expect(result.snapshot.districts[0]).toEqual({
      path: "",
      x: 0,
      y: 0,
      width: 21.333,
      height: 64,
      weight: 40,
    });
    expect(result.snapshot.buildings).toEqual(snapshot.buildings);
  });

  it("rejects a snapshot without district geometry", () => {
    const { districts: _districts, ...withoutDistricts } = snapshot;

    expect(() =>
      GameEventSchema.parse({
        ...base,
        type: "world.ready",
        snapshot: withoutDistricts,
      }),
    ).toThrow();
  });

  it("rejects a snapshot without a world size", () => {
    const { size: _size, ...withoutSize } = snapshot;

    expect(() =>
      GameEventSchema.parse({ ...base, type: "world.ready", snapshot: withoutSize }),
    ).toThrow();
  });

  it("rejects unknown event variants", () => {
    expect(() =>
      GameEventSchema.parse({ ...base, type: "city.exploded" }),
    ).toThrow();
  });

  it("carries permission mode on an individual order", () => {
    const command = MayorCommandSchema.parse({
      type: "session.prompt",
      prompt: "add an endpoint",
      permissionMode: "auto",
    });

    expect(command).toEqual({
      type: "session.prompt",
      prompt: "add an endpoint",
      permissionMode: "auto",
    });

    const started = GameEventSchema.parse({
      ...base,
      type: "session.started",
      model: "sonnet",
      permissionMode: "auto",
    });
    expect(started).toMatchObject({
      type: "session.started",
      permissionMode: "auto",
    });

    const legacyStarted = GameEventSchema.parse({
      ...base,
      type: "session.started",
      model: "sonnet",
    });
    expect(legacyStarted).toMatchObject({ permissionMode: "default" });
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
