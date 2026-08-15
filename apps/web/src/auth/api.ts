import type { RepoSummary } from "@sudo-city/protocol";

/**
 * Relative by default: the API is reached through the web app's own origin
 * (Vite's dev proxy locally, a Vercel rewrite in production -- see
 * vite.config.ts and vercel.json), which is what lets the session cookie be
 * httpOnly and same-origin instead of a cross-site cookie or a client-held
 * bearer token. `VITE_API_URL` remains as an escape hatch for hitting the
 * API directly (e.g. local debugging), not the normal path.
 */
export const API_URL = import.meta.env.VITE_API_URL ?? "";

export function githubStartUrl(): string {
  return `${API_URL}/auth/github/start`;
}

/** Grants or expands repo access via GitHub's install picker -- distinct from login, since revisiting login once already installed dead-ends on GitHub's side. */
export function githubInstallUrl(): string {
  return `${API_URL}/auth/github/install`;
}

export interface SessionResponse {
  authenticated: boolean;
  mode: "anonymous" | "user";
  user?: { id: number; login: string; avatarUrl: string };
}

/**
 * Same-origin by default (see API_URL), so the browser attaches the httpOnly
 * session cookie on its own -- there's no token for this code to handle.
 * `include` when API_URL is overridden: a "same-origin" credentials mode
 * would silently drop the cookie on that cross-origin escape-hatch request,
 * making it look like auth is broken rather than just not being sent.
 */
function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: API_URL ? "include" : "same-origin",
  });
}

export async function fetchSession(): Promise<SessionResponse> {
  const response = await authedFetch("/api/auth/session");
  return (await response.json()) as SessionResponse;
}

export async function logout(): Promise<void> {
  await authedFetch("/api/auth/logout", { method: "POST" });
}

/** Mints a single-use ticket for the WebSocket handshake, which sits outside the same-origin API proxy and so can't rely on the cookie the way a fetch does. */
export async function fetchWsTicket(): Promise<string | undefined> {
  const response = await authedFetch("/api/auth/ws-ticket", { method: "POST" });
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as { ticket: string };
  return body.ticket;
}

export async function fetchRepos(): Promise<RepoSummary[]> {
  const response = await authedFetch("/api/repos");
  if (!response.ok) {
    throw new Error(`Failed to list repositories (${response.status})`);
  }
  const body = (await response.json()) as { repos: RepoSummary[] };
  return body.repos;
}

export async function importRepo(fullName: string): Promise<{ workspaceKey: string }> {
  const response = await authedFetch("/api/repos/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to import ${fullName} (${response.status})`);
  }
  return (await response.json()) as { workspaceKey: string };
}

export interface ServerConfig {
  mode: "local" | "hosted";
  maxUploadBytes: number;
}

export async function fetchConfig(): Promise<ServerConfig> {
  const response = await authedFetch("/api/config");
  if (!response.ok) {
    return { mode: "hosted", maxUploadBytes: 150 * 1024 * 1024 };
  }
  return (await response.json()) as ServerConfig;
}

export async function localPickFolder(): Promise<
  { path: string; name: string } | { unavailable: true }
> {
  const response = await authedFetch("/api/local/pick", { method: "POST" });
  if (!response.ok) {
    return { unavailable: true };
  }
  return (await response.json()) as
    | { path: string; name: string }
    | { unavailable: true };
}

export async function localOpenFolder(
  path: string,
): Promise<{ repoKey: string; name: string }> {
  const response = await authedFetch("/api/local/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to open directory (${response.status})`);
  }
  return (await response.json()) as { repoKey: string; name: string };
}

