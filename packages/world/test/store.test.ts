import { DatabaseSync } from "node:sqlite";
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
      messageId: "message_1",
      role: "system",
      kind: "notice",
      text: "Ready",
      contextPaths: [],
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


describe("session persistence", () => {
  function messageEvent(sessionId: string, sequence: number): GameEvent {
    return {
      id: `${sessionId}-event-${sequence}`,
      cityId: "main",
      sessionId,
      sequence,
      timestamp: "2026-08-08T00:00:00.000Z",
      type: "session.message",
      messageId: `${sessionId}-message-${sequence}`,
      role: "agent",
      kind: "text",
      text: `message ${sequence}`,
      contextPaths: [],
    };
  }

  it("round-trips session records and filters them by city", () => {
    const store = createStore();
    const record = {
      sessionId: "session-main",
      cityId: "main",
      title: "Main order",
      autoTitled: false,
      model: "sonnet",
      effort: "high",
      permissionMode: "default",
      status: "idle",
      lastTurnOutcome: "success",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:01:00.000Z",
      turnCount: 2,
      costUsd: 0.25,
      sequence: 8,
      readOnly: true,
      closedAt: "2026-08-08T00:02:00.000Z",
    };
    store.saveSession(record);
    store.saveSession({
      ...record,
      sessionId: "session-pr",
      cityId: "pr-51",
      title: "Review order",
      updatedAt: "2026-08-08T00:03:00.000Z",
      closedAt: undefined,
    });

    expect(store.loadSessions()).toEqual([
      { ...record, sessionId: "session-pr", cityId: "pr-51", title: "Review order", updatedAt: "2026-08-08T00:03:00.000Z", closedAt: undefined },
      record,
    ]);
    expect(store.loadSessions("pr-51")).toEqual([
      { ...record, sessionId: "session-pr", cityId: "pr-51", title: "Review order", updatedAt: "2026-08-08T00:03:00.000Z", closedAt: undefined },
    ]);
    store.close();
  });

  it("allows the same sequence in separate sessions", () => {
    const store = createStore();
    store.appendEvent(messageEvent("session-a", 0));
    store.appendEvent(messageEvent("session-b", 0));

    expect(store.readEvents("session-a")).toHaveLength(1);
    expect(store.readEvents("session-b")).toHaveLength(1);
    store.close();
  });

  it("pages newest events by default and later events after a cursor", () => {
    const store = createStore();
    for (const sequence of [0, 1, 2, 3, 4]) {
      store.appendEvent(messageEvent("session-page", sequence));
    }

    const newest = store.readEventPage("session-page", { limit: 2 });
    expect(newest.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(newest.hasMore).toBe(true);

    const later = store.readEventPage("session-page", {
      afterSequence: 1,
      limit: 2,
    });
    expect(later.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(later.hasMore).toBe(true);
    store.close();
  });

  it("does not persist live session deltas", () => {
    const store = createStore();
    store.appendEvent({
      ...messageEvent("session-delta", 0),
      id: "delta-event",
      type: "session.delta",
      messageId: "message-delta",
      kind: "text",
      text: "partial",
    });

    expect(store.readEvents("session-delta")).toEqual([]);
    store.close();
  });

  it("drops an old events table when the sessions migration marker is absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "sudo-city-world-legacy-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "world.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      INSERT INTO events VALUES ('legacy', 'main', 0, '2026-08-08T00:00:00.000Z', 'session.message', '{}');
    `);
    legacy.close();

    const store = new SQLiteWorldStore(databasePath);
    expect(store.readEvents("main")).toEqual([]);
    store.close();
  });

  it("replaces an incompatible legacy sessions table", () => {
    const directory = mkdtempSync(join(tmpdir(), "sudo-city-world-legacy-sessions-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "world.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        city_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        sdk_session_id TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        turn_count INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sessions VALUES ('legacy-session', 'main', 'Old order', 'idle', 'sonnet', 'high', NULL, 0, 0, 0, 0, 0, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      INSERT INTO events VALUES ('legacy-event', 'legacy-session', 0, '2026-08-08T00:00:00.000Z', 'session.message', '{}');
    `);
    legacy.close();

    const store = new SQLiteWorldStore(databasePath);
    expect(store.loadSessions()).toEqual([]);
    expect(store.readEvents("legacy-session")).toEqual([]);
    store.close();
  });
});
