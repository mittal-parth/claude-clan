import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  cityIdFor,
  ensureMainWorktree,
  ensureWorktree,
  fileDiff,
  issueCityIdFor,
  parseIssueListJson,
  parsePullRequestListJson,
  pruneWorktrees,
  removeWorktree,
  reviewEventFlag,
  worktreePath,
  type PullRequestRef,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A real, local, network-free git repo with a main branch and a feature
 * branch that adds, modifies, and deletes a file relative to main. No `gh`,
 * no remote -- exercises ensureWorktree's fallback-to-headSha path exactly
 * as it would for a same-repo branch with no configured origin.
 */
async function createFixtureRepo(): Promise<{
  repoPath: string;
  baseRef: string;
  pr: PullRequestRef;
}> {
  const repoPath = mkdtempSync(join(tmpdir(), "sudo-city-cities-"));
  temporaryDirectories.push(repoPath);

  const git = (...args: string[]) =>
    execFileAsync("git", args, { cwd: repoPath });

  await git("init", "-b", "main");
  await git("config", "user.email", "fixture@example.com");
  await git("config", "user.name", "Fixture");
  await git("config", "commit.gpgsign", "false");

  writeFileSync(join(repoPath, "kept.ts"), "export const kept = 1;\n");
  writeFileSync(join(repoPath, "removed.ts"), "export const removed = 1;\n");
  await git("add", ".");
  await git("commit", "-m", "initial");

  await git("checkout", "-b", "feature");
  writeFileSync(join(repoPath, "kept.ts"), "export const kept = 2;\n");
  writeFileSync(join(repoPath, "added.ts"), "export const added = 1;\n");
  rmSync(join(repoPath, "removed.ts"));
  await git("add", "-A");
  await git("commit", "-m", "feature changes");

  const { stdout: headSha } = await git("rev-parse", "HEAD");
  await git("checkout", "main");

  return {
    repoPath,
    baseRef: "main",
    pr: {
      number: 7,
      title: "Feature",
      author: "octocat",
      headSha: headSha.trim(),
      headRef: "feature",
      baseRef: "main",
      url: "https://example.invalid/pr/7",
    },
  };
}

describe("changedFiles / fileDiff", () => {
  it("classifies added, modified, and deleted files against the base ref", async () => {
    const { repoPath, baseRef, pr } = await createFixtureRepo();

    const files = await changedFiles(repoPath, baseRef, pr.headSha);
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]));

    expect(byPath["added.ts"]).toMatchObject({
      change: "added",
      additions: 1,
      deletions: 0,
    });
    expect(byPath["kept.ts"]).toMatchObject({
      change: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(byPath["removed.ts"]).toMatchObject({
      change: "deleted",
      additions: 0,
      deletions: 1,
    });
  });

  it("returns a unified diff for a single file", async () => {
    const { repoPath, baseRef, pr } = await createFixtureRepo();

    const patch = await fileDiff(repoPath, baseRef, pr.headSha, "kept.ts");

    expect(patch).toContain("-export const kept = 1;");
    expect(patch).toContain("+export const kept = 2;");
  });
});

describe("worktree lifecycle", () => {
  it("creates a writable issue worktree from main", async () => {
    const { repoPath } = await createFixtureRepo();
    const cityId = issueCityIdFor({ number: 12 });

    const path = await ensureMainWorktree(repoPath, cityId);
    expect(path).toBe(worktreePath(repoPath, cityId));
    expect(readFileSync(join(path, "kept.ts"), "utf8")).toContain("kept = 1");
    expect(() => readFileSync(join(path, "added.ts"), "utf8")).toThrow();

    writeFileSync(join(path, "issue-fix.ts"), "export const fixed = true;\n");
    expect(readFileSync(join(path, "issue-fix.ts"), "utf8")).toContain("fixed");
  });

  it("creates a worktree at the PR's head, checked out and scannable", async () => {
    const { repoPath, pr } = await createFixtureRepo();

    const path = await ensureWorktree(repoPath, pr);
    expect(path).toBe(worktreePath(repoPath, cityIdFor(pr)));
    expect(readFileSync(join(path, "kept.ts"), "utf8")).toContain(
      "kept = 2",
    );
    expect(readFileSync(join(path, "added.ts"), "utf8")).toContain("added");

    // Idempotent: a second call reuses the existing worktree.
    const again = await ensureWorktree(repoPath, pr);
    expect(again).toBe(path);
  });

  it("fast-forwards an existing worktree when the PR gained new commits", async () => {
    const { repoPath, pr } = await createFixtureRepo();
    const path = await ensureWorktree(repoPath, pr);
    expect(readFileSync(join(path, "added.ts"), "utf8")).toContain("added = 1");

    const git = (...args: string[]) =>
      execFileAsync("git", args, { cwd: repoPath });
    await git("checkout", "feature");
    writeFileSync(join(repoPath, "added.ts"), "export const added = 2;\n");
    await git("commit", "-am", "one more commit on the PR");
    const { stdout: newHeadSha } = await git("rev-parse", "HEAD");
    await git("checkout", "main");

    const moved = await ensureWorktree(repoPath, {
      ...pr,
      headSha: newHeadSha.trim(),
    });

    expect(moved).toBe(path);
    expect(readFileSync(join(path, "added.ts"), "utf8")).toContain(
      "added = 2",
    );
  });

  it("recovers when the worktree directory was deleted by hand", async () => {
    const { repoPath, pr } = await createFixtureRepo();
    const path = await ensureWorktree(repoPath, pr);

    // Simulate a user deleting the directory directly instead of going
    // through removeWorktree() -- git still has it registered afterwards.
    rmSync(path, { recursive: true, force: true });

    const rebuilt = await ensureWorktree(repoPath, pr);
    expect(rebuilt).toBe(path);
    expect(readFileSync(join(path, "kept.ts"), "utf8")).toContain("kept = 2");
  });

  it("removes a worktree cleanly", async () => {
    const { repoPath, pr } = await createFixtureRepo();
    const path = await ensureWorktree(repoPath, pr);

    await removeWorktree(repoPath, cityIdFor(pr));

    const { stdout } = await execFileAsync("git", ["worktree", "list"], {
      cwd: repoPath,
    });
    expect(stdout).not.toContain(path);
  });

  it("prunes worktrees that fell out of the keep set", async () => {
    const { repoPath, pr } = await createFixtureRepo();
    await ensureWorktree(repoPath, pr);

    await pruneWorktrees(repoPath, new Set());

    const { stdout } = await execFileAsync("git", ["worktree", "list"], {
      cwd: repoPath,
    });
    expect(stdout).not.toContain(cityIdFor(pr));
  });
});

describe("GhCliClient helpers", () => {
  it("maps gh's issue JSON shape to IssueRef", () => {
    expect(
      parseIssueListJson(
        JSON.stringify([
          {
            number: 12,
            title: "Fix the shop",
            body: "The issue shop needs a sign.",
            author: { login: "octocat" },
            url: "https://example.invalid/issues/12",
          },
        ]),
      ),
    ).toEqual([
      {
        number: 12,
        title: "Fix the shop",
        body: "The issue shop needs a sign.",
        author: "octocat",
        url: "https://example.invalid/issues/12",
      },
    ]);
  });

  it("maps gh's JSON shape to PullRequestRef", () => {
    const refs = parsePullRequestListJson(
      JSON.stringify([
        {
          number: 42,
          title: "Fix the thing",
          author: { login: "octocat" },
          headRefName: "fix-thing",
          headRefOid: "abc123",
          baseRefName: "main",
          url: "https://example.invalid/pr/42",
        },
      ]),
    );

    expect(refs).toEqual([
      {
        number: 42,
        title: "Fix the thing",
        author: "octocat",
        headSha: "abc123",
        headRef: "fix-thing",
        baseRef: "main",
        url: "https://example.invalid/pr/42",
      },
    ]);
  });

  it("maps review events to gh's CLI flags", () => {
    expect(reviewEventFlag("APPROVE")).toBe("--approve");
    expect(reviewEventFlag("REQUEST_CHANGES")).toBe("--request-changes");
    expect(reviewEventFlag("COMMENT")).toBe("--comment");
  });
});
