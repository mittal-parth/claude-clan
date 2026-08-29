import { access, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { RepoSummary } from "@sudo-city/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidRepoFullName } from "@sudo-city/cities";
import { isLocalMode } from "./local-mode.js";
import type { WorkspaceManager } from "./workspaces.js";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 60_000;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_GITHUB_ROOT = join(
  homedir(),
  "Library",
  "Application Support",
  "Claude City",
  "github",
);

export interface LocalGithubOptions {
  root?: string;
  storeRootFor?: (repoPath: string) => string | undefined;
}

interface GhRepoJson {
  nameWithOwner?: unknown;
  name?: unknown;
  owner?: { login?: unknown } | unknown;
  isPrivate?: unknown;
  /** `gh repo list` returns an object, e.g. {"name":"main"} -- not a string. */
  defaultBranchRef?: { name?: unknown } | unknown;
  diskUsage?: unknown;
}

export interface LocalGithubStatus {
  available: boolean;
  authenticated: boolean;
  repos: RepoSummary[];
  error?: string;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function executable(path: string): Promise<boolean> {
  try {
    const details = await stat(path);
    return details.isFile();
  } catch {
    return false;
  }
}

/** Resolve gh without trusting a Finder-launched app's sparse PATH. */
export async function resolveGhBinary(): Promise<string | undefined> {
  const configured = process.env.SUDO_CITY_GH_PATH?.trim();
  if (configured) {
    return (await executable(configured)) ? configured : undefined;
  }
  const candidates = [
    join(homedir(), ".local", "bin", "gh"),
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/usr/bin/gh",
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", "command -v gh"], {
      env: commandEnvironment(),
      timeout: 10_000,
      maxBuffer: 16_000,
    });
    const found = stdout.trim().split("\n")[0];
    return found && (await executable(found)) ? found : undefined;
  } catch {
    return undefined;
  }
}

async function runGh(
  gh: string,
  args: readonly string[],
  timeout: number,
): Promise<string> {
  const { stdout } = await execFileAsync(gh, [...args], {
    env: commandEnvironment(),
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function localGithubKey(fullName: string): string {
  return `local:gh:${fullName}`;
}

function destinationFor(root: string, fullName: string): string {
  const [owner, name] = fullName.split("/") as [string, string];
  const resolvedRoot = resolve(root);
  const destination = resolve(resolvedRoot, owner, name);
  const escaped = relative(resolvedRoot, destination);
  if (!escaped || escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new Error("Invalid local GitHub repository path");
  }
  return destination;
}

async function isClone(destination: string): Promise<boolean> {
  try {
    await access(join(destination, ".git"));
    return true;
  } catch {
    return false;
  }
}

function parseRepo(row: GhRepoJson, root: string): RepoSummary | undefined {
  const fullName = typeof row.nameWithOwner === "string" ? row.nameWithOwner : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  const owner =
    row.owner && typeof row.owner === "object" && "login" in row.owner &&
    typeof row.owner.login === "string"
      ? row.owner.login
      : fullName?.split("/")[0];
  const branchRef =
    row.defaultBranchRef &&
    typeof row.defaultBranchRef === "object" &&
    "name" in row.defaultBranchRef &&
    typeof row.defaultBranchRef.name === "string"
      ? row.defaultBranchRef.name
      : undefined;
  // A repository with no commits has defaultBranchRef: null, so this genuinely
  // needs a fallback rather than being treated as malformed.
  const defaultBranch = branchRef && branchRef.length > 0 ? branchRef : "main";
  if (!fullName || !name || !owner || !isValidRepoFullName(fullName)) {
    return undefined;
  }
  const diskUsage = typeof row.diskUsage === "number" && Number.isFinite(row.diskUsage)
    ? Math.max(0, Math.trunc(row.diskUsage))
    : undefined;
  return {
    key: localGithubKey(fullName),
    fullName,
    owner,
    name,
    private: row.isPrivate === true,
    defaultBranch,
    ...(diskUsage === undefined ? {} : { size: diskUsage }),
    imported: false,
  };
}

export interface LocalGithubUser {
  login: string;
  avatarUrl: string;
  name?: string;
}

/**
 * The signed-in gh account, for the desktop HUD's identity corner.
 *
 * The hosted build gets this from its own GitHub OAuth session, which the
 * desktop build has no reason to ask for: the mayor is already authenticated
 * locally. Returns undefined rather than throwing whenever gh is missing or
 * logged out, because a missing avatar must not be an error state.
 */
export async function localGithubUser(): Promise<LocalGithubUser | undefined> {
  const gh = await resolveGhBinary();
  if (!gh) return undefined;
  try {
    const output = await runGh(gh, ["api", "user"], GH_TIMEOUT_MS);
    const parsed = JSON.parse(output) as {
      login?: unknown;
      avatar_url?: unknown;
      name?: unknown;
    };
    if (typeof parsed.login !== "string" || typeof parsed.avatar_url !== "string") {
      return undefined;
    }
    return {
      login: parsed.login,
      avatarUrl: parsed.avatar_url,
      ...(typeof parsed.name === "string" && parsed.name.length > 0
        ? { name: parsed.name }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export async function listLocalGithubRepos(
  options: LocalGithubOptions = {},
): Promise<LocalGithubStatus> {
  const gh = await resolveGhBinary();
  if (!gh) {
    return {
      available: false,
      authenticated: false,
      repos: [],
      error: "GitHub CLI (gh) is not installed. Install it and run gh auth login to use GitHub import.",
    };
  }
  try {
    await runGh(gh, ["auth", "status", "--hostname", "github.com"], GH_TIMEOUT_MS);
  } catch {
    return {
      available: true,
      authenticated: false,
      repos: [],
      error: "GitHub CLI is not signed in. Run gh auth login, then refresh this panel.",
    };
  }

  try {
    const output = await runGh(
      gh,
      [
        "repo",
        "list",
        "--limit",
        "1000",
        "--json",
        // `defaultBranchRef`, not `defaultBranchName`: the latter is not a
        // field `gh repo list` knows, and gh rejects the whole request with
        // "Unknown JSON field" rather than ignoring it. It returns an object
        // ({"name":"main"}), not a string -- see parseRepo.
        "nameWithOwner,name,owner,isPrivate,defaultBranchRef,diskUsage",
      ],
      GH_TIMEOUT_MS,
    );
    const parsed = JSON.parse(output) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [];
    const root = options.root ?? DEFAULT_GITHUB_ROOT;
    const repos = rows
      .filter((row): row is GhRepoJson => Boolean(row) && typeof row === "object")
      .map((row) => parseRepo(row, root))
      .filter((repo): repo is RepoSummary => repo !== undefined);
    await mkdir(root, { recursive: true });
    await Promise.all(
      repos.map(async (repo) => {
        repo.imported = await isClone(destinationFor(root, repo.fullName));
      }),
    );
    return { available: true, authenticated: true, repos };
  } catch (error) {
    // The previous `catch {}` here reported every failure as "check gh auth
    // status", which sent people to re-authenticate a CLI that was already
    // signed in -- the actual fault was an invalid --json field, and gh had
    // said so on stderr. Carry gh's own message through: it is the only thing
    // that distinguishes a bad field from a rate limit from a network fault.
    const detail = ghErrorDetail(error);
    return {
      available: true,
      authenticated: true,
      repos: [],
      error: detail
        ? `GitHub CLI could not list repositories: ${detail}`
        : "GitHub CLI could not list repositories.",
    };
  }
}

/**
 * The useful line out of an execFile rejection. gh writes diagnostics to
 * stderr and exits non-zero, so the Error's own message is only ever
 * "Command failed"; the first stderr line is what names the real problem.
 */
function ghErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = error as { stderr?: unknown; killed?: unknown; message?: unknown };
  if (value.killed === true) {
    return "the command timed out";
  }
  const stderr = typeof value.stderr === "string" ? value.stderr.trim() : "";
  if (stderr) {
    return stderr.split("\n")[0]?.slice(0, 200);
  }
  return typeof value.message === "string" ? value.message.slice(0, 200) : undefined;
}

export async function cloneLocalGithubRepo(options: {
  fullName: string;
  root?: string;
  storeRootFor?: (repoPath: string) => string | undefined;
  workspaces: WorkspaceManager;
  onProgress?: (message: string) => void;
}): Promise<{ workspaceKey: string; path: string }> {
  if (!isValidRepoFullName(options.fullName)) {
    throw new Error("fullName must be a valid owner/name");
  }
  const gh = await resolveGhBinary();
  if (!gh) {
    throw new Error("GitHub CLI (gh) is not installed");
  }
  const root = resolve(options.root ?? DEFAULT_GITHUB_ROOT);
  const destination = destinationFor(root, options.fullName);
  await mkdir(dirname(destination), { recursive: true });

  if (await isClone(destination)) {
    options.onProgress?.("reusing existing clone");
  } else {
    try {
      await access(destination);
      throw new Error("The local GitHub destination already exists and is not a clone");
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
    }
    options.onProgress?.("cloning with gh");
    try {
      await execFileAsync(
        gh,
        ["repo", "clone", options.fullName, destination, "--", "--depth=50", "--single-branch"],
        {
          env: commandEnvironment(),
          timeout: CLONE_TIMEOUT_MS,
          maxBuffer: 128 * 1024,
        },
      );
    } catch (error) {
      const detail = ghErrorDetail(error);
      throw new Error(
        detail
          ? `Failed to clone ${options.fullName}: ${detail}`
          : `Failed to clone ${options.fullName} with GitHub CLI`,
      );
    }
  }

  const workspace = await options.workspaces.openLocalFolder({
    path: destination,
    storeRoot: options.storeRootFor?.(destination),
  });
  return { workspaceKey: workspace.key, path: destination };
}

async function localRequestAllowed(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (isLocalMode()) return true;
  await reply.code(404).send({ error: "Local GitHub import is unavailable." });
  return false;
}

export function registerLocalGithubRoutes(
  app: FastifyInstance,
  workspaces: WorkspaceManager,
  options: LocalGithubOptions = {},
): void {
  app.get("/api/local/github/repos", async (request, reply) => {
    if (!(await localRequestAllowed(request, reply))) return;
    return listLocalGithubRepos(options);
  });

  app.get("/api/local/github/user", async (request, reply) => {
    if (!(await localRequestAllowed(request, reply))) return;
    // A logged-out or absent gh is a normal state here, not a failure, so this
    // answers 200 with an empty body rather than an error the HUD would have
    // to special-case.
    return { user: await localGithubUser() };
  });

  app.post<{ Body: { fullName?: string } }>(
    "/api/local/github/clone",
    async (request, reply) => {
      if (!(await localRequestAllowed(request, reply))) return;
      const fullName = request.body?.fullName;
      if (!isValidRepoFullName(fullName)) {
        await reply.code(400).send({ error: "fullName must be a valid owner/name" });
        return;
      }
      const stream = new (await import("node:stream")).PassThrough();
      void reply.header("Content-Type", "application/x-ndjson").send(stream);
      try {
        const result = await cloneLocalGithubRepo({
          fullName,
          root: options.root,
          storeRootFor: options.storeRootFor,
          workspaces,
          onProgress: (message) => stream.write(JSON.stringify({ phase: "cloning", message }) + "\n"),
        });
        stream.write(JSON.stringify({ phase: "ready", ...result }) + "\n");
        stream.end();
      } catch (error) {
        stream.write(
          JSON.stringify({
            error: error instanceof Error ? error.message : "GitHub clone failed",
          }) + "\n",
        );
        stream.end();
      }
    },
  );
}
