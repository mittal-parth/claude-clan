import { execFile, spawn } from "node:child_process";
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "git",
        ["clone", "--progress", "--depth=50", "--single-branch", remote, options.destination],
        {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "credential.helper",
            GIT_CONFIG_VALUE_0: "",
          },
        }
      );

      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutMs = 5 * 60_000;
      
      const clearTimer = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      timeoutId = setTimeout(() => {
        child.kill();
        const err = new Error("killed");
        (err as any).killed = true;
        reject(err);
      }, timeoutMs);

      let errorOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        errorOutput += text;
        if (errorOutput.length > 16384) {
          errorOutput = errorOutput.slice(-16384);
        }
        const lines = text.split(/[\r\n]+/);
        for (const line of lines) {
          const match = line.match(/(?:Receiving objects|Resolving deltas):\s+(\d+)%\s+\((\d+\/\d+)\)(?:.*\|\s+([\d.]+\s+[a-zA-Z]+\/s))?/);
          if (match) {
            const percent = match[1];
            const size = match[2];
            const speed = match[3];
            const formatted = `${size} • ${percent}%` + (speed ? ` • ${speed}` : "");
            options.onProgress?.(formatted);
          }
        }
      });

      child.on("error", (err: Error) => {
        clearTimer();
        reject(err);
      });

      child.on("close", (code: number) => {
        clearTimer();
        if (code === 0) resolve();
        else reject(new Error(`git clone exited with code ${code}: ${errorOutput}`));
      });
    });
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
