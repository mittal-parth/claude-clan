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
      buildings: [],
    };

    store.appendEvent(event);
    store.saveSnapshot(snapshot);

    expect(store.readEvents("session_1")).toEqual([event]);
    expect(store.loadLatestSnapshot()).toEqual(snapshot);
    store.close();
  });

  it("keeps existing plot coordinates immutable", () => {
    const store = createStore();
    store.savePlots({ "src/index.ts": { x: 2, y: 4 } });
    store.savePlots({ "src/index.ts": { x: 8, y: 9 } });

    expect(store.loadPlots()).toEqual({
      "src/index.ts": { x: 2, y: 4 },
    });
    store.close();
  });
});
