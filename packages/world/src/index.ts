import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GameEventSchema,
  TRANSCRIPT_PAGE_LIMIT,
  PlotSchema,
  WorldSnapshotSchema,
  type GameEvent,
  type Plot,
  type WorldSnapshot,
} from "@sudo-city/protocol";

export interface SessionRecord {
  sessionId: string;
  cityId: string;
  title: string;
  autoTitled: boolean;
  model: string;
  effort: string;
  permissionMode: string;
  status: string;
  lastTurnOutcome?: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  costUsd: number;
  sequence: number;
  readOnly: boolean;
  closedAt?: string;
}

interface SessionRow {
  session_id: string;
  world_id: string;
  title: string;
  auto_titled: number;
  model: string;
  effort: string;
  permission_mode: string;
  status: string;
  last_turn_outcome: string | null;
  created_at: string;
  updated_at: string;
  turn_count: number;
  cost_usd: number;
  sequence: number;
  read_only: number;
  closed_at: string | null;
}

const SESSION_SCHEMA_COLUMNS = [
  "session_id",
  "world_id",
  "title",
  "auto_titled",
  "model",
  "effort",
  "permission_mode",
  "status",
  "last_turn_outcome",
  "created_at",
  "updated_at",
  "turn_count",
  "cost_usd",
  "sequence",
  "read_only",
  "closed_at",
] as const;

const EVENT_SCHEMA_COLUMNS = [
  "id",
  "session_id",
  "sequence",
  "timestamp",
  "type",
  "payload",
] as const;

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    cityId: row.world_id,
    title: row.title,
    autoTitled: row.auto_titled !== 0,
    model: row.model,
    effort: row.effort,
    permissionMode: row.permission_mode,
    status: row.status,
    lastTurnOutcome: row.last_turn_outcome ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turnCount: row.turn_count,
    costUsd: row.cost_usd,
    sequence: row.sequence,
    readOnly: row.read_only !== 0,
    closedAt: row.closed_at ?? undefined,
  };
}
export interface WorldStore {
  appendEvent(event: GameEvent): void;
  close(): void;
  deleteSession(sessionId: string): void;
  loadLatestSnapshot(worldId: string): WorldSnapshot | undefined;
  loadPlots(worldId: string): Record<string, Plot>;
  loadSessions(cityId?: string): SessionRecord[];
  readEventPage(
    sessionId: string,
    options?: { afterSequence?: number; limit?: number },
  ): { events: GameEvent[]; hasMore: boolean };
  readEvents(sessionId: string): GameEvent[];
  savePlots(worldId: string, plots: Readonly<Record<string, Plot>>): void;
  saveSession(record: SessionRecord): void;
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
    `);
    this.migrateSessionScopedEvents();
    this.migrateWorldScopedTables();
  }

  /**
   * `events.session_id` used to hold a city-scoped id minted once at city
   * construction. It now holds a real conversation id, so retaining those
   * rows would surface one enormous bogus transcript per city. `.sudocity/`
   * is a local cache, so an incompatible sessions table is a migration marker
   * for the old shape, not evidence that the current schema is present.
   */
  private migrateSessionScopedEvents(): void {
    const hasCurrentSchema =
      this.hasAllColumns("sessions", SESSION_SCHEMA_COLUMNS) &&
      this.hasAllColumns("events", EVENT_SCHEMA_COLUMNS);
    if (hasCurrentSchema) {
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS events_session_sequence
          ON events(session_id, sequence);
        CREATE INDEX IF NOT EXISTS sessions_world_updated
          ON sessions(world_id, updated_at DESC);
      `);
      return;
    }

    this.database.exec(`
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS sessions;
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX events_session_sequence
        ON events(session_id, sequence);
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        title TEXT NOT NULL,
        auto_titled INTEGER NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        last_turn_outcome TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        turn_count INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        sequence INTEGER NOT NULL DEFAULT 0,
        read_only INTEGER NOT NULL DEFAULT 0,
        closed_at TEXT
      );
      CREATE INDEX sessions_world_updated
        ON sessions(world_id, updated_at DESC);
    `);
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

  private hasAllColumns(
    table: string,
    columns: readonly string[],
  ): boolean {
    return columns.every((column) => this.hasColumn(table, column));
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
    // Deltas are a live paint of a message the final session.message carries in
    // full. Persisting them would add a row per token and make backfill slower
    // precisely for the busy conversations this cache serves.
    if (event.type === "session.delta") {
      return;
    }
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

  readEventPage(
    sessionId: string,
    options: { afterSequence?: number; limit?: number } = {},
  ): { events: GameEvent[]; hasMore: boolean } {
    const limit = options.limit ?? TRANSCRIPT_PAGE_LIMIT;
    if (limit <= 0) {
      return { events: [], hasMore: true };
    }

    const rows = options.afterSequence === undefined
      ? (this.database
          .prepare(
            `SELECT payload FROM events
             WHERE session_id = ?
             ORDER BY sequence DESC
             LIMIT ?`,
          )
          .all(sessionId, limit + 1) as Array<{ payload: string }>)
      : (this.database
          .prepare(
            `SELECT payload FROM events
             WHERE session_id = ? AND sequence > ?
             ORDER BY sequence ASC
             LIMIT ?`,
          )
          .all(sessionId, options.afterSequence, limit + 1) as Array<{
          payload: string;
        }>);

    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    if (options.afterSequence === undefined) {
      selected.reverse();
    }
    return {
      events: selected.flatMap((row) => {
        const parsed = GameEventSchema.safeParse(JSON.parse(row.payload));
        return parsed.success ? [parsed.data] : [];
      }),
      hasMore,
    };
  }

  saveSession(record: SessionRecord): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO sessions
          (session_id, world_id, title, auto_titled, model, effort,
           permission_mode, status, last_turn_outcome, created_at, updated_at,
           turn_count, cost_usd, sequence, read_only, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.sessionId,
        record.cityId,
        record.title,
        record.autoTitled ? 1 : 0,
        record.model,
        record.effort,
        record.permissionMode,
        record.status,
        record.lastTurnOutcome ?? null,
        record.createdAt,
        record.updatedAt,
        record.turnCount,
        record.costUsd,
        record.sequence,
        record.readOnly ? 1 : 0,
        record.closedAt ?? null,
      );
  }

  loadSessions(cityId?: string): SessionRecord[] {
    const rows = cityId === undefined
      ? (this.database
          .prepare(
            `SELECT session_id, world_id, title, auto_titled, model, effort,
                    permission_mode, status, last_turn_outcome, created_at,
                    updated_at, turn_count, cost_usd, sequence, read_only,
                    closed_at
             FROM sessions ORDER BY updated_at DESC`,
          )
          .all() as unknown as SessionRow[])
      : (this.database
          .prepare(
            `SELECT session_id, world_id, title, auto_titled, model, effort,
                    permission_mode, status, last_turn_outcome, created_at,
                    updated_at, turn_count, cost_usd, sequence, read_only,
                    closed_at
             FROM sessions WHERE world_id = ? ORDER BY updated_at DESC`,
          )
          .all(cityId) as unknown as SessionRow[]);
    return rows.map(sessionFromRow);
  }

  deleteSession(sessionId: string): void {
    const deleteEvents = this.database.prepare(
      `DELETE FROM events WHERE session_id = ?`,
    );
    const deleteSession = this.database.prepare(
      `DELETE FROM sessions WHERE session_id = ?`,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Hard deletion must remove the transcript too; normal session.close is
      // intentionally a soft close so its history remains readable.
      deleteEvents.run(sessionId);
      deleteSession.run(sessionId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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
