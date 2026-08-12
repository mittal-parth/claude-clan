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

const SESSION_ERROR_HASH = "#session-error=1";

export interface HashSessionResult {
  error?: boolean;
}

/**
 * Reads the login-failure marker GitHub's callback redirect can leave in the
 * URL fragment. There is no success case to read here: a successful login
 * finishes on `/api/auth/finish`, which sets the session as an httpOnly
 * cookie and redirects to a plain URL -- nothing for page JS to pick up.
 */
export function readSessionFromHash(hash: string): HashSessionResult {
  if (hash === SESSION_ERROR_HASH) {
    return { error: true };
  }
  return {};
}

export interface StoredActiveRepo {
  repoKey: string;
  userId?: number;
}

const ACTIVE_REPO_STORAGE_KEY = "sudo-city:active-repo";

export function readStoredActiveRepo(): StoredActiveRepo | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  try {
    const raw = localStorage.getItem(ACTIVE_REPO_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = parsed as { repoKey?: unknown; userId?: unknown };
    if (typeof value.repoKey !== "string" || value.repoKey.length === 0) {
      return undefined;
    }
    if (value.userId !== undefined && typeof value.userId !== "number") {
      return undefined;
    }
    return {
      repoKey: value.repoKey,
      ...(value.userId === undefined ? {} : { userId: value.userId }),
    };
  } catch {
    return undefined;
  }
}

export function writeStoredActiveRepo(repoKey: string, userId?: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      ACTIVE_REPO_STORAGE_KEY,
      JSON.stringify({
        repoKey,
        ...(userId === undefined ? {} : { userId }),
      }),
    );
  } catch {
    // A failed write only costs persistence across a reload.
  }
}

export function clearStoredActiveRepo(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(ACTIVE_REPO_STORAGE_KEY);
  } catch {
    // Storage may be disabled; the in-memory navigation still works.
  }
}
