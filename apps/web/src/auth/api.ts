import type { RepoSummary } from "@sudo-city/protocol";

/** Mirrors App.tsx's VITE_WS_URL pattern: a build-time env var in production, a same-origin default for local dev. */
export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4100";

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
 * Every authenticated call reads back an optional `x-session-token` header:
 * the server refreshes a near-expiry GitHub token transparently and hands
 * back the newly sealed session, so the client never runs its own refresh
 * logic -- it just adopts whatever token comes back.
 */
async function authedFetch(
  path: string,
  token: string | undefined,
  onRefreshed: (token: string) => void,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const refreshed = response.headers.get("x-session-token");
  if (refreshed) {
    onRefreshed(refreshed);
  }
  return response;
}

export async function fetchSession(
  token: string | undefined,
  onRefreshed: (token: string) => void,
): Promise<SessionResponse> {
  if (!token) {
    return { authenticated: false, mode: "anonymous" };
  }
  const response = await authedFetch("/api/auth/session", token, onRefreshed);
  return (await response.json()) as SessionResponse;
}

export async function logout(
  token: string | undefined,
  onRefreshed: (token: string) => void,
): Promise<void> {
  if (!token) {
    return;
  }
  await authedFetch("/api/auth/logout", token, onRefreshed, { method: "POST" });
}

export async function fetchRepos(
  token: string,
  onRefreshed: (token: string) => void,
): Promise<RepoSummary[]> {
  const response = await authedFetch("/api/repos", token, onRefreshed);
  if (!response.ok) {
    throw new Error(`Failed to list repositories (${response.status})`);
  }
  const body = (await response.json()) as { repos: RepoSummary[] };
  return body.repos;
}

export async function importRepo(
  token: string,
  fullName: string,
  onRefreshed: (token: string) => void,
): Promise<{ workspaceKey: string }> {
  const response = await authedFetch("/api/repos/import", token, onRefreshed, {
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
