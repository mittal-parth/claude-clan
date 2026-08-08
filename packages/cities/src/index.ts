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

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface GitHubClient {
  listOpenPullRequests(repoPath: string): Promise<PullRequestRef[]>;
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

export class GhCliClient implements GitHubClient {
  async listOpenPullRequests(repoPath: string): Promise<PullRequestRef[]> {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        "number,title,author,headRefName,headRefOid,baseRefName,url",
      ],
      { cwd: repoPath },
    );
    return parsePullRequestListJson(stdout);
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

/**
 * Ensures a git worktree exists for the PR's head, creating it if needed.
 * Fork PRs don't have their head ref locally, so it's fetched by PR number
 * first; a same-repo branch PR usually already has it under
 * refs/remotes/origin/<headRef>, in which case the fetch is a harmless no-op
 * (fetching a ref that already resolves to the same object).
 */
export async function ensureWorktree(
  repoPath: string,
  pr: PullRequestRef,
): Promise<string> {
  const cityId = cityIdFor(pr);
  const path = worktreePath(repoPath, cityId);
  if (await pathExists(path)) {
    return path;
  }

  const localRef = `refs/sudo-city/${cityId}`;
  await execFileAsync(
    "git",
    ["fetch", "origin", `pull/${pr.number}/head:${localRef}`],
    { cwd: repoPath },
  ).catch(() => {
    // Fetch can fail for a same-repo branch PR whose ref already exists
    // locally under a different name; the worktree add below still works
    // off the PR's head sha in that case.
  });

  const treeish = (await refExists(repoPath, localRef))
    ? localRef
    : pr.headSha;

  await mkdir(dirname(path), { recursive: true });
  await execFileAsync("git", ["worktree", "add", "--detach", path, treeish], {
    cwd: repoPath,
  });
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
