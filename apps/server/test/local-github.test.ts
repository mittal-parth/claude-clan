import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cloneLocalGithubRepo,
  listLocalGithubRepos,
  localGithubUser,
  registerLocalGithubRoutes,
} from "../src/local-github.js";
import type { WorkspaceManager } from "../src/workspaces.js";

const openLocalFolder = vi.fn(async ({ path }: { path: string }) => ({
  key: `local:${path}`,
  path,
}));
const workspaceManager = { openLocalFolder } as unknown as WorkspaceManager;

let scratch: string;
let previousGhPath: string | undefined;
let previousLocal: string | undefined;

/**
 * A stand-in for the real `gh`, and deliberately a strict one.
 *
 * The previous version of this fake echoed whatever `--json` fields it was
 * asked for and emitted `defaultBranchName`, a field `gh repo list` does not
 * have. That made the suite green while every real listing failed: the fake had
 * been written from the implementation instead of from the tool. So it now
 * mirrors two things about real gh that actually matter --
 *
 *   1. it validates `--json` against the real field list and exits non-zero
 *      with gh's own "Unknown JSON field" message on stderr, and
 *   2. it returns `defaultBranchRef` as a nested object, which is the shape gh
 *      really produces.
 *
 * Verified against `gh version 2.x` output on macOS.
 */
async function fakeGh(): Promise<string> {
  const path = join(scratch, "gh");
  await writeFile(
    path,
    `#!/bin/sh
set -eu

# The subset of 'gh repo list --json' fields this project relies on. Real gh
# rejects anything outside its own list, and so must this.
KNOWN="archivedAt assignableUsers codeOfConduct contactLinks createdAt defaultBranchRef deleteBranchOnMerge description diskUsage forkCount fundingLinks hasDiscussionsEnabled hasIssuesEnabled hasProjectsEnabled hasWikiEnabled homepageUrl id isArchived isBlankIssuesEnabled isEmpty isFork isInOrganization isMirror isPrivate isSecurityPolicyEnabled isTemplate isUserConfigurationRepository issues labels languages latestRelease licenseInfo mentionableUsers mergeCommitAllowed milestones mirrorUrl name nameWithOwner openGraphImageUrl owner parent primaryLanguage projects pullRequests pushedAt rebaseMergeAllowed repositoryTopics securityPolicyUrl squashMergeAllowed sshUrl stargazerCount templateRepository updatedAt url usesCustomOpenGraphImage viewerCanAdminister viewerDefaultCommitEmail viewerDefaultMergeMethod viewerHasStarred viewerPermission viewerPossibleCommitEmails viewerSubscription visibility watchers"

if [ "$1" = "auth" ]; then
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  printf '%s' '{"login":"octocat","avatar_url":"https://avatars.example.test/octocat.png","name":"Mona Octocat"}'
  exit 0
fi

if [ "$1" = "repo" ] && [ "$2" = "list" ]; then
  FIELDS=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "--json" ]; then
      shift
      FIELDS="\${1:-}"
      break
    fi
    shift
  done
  OLDIFS="$IFS"
  IFS=','
  for field in $FIELDS; do
    IFS="$OLDIFS"
    match=0
    for known in $KNOWN; do
      if [ "$field" = "$known" ]; then
        match=1
        break
      fi
    done
    if [ "$match" -eq 0 ]; then
      printf 'Unknown JSON field: "%s"\\n' "$field" >&2
      exit 1
    fi
    IFS=','
  done
  IFS="$OLDIFS"
  printf '%s' '[{"nameWithOwner":"octocat/hello-world","name":"hello-world","owner":{"id":"U_1","login":"octocat"},"isPrivate":false,"defaultBranchRef":{"name":"main"},"diskUsage":128},{"nameWithOwner":"octocat/private","name":"private","owner":{"id":"U_1","login":"octocat"},"isPrivate":true,"defaultBranchRef":{"name":"trunk"},"diskUsage":256},{"nameWithOwner":"octocat/empty","name":"empty","owner":{"id":"U_1","login":"octocat"},"isPrivate":false,"defaultBranchRef":null,"diskUsage":0}]'
  exit 0
fi

if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then
  mkdir -p "$4/.git"
  printf '%s\\n' 'clone complete'
  exit 0
fi

exit 1
`,
  );
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  scratch = await mkdtemp(join("/tmp", "cc-local-gh-test-"));
  previousGhPath = process.env.SUDO_CITY_GH_PATH;
  previousLocal = process.env.SUDO_CITY_LOCAL;
  process.env.SUDO_CITY_GH_PATH = await fakeGh();
  process.env.SUDO_CITY_LOCAL = "1";
  openLocalFolder.mockClear();
});

afterEach(async () => {
  if (previousGhPath === undefined) delete process.env.SUDO_CITY_GH_PATH;
  else process.env.SUDO_CITY_GH_PATH = previousGhPath;
  if (previousLocal === undefined) delete process.env.SUDO_CITY_LOCAL;
  else process.env.SUDO_CITY_LOCAL = previousLocal;
  await rm(scratch, { recursive: true, force: true });
});

describe("local GitHub CLI", () => {
  it("returns a graceful unavailable state when gh cannot be resolved", async () => {
    process.env.SUDO_CITY_GH_PATH = join(scratch, "missing-gh");
    const result = await listLocalGithubRepos({ root: join(scratch, "github") });
    expect(result.available).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.repos).toEqual([]);
    expect(result.error).toMatch(/not installed/i);
  });

  it("lists authenticated gh repositories and marks existing clones", async () => {
    const root = join(scratch, "github");
    await mkdir(join(root, "octocat", "private", ".git"), { recursive: true });
    const result = await listLocalGithubRepos({ root });

    expect(result).toMatchObject({ available: true, authenticated: true });
    expect(result.repos).toEqual([
      expect.objectContaining({
        key: "local:gh:octocat/hello-world",
        fullName: "octocat/hello-world",
        owner: "octocat",
        imported: false,
        defaultBranch: "main",
        size: 128,
      }),
      expect.objectContaining({
        key: "local:gh:octocat/private",
        private: true,
        imported: true,
        // Read out of the nested defaultBranchRef object, not a flat string.
        defaultBranch: "trunk",
      }),
      expect.objectContaining({
        key: "local:gh:octocat/empty",
        // A repository with no commits has defaultBranchRef: null, so the
        // fallback has to hold rather than the row being dropped.
        defaultBranch: "main",
      }),
    ]);
  });

  it("reports gh's own message when a listing fails, rather than blaming auth", async () => {
    // The fake rejects unknown --json fields exactly as gh does. This is the
    // guard for the defect this test file previously hid: the implementation
    // asked for "defaultBranchName", gh refused the whole request, and the
    // catch reported "check gh auth status" for an already-authenticated CLI.
    const path = join(scratch, "gh-bad-field");
    await writeFile(
      path,
      `#!/bin/sh
if [ "$1" = "auth" ]; then exit 0; fi
printf 'Unknown JSON field: "defaultBranchName"\\n' >&2
exit 1
`,
    );
    await chmod(path, 0o755);
    process.env.SUDO_CITY_GH_PATH = path;

    const result = await listLocalGithubRepos({ root: join(scratch, "github") });
    expect(result).toMatchObject({ available: true, authenticated: true });
    expect(result.repos).toEqual([]);
    expect(result.error).toContain("Unknown JSON field");
    // The misleading advice must not come back.
    expect(result.error).not.toMatch(/gh auth status/i);
  });

  it("clones through gh and opens the result as a local workspace", async () => {
    const root = join(scratch, "github");
    const progress: string[] = [];
    const result = await cloneLocalGithubRepo({
      fullName: "octocat/hello-world",
      root,
      workspaces: workspaceManager,
      onProgress: (message) => progress.push(message),
    });

    expect(result).toEqual({
      workspaceKey: `local:${join(root, "octocat", "hello-world")}`,
      path: join(root, "octocat", "hello-world"),
    });
    expect(progress).toContain("cloning with gh");
    expect(workspaceManager.openLocalFolder).toHaveBeenCalledWith({
      path: join(root, "octocat", "hello-world"),
      storeRoot: undefined,
    });
  });

  it("reuses a clone and refuses to overwrite a non-clone directory", async () => {
    const root = join(scratch, "github");
    const destination = join(root, "octocat", "hello-world");
    await mkdir(join(destination, ".git"), { recursive: true });
    await cloneLocalGithubRepo({ fullName: "octocat/hello-world", root, workspaces: workspaceManager });
    expect(workspaceManager.openLocalFolder).toHaveBeenCalledTimes(1);

    const occupied = join(root, "octocat", "private");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "keep.txt"), "do not delete");
    await expect(
      cloneLocalGithubRepo({ fullName: "octocat/private", root, workspaces: workspaceManager }),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects invalid repository names before invoking gh", async () => {
    await expect(
      cloneLocalGithubRepo({ fullName: "../../escape", root: join(scratch, "github"), workspaces: workspaceManager }),
    ).rejects.toThrow(/owner\/name/i);
    expect(workspaceManager.openLocalFolder).not.toHaveBeenCalled();
  });

  it("reads the signed-in gh account for the HUD, and stays quiet without gh", async () => {
    const user = await localGithubUser();
    expect(user).toEqual({
      login: "octocat",
      avatarUrl: "https://avatars.example.test/octocat.png",
      name: "Mona Octocat",
    });

    // No gh installed is a normal desktop state, not an error: the HUD simply
    // shows no avatar, so this must resolve undefined rather than throw.
    process.env.SUDO_CITY_GH_PATH = join(scratch, "missing-gh");
    await expect(localGithubUser()).resolves.toBeUndefined();
  });

  it("serves the gh identity in local mode and hides the route when hosted", async () => {
    const app = Fastify();
    registerLocalGithubRoutes(app, workspaceManager, { root: join(scratch, "github") });
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/local/github/user" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { login: "octocat" } });
    await app.close();

    delete process.env.SUDO_CITY_LOCAL;
    const hosted = Fastify();
    registerLocalGithubRoutes(hosted, workspaceManager, { root: join(scratch, "github") });
    await hosted.ready();
    const hostedResponse = await hosted.inject({ method: "GET", url: "/api/local/github/user" });
    expect(hostedResponse.statusCode).toBe(404);
    await hosted.close();
  });

  it("registers routes only in local mode and serves the gh status payload", async () => {
    const app = Fastify();
    registerLocalGithubRoutes(app, workspaceManager, { root: join(scratch, "github") });
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/local/github/repos" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: true, authenticated: true });
    await app.close();

    delete process.env.SUDO_CITY_LOCAL;
    const hostedApp = Fastify();
    registerLocalGithubRoutes(hostedApp, workspaceManager, { root: join(scratch, "github") });
    await hostedApp.ready();
    const hostedResponse = await hostedApp.inject({ method: "GET", url: "/api/local/github/repos" });
    expect(hostedResponse.statusCode).toBe(404);
    await hostedApp.close();
  });
});
