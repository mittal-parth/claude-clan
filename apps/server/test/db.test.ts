import { loadEnvFile } from "node:process";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/db.js";
import { TokenCipher } from "../src/token-cipher.js";

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
  const db = new Database(
    process.env.DATABASE_URL!,
    new TokenCipher("test-key-not-a-real-secret"),
  );
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

  // The whole point of the cipher: a SELECT on this table must not yield
  // usable GitHub credentials. Reads the raw column rather than trusting the
  // accessor that would decrypt it.
  it("stores the GitHub tokens encrypted, not as readable text", async () => {
    const sessionId = await db.createSession(userA, tokens);
    const raw = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const row = (
        await raw.query<{ access_token: string; refresh_token: string | null }>(
          "SELECT access_token, refresh_token FROM sessions WHERE id = $1",
          [sessionId],
        )
      ).rows[0]!;

      expect(row.access_token).not.toBe(tokens.accessToken);
      expect(row.access_token).not.toContain(tokens.accessToken);
      expect(row.access_token.startsWith("v1.")).toBe(true);
      expect(row.refresh_token).not.toBe(tokens.refreshToken);
      expect(row.refresh_token).not.toContain(tokens.refreshToken);
      expect(row.refresh_token?.startsWith("v1.")).toBe(true);
    } finally {
      await raw.end();
    }

    // ...and the round trip still hands the caller the real tokens.
    expect((await db.getSession(sessionId))?.tokens).toMatchObject({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  });

  // Rows predating encryption (or written under a different key) are not
  // sessions any more. They must fail closed rather than throwing on every
  // request, so the user just signs in again.
  it("treats an undecryptable session row as no session at all", async () => {
    const sessionId = await db.createSession(userA, tokens);
    const raw = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await raw.query(
        "UPDATE sessions SET access_token = $2 WHERE id = $1",
        [sessionId, "ghu_written_before_encryption"],
      );

      await expect(db.getSession(sessionId)).resolves.toBeUndefined();
    } finally {
      await raw.end();
    }
  });

  it("does not rewrite existing rows when migrate runs", async () => {
    const sessionId = await db.createSession(userA, tokens);
    const raw = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const readToken = async () =>
        (
          await raw.query<{ access_token: string }>(
            "SELECT access_token FROM sessions WHERE id = $1",
            [sessionId],
          )
        ).rows[0]!.access_token;
      const before = await readToken();

      await db.migrate();

      expect(await readToken()).toBe(before);
    } finally {
      await raw.end();
    }
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

  // The per-user budget cap is only as good as this ledger: it is the sole
  // record that outlives a workspace eviction, a restart, or a second instance.
  it("reports no spend for a user who has never dispatched a crew", async () => {
    await db.upsertUser(userA);
    expect(await db.userSpentUsd(userA.id)).toBe(0);
  });

  it("accumulates spend across runs rather than replacing it", async () => {
    await db.upsertUser(userA);

    expect(await db.addUserSpend(userA.id, 1.5)).toBeCloseTo(1.5, 6);
    expect(await db.addUserSpend(userA.id, 2.25)).toBeCloseTo(3.75, 6);
    expect(await db.userSpentUsd(userA.id)).toBeCloseTo(3.75, 6);
  });

  it("keeps sub-cent precision, so many small runs still reach the cap", async () => {
    await db.upsertUser(userA);
    const before = await db.userSpentUsd(userA.id);

    for (let run = 0; run < 10; run += 1) {
      await db.addUserSpend(userA.id, 0.000_1);
    }

    expect(await db.userSpentUsd(userA.id)).toBeCloseTo(before + 0.001, 6);
  });

  it("does not lose a run when two instances bill the same user at once", async () => {
    await db.upsertUser(userA);
    const before = await db.userSpentUsd(userA.id);

    // The increment happens in SQL, so concurrent writers can't read-modify-write
    // over each other the way an in-process counter would.
    await Promise.all(
      Array.from({ length: 20 }, () => db.addUserSpend(userA.id, 0.05)),
    );

    expect(await db.userSpentUsd(userA.id)).toBeCloseTo(before + 1, 6);
  });

  it("keeps each user's ledger separate", async () => {
    const userB = { id: -1002, login: "test-user-b", avatarUrl: "https://example.com/b.png" };
    await db.upsertUser(userA);
    await db.upsertUser(userB);
    const cleanup = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const beforeA = await db.userSpentUsd(userA.id);

      await db.addUserSpend(userB.id, 4);

      expect(await db.userSpentUsd(userB.id)).toBeCloseTo(4, 6);
      expect(await db.userSpentUsd(userA.id)).toBeCloseTo(beforeA, 6);
    } finally {
      await cleanup.query("DELETE FROM users WHERE id = $1", [userB.id]);
      await cleanup.end();
    }
  });
});
