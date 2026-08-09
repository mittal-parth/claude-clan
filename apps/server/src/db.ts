import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { GitHubTokens } from "@sudo-city/cities";

export interface DbUser {
  id: number;
  login: string;
  avatarUrl: string;
}

export interface DbSession {
  id: string;
  userId: number;
  login: string;
  avatarUrl: string;
  tokens: GitHubTokens;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS imported_repos (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_key TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  clone_path TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_key)
);
`;

/**
 * Sessions are now a server-side row, not a self-contained sealed token --
 * the bearer token the client holds is just an opaque random id (never
 * changes), so refreshing the underlying GitHub access token is an in-place
 * UPDATE rather than minting and handing back a new bearer token. This also
 * makes revocation trivial (DELETE/mark revoked) and survives a server
 * restart, unlike the AES-sealed tokens this replaces.
 */
export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertUser(user: DbUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, login, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET login = $2, avatar_url = $3, updated_at = now()`,
      [user.id, user.login, user.avatarUrl],
    );
  }

  /** Session ids are opaque and unguessable (256 bits) -- there's no encoded payload for a client to tamper with, only a row to look up. */
  async createSession(user: DbUser, tokens: GitHubTokens): Promise<string> {
    await this.upsertUser(user);
    const id = randomBytes(32).toString("base64url");
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, access_token, refresh_token, expires_at, refresh_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        user.id,
        tokens.accessToken,
        tokens.refreshToken ?? null,
        tokens.expiresAt,
        tokens.refreshTokenExpiresAt ?? null,
      ],
    );
    return id;
  }

  async getSession(id: string): Promise<DbSession | undefined> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      login: string;
      avatar_url: string;
      access_token: string;
      refresh_token: string | null;
      expires_at: Date;
      refresh_token_expires_at: Date | null;
    }>(
      `SELECT s.id, s.user_id, u.login, u.avatar_url, s.access_token, s.refresh_token, s.expires_at, s.refresh_token_expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.revoked_at IS NULL`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      userId: Number(row.user_id),
      login: row.login,
      avatarUrl: row.avatar_url,
      tokens: {
        accessToken: row.access_token,
        refreshToken: row.refresh_token ?? undefined,
        expiresAt: row.expires_at.toISOString(),
        refreshTokenExpiresAt: row.refresh_token_expires_at?.toISOString(),
      },
    };
  }

  /** In-place: the bearer token the client holds never changes, so a refresh has nothing to hand back to the client. */
  async updateSessionTokens(id: string, tokens: GitHubTokens): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET access_token = $2, refresh_token = $3, expires_at = $4, refresh_token_expires_at = $5
       WHERE id = $1`,
      [
        id,
        tokens.accessToken,
        tokens.refreshToken ?? null,
        tokens.expiresAt,
        tokens.refreshTokenExpiresAt ?? null,
      ],
    );
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [id]);
  }

  async markRepoImported(options: {
    userId: number;
    repoKey: string;
    owner: string;
    name: string;
    clonePath: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO imported_repos (user_id, repo_key, owner, name, clone_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, repo_key) DO UPDATE SET clone_path = $5, imported_at = now()`,
      [options.userId, options.repoKey, options.owner, options.name, options.clonePath],
    );
  }

  async importedRepoKeys(userId: number): Promise<Set<string>> {
    const result = await this.pool.query<{ repo_key: string }>(
      `SELECT repo_key FROM imported_repos WHERE user_id = $1`,
      [userId],
    );
    return new Set(result.rows.map((row) => row.repo_key));
  }

  /** The clone_path a previous (possibly since-restarted) process recorded for this repo, if any -- lets a workspace reopen from an on-disk clone instead of re-cloning after a restart. */
  async clonePathFor(userId: number, repoKey: string): Promise<string | undefined> {
    const result = await this.pool.query<{ clone_path: string }>(
      `SELECT clone_path FROM imported_repos WHERE user_id = $1 AND repo_key = $2`,
      [userId, repoKey],
    );
    return result.rows[0]?.clone_path;
  }
}
