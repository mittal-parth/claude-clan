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

/** The bearer token is an opaque session id that never changes -- refreshing the underlying GitHub token happens server-side, in place, so there's nothing for the client to adopt back. */
function authedFetch(path: string, token: string | undefined, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function fetchSession(token: string | undefined): Promise<SessionResponse> {
  if (!token) {
    return { authenticated: false, mode: "anonymous" };
  }
  const response = await authedFetch("/api/auth/session", token);
  return (await response.json()) as SessionResponse;
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) {
    return;
  }
  await authedFetch("/api/auth/logout", token, { method: "POST" });
}

export async function fetchRepos(token: string): Promise<RepoSummary[]> {
  const response = await authedFetch("/api/repos", token);
  if (!response.ok) {
    throw new Error(`Failed to list repositories (${response.status})`);
  }
  const body = (await response.json()) as { repos: RepoSummary[] };
  return body.repos;
}

export async function importRepo(token: string, fullName: string): Promise<{ workspaceKey: string }> {
  const response = await authedFetch("/api/repos/import", token, {
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
