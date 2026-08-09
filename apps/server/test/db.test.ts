import { loadEnvFile } from "node:process";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/db.js";

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(join(import.meta.dirname, "../../../.env"));
  } catch {
    // No local .env -- DATABASE_URL just stays unset, and the suite skips.
  }
}

// A real Postgres integration test, not a mocked one -- db.ts is a thin SQL
// wrapper, and the SQL itself (upserts, joins, constraints) is exactly what
// would silently break if mocked. Skips entirely without DATABASE_URL
// (e.g. in CI without a database configured) rather than failing the suite.
describe.skipIf(!process.env.DATABASE_URL)("Database", () => {
  const db = new Database(process.env.DATABASE_URL!);
  // Fake GitHub user ids, far outside any real range, so this suite never
  // collides with real session data in the same database.
  const userA = { id: -1001, login: "test-user-a", avatarUrl: "https://example.com/a.png" };
  const tokens = {
    accessToken: "ghu_test",
    refreshToken: "ghr_test",
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };

  beforeAll(async () => {
    await db.migrate();
  });

  afterAll(async () => {
    // ON DELETE CASCADE takes sessions/imported_repos with it.
    const cleanup = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup.query("DELETE FROM users WHERE id = $1", [userA.id]);
    await cleanup.end();
    await db.close();
  });

  it("creates a session and looks it up", async () => {
    const sessionId = await db.createSession(userA, tokens);
    expect(sessionId).toHaveLength(43); // 32 random bytes, base64url

    const session = await db.getSession(sessionId);
    expect(session).toMatchObject({
      id: sessionId,
      userId: userA.id,
      login: userA.login,
      avatarUrl: userA.avatarUrl,
      tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    });
  });

  it("returns undefined for an unknown session", async () => {
    expect(await db.getSession("not-a-real-session-id")).toBeUndefined();
  });

  it("updates tokens in place without changing the session id", async () => {
    const sessionId = await db.createSession(userA, tokens);
    const refreshed = { ...tokens, accessToken: "ghu_refreshed" };
    await db.updateSessionTokens(sessionId, refreshed);
    const session = await db.getSession(sessionId);
    expect(session?.tokens.accessToken).toBe("ghu_refreshed");
  });

  it("stops returning a revoked session", async () => {
    const sessionId = await db.createSession(userA, tokens);
    await db.revokeSession(sessionId);
    expect(await db.getSession(sessionId)).toBeUndefined();
  });

  it("tracks imported repos per user, upserting on repeated import", async () => {
    await db.markRepoImported({
      userId: userA.id,
      repoKey: "octocat/hello-world",
      owner: "octocat",
      name: "hello-world",
      clonePath: "/tmp/sudocity/octocat/hello-world",
    });
    expect(await db.importedRepoKeys(userA.id)).toEqual(new Set(["octocat/hello-world"]));
    expect(await db.clonePathFor(userA.id, "octocat/hello-world")).toBe(
      "/tmp/sudocity/octocat/hello-world",
    );

    await db.markRepoImported({
      userId: userA.id,
      repoKey: "octocat/hello-world",
      owner: "octocat",
      name: "hello-world",
      clonePath: "/tmp/sudocity-v2/octocat/hello-world",
    });
    expect(await db.clonePathFor(userA.id, "octocat/hello-world")).toBe(
      "/tmp/sudocity-v2/octocat/hello-world",
    );
  });

  it("returns undefined for a repo never imported", async () => {
    expect(await db.clonePathFor(userA.id, "octocat/never-imported")).toBeUndefined();
  });
});
