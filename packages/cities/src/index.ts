import { execFile } from "node:child_process";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, FileChangeKind } from "@sudo-city/protocol";

const execFileAsync = promisify(execFile);

export interface PullRequestRef {
  number: number;
  title: string;
  author: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  url: string;
}

export interface IssueRef {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface GitHubClient {
  listOpenPullRequests(repoPath: string): Promise<PullRequestRef[]>;
  listOpenIssues(repoPath: string): Promise<IssueRef[]>;
  postReview(
    repoPath: string,
    number: number,
    body: string,
    event: ReviewEvent,
  ): Promise<void>;
}

interface RawPullRequest {
  number: number;
  title: string;
  author: { login: string };
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  url: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  author: { login: string } | null;
  url: string;
}

/**
 * Split out from GhCliClient so the JSON shape can be tested without
 * shelling out to `gh` -- no network, no auth, just a fixture string.
 */
export function parsePullRequestListJson(json: string): PullRequestRef[] {
  const rows = JSON.parse(json) as RawPullRequest[];
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    author: row.author.login,
    headSha: row.headRefOid,
    headRef: row.headRefName,
    baseRef: row.baseRefName,
    url: row.url,
  }));
}

export function parseIssueListJson(json: string): IssueRef[] {
  const rows = JSON.parse(json) as RawIssue[];
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    body: row.body ?? "",
    author: row.author?.login ?? "unknown",
    url: row.url,
  }));
}

export function reviewEventFlag(event: ReviewEvent): string {
  switch (event) {
    case "APPROVE":
      return "--approve";
    case "REQUEST_CHANGES":
      return "--request-changes";
    case "COMMENT":
      return "--comment";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

interface RawApiPullRequest {
  number: number;
  title: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  base: { ref: string };
  html_url: string;
}

/**
 * The REST equivalent of parsePullRequestListJson. GitHub's API names these
 * fields differently from `gh --json`, and a PR opened by a deleted account
 * has a null user, which `gh` reports as the literal "ghost".
 */
export function parsePullRequestApiJson(json: string): PullRequestRef[] {
  const rows = JSON.parse(json) as RawApiPullRequest[];
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    author: row.user?.login ?? "ghost",
    headSha: row.head.sha,
    headRef: row.head.ref,
    baseRef: row.base.ref,
    url: row.html_url,
  }));
}

interface RawApiIssue {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  html_url: string;
  /** Present only when the "issue" is actually a pull request. */
  pull_request?: unknown;
}

/**
 * The REST equivalent of parseIssueListJson. GitHub's issues endpoint also
 * returns pull requests, distinguished only by the presence of a
 * `pull_request` field, so those are filtered out here.
 */
export function parseIssueApiJson(json: string): IssueRef[] {
  const rows = JSON.parse(json) as RawApiIssue[];
  return rows
    .filter((row) => !row.pull_request)
    .map((row) => ({
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      author: row.user?.login ?? "ghost",
      url: row.html_url,
    }));
}

/**
 * `owner/repo` from a git remote URL, for either transport git writes:
 * https://github.com/owner/repo.git or git@github.com:owner/repo.git.
 * Anything that isn't GitHub returns undefined -- the caller degrades to a
 * roster with only "main" rather than guessing at another host's API.
 */
export function parseGitHubRemote(remoteUrl: string): string | undefined {
  const match = remoteUrl
    .trim()
    .match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * Lists pull requests over the REST API instead of shelling out to `gh`,
 * which is absent from most deployment images. Public repositories need no
 * credentials; GITHUB_TOKEN is used when present, both to lift the 60/hour
 * unauthenticated rate limit and to reach private repositories.
 */
export class GitHubApiClient implements GitHubClient {
  constructor(private readonly token = process.env.GITHUB_TOKEN) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "sudo-city",
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async slugFor(repoPath: string): Promise<string | undefined> {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoPath },
    );
    return parseGitHubRemote(stdout);
  }

  async listOpenPullRequests(repoPath: string): Promise<PullRequestRef[]> {
    const slug = await this.slugFor(repoPath);
    if (!slug) {
      return [];
    }
    const response = await fetch(
      `https://api.github.com/repos/${slug}/pulls?state=open&per_page=100`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status} listing pull requests for ${slug}`,
      );
    }
    return parsePullRequestApiJson(await response.text());
  }

  async listOpenIssues(repoPath: string): Promise<IssueRef[]> {
    const slug = await this.slugFor(repoPath);
    if (!slug) {
      return [];
    }
    const response = await fetch(
      `https://api.github.com/repos/${slug}/issues?state=open&per_page=100`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status} listing issues for ${slug}`,
      );
    }
    return parseIssueApiJson(await response.text());
  }

  async postReview(
    repoPath: string,
    number: number,
    body: string,
    event: ReviewEvent,
  ): Promise<void> {
    if (!this.token) {
      throw new Error(
        "Posting a review requires GITHUB_TOKEN; listing works without one.",
      );
    }
    const slug = await this.slugFor(repoPath);
    if (!slug) {
      throw new Error("origin is not a GitHub remote");
    }
    const response = await fetch(
      `https://api.github.com/repos/${slug}/pulls/${number}/reviews`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ body, event }),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} posting review`);
    }
  }
}

export class GhCliClient implements GitHubClient {
  async listOpenPullRequests(repoPath: string): Promise<PullRequestRef[]> {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,title,author,headRefName,headRefOid,baseRefName,url",
      ],
      { cwd: repoPath },
    );
    return parsePullRequestListJson(stdout);
  }

  async listOpenIssues(repoPath: string): Promise<IssueRef[]> {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,title,body,author,url",
      ],
      { cwd: repoPath },
    );
    return parseIssueListJson(stdout);
  }

  async postReview(
    repoPath: string,
    number: number,
    body: string,
    event: ReviewEvent,
  ): Promise<void> {
    await execFileAsync(
      "gh",
      ["pr", "review", String(number), reviewEventFlag(event), "--body", body],
      { cwd: repoPath },
    );
  }
}

export function cityIdFor(pr: Pick<PullRequestRef, "number">): string {
  return `pr-${pr.number}`;
}

export function issueCityIdFor(issue: Pick<IssueRef, "number">): string {
  return `issue-${issue.number}`;
}

export function worktreePath(repoPath: string, cityId: string): string {
  return join(repoPath, ".sudocity", "worktrees", cityId);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", ref], {
      cwd: repoPath,
    });
    return true;
  } catch {
    return false;
  }
}

async function headShaOf(worktreePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Fetches the PR's head into a dedicated local ref and returns a treeish to
 * check out. Fork PRs don't have their head ref locally, so it's fetched by
 * PR number; a same-repo branch PR usually already has the commit under
 * refs/remotes/origin/<headRef>, in which case the fetch still succeeds (it
 * just re-fetches an object git already has), but even if it failed for some
 * other reason the fallback to the PR's raw head sha covers it.
 */
async function fetchPullRequestHead(
  repoPath: string,
  pr: PullRequestRef,
): Promise<string> {
  const localRef = `refs/sudo-city/${cityIdFor(pr)}`;
  await execFileAsync(
    "git",
    ["fetch", "origin", `pull/${pr.number}/head:${localRef}`],
    { cwd: repoPath },
  ).catch(() => {
    // Handled by the raw-sha fallback below.
  });
  return (await refExists(repoPath, localRef)) ? localRef : pr.headSha;
}

/**
 * Ensures a git worktree exists for the PR's head, creating it if needed.
 * If a worktree already exists but the PR has moved since it was built --
 * gh reports a newer headSha than the worktree's checked-out HEAD -- it is
 * fetched and fast-forwarded rather than silently served stale, which would
 * otherwise show a reviewer old code, or fail outright when a later diff
 * against the PR's now-current head sha can't find that commit in history.
 */
export async function ensureWorktree(
  repoPath: string,
  pr: PullRequestRef,
): Promise<string> {
  const cityId = cityIdFor(pr);
  const path = worktreePath(repoPath, cityId);

  if (await pathExists(path)) {
    if ((await headShaOf(path)) === pr.headSha) {
      return path;
    }
    const treeish = await fetchPullRequestHead(repoPath, pr);
    await execFileAsync("git", ["checkout", "--detach", treeish], {
      cwd: path,
    });
    return path;
  }

  // The directory is gone, but if it was ever removed by hand rather than
  // via removeWorktree(), git still has it registered and refuses to add a
  // worktree at the same path again until it's pruned.
  await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath }).catch(
    () => {
      // Nothing to prune, or repoPath isn't a git repo -- either way the
      // add below will surface the real problem if there is one.
    },
  );

  const treeish = await fetchPullRequestHead(repoPath, pr);
  await mkdir(dirname(path), { recursive: true });
  await execFileAsync("git", ["worktree", "add", "--detach", path, treeish], {
    cwd: repoPath,
  });
  return path;
}

/**
 * Gives an issue its own detached copy of main. Unlike a PR worktree this is
 * deliberately writable: the mayor can hand the issue to an implementation
 * agent without altering the primary checkout.
 */
export async function ensureMainWorktree(
  repoPath: string,
  cityId: string,
  baseRef = "main",
): Promise<string> {
  const path = worktreePath(repoPath, cityId);
  if (await pathExists(path)) {
    return path;
  }

  await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath }).catch(
    () => {},
  );
  await mkdir(dirname(path), { recursive: true });
  await execFileAsync(
    "git",
    ["worktree", "add", "--detach", path, baseRef],
    { cwd: repoPath },
  );
  return path;
}

export async function removeWorktree(
  repoPath: string,
  cityId: string,
): Promise<void> {
  const path = worktreePath(repoPath, cityId);
  await execFileAsync("git", ["worktree", "remove", "--force", path], {
    cwd: repoPath,
  }).catch(() => {
    // Already removed, or never created -- either way there's nothing left
    // to clean up via git.
  });
  await rm(path, { recursive: true, force: true });
}

/** Removes every worktree under .sudocity/worktrees not in `keep`. */
export async function pruneWorktrees(
  repoPath: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const root = join(repoPath, ".sudocity", "worktrees");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => !keep.has(entry))
      .map((entry) => removeWorktree(repoPath, entry)),
  );
  await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath }).catch(
    () => {
      // Nothing to prune, or git couldn't find the repo at repoPath in a
      // test fixture -- both are fine to ignore.
    },
  );
}

function parseNumstat(value: string | undefined): number {
  if (!value || value === "-") {
    return 0;
  }
  return Number.parseInt(value, 10) || 0;
}

/**
 * The changed-file set for a PR, computed against main -- always run in the
 * main checkout, never in the worktree, since the worktree only needs to
 * exist for scanning and for the agent's cwd.
 */
export async function changedFiles(
  repoPath: string,
  baseRef: string,
  headSha: string,
): Promise<ChangedFile[]> {
  const range = `${baseRef}...${headSha}`;
  const [statusResult, numstatResult] = await Promise.all([
    execFileAsync("git", ["diff", "--no-renames", "--name-status", range], {
      cwd: repoPath,
    }),
    execFileAsync("git", ["diff", "--no-renames", "--numstat", range], {
      cwd: repoPath,
    }),
  ]);

  const statusByPath = new Map<string, FileChangeKind>();
  for (const line of statusResult.stdout.split(/\r?\n/u)) {
    const [status, path] = line.split("\t");
    if (!path) {
      continue;
    }
    statusByPath.set(
      path,
      status === "A" ? "added" : status === "D" ? "deleted" : "modified",
    );
  }

  const files: ChangedFile[] = [];
  for (const line of numstatResult.stdout.split(/\r?\n/u)) {
    const [addedText, deletedText, path] = line.split("\t");
    if (!path) {
      continue;
    }
    files.push({
      path,
      change: statusByPath.get(path) ?? "modified",
      additions: parseNumstat(addedText),
      deletions: parseNumstat(deletedText),
    });
  }
  return files;
}

/** The unified diff for one file, lazily fetched when a building is clicked. */
export async function fileDiff(
  repoPath: string,
  baseRef: string,
  headSha: string,
  path: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--no-color", "--no-renames", `${baseRef}...${headSha}`, "--", path],
    { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}
