import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripRemoteCredentials } from "../src/clone.js";

const execFileAsync = promisify(execFile);
const TOKEN = "ghs_ThisWouldBeARealInstallationToken";

/**
 * `git clone` persists whatever URL it was handed, credentials included, into
 * .git/config. On a box where every user's clones sit under one root and every
 * crew has Bash, that file is one user's agent away from another user's GitHub
 * account -- so this asserts the token is not left behind.
 */
describe("stripRemoteCredentials", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), "sudocity-clone-test-"));
    await execFileAsync("git", ["init", "-q", repoPath]);
    await execFileAsync(
      "git",
      [
        "remote",
        "add",
        "origin",
        `https://x-access-token:${TOKEN}@github.com/octocat/hello-world.git`,
      ],
      { cwd: repoPath },
    );
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  async function configuredRemote(): Promise<string> {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoPath },
    );
    return stdout.trim();
  }

  it("confirms git stores the credential in the first place", async () => {
    // Guards the premise: if a future git stopped persisting userinfo, the
    // rest of this suite would pass for the wrong reason.
    expect(await configuredRemote()).toContain(TOKEN);
  });

  it("leaves no token in the remote URL", async () => {
    await stripRemoteCredentials(
      repoPath,
      "https://github.com/octocat/hello-world.git",
    );

    const remote = await configuredRemote();
    expect(remote).toBe("https://github.com/octocat/hello-world.git");
    expect(remote).not.toContain(TOKEN);
    expect(remote).not.toContain("x-access-token");
  });

  it("leaves no token anywhere in .git/config", async () => {
    await stripRemoteCredentials(
      repoPath,
      "https://github.com/octocat/hello-world.git",
    );

    // The URL is the known hiding place, but assert on the whole file so a
    // future change that stashes credentials elsewhere is caught too.
    const { stdout } = await execFileAsync("git", ["config", "--list"], {
      cwd: repoPath,
    });
    expect(stdout).not.toContain(TOKEN);
  });

  it("keeps the remote usable for identifying the repository", async () => {
    await stripRemoteCredentials(
      repoPath,
      "https://github.com/octocat/hello-world.git",
    );

    // parseGitHubRemote reads this to resolve owner/name for the GitHub API.
    expect(await configuredRemote()).toMatch(
      /github\.com\/octocat\/hello-world/,
    );
  });
});
