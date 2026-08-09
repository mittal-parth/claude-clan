import { GitHubAuth, needsRefresh } from "@sudo-city/cities";
import type { FastifyRequest } from "fastify";
import { deriveSessionKey, openSession, sealSession, type Session } from "./session.js";

export interface AuthContext {
  sessionKey: Buffer;
  githubAuth: GitHubAuth;
  appSlug: string;
  webOrigin: string;
  stateSecret: string;
  clientId: string;
  clientSecret: string;
}

export function buildAuthContext(): AuthContext {
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  return {
    sessionKey: deriveSessionKey(requireEnv("SESSION_SECRET")),
    githubAuth: new GitHubAuth({ clientId, clientSecret }),
    appSlug: requireEnv("GITHUB_APP_SLUG"),
    webOrigin: requireEnv("WEB_ORIGIN"),
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

export interface ResolvedSession {
  session: Session;
  /** Set only when the access token was refreshed -- callers should hand this back to the client as the session's new bearer token. */
  refreshedToken?: string;
}

/**
 * Opens the sealed session and, if its GitHub access token is within 60s of
 * expiring, refreshes it and re-seals -- callers surface refreshedToken back
 * to the client (a response header) so the client's held token stays valid
 * without ever needing its own refresh logic.
 */
export async function resolveSession(
  token: string,
  auth: AuthContext,
  now: Date,
): Promise<ResolvedSession | undefined> {
  const session = openSession(token, auth.sessionKey, now);
  if (!session) {
    return undefined;
  }
  if (!needsRefresh(session.tokens, now) || !session.tokens.refreshToken) {
    return { session };
  }
  const refreshed = await auth.githubAuth.refresh(session.tokens.refreshToken);
  const updated: Session = {
    ...session,
    tokens: refreshed,
    expiresAt: refreshed.expiresAt,
  };
  return { session: updated, refreshedToken: sealSession(updated, auth.sessionKey) };
}
