/**
 * Auth session/gate state, free of React and the DOM, so the rules that
 * decide which screen the app is on are testable on their own.
 */

export interface AuthUser {
  id: number;
  login: string;
  avatarUrl: string;
}

export type AuthSession =
  | { authenticated: true; user: AuthUser }
  | { authenticated: false };

export type Gate = "login" | "repos" | "city";

/**
 * "login" until signed in; "repos" once signed in but no repo has been
 * chosen for this visit yet; "city" once a repo (or the demo repo) is
 * active. The demo repo bypasses "login"/"repos" entirely -- it is the one
 * path required to work with zero credentials configured.
 */
export function gateFor(session: AuthSession, activeRepoKey: string | undefined): Gate {
  if (activeRepoKey) {
    return "city";
  }
  if (!session.authenticated) {
    return "login";
  }
  return "repos";
}

const SESSION_HASH_PREFIX = "#session=";
const SESSION_ERROR_HASH = "#session-error=1";

export interface HashSessionResult {
  token?: string;
  error?: boolean;
}

/**
 * Reads the sealed session token GitHub's callback redirect left in the URL
 * fragment. A fragment (not a query string) so the token never reaches
 * Render's access logs on that hop, and never reaches the server again once
 * the SPA strips it.
 */
export function readSessionFromHash(hash: string): HashSessionResult {
  if (hash.startsWith(SESSION_HASH_PREFIX)) {
    const token = hash.slice(SESSION_HASH_PREFIX.length);
    return token ? { token } : {};
  }
  if (hash === SESSION_ERROR_HASH) {
    return { error: true };
  }
  return {};
}

const SESSION_STORAGE_KEY = "sudo-city:session";

/**
 * sessionStorage, not localStorage: it survives a reload/reconnect within
 * the tab but not a closed tab, which bounds how long an XSS-stolen token
 * (wrapping the user's GitHub token) stays useful. See login_plan.md §1 for
 * the fuller tradeoff and the custom-domain hardening path.
 */
export function readStoredToken(): string | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredToken(token: string | undefined): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    if (token) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // A failed write only costs persistence across a reload, not the session.
  }
}
