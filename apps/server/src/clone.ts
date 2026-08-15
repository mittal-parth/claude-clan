import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CloneOptions {
  owner: string;
  name: string;
  destination: string;
  githubToken: string;
  onProgress?: (message: string) => void;
}

/**
 * A shallow, single-branch clone -- `/tmp` on Render is wiped on every
 * deploy and every free-tier spin-down, so this is a cache to rebuild
 * cheaply, not a durable checkout. The token is embedded in the remote URL
 * (x-access-token:<token>@github.com) rather than passed as a header, since
 * plain `git clone` has no way to attach custom HTTP headers to the initial
 * request; it's never logged because argv isn't echoed and the destination
 * directory (not the URL) is what appears in error messages below.
 */
export async function cloneRepo(options: CloneOptions): Promise<void> {
  await rm(options.destination, { recursive: true, force: true });
  await mkdir(dirname(options.destination), { recursive: true });
  const remote = `https://x-access-token:${options.githubToken}@github.com/${options.owner}/${options.name}.git`;

  options.onProgress?.("cloning");
  try {
    await execFileAsync(
      "git",
      ["clone", "--depth=50", "--single-branch", remote, options.destination],
      {
        maxBuffer: 16 * 1024 * 1024,
        // A shallow clone still pulls the full working tree at each of the
        // last 50 commits, not just deltas -- for an unusually large repo
        // (a multi-gigabyte monorepo, say) that's a real multi-minute
        // transfer, not a hang. 60s was too eager to kill a slow-but-honest
        // clone; 5 minutes is the ceiling before this is treated as failed.
        timeout: 5 * 60_000,
        env: {
          ...process.env,
          // The token is already embedded in the remote URL -- if it's
          // rejected (expired, wrong scope), git must fail fast with an
          // error rather than falling through to an interactive credential
          // prompt (or, on macOS, a Keychain GUI prompt via osxkeychain)
          // that nothing on a headless server can ever answer, hanging the
          // request forever.
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "credential.helper",
          GIT_CONFIG_VALUE_0: "",
        },
      },
    );
  } catch (error) {
    // A timeout kill leaves Node's error with no useful stderr tail (the
    // process was cut off mid-transfer), so it needs its own message rather
    // than surfacing whatever partial "Cloning into '...'" text git managed
    // to print before being killed.
    const timedOut =
      error instanceof Error && "killed" in error && (error as { killed?: boolean }).killed === true;
    if (timedOut) {
      throw new Error(
        `Cloning ${options.owner}/${options.name} took longer than 5 minutes and was cancelled -- it may be unusually large.`,
      );
    }
    throw new Error(
      `Failed to clone ${options.owner}/${options.name}: ${
        error instanceof Error ? error.message.replaceAll(remote, "<redacted>") : String(error)
      }`,
    );
  }

  await stripRemoteCredentials(
    options.destination,
    `https://github.com/${options.owner}/${options.name}.git`,
  );
}

/**
 * `git clone` writes the URL it was given into .git/config verbatim, embedded
 * credentials and all -- so a freshly cloned repo carries its owner's GitHub
 * token in plaintext inside the working tree. Every user's clones live under
 * one root on this box, and a crew has Bash, so that file is readable by
 * anyone else's agent: it turns "can see your code" into "can push to your
 * repositories". Rewriting the remote without credentials leaves nothing at
 * rest; the token is supplied per invocation when a PR fetch actually needs
 * it (see ensureWorktree).
 *
 * There is a brief window between clone and rewrite where the token is on
 * disk. Closing that entirely means never handing git a credentialed URL,
 * which costs an auth mechanism this doesn't need yet.
 */
export async function stripRemoteCredentials(
  repoPath: string,
  cleanRemote: string,
): Promise<void> {
  await execFileAsync("git", ["remote", "set-url", "origin", cleanRemote], {
    cwd: repoPath,
  });
}
