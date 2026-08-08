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
  loadLatestSnapshot(worldId: string): WorldSnapshot | undefined;
  loadPlots(worldId: string): Record<string, Plot>;
  readEvents(sessionId: string): GameEvent[];
  savePlots(worldId: string, plots: Readonly<Record<string, Plot>>): void;
  saveSnapshot(worldId: string, snapshot: WorldSnapshot): void;
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
    `);
    this.migrateWorldScopedTables();
  }

  /**
   * `plots` and `snapshots` predate per-city worlds and had no world column, so a
   * second city would silently steal the first city's coordinates. `.sudocity/`
   * is a gitignored local cache with nothing worth an ALTER migration, so an old
   * shape is just dropped and recreated empty.
   */
  private migrateWorldScopedTables(): void {
    if (this.hasColumn("plots", "world_id")) {
      return;
    }
    this.database.exec(`
      DROP TABLE IF EXISTS plots;
      DROP TABLE IF EXISTS snapshots;
      CREATE TABLE plots (
        world_id TEXT NOT NULL,
        path TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        PRIMARY KEY (world_id, path)
      );
      CREATE TABLE snapshots (
        id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (world_id, id)
      );
      CREATE INDEX snapshots_world_generated
        ON snapshots(world_id, generated_at);
    `);
  }

  private hasColumn(table: string, column: string): boolean {
    const exists = this.database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(table);
    if (!exists) {
      return false;
    }
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    return columns.some((entry) => entry.name === column);
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
    return rows.flatMap((row) => {
      const parsed = GameEventSchema.safeParse(JSON.parse(row.payload));
      return parsed.success ? [parsed.data] : [];
    });
  }

  saveSnapshot(worldId: string, snapshot: WorldSnapshot): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO snapshots (id, world_id, generated_at, payload)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        worldId,
        snapshot.generatedAt,
        JSON.stringify(snapshot),
      );
  }

  loadLatestSnapshot(worldId: string): WorldSnapshot | undefined {
    const row = this.database
      .prepare(
        `SELECT payload FROM snapshots
         WHERE world_id = ?
         ORDER BY generated_at DESC
         LIMIT 1`,
      )
      .get(worldId) as { payload: string } | undefined;
    return row
      ? WorldSnapshotSchema.parse(JSON.parse(row.payload))
      : undefined;
  }

  savePlots(worldId: string, plots: Readonly<Record<string, Plot>>): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO plots (world_id, path, x, y) VALUES (?, ?, ?, ?)`,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [path, plot] of Object.entries(plots)) {
        insert.run(worldId, path, plot.x, plot.y);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadPlots(worldId: string): Record<string, Plot> {
    const rows = this.database
      .prepare(
        "SELECT path, x, y FROM plots WHERE world_id = ? ORDER BY path",
      )
      .all(worldId) as Array<{ path: string; x: number; y: number }>;
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
