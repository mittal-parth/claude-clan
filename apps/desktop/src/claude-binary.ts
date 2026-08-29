import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const USER_CANDIDATES = [
  join(homedir(), ".local", "bin", "claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ClaudeBinary {
  path: string;
  version: string;
  source: "user" | "bundled";
}

export async function resolveClaudeBinary(
  configured?: string,
): Promise<ClaudeBinary | undefined> {
  const bundledPaths = bundledCandidates();
  const candidates = [
    ...(configured ? [configured] : []),
    ...USER_CANDIDATES,
    ...(await fromShellPath()),
    ...bundledPaths,
  ];
  const seen = new Set<string>();

  for (const path of candidates) {
    if (seen.has(path) || !isExecutable(path)) {
      continue;
    }
    seen.add(path);
    const version = await execFileAsync(path, ["--version"], { timeout: 10_000 })
      .then(({ stdout }) => stdout.trim())
      .catch(() => undefined);
    if (version) {
      return {
        path,
        version,
        source: bundledPaths.includes(path) ? "bundled" : "user",
      };
    }
  }
  return undefined;
}

async function fromShellPath(): Promise<string[]> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  return execFileAsync(shell, ["-l", "-c", "command -v claude"], { timeout: 10_000 })
    .then(({ stdout }) => (stdout.trim() ? [stdout.trim()] : []))
    .catch(() => []);
}

function bundledCandidates(): string[] {
  const configured = process.env.SUDO_CITY_BUNDLED_CLAUDE?.trim();
  return configured ? [configured] : [];
}
