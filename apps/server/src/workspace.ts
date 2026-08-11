import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { join } from "node:path";
import {
  AgentSessionManager,
  type AgentEvent,
} from "@sudo-city/agent";
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
import type {
  ChangedFile,
  CityId,
  CitySummary,
  EffortLevel,
  GameEvent,
  Issue,
  PermissionMode,
  PullRequestOverlay,
  WorldSnapshot,
} from "@sudo-city/protocol";
import { SQLiteWorldStore } from "@sudo-city/world";
import { scanRepository } from "@sudo-city/worldgen";
import type { FastifyBaseLogger } from "fastify";

const MAX_CONTEXT_FILES = 20;

type EventInput<Event extends GameEvent = GameEvent> = Event extends GameEvent
  ? Omit<Event, "id" | "cityId" | "sessionId" | "sequence" | "timestamp">
  : never;

/** One city's worth of process state, identical in shape to the pre-multi-tenant single-repo server -- only its owning Workspace changed. */
interface City {
  readonly id: CityId;
  readonly cwd: string;
  readonly agent: AgentSessionManager;
  readonly sessionId: string;
  sequence: number;
  snapshot: WorldSnapshot;
  overlay?: PullRequestOverlay;
  spentUsd: number;
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

  async disposeAll(): Promise<void> {
    await Promise.all(this.list().map((city) => city.agent.interrupt()));
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

export interface WorkspaceOptions {
  /** "demo", or `${userId}:${repoKeyFor(fullName)}` -- unique across the whole process, opaque to callers otherwise. */
  key: string;
  repoPath: string;
  /** The signed-in user's installation token; absent for the shared demo workspace, which falls back to GitHubApiClient's own GITHUB_TOKEN env var. */
  githubToken?: string;
  log: FastifyBaseLogger;
  /** Rationed from a ledger the WorkspaceManager sums across every open workspace, not just this one -- see index.ts. */
  remainingBudget: () => number;
  onEvent: (cityId: CityId, event: GameEvent) => void;
  onCitiesChanged: () => void;
  onIssuesChanged: () => void;
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
  private readonly githubToken: string | undefined;
  private viewerLoginValue: string | undefined;
  private readonly remainingBudget: () => number;
  private readonly onEvent: WorkspaceOptions["onEvent"];
  private readonly onCitiesChanged: WorkspaceOptions["onCitiesChanged"];
  private readonly onIssuesChanged: WorkspaceOptions["onIssuesChanged"];
  /** Bumped on every access; the WorkspaceManager's LRU reads this to find an eviction candidate. */
  lastUsedAt = Date.now();

  private constructor(options: WorkspaceOptions) {
    this.key = options.key;
    this.repoPath = resolve(options.repoPath);
    this.log = options.log;
    this.githubToken = options.githubToken;
    this.remainingBudget = options.remainingBudget;
    this.onEvent = options.onEvent;
    this.onCitiesChanged = options.onCitiesChanged;
    this.onIssuesChanged = options.onIssuesChanged;
    this.store = new SQLiteWorldStore(join(this.repoPath, ".sudocity", "world.db"));
    this.githubClient = new GitHubApiClient();
  }

  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const workspace = new Workspace(options);
    const snapshot = await workspace.generateWorld("main", workspace.repoPath);
    workspace.registry.add({
      id: "main",
      cwd: workspace.repoPath,
      agent: new AgentSessionManager({
        cwd: workspace.repoPath,
        emit: (event) => workspace.emitAgentEvent("main", event),
        maxBudgetUsd: workspace.remainingBudget(),
      }),
      sessionId: `local-${randomUUID()}`,
      sequence: 0,
      snapshot,
      spentUsd: 0,
    });
    await workspace.refreshRoster();
    workspace.viewerLoginValue = await workspace.githubClient
      .viewerLogin(workspace.githubToken)
      .catch(() => undefined);
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
    return this.registry.list().reduce((total, city) => total + city.spentUsd, 0);
  }

  hasRunningAgent(): boolean {
    return this.registry.list().some((city) => city.agent.isRunning());
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
      this.log.warn({ error, city }, "Repository scan failed; using preview world");
      return this.fallbackWorld(city, cwd);
    }
  }

  createEvent(city: City, event: EventInput): GameEvent {
    const currentSequence = city.sequence++;
    const completedEvent = {
      ...event,
      id: `${city.id}_evt_${currentSequence}`,
      cityId: city.id,
      sessionId: city.sessionId,
      sequence: currentSequence,
      timestamp: new Date().toISOString(),
    } as GameEvent;
    this.store.appendEvent(completedEvent);
    return completedEvent;
  }

  private emitAgentEvent(cityId: CityId, event: AgentEvent): void {
    const city = this.registry.get(cityId);
    if (!city) {
      return;
    }
    if (event.type === "session.usage") {
      city.spentUsd = event.costUsd;
    }
    this.onEvent(cityId, this.createEvent(city, event));
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
        await city.agent.interrupt();
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
    const worktree = await ensureWorktree(this.repoPath, pr);
    const snapshot = await this.generateWorld(cityId, worktree);
    const overlay = await this.computeOverlay(cityId, pr).catch((error: unknown) => {
      this.log.warn(
        { error, cityId, workspace: this.key },
        "Failed to compute the PR diff overlay; markers will be unavailable",
      );
      return undefined;
    });
    const agent = new AgentSessionManager({
      cwd: worktree,
      emit: (event) => this.emitAgentEvent(cityId, event),
      maxBudgetUsd: this.remainingBudget(),
      disallowedTools: REVIEW_DISALLOWED_TOOLS,
      systemPromptAppend: reviewSystemPrompt(pr, overlay),
    });
    return {
      id: cityId,
      cwd: worktree,
      agent,
      sessionId: `local-${randomUUID()}`,
      sequence: 0,
      snapshot,
      overlay,
      spentUsd: 0,
    };
  }

  private async buildIssueCity(cityId: CityId, issue: IssueRef): Promise<City> {
    const worktree = await ensureMainWorktree(this.repoPath, cityId);
    const snapshot = await this.generateWorld(cityId, worktree);
    const agent = new AgentSessionManager({
      cwd: worktree,
      emit: (event) => this.emitAgentEvent(cityId, event),
      maxBudgetUsd: this.remainingBudget(),
      systemPromptAppend: [
        `You are fixing GitHub issue #${issue.number}, "${issue.title}".`,
        "This city is a writable detached worktree based on main. Implement and verify the fix here; do not change the primary checkout.",
        issue.body ? `Issue details:\n${issue.body}` : "No issue description was provided.",
      ].join("\n\n"),
    });
    return {
      id: cityId,
      cwd: worktree,
      agent,
      sessionId: `local-${randomUUID()}`,
      sequence: 0,
      snapshot,
      spentUsd: 0,
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
    const event = this.createEvent(city, { type: "world.ready", snapshot: city.snapshot });
    this.onEvent(city.id, event);
    return event;
  }

  prompt(
    cityId: CityId,
    prompt: string,
    options: {
      permissionMode?: PermissionMode;
      contextPaths?: readonly string[];
      model?: string;
      effort?: EffortLevel;
    },
  ): { city: City } | undefined {
    const city = this.registry.get(cityId);
    if (!city) {
      return undefined;
    }
    const contextPaths = this.sanitizeContextPaths(options.contextPaths);
    this.onEvent(
      city.id,
      this.createEvent(city, {
        type: "session.message",
        role: "mayor",
        text: mayorMessage(prompt, contextPaths),
      }),
    );
    city.agent.setMaxBudgetUsd(this.remainingBudget());
    void city.agent
      .start(prompt, options.permissionMode ?? "default", {
        model: options.model,
        effort: options.effort,
        contextPaths,
      })
      .catch((error: unknown) => {
        this.emitAgentEvent(city.id, {
          type: "session.message",
          role: "system",
          text:
            error instanceof Error
              ? `Agent stopped: ${error.message}`
              : "Agent stopped unexpectedly.",
        });
      });
    return { city };
  }

  interrupt(cityId: CityId): boolean {
    const city = this.registry.get(cityId);
    if (!city) {
      return false;
    }
    void city.agent.interrupt();
    this.onEvent(
      city.id,
      this.createEvent(city, {
        type: "session.message",
        role: "system",
        text: "Construction paused by the mayor.",
      }),
    );
    return true;
  }

  resolvePermit(toolCallId: string, decision: "allow" | "deny"): boolean {
    return this.registry
      .list()
      .some((city) => city.agent.resolvePermit(toolCallId, decision));
  }

  async diff(cityId: CityId, path: string): Promise<string> {
    const pr = this.registry.pullRequestFor(cityId);
    if (!pr) {
      throw new Error("This city has no pull request to diff against.");
    }
    return fileDiff(this.repoPath, pr.baseRef, pr.headSha, path);
  }

  async dispose(): Promise<void> {
    await this.registry.disposeAll();
    this.store.close();
  }
}

export type { City };
