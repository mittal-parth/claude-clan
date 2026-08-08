import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { join, relative, resolve, sep } from "node:path";
import {
  AgentSessionManager,
  type AgentEvent,
} from "@sudo-city/agent";
import {
  GhCliClient,
  changedFiles,
  cityIdFor,
  ensureWorktree,
  fileDiff,
  pruneWorktrees,
  type GitHubClient,
  type PullRequestRef,
} from "@sudo-city/cities";
import websocket from "@fastify/websocket";
import { layoutWorld } from "@sudo-city/layout";
import {
  MayorCommandSchema,
  type ChangedFile,
  type CityId,
  type CitySummary,
  type GameEvent,
  type PullRequestOverlay,
  type ServerMessage,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { SQLiteWorldStore } from "@sudo-city/world";
import { scanRepository } from "@sudo-city/worldgen";
import Fastify from "fastify";
import { WebSocket, type RawData } from "ws";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4100);
const app = Fastify({ logger: true });

await app.register(websocket);

const targetRepo =
  process.env.SUDO_CITY_REPO ?? process.env.INIT_CWD ?? process.cwd();
const repositoryRoot = resolve(targetRepo);
const MAX_CONTEXT_FILES = 20;

function sanitizeContextPaths(paths: readonly string[] | undefined): string[] {
  const safePaths = new Set<string>();

  for (const rawPath of paths ?? []) {
    const candidate = rawPath.trim().replaceAll("\\", "/");
    if (!candidate || candidate.startsWith("/") || candidate.includes("\0")) {
      continue;
    }

    const absolutePath = resolve(repositoryRoot, candidate);
    const repositoryPath = relative(repositoryRoot, absolutePath);
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

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    loadEnvFile(join(targetRepo, ".env"));
  } catch {
    // Existing Claude Code credentials remain the local-development fallback.
  }
}
const store = new SQLiteWorldStore(
  join(targetRepo, ".sudocity", "world.db"),
);

type EventInput<Event extends GameEvent = GameEvent> = Event extends GameEvent
  ? Omit<Event, "id" | "cityId" | "sessionId" | "sequence" | "timestamp">
  : never;

/**
 * One city's worth of process state. Each city has its own event sequence,
 * session id, in-flight scan guard, and agent -- none of these can be shared
 * across cities without one city stomping another's snapshot or sequence.
 */
interface City {
  readonly id: CityId;
  readonly cwd: string;
  readonly agent: AgentSessionManager;
  readonly sessionId: string;
  sequence: number;
  snapshot: WorldSnapshot;
  /** A PR city's diff against main; absent for "main" itself. */
  overlay?: PullRequestOverlay;
  /** This city's own share of the global budget spent so far -- session.usage's costUsd is cumulative per session, so this is a replace, not an add. */
  spentUsd: number;
  /** Guards against a burst of file.changed events queueing parallel scans. */
  pendingScan?: Promise<WorldSnapshot>;
}

class CityRegistry {
  private readonly cities = new Map<CityId, City>();
  /** Every open PR known from the last gh pr list, whether or not it's been travelled to yet. */
  private readonly pullRequests = new Map<CityId, PullRequestRef>();
  /** In-flight ensureCity builds, so summaries() can report "building" and a second travel command reuses the same build. */
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

  knownPullRequestIds(): CityId[] {
    return [...this.pullRequests.keys()];
  }

  isBuilding(id: CityId): boolean {
    return this.pendingBuilds.has(id);
  }

  /** Builds a PR city at most once concurrently; a second travel while one is in flight reuses the same promise. */
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
    return entries;
  }

  async disposeAll(): Promise<void> {
    await Promise.all(this.list().map((city) => city.agent.interrupt()));
  }
}

const registry = new CityRegistry();

function fallbackWorld(city: CityId, repoPath: string): WorldSnapshot {
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

/**
 * A PR city must render the same island as main -- buildTerrain derives
 * every street from district geometry, and squarify reweights every
 * rectangle from LOC, so recomputing districts for a PR would silently
 * reshuffle the city even though only a few files changed. Pinning to
 * main's own size/districts, and seeding plots from main's (with the PR
 * city's own already-persisted plots winning if it's been scanned before),
 * keeps a PR city spatially comparable to main: only the occupied plots
 * differ.
 */
async function generateWorld(city: CityId, cwd: string): Promise<WorldSnapshot> {
  try {
    const map = await scanRepository(cwd);
    const main = city === "main" ? undefined : registry.get("main");
    const layout = layoutWorld(map, {
      width: main?.snapshot.size.width,
      height: main?.snapshot.size.height,
      districts: main?.snapshot.districts,
      previousPlots: main
        ? { ...store.loadPlots("main"), ...store.loadPlots(city) }
        : store.loadPlots(city),
    });
    store.savePlots(city, layout.plots);
    store.saveSnapshot(city, layout.snapshot);
    return layout.snapshot;
  } catch (error) {
    app.log.warn({ error, city }, "Repository scan failed; using preview world");
    return fallbackWorld(city, cwd);
  }
}

function createEvent(city: City, event: EventInput): GameEvent {
  const currentSequence = city.sequence++;
  const completedEvent = {
    ...event,
    id: `${city.id}_evt_${currentSequence}`,
    cityId: city.id,
    sessionId: city.sessionId,
    sequence: currentSequence,
    timestamp: new Date().toISOString(),
  } as GameEvent;
  store.appendEvent(completedEvent);
  return completedEvent;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

/** Which city each connected socket is currently viewing. */
const clients = new Map<WebSocket, { cityId: CityId }>();

function broadcastEvent(cityId: CityId, event: GameEvent): void {
  const message = JSON.stringify({ kind: "event", event } satisfies ServerMessage);
  for (const [client, subscription] of clients) {
    if (subscription.cityId === cityId && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastCities(): void {
  const message = JSON.stringify({
    kind: "cities",
    cities: registry.summaries(),
  } satisfies ServerMessage);
  for (const client of clients.keys()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function emitAgentEvent(cityId: CityId, event: AgentEvent): void {
  const city = registry.get(cityId);
  if (!city) {
    return;
  }
  if (event.type === "session.usage") {
    // total_cost_usd from the SDK is cumulative for that session, not a
    // per-turn delta -- replacing rather than summing is what keeps N
    // cities' concurrent spend from being double-counted.
    city.spentUsd = event.costUsd;
  }
  broadcastEvent(cityId, createEvent(city, event));
}

/**
 * One budget shared across every city's agent, not one per agent -- N
 * concurrent PR review sessions must not silently multiply the ceiling by N.
 * Each city's manager is rationed the remaining balance right before it
 * starts a query (see setMaxBudgetUsd below), so an already-expensive main
 * session leaves less for a PR city that travels in afterward, and vice versa.
 */
const GLOBAL_MAX_BUDGET_USD = Number(process.env.SUDO_CITY_MAX_BUDGET_USD ?? 1);

function remainingBudget(): number {
  const spent = registry
    .list()
    .reduce((total, city) => total + city.spentUsd, 0);
  return Math.max(0, GLOBAL_MAX_BUDGET_USD - spent);
}

const mainSessionId = `local-${randomUUID()}`;
const mainAgent = new AgentSessionManager({
  cwd: targetRepo,
  emit: (event) => emitAgentEvent("main", event),
  maxBudgetUsd: remainingBudget(),
});

registry.add({
  id: "main",
  cwd: targetRepo,
  agent: mainAgent,
  sessionId: mainSessionId,
  sequence: 0,
  snapshot: await generateWorld("main", targetRepo),
  spentUsd: 0,
});

function sendWorld(socket: WebSocket, city: City): void {
  send(socket, {
    kind: "event",
    event: createEvent(city, { type: "world.ready", snapshot: city.snapshot }),
  });
}

function sendOverlay(socket: WebSocket, city: City): void {
  if (city.overlay) {
    send(socket, { kind: "overlay", overlay: city.overlay });
  }
}

/**
 * The changed-file set for a PR against its base, computed in the main
 * checkout (not the worktree). Deleted files carry main's own plot, since
 * they no longer exist in the PR worktree for the renderer to place them by.
 */
async function computeOverlay(
  cityId: CityId,
  pr: PullRequestRef,
): Promise<PullRequestOverlay> {
  const files = await changedFiles(targetRepo, pr.baseRef, pr.headSha);
  const mainPlots = store.loadPlots("main");
  const withPlots: ChangedFile[] = files.map((file) =>
    file.change === "deleted"
      ? { ...file, plot: mainPlots[file.path] }
      : file,
  );
  return {
    cityId,
    baseRef: pr.baseRef,
    headSha: pr.headSha,
    files: withPlots,
  };
}

const githubClient: GitHubClient = new GhCliClient();

/**
 * gh's absence, an unauthenticated session, or no configured remote must
 * never fail the boot -- they degrade to a roster with only "main", the
 * same fallback posture the repository scan itself already has.
 */
async function refreshRoster(): Promise<void> {
  let pullRequests: PullRequestRef[] = [];
  try {
    pullRequests = await githubClient.listOpenPullRequests(targetRepo);
  } catch (error) {
    app.log.warn(
      { error },
      "Failed to list open pull requests; only the main city is available",
    );
  }

  const keep = new Set(pullRequests.map((pr) => cityIdFor(pr) as CityId));
  registry.setPullRequests(pullRequests);

  for (const city of registry.list()) {
    if (city.id !== "main" && !keep.has(city.id)) {
      await city.agent.interrupt();
      registry.remove(city.id);
    }
  }

  await pruneWorktrees(targetRepo, keep).catch((error: unknown) => {
    app.log.warn({ error }, "Failed to prune stale PR worktrees");
  });

  broadcastCities();
}

/**
 * Builds a PR city's worktree, scan, and agent. Called lazily on first
 * travel, never eagerly for every open PR -- startup cost stays flat
 * regardless of how many PRs are open.
 */
/**
 * Read-only Write/Edit/NotebookEdit are removed from the model's context
 * entirely (disallowedTools), not merely gated behind a permit -- a PR city
 * is for reviewing, not fixing in place. Publishing a review still goes
 * through Bash, which isn't a safe tool, so `gh pr review` naturally hits
 * the normal permit prompt and needs an explicit mayor stamp before it runs.
 */
const REVIEW_DISALLOWED_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

function reviewSystemPrompt(
  pr: PullRequestRef,
  overlay: PullRequestOverlay | undefined,
): string {
  const files = overlay?.files.length
    ? overlay.files
        .map((file) => `- ${file.change}: ${file.path}`)
        .join("\n")
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

async function buildPrCity(cityId: CityId, pr: PullRequestRef): Promise<City> {
  const worktree = await ensureWorktree(targetRepo, pr);
  const snapshot = await generateWorld(cityId, worktree);
  const overlay = await computeOverlay(cityId, pr).catch((error: unknown) => {
    app.log.warn(
      { error, cityId },
      "Failed to compute the PR diff overlay; markers will be unavailable",
    );
    return undefined;
  });
  const agent = new AgentSessionManager({
    cwd: worktree,
    emit: (event) => emitAgentEvent(cityId, event),
    maxBudgetUsd: remainingBudget(),
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

/**
 * Returns an existing city, or builds one lazily if its PR is known but not
 * yet materialised. Broadcasts the roster around the build so clients see
 * the "building" status flip to "ready" (or back to "idle" on failure).
 */
async function ensureCity(cityId: CityId): Promise<City | undefined> {
  const existing = registry.get(cityId);
  if (existing) {
    return existing;
  }
  const pr = registry.pullRequestFor(cityId);
  if (!pr) {
    return undefined;
  }

  const building = registry.ensureBuild(cityId, () => buildPrCity(cityId, pr));
  broadcastCities();
  try {
    const city = await building;
    broadcastCities();
    return city;
  } catch (error) {
    app.log.error({ error, cityId }, "Failed to build PR city");
    broadcastCities();
    return undefined;
  }
}

await refreshRoster();

/**
 * Rescans a city's repository and broadcasts the result to that city's
 * viewers only. Plots are persisted, so a file that already exists keeps
 * its city block and the client's diff leaves the standing building alone.
 */
async function rescanWorld(city: City): Promise<void> {
  city.pendingScan ??= generateWorld(city.id, city.cwd).finally(() => {
    city.pendingScan = undefined;
  });
  city.snapshot = await city.pendingScan;
  broadcastEvent(
    city.id,
    createEvent(city, { type: "world.ready", snapshot: city.snapshot }),
  );
}

app.get("/health", async () => ({ ok: true, service: "sudo-city" }));
app.addHook("onClose", async () => {
  await registry.disposeAll();
  store.close();
});

app.get("/ws", { websocket: true }, (socket) => {
  const mainCity = registry.get("main");
  if (!mainCity) {
    socket.close();
    return;
  }

  clients.set(socket, { cityId: "main" });
  send(socket, { kind: "cities", cities: registry.summaries() });
  sendWorld(socket, mainCity);
  socket.once("close", () => clients.delete(socket));

  socket.on("message", (payload: RawData) => {
    let command: unknown;
    try {
      command = JSON.parse(payload.toString()) as unknown;
    } catch {
      send(socket, {
        kind: "error",
        code: "INVALID_JSON",
        message: "Command must be valid JSON",
      });
      return;
    }

    const decoded = MayorCommandSchema.safeParse(command);

    if (!decoded.success) {
      send(socket, {
        kind: "error",
        code: "INVALID_COMMAND",
        message: decoded.error.issues[0]?.message ?? "Invalid command",
      });
      return;
    }

    // Aliased to a local const so discriminated-union narrowing survives
    // inside the .some() callback below -- narrowing a property access like
    // decoded.data does not reliably propagate into a nested closure.
    const data = decoded.data;

    function requireCity(cityId: CityId): City | undefined {
      const city = registry.get(cityId);
      if (!city) {
        send(socket, {
          kind: "error",
          code: "CITY_NOT_FOUND",
          message: `No city "${cityId}" is available.`,
        });
      }
      return city;
    }

    switch (data.type) {
      case "world.request": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        void rescanWorld(city).catch((error: unknown) => {
          app.log.error({ error }, "World rescan failed");
          send(socket, {
            kind: "error",
            code: "WORLD_SCAN_FAILED",
            message:
              error instanceof Error ? error.message : "Repository scan failed",
          });
        });
        break;
      }
      case "session.prompt": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        const contextPaths = sanitizeContextPaths(data.contextPaths);
        broadcastEvent(
          city.id,
          createEvent(city, {
            type: "session.message",
            role: "mayor",
            text: mayorMessage(data.prompt, contextPaths),
          }),
        );
        // Rationed from the shared ledger right before the query starts, so
        // whatever another city has already spent narrows this session's cap.
        city.agent.setMaxBudgetUsd(remainingBudget());
        void city.agent
          .start(data.prompt, data.permissionMode ?? "default", {
            model: data.model,
            effort: data.effort,
            contextPaths,
          })
          .catch((error: unknown) => {
            emitAgentEvent(city.id, {
              type: "session.message",
              role: "system",
              text:
                error instanceof Error
                  ? `Agent stopped: ${error.message}`
                  : "Agent stopped unexpectedly.",
            });
          });
        break;
      }
      case "session.interrupt": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        void city.agent.interrupt();
        broadcastEvent(
          city.id,
          createEvent(city, {
            type: "session.message",
            role: "system",
            text: "Construction paused by the mayor.",
          }),
        );
        break;
      }
      case "permit.resolve": {
        // A permit's toolCallId is SDK-generated and globally unique, so
        // fanning out across every city's agent is safe: at most one will
        // recognise it, and resolvePermit returns false on a miss. This also
        // avoids trusting a client-supplied cityId for an authorization
        // decision.
        const resolved = registry
          .list()
          .some((city) =>
            city.agent.resolvePermit(data.toolCallId, data.decision),
          );
        if (!resolved) {
          send(socket, {
            kind: "error",
            code: "PERMIT_NOT_FOUND",
            message: "This permit is no longer pending.",
            toolCallId: data.toolCallId,
          });
        }
        break;
      }
      case "city.travel": {
        const cityId = data.cityId;
        // A PR city may not exist yet -- ensureCity builds it lazily on
        // first travel and broadcasts "building" -> "ready"/failed status
        // around the wait, which is why this can't reuse requireCity's
        // synchronous lookup.
        void ensureCity(cityId)
          .then((city) => {
            if (!city) {
              send(socket, {
                kind: "error",
                code: "CITY_NOT_FOUND",
                message: `No city "${cityId}" is available.`,
              });
              return;
            }
            clients.set(socket, { cityId: city.id });
            sendWorld(socket, city);
            sendOverlay(socket, city);
          })
          .catch((error: unknown) => {
            app.log.error({ error, cityId }, "Failed to travel to city");
            send(socket, {
              kind: "error",
              code: "CITY_NOT_FOUND",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to build that city.",
            });
          });
        break;
      }
      case "city.refresh":
        void refreshRoster().catch((error: unknown) => {
          app.log.error({ error }, "Failed to refresh the city roster");
          send(socket, {
            kind: "error",
            code: "CITY_NOT_FOUND",
            message: "Failed to refresh open pull requests.",
          });
        });
        break;
      case "diff.request": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        const pr = registry.pullRequestFor(city.id);
        if (!pr) {
          send(socket, {
            kind: "error",
            code: "CITY_NOT_FOUND",
            message: "This city has no pull request to diff against.",
          });
          break;
        }
        void fileDiff(targetRepo, pr.baseRef, pr.headSha, data.path)
          .then((patch) => {
            send(socket, {
              kind: "diff",
              cityId: city.id,
              path: data.path,
              patch,
            });
          })
          .catch((error: unknown) => {
            app.log.error(
              { error, cityId: city.id, path: data.path },
              "Failed to compute file diff",
            );
            send(socket, {
              kind: "error",
              code: "CITY_NOT_FOUND",
              message: "Failed to compute that diff.",
            });
          });
        break;
      }
      default: {
        const exhaustiveCommand: never = data;
        throw new Error(`Unhandled command: ${String(exhaustiveCommand)}`);
      }
    }
  });
});

await app.listen({ host, port });
