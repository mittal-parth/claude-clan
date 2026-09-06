import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  SessionRunner,
  type AgentEvent,
  type SandboxSettings,
} from "@sudo-city/agent";
import { configureGitIdentity, setupGitCredentials } from "./clone.js";
import {
  GitHubApiClient,
  changedFiles,
  cityIdFor,
  ensureMainWorktree,
  ensureWorktree,
  fileDiff,
  issueCityIdFor,
  listLocalWorktrees,
  pruneWorktrees,
  type GitHubClient,
  type IssueRef,
  type LocalWorktreeRef,
  type PullRequestRef,
} from "@sudo-city/cities";
import { layoutWorld } from "@sudo-city/layout";
import {
  isPushOrPrCommand,
  isWriteAccessError,
  type ChangedFile,
  type CityId,
  type CitySummary,
  type EffortLevel,
  type GameEvent,
  type Issue,
  type PermissionMode,
  type PullRequestOverlay,
  type SessionStatus,
  type SessionSummary,
  type TurnOutcome,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { SQLiteWorldStore } from "@sudo-city/world";
import { scanRepository } from "@sudo-city/worldgen";
import { BudgetLedger } from "./budget-ledger.js";
import {
  MAX_RUNNING_SESSIONS_PER_WORKSPACE,
  MAX_SESSIONS_PER_CITY,
  SessionRegistry,
  autoTitle,
  sessionToRecord,
  type QueuedTurn,
  type SessionState,
} from "./sessions.js";
import type { FastifyBaseLogger } from "fastify";

const MAX_CONTEXT_FILES = 20;
const WORLD_STORE_DIR = ".sudocity/";
const execFileAsync = promisify(execFile);

type EventInput<Event extends GameEvent = GameEvent> = Event extends GameEvent
  ? Omit<Event, "id" | "cityId" | "sessionId" | "sequence" | "timestamp">
  : never;

export type SessionError =
  | { code: "CITY_NOT_FOUND" }
  | { code: "SESSION_NOT_FOUND" }
  | { code: "SESSION_CLOSED" }
  | { code: "BUDGET_EXHAUSTED"; message: string }
  | { code: "TOO_MANY_RUNNING_SESSIONS"; message: string }
  | { code: "TOO_MANY_SESSIONS"; message: string };

/** One city's worth of process state, identical in shape to the pre-multi-tenant single-repo server -- only its owning Workspace changed. */
interface City {
  readonly id: CityId;
  readonly cwd: string;
  readonly readOnly: boolean;
  readonly disallowedTools?: readonly string[];
  readonly systemPromptAppend?: string;
  snapshot: WorldSnapshot;
  overlay?: PullRequestOverlay;
  pendingScan?: Promise<WorldSnapshot>;
}

/**
 * Whether an issue is a synthesised stand-in for a local git worktree rather
 * than something a person opened on GitHub.
 *
 * refreshRoster() pushes one of these per checked-out worktree so the branch
 * shows up as a city you can travel to, and a `file://` url is what tells the
 * two apart — a GitHub issue always has an https one. Keep the test here
 * rather than repeating the prefix: the roster, the city list and the issue
 * board all have to agree on what counts as local.
 */
function isLocalWorktreeIssue(issue: Pick<IssueRef, "url">): boolean {
  return issue.url?.startsWith("file://") ?? false;
}

class CityRegistry {
  private readonly cities = new Map<CityId, City>();
  private readonly pullRequests = new Map<CityId, PullRequestRef>();
  private readonly issues = new Map<CityId, IssueRef>();
  private readonly pendingBuilds = new Map<CityId, Promise<City>>();

  add(city: City): void {
    this.cities.set(city.id, city);
  }

  remove(id: CityId): void {
    this.cities.delete(id);
  }

  updateSystemPromptAppend(id: CityId, systemPromptAppend: string): void {
    const city = this.cities.get(id);
    if (city) {
      this.cities.set(id, { ...city, systemPromptAppend });
    }
  }

  get(id: CityId): City | undefined {
    return this.cities.get(id);
  }

  list(): City[] {
    return [...this.cities.values()];
  }

  setPullRequests(prs: readonly PullRequestRef[]): void {
    this.pullRequests.clear();
    for (const pr of prs) {
      this.pullRequests.set(cityIdFor(pr) as CityId, pr);
    }
  }

  pullRequestFor(id: CityId): PullRequestRef | undefined {
    return this.pullRequests.get(id);
  }

  setIssues(issues: readonly IssueRef[]): void {
    this.issues.clear();
    for (const issue of issues) {
      this.issues.set(issueCityIdFor(issue) as CityId, issue);
    }
  }

  issueFor(id: CityId): IssueRef | undefined {
    return this.issues.get(id);
  }

  /**
   * The issue board only — the bazaar under the capitol, where you pick
   * something to fix. Local worktrees are deliberately excluded: they are
   * already-checked-out branches, not work anyone reported, and offering one
   * as an issue to fix invites dispatching the mayor at a city that exists.
   * They keep their entry in `this.issues` because that is what gives them a
   * city id and a place in listCities().
   */
  listIssues(): Issue[] {
    return [...this.issues.values()]
      .filter((issue) => !isLocalWorktreeIssue(issue))
      .map((issue) => ({ ...issue }));
  }

  knownPullRequestIds(): CityId[] {
    return [...this.pullRequests.keys()];
  }

  isBuilding(id: CityId): boolean {
    return this.pendingBuilds.has(id);
  }

  async ensureBuild(id: CityId, build: () => Promise<City>): Promise<City> {
    let pending = this.pendingBuilds.get(id);
    if (!pending) {
      pending = build().finally(() => this.pendingBuilds.delete(id));
      this.pendingBuilds.set(id, pending);
    }
    const city = await pending;
    this.cities.set(id, city);
    return city;
  }

  summaries(): CitySummary[] {
    const entries: CitySummary[] = [];
    if (this.cities.has("main")) {
      entries.push({
        id: "main",
        kind: "main",
        title: "main",
        ref: "main",
        status: "ready",
      });
    }
    for (const [id, pr] of this.pullRequests) {
      entries.push({
        id,
        kind: "pull-request",
        title: `#${pr.number} ${pr.title}`,
        ref: pr.headRef,
        number: pr.number,
        author: pr.author,
        url: pr.url,
        status: this.cities.has(id)
          ? "ready"
          : this.pendingBuilds.has(id)
            ? "building"
            : "idle",
      });
    }
    for (const [id, issue] of this.issues) {
      const isLocalWorktree = isLocalWorktreeIssue(issue);
      if (!this.cities.has(id) && !this.pendingBuilds.has(id) && !isLocalWorktree) {
        continue;
      }
      entries.push({
        id,
        kind: "issue",
        title: isLocalWorktree ? issue.title : `#${issue.number} ${issue.title}`,
        ref: isLocalWorktree ? issue.title.replace(/^Local Worktree:\s*/, "") : "main",
        number: issue.number,
        author: issue.author,
        url: issue.url,
        status: this.cities.has(id)
          ? "ready"
          : this.pendingBuilds.has(id)
            ? "building"
            : "idle",
      });
    }
    return entries;
  }

}

const REVIEW_DISALLOWED_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

function reviewSystemPrompt(
  pr: PullRequestRef,
  overlay: PullRequestOverlay | undefined,
): string {
  const files = overlay?.files.length
    ? overlay.files.map((file) => `- ${file.change}: ${file.path}`).join("\n")
    : "(the changed-file list could not be computed)";
  return [
    `You are reviewing GitHub pull request #${pr.number}, "${pr.title}", opened by @${pr.author}.`,
    `This city's working directory is a worktree checked out at the PR's head commit (${pr.headSha}), diffed against ${pr.baseRef}.`,
    "Write, Edit, and NotebookEdit are disabled here -- this city is read-only. Read and search freely; do not attempt to fix anything in place.",
    "Changed files:",
    files,
    `To publish your review, run \`gh pr review ${pr.number} --approve\`, \`--request-changes\`, or \`--comment\`, each with \`--body "..."\`, via Bash. That call will pause for the mayor's permit before it executes -- never assume a review has been posted until it's been stamped.`,
  ].join("\n");
}

function mayorMessage(prompt: string, contextPaths: readonly string[]): string {
  if (contextPaths.length === 0) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Attached context files:",
    ...contextPaths.map((path) => `- ${path}`),
  ].join("\n");
}

const GIT_PERMISSION_INSTRUCTIONS = [
  "If git push or gh pr create fails with permission denied or HTTP 403, inform the user clearly: 'Git push was denied (HTTP 403). Write access is required to push changes or create pull requests. To fix this: 1. Ensure you have collaborator write permissions on the repository. 2. Verify that the GitHub App installation has \"Contents: Read and write\" permissions at https://github.com/settings/installations.'",
].join("\n");

export interface WorkspaceOptions {
  /** "demo", or `${userId}:${repoKeyFor(fullName)}` -- unique across the whole process, opaque to callers otherwise. */
  key: string;
  repoPath: string;
  /** The signed-in user's installation token; absent for the shared demo workspace, which falls back to GitHubApiClient's own GITHUB_TOKEN env var. */
  githubToken?: string;
  userId?: number;
  log: FastifyBaseLogger;
  /** Rationed from a ledger the WorkspaceManager sums across every open workspace, not just this one -- see index.ts. */
  remainingBudget: () => number;
  /** Called with the dollar cost of each finished run, for the durable per-user ledger. */
  onSpend?: (amountUsd: number) => void;
  /** OS-level confinement for this workspace's crews; undefined runs them unsandboxed. */
  sandbox?: SandboxSettings;
  onEvent: (cityId: CityId, sessionId: string, event: GameEvent) => void;
  onSessionChanged: (session: SessionSummary) => void;
  onCitiesChanged: () => void;
  onIssuesChanged: () => void;
  onError?: (error: { code: string; message: string; sessionId?: string }) => void;
}

/**
 * Everything that used to be module-level state in apps/server/src/index.ts,
 * now scoped per (user, repo) instead of per process. sanitizeContextPaths
 * closing over this.repoPath is what stops a path-traversal payload in one
 * user's session from reaching another user's clone.
 */
export class Workspace {
  readonly key: string;
  readonly repoPath: string;
  private readonly log: FastifyBaseLogger;
  private readonly store: SQLiteWorldStore;
  private readonly registry = new CityRegistry();
  private readonly githubClient: GitHubClient;
  private githubToken: string | undefined;
  private readonly userId: number | undefined;
  private viewerLoginValue: string | undefined;
  private readonly remainingBudget: () => number;
  private readonly sandbox: WorkspaceOptions["sandbox"];
  private readonly onSpend: WorkspaceOptions["onSpend"];
  private readonly onEvent: WorkspaceOptions["onEvent"];
  private readonly onSessionChanged: WorkspaceOptions["onSessionChanged"];
  private readonly onCitiesChanged: WorkspaceOptions["onCitiesChanged"];
  private readonly onIssuesChanged: WorkspaceOptions["onIssuesChanged"];
  private readonly onError: WorkspaceOptions["onError"];
  private readonly pendingToolCommands = new Map<string, string>();
  hasWriteAccess: boolean | undefined = undefined;
  private readonly sessions = new SessionRegistry();
  private readonly ledger: BudgetLedger;
  private readonly worldSequences = new Map<CityId, number>();
  /** Bumped on every access; the WorkspaceManager's LRU reads this to find an eviction candidate. */
  lastUsedAt = Date.now();

  private constructor(options: WorkspaceOptions) {
    this.key = options.key;
    this.repoPath = resolve(options.repoPath);
    this.log = options.log;
    this.githubToken = options.githubToken;
    this.userId = options.userId;
    this.remainingBudget = options.remainingBudget;
    this.sandbox = options.sandbox;
    this.onSpend = options.onSpend;
    this.onEvent = options.onEvent;
    this.onSessionChanged = options.onSessionChanged;
    this.onCitiesChanged = options.onCitiesChanged;
    this.onIssuesChanged = options.onIssuesChanged;
    this.onError = options.onError;
    this.ledger = new BudgetLedger(
      this.remainingBudget,
      (amountUsd) => this.onSpend?.(amountUsd),
    );
    this.store = new SQLiteWorldStore(join(this.repoPath, ".sudocity", "world.db"));
    this.githubClient = new GitHubApiClient();
  }

  private setPendingToolCommand(id: string, command: string): void {
    if (this.pendingToolCommands.size >= 100) {
      const oldest = this.pendingToolCommands.keys().next().value;
      if (oldest) this.pendingToolCommands.delete(oldest);
    }
    this.pendingToolCommands.set(id, command);
  }

  private buildSystemPromptAppend(basePrompt?: string): string {
    const parts = [
      ...(basePrompt ? [basePrompt] : []),
      GIT_PERMISSION_INSTRUCTIONS,
    ];
    if (this.hasWriteAccess === false) {
      parts.push(
        "IMPORTANT: You DO NOT have write permissions to push to this remote repository. Do not attempt to run 'git push' or 'gh pr create'. Commit your changes locally only and explain to the user that write access is required to push to GitHub.",
      );
    }
    return parts.join("\n\n");
  }

  private updateCitySystemPrompts(): void {
    const main = this.registry.get("main");
    if (main) {
      this.registry.updateSystemPromptAppend("main", this.buildSystemPromptAppend());
    }
    for (const city of this.registry.list()) {
      if (city.id !== "main") {
        const issue = this.registry.issueFor(city.id);
        if (issue) {
          this.registry.updateSystemPromptAppend(
            city.id,
            this.buildSystemPromptAppend(
              [
                `You are fixing GitHub issue #${issue.number}, "${issue.title}".`,
                "This city is a writable detached worktree based on main. Implement and verify the fix here; do not change the primary checkout.",
                issue.body ? `Issue details:\n${issue.body}` : "No issue description was provided.",
              ].join("\n\n"),
            ),
          );
        }
      }
    }
  }

  /**
   * Updates the GitHub token on reconnect / repo.select and re-evaluates write permissions.
   */
  async updateGithubToken(token?: string): Promise<void> {
    this.githubToken = token;
    if (token) {
      const writeAccess = await this.githubClient
        .hasWriteAccess(this.repoPath, token)
        .catch(() => undefined);
      if (writeAccess !== undefined) {
        this.hasWriteAccess = writeAccess;
        this.updateCitySystemPrompts();
      }
    }
  }

  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const workspace = new Workspace(options);
    await workspace.hideWorldStoreFromGit();
    await setupGitCredentials(workspace.repoPath).catch(() => undefined);
    workspace.viewerLoginValue = await workspace.githubClient
      .viewerLogin(workspace.githubToken)
      .catch(() => undefined);
    if (workspace.githubToken) {
      workspace.hasWriteAccess = await workspace.githubClient
        .hasWriteAccess(workspace.repoPath, workspace.githubToken)
        .catch(() => undefined);
    }
    const snapshot = await workspace.generateWorld("main", workspace.repoPath);
    workspace.registry.add({
      id: "main",
      cwd: workspace.repoPath,
      readOnly: false,
      systemPromptAppend: workspace.buildSystemPromptAppend(),
      snapshot,
    });
    await workspace.refreshRoster();
    workspace.restoreSessions();
    if (workspace.viewerLoginValue) {
      const email = workspace.userId
        ? `${workspace.userId}+${workspace.viewerLoginValue}@users.noreply.github.com`
        : `${workspace.viewerLoginValue}@users.noreply.github.com`;
      await configureGitIdentity(
        workspace.repoPath,
        workspace.viewerLoginValue,
        email,
      ).catch(() => undefined);
    }
    return workspace;
  }

  /**
   * The GitHub login behind this workspace's credential -- the signed-in
   * user's for a personal workspace, or the shared demo's local
   * GITHUB_TOKEN's for the demo. Lets the client tell its own PRs apart
   * from ones to review even when nobody signed in through the app.
   */
  viewerLogin(): string | undefined {
    return this.viewerLoginValue;
  }

  touch(): void {
    this.lastUsedAt = Date.now();
  }

  spentUsd(): number {
    return this.sessions.list().reduce((total, session) => total + session.costUsd, 0);
  }

  /** What a new order here could spend after settled workspace spend. */
  remainingBudgetUsd(): number {
    return this.remainingBudget();
  }

  /**
   * `.sudocity/world.db` lives inside the checkout, so without this every
   * user's repo reports as dirty and the agent sees the world store as
   * something it could commit. Written to .git/info/exclude rather than
   * .gitignore because that file belongs to the user's repository, not to us.
   */
  private async hideWorldStoreFromGit(): Promise<void> {
    const excludePath = join(this.repoPath, ".git", "info", "exclude");
    try {
      const existing = await readFile(excludePath, "utf8").catch(() => "");
      if (existing.split("\n").includes(WORLD_STORE_DIR)) {
        return;
      }
      await mkdir(dirname(excludePath), { recursive: true });
      await writeFile(
        excludePath,
        `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}${WORLD_STORE_DIR}\n`,
      );
    } catch (error) {
      this.log.warn(
        { error, repoPath: this.repoPath },
        "Could not hide .sudocity from git; this workspace will always look dirty",
      );
    }
  }

  /**
   * Whether evicting this workspace would destroy work. Uncommitted edits only
   * exist in the clone, and eviction deletes the clone.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
        cwd: this.repoPath,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
      });
      return stdout.trim().length > 0;
    } catch (error) {
      // A missing or broken checkout has no work to protect, and treating it
      // as dirty would make it unevictable and wedge the cap.
      this.log.warn(
        { error, repoPath: this.repoPath },
        "Could not read git status; treating the workspace as safe to evict",
      );
      return false;
    }
  }

  hasRunningAgent(): boolean {
    return this.sessions.list().some((session) => session.runner?.isRunning() ?? false);
  }

  city(id: CityId): City | undefined {
    return this.registry.get(id);
  }

  summaries(): CitySummary[] {
    return this.registry.summaries();
  }

  listIssues(): Issue[] {
    return this.registry.listIssues();
  }

  overlayFor(id: CityId): PullRequestOverlay | undefined {
    return this.registry.get(id)?.overlay;
  }

  sanitizeContextPaths(paths: readonly string[] | undefined): string[] {
    const safePaths = new Set<string>();
    for (const rawPath of paths ?? []) {
      const candidate = rawPath.trim().replaceAll("\\", "/");
      if (!candidate || candidate.startsWith("/") || candidate.includes("\0")) {
        continue;
      }
      const absolutePath = resolve(this.repoPath, candidate);
      const repositoryPath = relative(this.repoPath, absolutePath);
      if (
        !repositoryPath ||
        repositoryPath === ".." ||
        repositoryPath.startsWith(`..${sep}`)
      ) {
        continue;
      }
      safePaths.add(sep === "/" ? repositoryPath : repositoryPath.split(sep).join("/"));
      if (safePaths.size >= MAX_CONTEXT_FILES) {
        break;
      }
    }
    return [...safePaths];
  }

  private fallbackWorld(city: CityId, repoPath: string): WorldSnapshot {
    return {
      id: `preview-${city}`,
      repoPath,
      revision: "working-tree",
      generatedAt: new Date().toISOString(),
      size: { width: 8, height: 8 },
      districts: [
        { path: "apps/web", x: 0, y: 0, width: 4, height: 8, weight: 184 },
        { path: "apps/server", x: 4, y: 0, width: 4, height: 4, weight: 96 },
        { path: "packages/protocol", x: 4, y: 4, width: 4, height: 4, weight: 121 },
      ],
      buildings: [
        {
          path: "apps/web/src/App.tsx",
          district: "apps/web",
          language: "TypeScript",
          loc: 184,
          plot: { x: 1, y: 2 },
        },
        {
          path: "apps/server/src/index.ts",
          district: "apps/server",
          language: "TypeScript",
          loc: 96,
          plot: { x: 4, y: 1 },
        },
        {
          path: "packages/protocol/src/index.ts",
          district: "packages/protocol",
          language: "TypeScript",
          loc: 121,
          plot: { x: 5, y: 4 },
        },
      ],
    };
  }

  private async generateWorld(city: CityId, cwd: string): Promise<WorldSnapshot> {
    try {
      const map = await scanRepository(cwd);
      const main = city === "main" ? undefined : this.registry.get("main");
      const layout = layoutWorld(map, {
        width: main?.snapshot.size.width,
        height: main?.snapshot.size.height,
        districts: main?.snapshot.districts,
        previousPlots: main
          ? { ...this.store.loadPlots("main"), ...this.store.loadPlots(city) }
          : this.store.loadPlots(city),
      });
      this.store.savePlots(city, layout.plots);
      this.store.saveSnapshot(city, layout.snapshot);
      return layout.snapshot;
    } catch (error) {
      this.log.error({ error, city, key: this.key }, "Repository scan or layout failed");
      if (this.key === "demo") {
        return this.fallbackWorld(city, cwd);
      }
      throw new Error(
        `Failed to generate city layout: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Stamps a durable or live event with the conversation's own sequence. A
   * city has many sessions now; using a city counter made one transcript's
   * event order depend on unrelated work in the same checkout.
   */
  private createEvent(session: SessionState, event: EventInput): GameEvent {
    const sequence = session.sequence++;
    const completedEvent = {
      ...event,
      id: `${session.sessionId}_evt_${sequence}`,
      cityId: session.cityId,
      sessionId: session.sessionId,
      sequence,
      timestamp: new Date().toISOString(),
    } as GameEvent;
    this.store.appendEvent(completedEvent);
    this.store.saveSession(sessionToRecord(session));
    return completedEvent;
  }

  /**
   * `world.ready` belongs to a city, not a conversation. The protocol envelope
   * still needs a session id, so a stable synthetic id keeps map snapshots out
   * of every real transcript and the client can filter it from the roster.
   */
  createWorldEvent(city: City, snapshot = city.snapshot): GameEvent {
    const sessionId = `world:${city.id}`;
    const sequence = this.worldSequences.get(city.id) ?? 0;
    this.worldSequences.set(city.id, sequence + 1);
    const event = {
      type: "world.ready" as const,
      snapshot,
      id: `${sessionId}_evt_${sequence}`,
      cityId: city.id,
      sessionId,
      sequence,
      timestamp: new Date().toISOString(),
    };
    this.store.appendEvent(event);
    return event;
  }

  private emitSessionEvent(
    session: SessionState,
    event: EventInput,
    notify = true,
  ): GameEvent {
    const completed = this.createEvent(session, event);
    if (notify) {
      session.updatedAt = new Date().toISOString();
      this.store.saveSession(sessionToRecord(session));
      this.onSessionChanged(this.sessionSummary(session));
    }
    this.onEvent(session.cityId, session.sessionId, completed);
    return completed;
  }

  private sessionSummary(session: SessionState): SessionSummary {
    const summary = this.sessions
      .summaries()
      .find((candidate) => candidate.sessionId === session.sessionId);
    if (!summary) {
      throw new Error(`Session ${session.sessionId} is not registered`);
    }
    return summary;
  }

  private emitAgentEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    switch (event.type) {
      case "session.status":
        session.status = event.status;
        if (event.outcome !== undefined) {
          session.lastTurnOutcome = event.outcome;
        }
        if (event.status === "closed") {
          session.closedAt ??= new Date().toISOString();
        }
        break;
      case "turn.completed":
        session.turnCount += 1;
        session.costUsd += event.costUsd;
        session.lastTurnOutcome = event.outcome;
        break;
      case "permit.requested":
        session.pendingPermits.add(event.toolCallId);
        if (
          this.hasWriteAccess === false &&
          event.tool === "Bash" &&
          isPushOrPrCommand(event.input?.command)
        ) {
          this.onError?.({
            code: "WRITE_ACCESS_REQUIRED",
            message:
              "GitHub write access is required to push changes or create pull requests. Ensure your GitHub App has 'Contents: Read and write' permissions and you have collaborator write access.",
            sessionId: session.sessionId,
          });
        }
        break;
      case "permit.resolved":
        session.pendingPermits.delete(event.toolCallId);
        break;
      case "tool.started":
        if (event.tool === "Bash" && typeof event.input?.command === "string") {
          this.setPendingToolCommand(event.toolCallId, event.input.command);
        }
        session.activityLine = `${event.tool}${event.target ? ` · ${event.target}` : ""}`;
        break;
      case "tool.completed": {
        const lastCmd = this.pendingToolCommands.get(event.toolCallId);
        this.pendingToolCommands.delete(event.toolCallId);
        if (
          event.outcome === "error" &&
          (isPushOrPrCommand(lastCmd) || isPushOrPrCommand(event.resultPreview)) &&
          isWriteAccessError(event.resultPreview)
        ) {
          this.onError?.({
            code: "WRITE_ACCESS_REQUIRED",
            message:
              "GitHub write access is required to push changes or create pull requests. Ensure your GitHub App has 'Contents: Read and write' permissions and you have collaborator write access.",
            sessionId: session.sessionId,
          });
        }
        break;
      }
      case "session.message":
        if (event.role === "agent" && event.kind === "text") {
          session.activityLine = event.text.split("\n", 1)[0]?.trim().slice(0, 200);
        }
        break;
      default:
        break;
    }

    const notify = event.type !== "session.delta";
    this.emitSessionEvent(session, event, notify);

    if (event.type === "turn.completed") {
      // SessionRunner emits the following idle status synchronously after this
      // event. Waiting one microtask prevents a queued follow-up from being
      // started before that status transition has landed in the registry.
      queueMicrotask(() => {
        void this.drainQueued(session.sessionId);
      });
    }
  }

  private async drainQueued(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "closed" || session.queued.length === 0) {
      return;
    }
    const queued = session.queued.shift();
    if (!queued) {
      return;
    }
    session.updatedAt = new Date().toISOString();
    this.store.saveSession(sessionToRecord(session));
    this.onSessionChanged(this.sessionSummary(session));
    const runner = this.ensureRunner(session);
    void runner.send(queued.prompt, queued.contextPaths).catch((error: unknown) => {
      this.emitAgentEvent(session.sessionId, {
        type: "session.status",
        status: "failed",
        outcome: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private ensureRunner(session: SessionState): SessionRunner {
    if (session.runner) {
      return session.runner;
    }
    const city = this.registry.get(session.cityId);
    if (!city) {
      throw new Error(`City ${session.cityId} is not available`);
    }
    const runner = new SessionRunner({
      sessionId: session.sessionId,
      cwd: city.cwd,
      emit: (event) => this.emitAgentEvent(session.sessionId, event),
      model: session.model,
      effort: session.effort,
      permissionMode: session.permissionMode,
      disallowedTools: city.disallowedTools,
      systemPromptAppend: city.systemPromptAppend,
      sandbox: this.sandbox,
      resume: session.turnCount > 0,
      title: session.title,
      env: this.githubToken
        ? {
            GH_TOKEN: this.githubToken,
            ...(this.viewerLoginValue
              ? {
                  GIT_AUTHOR_NAME: this.viewerLoginValue,
                  GIT_COMMITTER_NAME: this.viewerLoginValue,
                  GIT_AUTHOR_EMAIL: this.userId
                    ? `${this.userId}+${this.viewerLoginValue}@users.noreply.github.com`
                    : `${this.viewerLoginValue}@users.noreply.github.com`,
                  GIT_COMMITTER_EMAIL: this.userId
                    ? `${this.userId}+${this.viewerLoginValue}@users.noreply.github.com`
                    : `${this.viewerLoginValue}@users.noreply.github.com`,
                }
              : {}),
          }
        : undefined,
      budget: {
        reserve: (sessionId) => this.ledger.reserve(sessionId),
        settle: (sessionId, actualUsd) => this.ledger.settle(sessionId, actualUsd),
      },
      onContextUsage: (percentage) => {
        session.contextPercent = percentage;
        session.updatedAt = new Date().toISOString();
        this.store.saveSession(sessionToRecord(session));
        this.onSessionChanged(this.sessionSummary(session));
      },
    });
    session.runner = runner;
    return runner;
  }

  private restoreSessions(): void {
    for (const record of this.store.loadSessions()) {
      if (this.sessions.get(record.sessionId)) {
        continue;
      }
      const activeStatus = ["starting", "thinking", "working", "awaiting-permit", "compacting"]
        .includes(record.status)
        ? "idle"
        : record.status;
      this.sessions.add({
        sessionId: record.sessionId,
        cityId: record.cityId as CityId,
        readOnly: record.readOnly,
        title: record.title,
        autoTitled: record.autoTitled,
        model: record.model,
        effort: record.effort as EffortLevel,
        permissionMode: record.permissionMode as PermissionMode,
        status: activeStatus as SessionStatus,
        lastTurnOutcome: record.lastTurnOutcome as TurnOutcome | undefined,
        sequence: record.sequence,
        turnCount: record.turnCount,
        costUsd: record.costUsd,
        pendingPermits: new Set(),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        closedAt: record.closedAt,
        queued: [],
      });
    }
  }

  private async computeOverlay(
    cityId: CityId,
    pr: PullRequestRef,
  ): Promise<PullRequestOverlay> {
    const files = await changedFiles(this.repoPath, pr.baseRef, pr.headSha);
    const mainPlots = this.store.loadPlots("main");
    const withPlots: ChangedFile[] = files.map((file) =>
      file.change === "deleted" ? { ...file, plot: mainPlots[file.path] } : file,
    );
    return { cityId, baseRef: pr.baseRef, headSha: pr.headSha, files: withPlots };
  }

  async refreshRoster(): Promise<void> {
    let pullRequests: PullRequestRef[] = [];
    let issues: IssueRef[] = [];
    let localWorktrees: LocalWorktreeRef[] = [];
    try {
      [pullRequests, issues, localWorktrees] = await Promise.all([
        this.githubClient.listOpenPullRequests(this.repoPath, this.githubToken),
        this.githubClient.listOpenIssues(this.repoPath, this.githubToken),
        listLocalWorktrees(this.repoPath),
      ]);
    } catch (error) {
      this.log.warn(
        { error, workspace: this.key },
        "Failed to list GitHub work; only the main city is available",
      );
    }

    const reviewPrCityIds = new Set(
      pullRequests
        .filter((pr) => {
          const m = this.viewerLoginValue?.toLowerCase().replace(/[-_]/g, "");
          const a = pr.author?.toLowerCase().replace(/[-_]/g, "");
          return Boolean(m && a && a !== m);
        })
        .map((pr) => cityIdFor(pr)),
    );

    const mainRepoResolved = resolve(this.repoPath);
    for (const wt of localWorktrees) {
      const wtResolved = resolve(wt.path);
      if (wtResolved === mainRepoResolved) continue;

      const isReviewPrWorktree = Array.from(reviewPrCityIds).some((id) =>
        wtResolved.endsWith(`${sep}${id}`) || wtResolved.endsWith(`/${id}`),
      );
      if (isReviewPrWorktree) continue;

      const existingCityId = wtResolved.slice(wtResolved.lastIndexOf(sep) + 1);
      const isKnownIssue = issues.some((iss) => issueCityIdFor(iss) === existingCityId);
      if (!isKnownIssue) {
        const localIssueNumber =
          (Math.abs(
            wt.branch.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 9000),
          ) %
            9000) +
          1000;
        issues.push({
          number: localIssueNumber,
          title: `Local Worktree: ${wt.branch}`,
          body: `Local git worktree checked out at ${wt.path}`,
          author: this.viewerLoginValue ?? "local",
          url: `file://${wt.path}`,
        });
      }
    }

    const keep = new Set<CityId>([
      ...pullRequests.map((pr) => cityIdFor(pr) as CityId),
      ...issues.map((issue) => issueCityIdFor(issue) as CityId),
    ]);
    this.registry.setPullRequests(pullRequests);
    this.registry.setIssues(issues);

    for (const city of this.registry.list()) {
      if (city.id !== "main" && !keep.has(city.id)) {
        for (const session of this.sessions.list(city.id)) {
          await this.closeSession(session.sessionId);
        }
        this.registry.remove(city.id);
      }
    }

    await pruneWorktrees(this.repoPath, keep).catch((error: unknown) => {
      this.log.warn({ error, workspace: this.key }, "Failed to prune stale PR worktrees");
    });

    this.onCitiesChanged();
    this.onIssuesChanged();
  }

  private async buildPrCity(cityId: CityId, pr: PullRequestRef): Promise<City> {
    const worktree = await ensureWorktree(this.repoPath, pr, this.githubToken);
    const snapshot = await this.generateWorld(cityId, worktree);
    const overlay = await this.computeOverlay(cityId, pr).catch((error: unknown) => {
      this.log.warn(
        { error, cityId, workspace: this.key },
        "Failed to compute the PR diff overlay; markers will be unavailable",
      );
      return undefined;
    });
    return {
      id: cityId,
      cwd: worktree,
      readOnly: true,
      disallowedTools: REVIEW_DISALLOWED_TOOLS,
      systemPromptAppend: reviewSystemPrompt(pr, overlay),
      snapshot,
      overlay,
    };
  }

  private async buildIssueCity(cityId: CityId, issue: IssueRef): Promise<City> {
    const worktree = await ensureMainWorktree(this.repoPath, cityId);
    const snapshot = await this.generateWorld(cityId, worktree);
    return {
      id: cityId,
      cwd: worktree,
      readOnly: false,
      systemPromptAppend: this.buildSystemPromptAppend(
        [
          `You are fixing GitHub issue #${issue.number}, "${issue.title}".`,
          "This city is a writable detached worktree based on main. Implement and verify the fix here; do not change the primary checkout.",
          issue.body ? `Issue details:\n${issue.body}` : "No issue description was provided.",
        ].join("\n\n"),
      ),
      snapshot,
    };
  }

  async ensureCity(cityId: CityId): Promise<City | undefined> {
    const existing = this.registry.get(cityId);
    if (existing) {
      return existing;
    }
    const pr = this.registry.pullRequestFor(cityId);
    const issue = this.registry.issueFor(cityId);
    if (!pr && !issue) {
      return undefined;
    }

    const building = this.registry.ensureBuild(cityId, () =>
      pr ? this.buildPrCity(cityId, pr) : this.buildIssueCity(cityId, issue!),
    );
    this.onCitiesChanged();
    try {
      const city = await building;
      this.onCitiesChanged();
      return city;
    } catch (error) {
      this.log.error({ error, cityId, workspace: this.key }, "Failed to build PR city");
      this.onCitiesChanged();
      return undefined;
    }
  }

  async rescanWorld(cityId: CityId): Promise<GameEvent | undefined> {
    const city = this.registry.get(cityId);
    if (!city) {
      return undefined;
    }
    city.pendingScan ??= this.generateWorld(city.id, city.cwd).finally(() => {
      city.pendingScan = undefined;
    });
    city.snapshot = await city.pendingScan;
    const event = this.createWorldEvent(city, city.snapshot);
    this.onEvent(city.id, event.sessionId, event);
    return event;
  }

  sessionSummaries(cityId?: CityId): SessionSummary[] {
    return this.sessions.summaries(cityId);
  }

  async openSession(
    cityId: CityId,
    options: {
      prompt: string;
      title?: string;
      model?: string;
      effort?: EffortLevel;
      permissionMode?: PermissionMode;
      contextPaths?: readonly string[];
    },
  ): Promise<{ session: SessionSummary } | { error: SessionError }> {
    const city = await this.ensureCity(cityId);
    if (!city) {
      return { error: { code: "CITY_NOT_FOUND" } };
    }
    if (this.sessions.countForCity(cityId) >= MAX_SESSIONS_PER_CITY) {
      return { error: { code: "TOO_MANY_SESSIONS", message: "This city has reached its session limit." } };
    }
    if (this.sessions.runningCount() >= MAX_RUNNING_SESSIONS_PER_WORKSPACE) {
      return { error: { code: "TOO_MANY_RUNNING_SESSIONS", message: "Too many crews are running at once." } };
    }
    if (!this.ledger.canFund()) {
      return { error: { code: "BUDGET_EXHAUSTED", message: "The city treasury cannot fund another order." } };
    }

    const contextPaths = this.sanitizeContextPaths(options.contextPaths);
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const session: SessionState = {
      sessionId,
      cityId,
      readOnly: city.readOnly,
      title: options.title ?? autoTitle(options.prompt),
      autoTitled: options.title === undefined,
      model: options.model ?? "sonnet",
      effort: options.effort ?? "high",
      permissionMode: options.permissionMode ?? "default",
      status: "starting",
      sequence: 0,
      turnCount: 0,
      costUsd: 0,
      pendingPermits: new Set(),
      createdAt: now,
      updatedAt: now,
      queued: [],
    };
    this.sessions.add(session);
    this.store.saveSession(sessionToRecord(session));
    this.emitSessionEvent(session, {
      type: "session.created",
      cityIdOfSession: cityId,
      title: session.title,
      model: session.model,
      effort: session.effort,
      permissionMode: session.permissionMode,
      readOnly: session.readOnly,
    });
    this.emitSessionEvent(session, {
      type: "session.message",
      messageId: `${sessionId}:mayor:0`,
      role: "mayor",
      kind: "text",
      text: options.prompt,
      contextPaths,
    });

    // If the repository is known to be read-only and the prompt requests push / PR operations,
    // broadcast an early WRITE_ACCESS_REQUIRED advisory warning to display the banner in the UI.
    // We allow the runner to proceed with local work, guided by system prompt instructions.
    if (this.hasWriteAccess === false && isPushOrPrCommand(options.prompt)) {
      this.onError?.({
        code: "WRITE_ACCESS_REQUIRED",
        message:
          "GitHub write access is required to push changes or create pull requests. Ensure your GitHub App has 'Contents: Read and write' permissions and you have collaborator write access.",
        sessionId,
      });
    }

    const runner = this.ensureRunner(session);
    void runner.send(options.prompt, contextPaths).catch((error: unknown) => {
      this.emitAgentEvent(sessionId, {
        type: "session.status",
        status: "failed",
        outcome: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    return { session: this.sessionSummary(session) };
  }

  async sendToSession(
    sessionId: string,
    prompt: string,
    contextPaths?: readonly string[],
  ): Promise<{ ok: true } | { error: SessionError }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { error: { code: "SESSION_NOT_FOUND" } };
    }
    if (session.status === "closed") {
      return { error: { code: "SESSION_CLOSED" } };
    }
    if (!this.ledger.canFund()) {
      return { error: { code: "BUDGET_EXHAUSTED", message: "The city treasury cannot fund another order." } };
    }
    const city = await this.ensureCity(session.cityId);
    if (!city) {
      return { error: { code: "CITY_NOT_FOUND" } };
    }
    const safeContextPaths = this.sanitizeContextPaths(contextPaths);
    // If the repository is known to be read-only and the prompt requests push / PR operations,
    // broadcast an early WRITE_ACCESS_REQUIRED advisory warning to display the banner in the UI.
    // We allow the runner to proceed with local work, guided by system prompt instructions.
    if (this.hasWriteAccess === false && isPushOrPrCommand(prompt)) {
      this.onError?.({
        code: "WRITE_ACCESS_REQUIRED",
        message:
          "GitHub write access is required to push changes or create pull requests. Ensure your GitHub App has 'Contents: Read and write' permissions and you have collaborator write access.",
        sessionId,
      });
    }
    const running = ["starting", "thinking", "working", "awaiting-permit", "compacting"].includes(session.status)
      || (session.runner?.isRunning() ?? false);
    if (running) {
      session.queued.push({ prompt, contextPaths: safeContextPaths });
      session.updatedAt = new Date().toISOString();
      this.store.saveSession(sessionToRecord(session));
      this.emitSessionEvent(session, {
        type: "session.message",
        messageId: `${sessionId}:mayor:${session.sequence}`,
        role: "mayor",
        kind: "text",
        text: prompt,
        contextPaths: safeContextPaths,
      });
      return { ok: true };
    }

    const runner = this.ensureRunner(session);
    this.emitSessionEvent(session, {
      type: "session.message",
      messageId: `${sessionId}:mayor:${session.sequence}`,
      role: "mayor",
      kind: "text",
      text: prompt,
      contextPaths: safeContextPaths,
    });
    void runner.send(prompt, safeContextPaths).catch((error: unknown) => {
      this.emitAgentEvent(sessionId, {
        type: "session.status",
        status: "failed",
        outcome: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    return { ok: true };
  }

  async interruptSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "closed") {
      return false;
    }
    const dropped = session.queued.length;
    session.queued = [];
    if (dropped > 0) {
      this.emitSessionEvent(session, {
        type: "session.message",
        messageId: `${sessionId}:notice:${session.sequence}`,
        role: "system",
        kind: "notice",
        text: `${dropped} queued order${dropped === 1 ? "" : "s"} discarded by the mayor.`,
        contextPaths: [],
      });
    }
    if (session.runner) {
      await session.runner.interrupt();
    } else {
      this.emitAgentEvent(sessionId, {
        type: "session.status",
        status: "interrupted",
        outcome: "interrupted",
      });
    }
    return true;
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.title = title;
    session.autoTitled = false;
    this.emitSessionEvent(session, { type: "session.renamed", title });
    return true;
  }

  async configureSession(
    sessionId: string,
    changes: { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode },
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "closed") {
      return false;
    }
    if (changes.model !== undefined) {
      session.model = changes.model;
      await session.runner?.setModel(changes.model);
    }
    if (changes.effort !== undefined) {
      session.effort = changes.effort;
      session.runner?.setEffort(changes.effort);
    }
    if (changes.permissionMode !== undefined) {
      session.permissionMode = changes.permissionMode;
      await session.runner?.setPermissionMode(changes.permissionMode);
    }
    this.emitSessionEvent(session, {
      type: "session.configured",
      model: changes.model,
      effort: changes.effort,
      permissionMode: changes.permissionMode,
    });
    return true;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.queued = [];
    if (session.runner) {
      await session.runner.dispose();
      session.runner = undefined;
    }
    if (session.status !== "closed") {
      session.closedAt = new Date().toISOString();
      this.emitAgentEvent(sessionId, {
        type: "session.status",
        status: "closed",
      });
    }
    return true;
  }

  async unarchiveSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "closed") {
      return false;
    }
    session.closedAt = undefined;
    session.queued = [];
    this.emitAgentEvent(sessionId, {
      type: "session.status",
      status: "idle",
    });
    return true;
  }

  resolvePermit(
    sessionId: string,
    toolCallId: string,
    decision: "allow" | "allow-always" | "deny",
  ): boolean {
    return this.sessions.get(sessionId)?.runner?.resolvePermit(toolCallId, decision) ?? false;
  }

  transcript(
    sessionId: string,
    afterSequence?: number,
  ): { events: GameEvent[]; fromSequence: number; hasMore: boolean } | undefined {
    if (!this.sessions.get(sessionId)) {
      return undefined;
    }
    const page = this.store.readEventPage(sessionId, { afterSequence });
    return {
      events: page.events,
      fromSequence: page.events[0]?.sequence ?? afterSequence ?? 0,
      hasMore: page.hasMore,
    };
  }

  async diff(cityId: CityId, path: string): Promise<string> {
    const pr = this.registry.pullRequestFor(cityId);
    if (!pr) {
      throw new Error("This city has no pull request to diff against.");
    }
    return fileDiff(this.repoPath, pr.baseRef, pr.headSha, path);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      this.sessions.list().map((session) => session.runner?.dispose()),
    );
    this.store.close();
  }
}

export type { City };
