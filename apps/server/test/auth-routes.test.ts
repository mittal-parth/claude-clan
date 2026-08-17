import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, type AuthContext } from "../src/auth-context.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import type { Database, DbSession } from "../src/db.js";
import { TicketStore } from "../src/ticket-store.js";
import type { GitHubAuth } from "@sudo-city/cities";

const FAR_FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();

const KNOWN_SESSION: DbSession = {
  id: "session-known",
  userId: 1,
  login: "octocat",
  avatarUrl: "https://example.test/avatar.png",
  tokens: { accessToken: "gho_test", expiresAt: FAR_FUTURE },
};

function buildApp(): { app: FastifyInstance; auth: AuthContext } {
  const app = Fastify();

  const db = {
    getSession: vi.fn(async (id: string) => (id === KNOWN_SESSION.id ? KNOWN_SESSION : undefined)),
    revokeSession: vi.fn(async () => undefined),
    updateSessionTokens: vi.fn(async () => undefined),
    createSession: vi.fn(async () => "session-new"),
  } as unknown as Database;

  const githubAuth = {
    exchangeCode: vi.fn(async () => ({ accessToken: "gho_new", expiresAt: FAR_FUTURE })),
    viewer: vi.fn(async () => ({ id: 2, login: "new-user", avatarUrl: "https://example.test/new.png" })),
  } as unknown as GitHubAuth;

  const auth: AuthContext = {
    db,
    githubAuth,
    appSlug: "sudo-city-test",
    webOrigin: "https://web.example.test",
    stateSecret: "test-state-secret",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    secureCookies: true,
    loginCodes: new TicketStore(60_000),
    wsTickets: new TicketStore(30_000),
  };

  return { app, auth };
}

describe("auth routes: cookie-authenticated session", () => {
  let app: FastifyInstance;
  let auth: AuthContext;

  beforeEach(async () => {
    ({ app, auth } = buildApp());
    await app.register(cookie);
    registerAuthRoutes(app, auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports unauthenticated with no session cookie", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(response.json()).toEqual({ authenticated: false, mode: "anonymous" });
  });

  it("resolves the session from a valid cookie, never a header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${KNOWN_SESSION.id}` },
      cookies: { [SESSION_COOKIE_NAME]: KNOWN_SESSION.id },
    });
    expect(response.json()).toEqual({
      authenticated: true,
      mode: "user",
      user: { id: 1, login: "octocat", avatarUrl: "https://example.test/avatar.png" },
    });
  });

  it("ignores a bearer header with no session cookie present", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${KNOWN_SESSION.id}` },
    });
    expect(response.json()).toEqual({ authenticated: false, mode: "anonymous" });
  });
});

describe("auth routes: /api/auth/finish sets the cookie on the app's own origin", () => {
  let app: FastifyInstance;
  let auth: AuthContext;

  beforeEach(async () => {
    ({ app, auth } = buildApp());
    await app.register(cookie);
    registerAuthRoutes(app, auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("sets an httpOnly, secure, SameSite=Lax cookie for a valid one-time code and redirects to webOrigin", async () => {
    const code = auth.loginCodes.create(KNOWN_SESSION.id);

    const response = await app.inject({ method: "GET", url: `/api/auth/finish?code=${code}` });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(auth.webOrigin);
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=${KNOWN_SESSION.id}`);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/Secure/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
  });

  it("burns the code after one use", async () => {
    const code = auth.loginCodes.create(KNOWN_SESSION.id);
    await app.inject({ method: "GET", url: `/api/auth/finish?code=${code}` });

    const second = await app.inject({ method: "GET", url: `/api/auth/finish?code=${code}` });
    expect(second.headers.location).toBe(`${auth.webOrigin}/#session-error=1`);
  });

  it("redirects to the error hash for an unknown code, without setting a cookie", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/finish?code=bogus" });
    expect(response.headers.location).toBe(`${auth.webOrigin}/#session-error=1`);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});

describe("auth routes: /api/auth/ws-ticket", () => {
  let app: FastifyInstance;
  let auth: AuthContext;

  beforeEach(async () => {
    ({ app, auth } = buildApp());
    await app.register(cookie);
    registerAuthRoutes(app, auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("401s with no session cookie", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/ws-ticket" });
    expect(response.statusCode).toBe(401);
  });

  it("mints a single-use ticket that resolves back to the session for a signed-in cookie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/ws-ticket",
      cookies: { [SESSION_COOKIE_NAME]: KNOWN_SESSION.id },
    });
    expect(response.statusCode).toBe(200);
    const { ticket } = response.json() as { ticket: string };

    expect(auth.wsTickets.consume(ticket)).toBe(KNOWN_SESSION.id);
    // Single-use: a second consume must fail even though the first succeeded.
    expect(auth.wsTickets.consume(ticket)).toBeUndefined();
  });
});

describe("auth routes: /api/auth/logout", () => {
  let app: FastifyInstance;
  let auth: AuthContext;

  beforeEach(async () => {
    ({ app, auth } = buildApp());
    await app.register(cookie);
    registerAuthRoutes(app, auth);
    await app.ready();
    // Logout best-effort-revokes the GitHub token via a real external call --
    // stub it out so the test suite never touches the network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it("clears the cookie with attributes matching how it was set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { [SESSION_COOKIE_NAME]: KNOWN_SESSION.id },
    });

    expect(response.statusCode).toBe(204);
    const setCookie = response.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toMatch(/Secure/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
    expect(cookieHeader).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it("revokes the session in the database", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { [SESSION_COOKIE_NAME]: KNOWN_SESSION.id },
    });
    expect(auth.db.revokeSession).toHaveBeenCalledWith(KNOWN_SESSION.id);
  });

  it("clears the cookie even with no session present", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toBeDefined();
  });
});

describe("auth routes: /auth/github/callback hands off through /api/auth/finish", () => {
  let app: FastifyInstance;
  let auth: AuthContext;

  beforeEach(async () => {
    ({ app, auth } = buildApp());
    await app.register(cookie);
    registerAuthRoutes(app, auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("never sets a cookie itself -- it redirects to /api/auth/finish with a one-time code", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/github/callback?code=gh-code" });

    expect(response.statusCode).toBe(302);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const location = response.headers.location as string;
    expect(location.startsWith(`${auth.webOrigin}/api/auth/finish?code=`)).toBe(true);

    const finishCode = new URL(location).searchParams.get("code")!;
    const finishResponse = await app.inject({ method: "GET", url: `/api/auth/finish?code=${finishCode}` });
    expect(finishResponse.headers.location).toBe(auth.webOrigin);
    expect(finishResponse.headers["set-cookie"]).toBeDefined();
  });

  it("redirects to the error hash if GitHub's code exchange fails", async () => {
    (auth.githubAuth.exchangeCode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("GitHub rejected the code"),
    );
    const response = await app.inject({ method: "GET", url: "/auth/github/callback?code=bad-code" });
    expect(response.headers.location).toBe(`${auth.webOrigin}/#session-error=1`);
  });
});
