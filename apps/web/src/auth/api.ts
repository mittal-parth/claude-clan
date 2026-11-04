import type { RepoSummary } from "@sudo-city/protocol";
import { desktop } from "@/lib/desktop";

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
  const bridge = desktop();
  const headers = new Headers(init?.headers);
  if (bridge?.token) {
    headers.set("x-desktop-token", bridge.token);
  }
  const base = bridge?.port ? `http://127.0.0.1:${bridge.port}` : API_URL;
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: base ? "include" : "same-origin",
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

export async function fetchRepos(): Promise<{ repos: RepoSummary[], maxRepoSizeMb?: number }> {
  const response = await authedFetch("/api/repos");
  if (!response.ok) {
    throw new Error(`Failed to list repositories (${response.status})`);
  }
  const body = (await response.json()) as { repos: RepoSummary[], maxRepoSizeMb?: number };
  return body;
}

export async function importRepo(fullName: string, onProgress?: (msg: string) => void): Promise<{ workspaceKey: string }> {
  const response = await authedFetch("/api/repos/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to import ${fullName} (${response.status})`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body to read");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let workspaceKey = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        if (data.phase === "cloning" && onProgress && data.message) {
          onProgress(data.message);
        } else if (data.phase === "ready" && data.workspaceKey) {
          workspaceKey = data.workspaceKey;
        }
      } catch (err) {
        if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
          throw err;
        }
      }
    }
  }
  
  if (!workspaceKey) {
    throw new Error("Import failed: no workspace key returned");
  }
  return { workspaceKey };
}


export interface LocalGithubResponse {
  available: boolean;
  authenticated: boolean;
  repos: RepoSummary[];
  error?: string;
}

export interface LocalGithubUser {
  login: string;
  avatarUrl: string;
  name?: string;
}

/**
 * The gh account behind the desktop app, or undefined when gh is absent or
 * logged out. Never throws: the HUD falls back to no avatar, which is a normal
 * state rather than an error worth a banner.
 */
export async function fetchLocalGithubUser(): Promise<LocalGithubUser | undefined> {
  try {
    const response = await authedFetch("/api/local/github/user");
    if (!response.ok) return undefined;
    const body = (await response.json()) as { user?: LocalGithubUser };
    return body.user;
  } catch {
    return undefined;
  }
}

export async function fetchLocalGithubRepos(): Promise<LocalGithubResponse> {
  const response = await authedFetch("/api/local/github/repos");
  if (!response.ok) {
    throw new Error(`Failed to check GitHub CLI (${response.status})`);
  }
  return (await response.json()) as LocalGithubResponse;
}

export async function cloneLocalGithubRepo(
  fullName: string,
  onProgress?: (message: string) => void,
): Promise<{ workspaceKey: string; path: string }> {
  const response = await authedFetch("/api/local/github/clone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to clone ${fullName} (${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body to read");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { workspaceKey: string; path: string } | undefined;
  const consume = (line: string): void => {
    if (!line.trim()) return;
    const data = JSON.parse(line) as {
      phase?: string;
      message?: string;
      error?: string;
      workspaceKey?: string;
      path?: string;
    };
    if (data.error) throw new Error(data.error);
    if (data.phase === "cloning" && data.message) onProgress?.(data.message);
    if (data.phase === "ready" && data.workspaceKey && data.path) {
      result = { workspaceKey: data.workspaceKey, path: data.path };
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error("GitHub clone failed: no workspace returned");
  return result;
}
