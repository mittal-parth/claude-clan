import { describe, expect, it } from "vitest";
import {
  CityIdSchema,
  GameEventSchema,
  MayorCommandSchema,
  PullRequestOverlaySchema,
  ServerMessageSchema,
} from "../src/index.js";

const base = {
  id: "evt_1",
  cityId: "main",
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

  it("carries layoutVersion when present, and parses fine without it", () => {
    const withVersion = GameEventSchema.parse({
      ...base,
      type: "world.ready",
      snapshot: { ...snapshot, layoutVersion: 2 },
    });
    if (withVersion.type !== "world.ready") {
      throw new Error("expected a world.ready event");
    }
    expect(withVersion.snapshot.layoutVersion).toBe(2);

    // A snapshot persisted by older code has no layoutVersion at all -- that
    // absence is itself the signal the server uses to tell a stale snapshot
    // from a current one, so it must still parse rather than be rejected.
    const withoutVersion = GameEventSchema.parse({
      ...base,
      type: "world.ready",
      snapshot,
    });
    if (withoutVersion.type !== "world.ready") {
      throw new Error("expected a world.ready event");
    }
    expect(withoutVersion.snapshot.layoutVersion).toBeUndefined();
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
      cityId: "main",
      prompt: "add an endpoint",
      permissionMode: "auto",
      contextPaths: ["src/index.ts", "packages/protocol/src/index.ts"],
    });

    expect(command).toEqual({
      type: "session.prompt",
      cityId: "main",
      prompt: "add an endpoint",
      permissionMode: "auto",
      contextPaths: ["src/index.ts", "packages/protocol/src/index.ts"],
    });

    const started = GameEventSchema.parse({
      ...base,
      type: "session.started",
      model: "sonnet",
      effort: "xhigh",
      permissionMode: "auto",
    });
    expect(started).toMatchObject({
      type: "session.started",
      effort: "xhigh",
      permissionMode: "auto",
    });

    const legacyStarted = GameEventSchema.parse({
      ...base,
      type: "session.started",
      model: "sonnet",
    });
    expect(legacyStarted).toMatchObject({
      permissionMode: "default",
      effort: "high",
    });
  });

  it("accepts model and effort on session.prompt", () => {
    const command = MayorCommandSchema.parse({
      type: "session.prompt",
      cityId: "main",
      prompt: "refactor the district",
      model: "opus",
      effort: "max",
    });

    expect(command).toEqual({
      type: "session.prompt",
      cityId: "main",
      prompt: "refactor the district",
      model: "opus",
      effort: "max",
    });
  });

  it("trims and validates mayor prompts", () => {
    const command = MayorCommandSchema.parse({
      type: "session.prompt",
      cityId: "main",
      prompt: "  add an endpoint  ",
    });

    expect(command).toEqual({
      type: "session.prompt",
      cityId: "main",
      prompt: "add an endpoint",
    });
  });

  it("accepts main, PR, and issue city ids, rejects anything else", () => {
    expect(CityIdSchema.parse("main")).toBe("main");
    expect(CityIdSchema.parse("pr-42")).toBe("pr-42");
    expect(CityIdSchema.parse("issue-12")).toBe("issue-12");
    expect(() => CityIdSchema.parse("pr-")).toThrow();
    expect(() => CityIdSchema.parse("staging")).toThrow();
    expect(() => CityIdSchema.parse("")).toThrow();
  });

  it("routes a city travel command", () => {
    const command = MayorCommandSchema.parse({
      type: "city.travel",
      cityId: "pr-42",
    });

    expect(command).toEqual({ type: "city.travel", cityId: "pr-42" });
  });

  it("parses a city roster message", () => {
    const message = ServerMessageSchema.parse({
      kind: "cities",
      cities: [
        {
          id: "main",
          kind: "main",
          title: "main",
          ref: "main",
          status: "ready",
        },
        {
          id: "pr-42",
          kind: "pull-request",
          title: "#42 Fix the thing",
          ref: "feat/fix-thing",
          number: 42,
          author: "octocat",
          url: "https://github.com/example/example/pull/42",
          status: "building",
        },
      ],
    });

    if (message.kind !== "cities") {
      throw new Error("expected a cities message");
    }
    expect(message.cities).toHaveLength(2);
    expect(message.cities[1]?.number).toBe(42);
  });

  it("parses a pull request overlay with a deleted file's original plot", () => {
    const overlay = PullRequestOverlaySchema.parse({
      cityId: "pr-42",
      baseRef: "main",
      headSha: "abc123",
      files: [
        { path: "src/new.ts", change: "added", additions: 10, deletions: 0 },
        {
          path: "src/gone.ts",
          change: "deleted",
          additions: 0,
          deletions: 20,
          plot: { x: 3, y: 5 },
        },
      ],
    });

    expect(overlay.files[1]?.plot).toEqual({ x: 3, y: 5 });
  });

  it("parses session.auth and repo.select commands", () => {
    expect(
      MayorCommandSchema.parse({ type: "session.auth", token: "sealed-token" }),
    ).toEqual({ type: "session.auth", token: "sealed-token" });
    expect(
      MayorCommandSchema.parse({ type: "repo.select", repoKey: "octocat/hello-world" }),
    ).toEqual({ type: "repo.select", repoKey: "octocat/hello-world" });
  });

  it("parses a repos roster message and a repo.status update", () => {
    const repos = ServerMessageSchema.parse({
      kind: "repos",
      repos: [
        {
          key: "octocat/hello-world",
          fullName: "octocat/hello-world",
          owner: "octocat",
          name: "hello-world",
          private: false,
          defaultBranch: "main",
          imported: true,
        },
      ],
      activeRepoKey: "octocat/hello-world",
    });
    if (repos.kind !== "repos") {
      throw new Error("expected a repos message");
    }
    expect(repos.repos[0]?.key).toBe("octocat/hello-world");

    const status = ServerMessageSchema.parse({
      kind: "repo.status",
      repoKey: "octocat/hello-world",
      phase: "cloning",
      percent: 40,
    });
    expect(status).toMatchObject({ phase: "cloning", percent: 40 });
  });
});
