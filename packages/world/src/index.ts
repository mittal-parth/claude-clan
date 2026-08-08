import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GameEventSchema,
  PlotSchema,
  WorldSnapshotSchema,
  type GameEvent,
  type Plot,
  type WorldSnapshot,
} from "@sudo-city/protocol";

export interface WorldStore {
  appendEvent(event: GameEvent): void;
  close(): void;
  loadLatestSnapshot(): WorldSnapshot | undefined;
  loadPlots(): Record<string, Plot>;
  readEvents(sessionId: string): GameEvent[];
  savePlots(plots: Readonly<Record<string, Plot>>): void;
  saveSnapshot(snapshot: WorldSnapshot): void;
}

export class SQLiteWorldStore implements WorldStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS events_session_sequence
        ON events(session_id, sequence);
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plots (
        path TEXT PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL
      );
    `);
  }

  appendEvent(event: GameEvent): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO events
          (id, session_id, sequence, timestamp, type, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.sessionId,
        event.sequence,
        event.timestamp,
        event.type,
        JSON.stringify(event),
      );
  }

  readEvents(sessionId: string): GameEvent[] {
    const rows = this.database
      .prepare(
        `SELECT payload FROM events
         WHERE session_id = ?
         ORDER BY sequence ASC`,
      )
      .all(sessionId) as Array<{ payload: string }>;
    return rows.map((row) => GameEventSchema.parse(JSON.parse(row.payload)));
  }

  saveSnapshot(snapshot: WorldSnapshot): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO snapshots (id, generated_at, payload)
         VALUES (?, ?, ?)`,
      )
      .run(snapshot.id, snapshot.generatedAt, JSON.stringify(snapshot));
  }

  loadLatestSnapshot(): WorldSnapshot | undefined {
    const row = this.database
      .prepare(
        `SELECT payload FROM snapshots
         ORDER BY generated_at DESC
         LIMIT 1`,
      )
      .get() as { payload: string } | undefined;
    return row
      ? WorldSnapshotSchema.parse(JSON.parse(row.payload))
      : undefined;
  }

  savePlots(plots: Readonly<Record<string, Plot>>): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO plots (path, x, y) VALUES (?, ?, ?)`,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [path, plot] of Object.entries(plots)) {
        insert.run(path, plot.x, plot.y);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadPlots(): Record<string, Plot> {
    const rows = this.database
      .prepare("SELECT path, x, y FROM plots ORDER BY path")
      .all() as Array<{ path: string; x: number; y: number }>;
    return Object.fromEntries(
      rows.map((row) => [
        row.path,
        PlotSchema.parse({ x: row.x, y: row.y }),
      ]),
    );
  }

  close(): void {
    this.database.close();
  }
}
