import { GitHubAuth, needsRefresh } from "@sudo-city/cities";
import type { FastifyRequest } from "fastify";
import { Database, type DbSession } from "./db.js";
import { TicketStore } from "./ticket-store.js";

/** Name of the httpOnly session cookie set by `/api/auth/finish`. */
export const SESSION_COOKIE_NAME = "sudo_city_session";

/** ~180 days: revocation and refresh-token expiry are what actually bound a session, not this. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export interface AuthContext {
  db: Database;
  githubAuth: GitHubAuth;
  appSlug: string;
  webOrigin: string;
  stateSecret: string;
  clientId: string;
  clientSecret: string;
  /** Cookie only sent over HTTPS -- derived from `webOrigin`'s scheme, not NODE_ENV, so it tracks how the app is actually reached. */
  secureCookies: boolean;
  /** Single-use codes bridging the GitHub-callback origin to the app's own origin, where the session cookie can actually be set. */
  loginCodes: TicketStore;
  /** Single-use tickets that stand in for the session cookie during a WebSocket handshake, which isn't behind the same-origin API proxy. */
  wsTickets: TicketStore;
}

export async function buildAuthContext(): Promise<AuthContext> {
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  const db = new Database(requireEnv("DATABASE_URL"));
  await db.migrate();
  const webOrigin = requireEnv("WEB_ORIGIN");
  return {
    db,
    githubAuth: new GitHubAuth({ clientId, clientSecret }),
    appSlug: requireEnv("GITHUB_APP_SLUG"),
    webOrigin,
    // Reuses SESSION_SECRET for the login-flow CSRF state HMAC only -- the
    // session itself is a DB row now, not something this secret seals.
    stateSecret: requireEnv("SESSION_SECRET"),
    clientId,
    clientSecret,
    secureCookies: webOrigin.startsWith("https://"),
    loginCodes: new TicketStore(60_000),
    wsTickets: new TicketStore(30_000),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for GitHub login`);
  }
  return value;
}

/**
 * The session id, read from the httpOnly cookie the client's browser
 * attaches automatically. Never read from a header or URL -- the cookie is
 * the only place a raw session id travels after login.
 */
export function sessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE_NAME];
}

/**
 * Looks up the session row and, if its GitHub access token is within 60s of
 * expiring, refreshes it in place -- the session id (the client's bearer
 * token) never changes, so unlike the old sealed-token scheme there is
 * nothing to hand back to the client here.
 */
export async function resolveSession(
  token: string,
  auth: AuthContext,
  now: Date,
): Promise<DbSession | undefined> {
  const session = await auth.db.getSession(token);
  if (!session) {
    return undefined;
  }
  if (!needsRefresh(session.tokens, now) || !session.tokens.refreshToken) {
    return session;
  }
  const refreshed = await auth.githubAuth.refresh(session.tokens.refreshToken);
  await auth.db.updateSessionTokens(token, refreshed);
  return { ...session, tokens: refreshed };
}
