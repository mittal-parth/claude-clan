import { createHmac, timingSafeEqual } from "node:crypto";

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  refreshTokenExpiresAt?: string;
}

export interface Viewer {
  id: number;
  login: string;
  avatarUrl: string;
}

export interface Installation {
  id: number;
  account: string;
}

export interface RepoRef {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * https://github.com/login/oauth/access_token's response shape, for both the
 * initial code exchange and a refresh (same shape, different grant_type on
 * the request). expires_in/refresh_token_expires_in are only present when
 * the App has opted into expiring user tokens -- always true for a new App,
 * so their absence here is treated as a misconfiguration, not a valid state.
 */
export function parseTokenResponse(json: unknown, now: Date): GitHubTokens {
  const row = json as RawTokenResponse;
  if (row.error) {
    throw new Error(
      `GitHub token exchange failed: ${row.error_description ?? row.error}`,
    );
  }
  if (!row.access_token || !row.expires_in) {
    throw new Error(
      "GitHub token response is missing access_token/expires_in -- is 'Expire user authorization tokens' enabled on this App?",
    );
  }
  const expiresAt = new Date(now.getTime() + row.expires_in * 1000).toISOString();
  const refreshTokenExpiresAt = row.refresh_token_expires_in
    ? new Date(now.getTime() + row.refresh_token_expires_in * 1000).toISOString()
    : undefined;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt,
    refreshTokenExpiresAt,
  };
}

const REFRESH_SKEW_MS = 60_000;

/** True once fewer than 60s of life remain, so a refresh always finishes before the token would be rejected mid-request. */
export function needsRefresh(tokens: GitHubTokens, now: Date): boolean {
  return new Date(tokens.expiresAt).getTime() - now.getTime() < REFRESH_SKEW_MS;
}

interface RawInstallation {
  id: number;
  account: { login?: string; slug?: string } | null;
}

export function parseInstallationsJson(json: unknown): Installation[] {
  const rows = (json as { installations?: RawInstallation[] }).installations ?? [];
  return rows.map((row) => ({
    id: row.id,
    account: row.account?.login ?? row.account?.slug ?? "unknown",
  }));
}

interface RawRepo {
  full_name: string;
  owner: { login: string };
  name: string;
  private: boolean;
  default_branch: string;
}

export function parseRepoListJson(json: unknown): RepoRef[] {
  const rows = (json as { repositories?: RawRepo[] }).repositories ?? [];
  return rows.map((row) => ({
    fullName: row.full_name,
    owner: row.owner.login,
    name: row.name,
    private: row.private,
    defaultBranch: row.default_branch,
  }));
}

export function parseUserReposJson(json: unknown): RepoRef[] {
  const rows = (json as RawRepo[]) ?? [];
  return rows.map((row) => ({
    fullName: row.full_name,
    owner: row.owner.login,
    name: row.name,
    private: row.private,
    defaultBranch: row.default_branch,
  }));
}

interface RawViewer {
  id: number;
  login: string;
  avatar_url: string;
}

export function parseViewerJson(json: unknown): Viewer {
  const row = json as RawViewer;
  return { id: row.id, login: row.login, avatarUrl: row.avatar_url };
}

/**
 * The installations/new URL shows GitHub's own repo picker on the authorize
 * screen -- that picker *is* the permission grant, unlike an OAuth App's
 * all-or-nothing `repo` scope. `state` is passed through best-effort: GitHub
 * has historically dropped it across this particular redirect chain (unlike
 * the plain /login/oauth/authorize flow, where it's reliable), so the
 * callback must not hard-fail when it comes back empty -- this is a fresh
 * login, not a request to link into an already-authenticated session, so the
 * blast radius of a dropped/forged state here is a new anonymous session,
 * not account takeover.
 */
export function installUrl(appSlug: string, state: string): string {
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * GitHub only walks a visitor through installations/new's authorize screen
 * (and issues a fresh `code`) the *first* time the App is installed for
 * that account -- revisiting it afterward just opens the "manage
 * installation" settings page with no redirect back to us at all. Every
 * *login* (as opposed to a first-time install/grant) must go through this
 * plain OAuth endpoint instead, which always completes with a code
 * regardless of install state. `state` is reliably round-tripped here,
 * unlike installUrl's chain.
 */
export function authorizeUrl(clientId: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  return url.toString();
}

/** `${owner}/${name}` normalized to the key used everywhere a repo is addressed (CityId workspace prefix, clone directory name). */
export function repoKeyFor(fullName: string): string {
  return fullName.toLowerCase();
}

/** HMAC-signed `${timestamp}.${signature}` -- no server memory needed to validate a 10-minute-TTL nonce. */
export function signState(secret: string, now: Date): string {
  const payload = String(now.getTime());
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export function verifyState(state: string, secret: string, now: Date): boolean {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return false;
  }
  const issuedAt = Number(payload);
  return Number.isFinite(issuedAt) && now.getTime() - issuedAt <= STATE_TTL_MS;
}

const GITHUB_API = "https://api.github.com";

export interface GitHubAuthOptions {
  clientId: string;
  clientSecret: string;
}

/**
 * All network I/O for GitHub App user auth. Kept separate from the pure
 * parsers above so exchangeCode/refresh/viewer/accessibleRepos need no
 * fixtures beyond a mocked fetch, while the parsing logic they call is
 * tested with plain JSON fixtures and no network at all.
 */
export class GitHubAuth {
  constructor(private readonly options: GitHubAuthOptions) {}

  private async requestToken(body: Record<string, string>): Promise<GitHubTokens> {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        ...body,
      }),
    });
    return parseTokenResponse(await response.json(), new Date());
  }

  exchangeCode(code: string): Promise<GitHubTokens> {
    return this.requestToken({ code });
  }

  refresh(refreshToken: string): Promise<GitHubTokens> {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async viewer(accessToken: string): Promise<Viewer> {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "sudo-city",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} fetching viewer`);
    }
    return parseViewerJson(await response.json());
  }

  /** All repos this user can access and the App is installed on (includes collaborator repos where they aren't an installation admin). */
  async accessibleRepos(accessToken: string): Promise<RepoRef[]> {
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "sudo-city",
    };
    
    const allRepos: RepoRef[] = [];
    let page = 1;
    while (true) {
      const response = await fetch(`${GITHUB_API}/user/repos?per_page=100&page=${page}`, { headers });
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status} listing repositories`);
      }
      const repos = parseUserReposJson(await response.json());
      allRepos.push(...repos);
      if (repos.length < 100) {
        break;
      }
      page++;
    }
    return allRepos;
  }
}
