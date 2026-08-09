import { GitHubAuth, needsRefresh } from "@sudo-city/cities";
import type { FastifyRequest } from "fastify";
import { Database, type DbSession } from "./db.js";

export interface AuthContext {
  db: Database;
  githubAuth: GitHubAuth;
  appSlug: string;
  webOrigin: string;
  stateSecret: string;
  clientId: string;
  clientSecret: string;
}

export async function buildAuthContext(): Promise<AuthContext> {
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  const db = new Database(requireEnv("DATABASE_URL"));
  await db.migrate();
  return {
    db,
    githubAuth: new GitHubAuth({ clientId, clientSecret }),
    appSlug: requireEnv("GITHUB_APP_SLUG"),
    webOrigin: requireEnv("WEB_ORIGIN"),
    // Reuses SESSION_SECRET for the login-flow CSRF state HMAC only -- the
    // session itself is a DB row now, not something this secret seals.
    stateSecret: requireEnv("SESSION_SECRET"),
    clientId,
    clientSecret,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for GitHub login`);
  }
  return value;
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
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
