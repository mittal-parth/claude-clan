import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameEvent, WorldSnapshot } from "@sudo-city/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { SQLiteWorldStore } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): SQLiteWorldStore {
  const directory = mkdtempSync(join(tmpdir(), "sudo-city-world-"));
  temporaryDirectories.push(directory);
  return new SQLiteWorldStore(join(directory, "world.db"));
}

describe("SQLiteWorldStore", () => {
  it("round-trips ordered events and snapshots", () => {
    const store = createStore();
    const event: GameEvent = {
      id: "evt_1",
      cityId: "main",
      sessionId: "session_1",
      sequence: 1,
      timestamp: "2026-08-08T00:00:00.000Z",
      type: "session.message",
      role: "system",
      text: "Ready",
    };
    const snapshot: WorldSnapshot = {
      id: "world:one",
      repoPath: "/tmp/repo",
      revision: "one",
      generatedAt: "2026-08-08T00:00:00.000Z",
      size: { width: 12, height: 12 },
      districts: [
        { path: "", x: 0, y: 0, width: 5.5, height: 12, weight: 40 },
        { path: "src", x: 5.5, y: 0, width: 6.5, height: 12, weight: 60 },
      ],
      buildings: [
        {
          path: "src/index.ts",
          district: "src",
          language: "TypeScript",
          loc: 60,
          plot: { x: 7, y: 1 },
        },
      ],
    };

    store.appendEvent(event);
    store.saveSnapshot("main", snapshot);

    expect(store.readEvents("session_1")).toEqual([event]);

    const loaded = store.loadLatestSnapshot("main");
    expect(loaded).toEqual(snapshot);
    // Geometry travels through SQLite intact, fractional rects and all.
    expect(loaded?.size).toEqual({ width: 12, height: 12 });
    expect(loaded?.districts).toHaveLength(2);
    expect(loaded?.districts[0]?.path).toBe("");
    expect(loaded?.districts[1]?.width).toBeCloseTo(6.5, 10);
    expect(loaded?.buildings[0]?.plot).toEqual({ x: 7, y: 1 });
    store.close();
  });

  it("keeps existing plot coordinates immutable", () => {
    const store = createStore();
    store.savePlots("main", { "src/index.ts": { x: 2, y: 4 } });
    store.savePlots("main", { "src/index.ts": { x: 8, y: 9 } });

    expect(store.loadPlots("main")).toEqual({
      "src/index.ts": { x: 2, y: 4 },
    });
    store.close();
  });

  it("keeps plots and snapshots isolated between worlds", () => {
    const store = createStore();

    store.savePlots("main", { "src/index.ts": { x: 2, y: 4 } });
    store.savePlots("pr-42", { "src/index.ts": { x: 9, y: 9 } });

    expect(store.loadPlots("main")).toEqual({
      "src/index.ts": { x: 2, y: 4 },
    });
    expect(store.loadPlots("pr-42")).toEqual({
      "src/index.ts": { x: 9, y: 9 },
    });

    const mainSnapshot: WorldSnapshot = {
      id: "world:same-sha",
      repoPath: "/tmp/repo",
      revision: "same-sha",
      generatedAt: "2026-08-08T00:00:00.000Z",
      size: { width: 12, height: 12 },
      districts: [],
      buildings: [],
    };
    const prSnapshot: WorldSnapshot = {
      ...mainSnapshot,
      repoPath: "/tmp/repo-pr-42",
    };

    // Two branches at the same sha share a snapshot id -- world_id is what
    // keeps INSERT OR REPLACE from letting one city clobber the other.
    store.saveSnapshot("main", mainSnapshot);
    store.saveSnapshot("pr-42", prSnapshot);

    expect(store.loadLatestSnapshot("main")).toEqual(mainSnapshot);
    expect(store.loadLatestSnapshot("pr-42")).toEqual(prSnapshot);
    expect(store.loadLatestSnapshot("pr-99")).toBeUndefined();

    store.close();
  });
});
