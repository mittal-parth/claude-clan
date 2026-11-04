import { loadEnvFile } from "node:process";
import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  MayorCommandSchema,
  type CityId,
  type GameEvent,
  type RepoStatusPhase,
  type ServerMessage,
} from "@sudo-city/protocol";
import Fastify from "fastify";
import { WebSocket, type RawData } from "ws";
import { buildAuthContext, resolveSession, type AuthContext } from "./auth-context.js";
import { buildCrewPolicy, buildSandboxSettings } from "./policy.js";
import {
  creditMode,
  isLocalMode,
  localAgentEnvironment,
  localSettingSources,
  requireDesktopToken,
  shouldLoadRepositoryEnv,
} from "./local-mode.js";
import { validateLocalPath } from "./local-path.js";
import { registerLocalGithubRoutes } from "./local-github.js";
import { budgetPolicyFromEnv, WorkspaceManager } from "./workspaces.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { isValidRepoFullName } from "@sudo-city/cities";
import { Workspace } from "./workspace.js";
import { shouldDeliverEvent } from "./event-routing.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4100);
const app = Fastify({ logger: true });

const webOrigin = process.env.WEB_ORIGIN;
// Real browser traffic reaches the API through the web app's own origin (a
// same-origin proxy in front of it), so the session cookie never needs to
// cross a site boundary. This CORS config only covers direct, non-proxied
// callers -- credentialed requests still need an explicit origin, `*` can't
// carry cookies.
await app.register(cors, {
  origin: [webOrigin, "http://127.0.0.1:5173"].filter((value): value is string => Boolean(value)),
  credentials: true,
});
await app.register(cookie);
await app.register(websocket);

const desktopToken = isLocalMode() ? requireDesktopToken() : undefined;

function desktopTokenMatches(candidate: string | undefined): boolean {
  if (!desktopToken) {
    return true;
  }
  if (!candidate || candidate.length !== desktopToken.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(desktopToken));
}

function desktopOriginMatches(origin: string | undefined): boolean {
  if (!desktopToken || !origin) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === String(port)
    );
  } catch {
    return false;
  }
}

if (desktopToken) {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api") || request.method === "OPTIONS") {
      return;
    }
    const token = request.headers["x-desktop-token"];
    if (
      !desktopOriginMatches(request.headers.origin) ||
      !desktopTokenMatches(typeof token === "string" ? token : undefined)
    ) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });
}

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const err = (error ?? {}) as { statusCode?: number; name?: string; message?: string };
  const status = typeof err.statusCode === "number" ? err.statusCode : 500;
  void reply.status(status).send({
    error: status >= 500 ? "Internal Server Error" : (err.name ?? "Error"),
    message: status >= 500 ? "An unexpected error occurred." : (err.message ?? "An error occurred."),
  });
});

const demoRepoPath = process.env.SUDO_CITY_REPO ?? process.env.INIT_CWD ?? process.cwd();

if (shouldLoadRepositoryEnv()) {
  try {
    loadEnvFile(join(demoRepoPath, ".env"));
  } catch {
    // Existing Claude Code credentials remain the local-development fallback.
  }
}

if (isLocalMode() && creditMode() === "subscription") {
  // Claude Code prefers this variable over a local login. Removing it from the
  // server process closes the inherited-shell billing trap even when the
  // desktop was launched from a shell that exported a key.
  delete process.env.ANTHROPIC_API_KEY;
}

const localAgentEnv = localAgentEnvironment();

/**
 * A GitHub App isn't required to run the demo city at all -- login-related
 * routes and the session.auth/repo.select commands are the only things
 * gated on this being configured. Everything else (the shared demo
 * workspace, chat, orders) must keep working with zero credentials, per the
 * plan's "must never depend on GitHub" requirement for the offline path.
 */
let authContext: AuthContext | undefined;
try {
  authContext = await buildAuthContext();
} catch (error) {
  app.log.warn(
    { error },
    "GitHub App env vars are not fully configured; login is disabled and only the demo city is available",
  );
}

const GLOBAL_MAX_BUDGET_USD = Number(process.env.SUDO_CITY_MAX_BUDGET_USD ?? 1);
// A signed-in user's lifetime allowance, enforced against a Postgres-backed
// ledger so it survives restarts, evictions, and a multi-instance fleet. The
// shared ceiling above still applies -- an order is capped by whichever of the
// two runs out first.
const PER_USER_MAX_BUDGET_USD = Number(
  process.env.SUDO_CITY_USER_MAX_BUDGET_USD ?? 10,
);
const budgetPolicy = budgetPolicyFromEnv(process.env, {
  globalMaxUsd: GLOBAL_MAX_BUDGET_USD,
  perUserMaxUsd: PER_USER_MAX_BUDGET_USD,
});
// Resolve to an absolute path so local world stores never accidentally land in
// the scanned project or depend on the server's current working directory.
const localStoreRoot = process.env.SUDO_CITY_STORE_ROOT?.trim()
  ? resolve(process.env.SUDO_CITY_STORE_ROOT.trim())
  : undefined;

function localStoreRootFor(repoPath: string): string | undefined {
  if (!localStoreRoot) {
    return undefined;
  }
  const hash = createHash("sha256").update(resolve(repoPath)).digest("hex").slice(0, 16);
  return join(localStoreRoot, "worlds", hash);
}
const localGithubRoot = resolve(
  process.env.SUDO_CITY_LOCAL_GITHUB_ROOT?.trim() ||
    join(process.env.HOME ?? homedir(), "Library", "Application Support", "Claude City", "github"),
);
// `??` would accept an empty SUDO_CITY_CLONE_ROOT= line (a very easy thing to
// leave in a .env) as a real value, and join("") resolves against cwd -- which
// drops every user's clone inside the server's own checkout, where it breaks
// the deploy's clean-tree gate and gets picked up by test globs. Resolve to an
// absolute path so a relative value can't land somewhere surprising either.
const cloneRoot = resolve(
  process.env.SUDO_CITY_CLONE_ROOT?.trim() || join(tmpdir(), "sudocity"),
);
const crewPolicy = buildCrewPolicy();
// Per workspace, not per process: each crew's allowRead is its own clone.
const sandboxFor = (repoPath: string) =>
  buildSandboxSettings({ repoPath, cloneRoot, serverRoot: demoRepoPath });
// Deliberately not the settings object itself: those are per workspace, and
// logging a specimen built from the clone root printed allowRead == denyRead,
// which reads as "the restriction is a no-op" when the real per-workspace
// values are correct. A security control's log must not describe something
// other than what runs.
app.log.info(
  {
    crewPolicy,
    sandbox: sandboxFor(cloneRoot)
      ? { enabled: true, scope: "per workspace", deniedOutside: cloneRoot }
      : "disabled",
  },
  "Crew policy for this deployment",
);

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function sendBudget(socket: WebSocket, state: ClientState): void {
  if (socket.readyState === WebSocket.OPEN) {
    send(socket, {
      kind: "budget",
      budget: workspaces.budgetInfo(state.userId),
    });
  }
}

interface ClientState {
  /**
   * Undefined until the client's repo.select lands. Every broadcast matches on
   * this, so a socket that has not chosen yet receives nothing — it must never
   * be shown another workspace's world, however briefly. See the connect
   * handler for what that cost.
   */
  workspaceKey?: string;
  cityId: CityId;
  userId?: number;
  githubToken?: string;
  /** Sessions whose modals are open; transcript traffic follows these across cities. */
  subscriptions: Set<string>;
}

/** Every connected socket, keyed by itself, carrying which workspace+city it's currently viewing. */
const clients = new Map<WebSocket, ClientState>();

function socketsForUser(userId: number): WebSocket[] {
  return [...clients.entries()]
    .filter(([, state]) => state.userId === userId)
    .map(([socket]) => socket);
}

function broadcastRepoStatus(
  userId: number,
  repoKey: string,
  phase: RepoStatusPhase,
  message?: string,
): void {
  for (const socket of socketsForUser(userId)) {
    if (socket.readyState === WebSocket.OPEN) {
      send(socket, { kind: "repo.status", repoKey, phase, message });
    }
  }
}

const workspaces = new WorkspaceManager({
  log: app.log,
  cloneRoot,
  budgetPolicy,
  pathToClaudeCodeExecutable: process.env.SUDO_CITY_CLAUDE_PATH?.trim() || undefined,
  settingSources: localSettingSources(),
  agentEnv: localAgentEnv,
  sandboxFor,
  spendStore:
    !isLocalMode() && authContext
      ? {
          spentUsd: (userId) => authContext!.db.userSpentUsd(userId),
          addSpend: (userId, amountUsd) =>
            authContext!.db.addUserSpend(userId, amountUsd),
        }
      : undefined,
  sink: {
    onEvent(workspaceKey, cityId, sessionId, event: GameEvent) {
      const message = JSON.stringify({ kind: "event", event } satisfies ServerMessage);
      for (const [socket, state] of clients) {
        if (
          socket.readyState !== WebSocket.OPEN ||
          !shouldDeliverEvent(state, workspaceKey, cityId, sessionId, event)
        ) {
          continue;
        }
        socket.send(message);
      }
      if (event.type === "session.usage") {
        const workspaceOwnerId = workspaceKey.includes(":")
          ? Number(workspaceKey.split(":")[0])
          : undefined;
        for (const [socket, state] of clients) {
          if (
            (state.workspaceKey === workspaceKey ||
              (workspaceOwnerId !== undefined && state.userId === workspaceOwnerId)) &&
            socket.readyState === WebSocket.OPEN
          ) {
            sendBudget(socket, state);
          }
        }
      }
    },
    onSessionChanged(workspaceKey, session) {
      const message = JSON.stringify({ kind: "session", session } satisfies ServerMessage);
      for (const [socket, state] of clients) {
        if (state.workspaceKey === workspaceKey && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    },
    onCitiesChanged(workspaceKey) {
      const workspace = workspaces.get(workspaceKey);
      if (!workspace) {
        return;
      }
      const message = JSON.stringify({
        kind: "cities",
        cities: workspace.summaries(),
      } satisfies ServerMessage);
      for (const [socket, state] of clients) {
        if (state.workspaceKey === workspaceKey && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    },
    onIssuesChanged(workspaceKey) {
      const workspace = workspaces.get(workspaceKey);
      if (!workspace) {
        return;
      }
      const message = JSON.stringify({
        kind: "issues",
        issues: workspace.listIssues(),
      } satisfies ServerMessage);
      for (const [socket, state] of clients) {
        if (state.workspaceKey === workspaceKey && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    },
    onBudgetChanged() {
      for (const [socket, state] of clients) {
        if (socket.readyState === WebSocket.OPEN) {
          sendBudget(socket, state);
        }
      }
    },
  },
});

const demoWorkspace = await workspaces.openDemo(demoRepoPath);

if (authContext) {
  registerAuthRoutes(app, authContext);
  registerRepoRoutes(app, authContext, workspaces, broadcastRepoStatus);
}
if (isLocalMode()) {
  registerLocalGithubRoutes(app, workspaces, {
    root: localGithubRoot,
    storeRootFor: localStoreRootFor,
  });
}

app.get("/health", async () => ({ ok: true, service: "sudo-city" }));
app.addHook("onClose", async () => {
  await workspaces.disposeAll();
  await authContext?.db.close();
});

/**
 * True when this connection is on the shared demo workspace and the
 * deployment has switched off the things that cost money or do work there.
 * Nobody authenticates to reach the demo city, so its socket commands are the
 * one unauthenticated write path in the server.
 */
function demoIsLocked(workspace: Workspace): boolean {
  return workspace.key === demoWorkspace.key && !crewPolicy.demoInteractive;
}

/** One error code for every gated action, so the HUD can answer any of them with the sign-in modal. */
function sendSignInRequired(socket: WebSocket, action: string): void {
  send(socket, {
    kind: "error",
    code: "SIGN_IN_REQUIRED",
    message: `Sign in to ${action}. The demo city is read-only.`,
  });
}

function sendWorld(socket: WebSocket, workspace: Workspace, cityId: CityId): void {
  const city = workspace.city(cityId);
  if (!city) {
    return;
  }
  send(socket, {
    kind: "event",
    event: workspace.createWorldEvent(city),
  });
}

function sendOverlay(socket: WebSocket, workspace: Workspace, cityId: CityId): void {
  const overlay = workspace.overlayFor(cityId);
  if (overlay) {
    send(socket, { kind: "overlay", overlay });
  }
}

function sendWorkspaceState(socket: WebSocket, workspace: Workspace, cityId: CityId): void {
  const state = clients.get(socket);
  send(socket, { kind: "cities", cities: workspace.summaries() });
  send(socket, { kind: "issues", issues: workspace.listIssues() });
  send(socket, { kind: "viewer", login: workspace.viewerLogin() });
  send(socket, { kind: "budget", budget: workspaces.budgetInfo(state?.userId) });
  send(socket, { kind: "sessions", sessions: workspace.sessionSummaries() });
  sendWorld(socket, workspace, cityId);
  sendOverlay(socket, workspace, cityId);
}

app.get("/ws", { websocket: true }, (socket, request) => {
  if (
    desktopToken &&
    (!desktopOriginMatches(request.headers.origin) ||
      !desktopTokenMatches(
        new URL(request.url, "http://127.0.0.1").searchParams.get("token") ?? undefined,
      ))
  ) {
    socket.close(4401, "Unauthorized");
    return;
  }
  // The socket starts pointed at the demo workspace so currentWorkspace()
  // always resolves, but nothing is pushed until the client says which repo
  // it wants. Sending the demo's world here unprompted meant every
  // reconnection rendered the demo island first: switching repositories tears
  // the socket down and opens a new one, so the client would draw the demo
  // city, stamp that snapshot with the repo key it was travelling to, and
  // only then receive the real world. The airport cutscene flew its landing
  // into that phantom island and put the aeroplane down in open water.
  //
  // Every client sends repo.select on open (the demo included, as "demo"),
  // and that path replies with the full state — so this costs nothing but the
  // round trip it should always have waited for.
  clients.set(socket, { cityId: "main", subscriptions: new Set() });
  // Connection-level rather than workspace-level, so unlike the world state
  // below it is sent on open: the HUD has to know which crews and thinking
  // levels this deployment allows before the mayor picks either.
  send(socket, { kind: "policy", policy: crewPolicy });
  sendBudget(socket, { cityId: "main", subscriptions: new Set() });
  socket.once("close", () => clients.delete(socket));

  function currentWorkspace(): Workspace | undefined {
    const state = clients.get(socket);
    return state?.workspaceKey ? workspaces.get(state.workspaceKey) : undefined;
  }

  // The client sends session.auth immediately followed by repo.select over
  // the same socket. session.auth now does a real DB lookup (async), so
  // without this queue, repo.select's handler could run before session.auth
  // finishes and see an unauthenticated socket. Chaining every message onto
  // one per-socket promise processes them strictly in arrival order
  // regardless of how long any individual handler's async work takes.
  let queue: Promise<void> = Promise.resolve();

  socket.on("message", (payload: RawData) => {
    queue = queue.then(() => handleMessage(payload)).catch((error: unknown) => {
      app.log.error({ error }, "Unhandled error in the WS message queue");
    });
  });

  async function handleMessage(payload: RawData): Promise<void> {
    let command: unknown;
    try {
      command = JSON.parse(payload.toString()) as unknown;
    } catch {
      send(socket, { kind: "error", code: "INVALID_JSON", message: "Command must be valid JSON" });
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

    const data = decoded.data;
    const state = clients.get(socket);
    if (!state) {
      return;
    }

    // One socket's bad command must never take the process down with it --
    // this server is shared by every connected user, unlike the old
    // single-repo single-tenant version.
    try {
    if (data.type === "session.auth") {
      if (!authContext) {
        send(socket, { kind: "error", code: "AUTH_DISABLED", message: "Login is not configured on this server." });
        return;
      }
      // `data.token` here is a single-use WS ticket (see `/api/auth/ws-ticket`),
      // not the session id itself -- page JS never holds that.
      const sessionId = authContext.wsTickets.consume(data.token);
      const session = sessionId ? await resolveSession(sessionId, authContext, new Date()) : undefined;
      if (!session) {
        send(socket, { kind: "error", code: "AUTH_INVALID", message: "Session is invalid or expired." });
        return;
      }
      await workspaces.ensureUserSpendLoaded(session.userId);
      const newState: ClientState = { ...state, userId: session.userId, githubToken: session.tokens.accessToken };
      clients.set(socket, newState);
      sendBudget(socket, newState);
      return;
    }

    if (data.type === "repo.select") {
      const currentState = clients.get(socket);
      if (!currentState) {
        return;
      }
      if (data.repoKey === "demo") {
        clients.set(socket, {
          workspaceKey: demoWorkspace.key,
          cityId: "main",
          userId: currentState.userId,
          githubToken: currentState.githubToken,
          subscriptions: new Set(),
        });
        sendWorkspaceState(socket, demoWorkspace, "main");
        return;
      }
      if (currentState.userId === undefined) {
        send(socket, { kind: "error", code: "AUTH_REQUIRED", message: "Sign in to select your own repos." });
        return;
      }
      if (!isValidRepoFullName(data.repoKey)) {
        send(socket, { kind: "error", code: "REPO_NOT_FOUND", message: "Unknown repository." });
        return;
      }
      const [owner, name] = data.repoKey.split("/") as [string, string];
      // The socket only carries an authenticated userId, never a token --
      // repo.select must be paired with a prior /api/repos/import (which
      // has the bearer token) unless the workspace is already open.
      const existingKey = `${currentState.userId}:${data.repoKey}`;
      let existing = workspaces.get(existingKey);
      
      if (!existing && currentState.githubToken && authContext) {
        const clonePath = await authContext.db.clonePathFor(currentState.userId, data.repoKey);
        if (clonePath) {
          try {
            existing = await workspaces.openUserRepo({
              userId: currentState.userId,
              owner,
              name,
              repoKey: data.repoKey,
              githubToken: currentState.githubToken,
            });
          } catch {
            // A missing directory or failed clone is handled by falling through
            // to the REPO_NOT_IMPORTED error below.
          }
        }
      }

      if (!existing) {
        send(socket, {
          kind: "error",
          code: "REPO_NOT_IMPORTED",
          message: "Import this repository first via /api/repos/import.",
        });
        return;
      }
      clients.set(socket, {
        workspaceKey: existing.key,
        cityId: "main",
        userId: currentState.userId,
        githubToken: currentState.githubToken,
        subscriptions: new Set(),
      });
      sendWorkspaceState(socket, existing, "main");
      return;
    }

    if (data.type === "repo.openLocal") {
      if (!isLocalMode()) {
        send(socket, {
          kind: "error",
          code: "NOT_SUPPORTED",
          message: "Opening a local folder is only available in the desktop app.",
        });
        return;
      }
      const validated = await validateLocalPath(data.path);
      if ("rejected" in validated) {
        const message =
          validated.rejected === "forbidden"
            ? "That folder is off limits."
            : validated.rejected === "not-found"
              ? "That folder no longer exists."
              : validated.rejected === "not-a-directory"
                ? "That is a file, not a folder."
                : "That path is not absolute.";
        send(socket, { kind: "error", code: "REPO_NOT_FOUND", message });
        return;
      }
      const workspace = await workspaces.openLocalFolder({
        path: validated.path,
        githubToken: state.githubToken,
        storeRoot: localStoreRootFor(validated.path),
      });
      clients.set(socket, {
        workspaceKey: workspace.key,
        cityId: "main",
        userId: state.userId,
        githubToken: state.githubToken,
        subscriptions: new Set(),
      });
      sendWorkspaceState(socket, workspace, "main");
      return;
    }

    const workspace = currentWorkspace();
    if (!workspace) {
      send(socket, { kind: "error", code: "CITY_NOT_FOUND", message: "No active repository selected." });
      return;
    }

    function requireCity(cityId: CityId) {
      const city = workspace!.city(cityId);
      if (!city) {
        send(socket, { kind: "error", code: "CITY_NOT_FOUND", message: `No city "${cityId}" is available.` });
      }
      return city;
    }

    function sendSessionError(error: { code: string; message?: string }): void {
      const fallback = error.code === "SESSION_NOT_FOUND"
        ? "That session no longer exists."
        : error.code === "SESSION_CLOSED"
          ? "That session is closed."
          : error.code === "TOO_MANY_SESSIONS"
            ? "This city has reached its session limit."
            : error.code === "TOO_MANY_RUNNING_SESSIONS"
              ? "Too many crews are running at once."
              : "That order cannot be funded right now.";
      send(socket, { kind: "error", code: error.code, message: error.message ?? fallback });
    }

    function policyAllows(model?: string, effort?: typeof crewPolicy.allowedEfforts[number]): boolean {
      if (model && !crewPolicy.allowedModels.includes(model)) {
        send(socket, {
          kind: "error",
          code: "MODEL_NOT_ALLOWED",
          message: `The ${model} crew is not on duty on this server.`,
        });
        return false;
      }
      if (effort && !crewPolicy.allowedEfforts.includes(effort)) {
        send(socket, {
          kind: "error",
          code: "EFFORT_NOT_ALLOWED",
          message: `Thinking level "${effort}" is not available on this server.`,
        });
        return false;
      }
      return true;
    }

    switch (data.type) {
      case "world.request": {
        if (!requireCity(data.cityId)) {
          break;
        }
        void workspace.rescanWorld(data.cityId).catch((error: unknown) => {
          app.log.error({ error }, "World rescan failed");
          send(socket, {
            kind: "error",
            code: "WORLD_SCAN_FAILED",
            message: error instanceof Error ? error.message : "Repository scan failed",
          });
        });
        break;
      }
      case "session.open": {
        if (!requireCity(data.cityId)) {
          break;
        }
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "dispatch a crew");
          break;
        }
        if (!policyAllows(data.model, data.effort)) {
          break;
        }
        const result = await workspace.openSession(data.cityId, {
          prompt: data.prompt,
          title: "title" in data ? data.title : undefined,
          permissionMode: data.permissionMode,
          contextPaths: data.contextPaths,
          model: data.model,
          effort: data.effort,
        });
        if ("error" in result) {
          sendSessionError(result.error);
          break;
        }
        state.subscriptions.add(result.session.sessionId);
        send(socket, { kind: "session", session: result.session });
        const initialTranscript = workspace.transcript(result.session.sessionId);
        if (initialTranscript) {
          send(socket, {
            kind: "transcript",
            sessionId: result.session.sessionId,
            fromSequence: initialTranscript.fromSequence,
            events: initialTranscript.events,
            hasMore: initialTranscript.hasMore,
          });
        }
        break;
      }
      case "session.send": {
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "send a follow-up order");
          break;
        }
        const result = await workspace.sendToSession(
          data.sessionId,
          data.prompt,
          data.contextPaths,
        );
        if ("error" in result) {
          sendSessionError(result.error);
        }
        break;
      }
      case "session.interrupt": {
        if (!(await workspace.interruptSession(data.sessionId))) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That session no longer exists.",
            sessionId: data.sessionId,
          });
        }
        break;
      }
      case "session.rename": {
        if (!(await workspace.renameSession(data.sessionId, data.title))) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That session no longer exists.",
            sessionId: data.sessionId,
          });
        }
        break;
      }
      case "session.configure": {
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "configure a crew");
          break;
        }
        if (!policyAllows(data.model, data.effort)) {
          break;
        }
        if (!(await workspace.configureSession(data.sessionId, data))) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That session is closed or no longer exists.",
            sessionId: data.sessionId,
          });
        }
        break;
      }
      case "session.close": {
        if (!(await workspace.closeSession(data.sessionId))) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That session no longer exists.",
            sessionId: data.sessionId,
          });
          break;
        }
        for (const clientState of clients.values()) {
          clientState.subscriptions.delete(data.sessionId);
        }
        break;
      }
      case "session.unarchive": {
        if (!(await workspace.unarchiveSession(data.sessionId))) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That archived session no longer exists.",
            sessionId: data.sessionId,
          });
        }
        break;
      }
      case "session.subscribe": {
        const transcript = workspace.transcript(data.sessionId, data.afterSequence);
        if (!transcript) {
          send(socket, {
            kind: "error",
            code: "SESSION_NOT_FOUND",
            message: "That session no longer exists.",
            sessionId: data.sessionId,
          });
          break;
        }
        state.subscriptions.add(data.sessionId);
        send(socket, {
          kind: "transcript",
          sessionId: data.sessionId,
          fromSequence: transcript.fromSequence,
          events: transcript.events,
          hasMore: transcript.hasMore,
        });
        break;
      }
      case "session.unsubscribe":
        state.subscriptions.delete(data.sessionId);
        break;
      case "session.list":
        send(socket, {
          kind: "sessions",
          sessions: workspace.sessionSummaries(data.cityId),
        });
        break;
      case "permit.resolve": {
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "stamp a permit");
          break;
        }
        const resolved = workspace.resolvePermit(
          data.sessionId,
          data.toolCallId,
          data.decision,
        );
        if (!resolved) {
          send(socket, {
            kind: "error",
            code: "PERMIT_NOT_FOUND",
            message: "This permit is no longer pending.",
            toolCallId: data.toolCallId,
            sessionId: data.sessionId,
          });
        }
        break;
      }
      case "city.travel": {
        const cityId = data.cityId;
        // `main` is already built and costs nothing to revisit; a PR or issue
        // city is a git worktree plus a repo scan, built on demand.
        if (cityId !== "main" && demoIsLocked(workspace)) {
          sendSignInRequired(socket, "sail to a pull request city");
          break;
        }
        void workspace
          .ensureCity(cityId)
          .then((city) => {
            if (!city) {
              send(socket, { kind: "error", code: "CITY_NOT_FOUND", message: `No city "${cityId}" is available.` });
              return;
            }
            clients.set(socket, { ...clients.get(socket)!, cityId: city.id });
            sendWorld(socket, workspace, city.id);
            sendOverlay(socket, workspace, city.id);
          })
          .catch((error: unknown) => {
            app.log.error({ error, cityId }, "Failed to travel to city");
            send(socket, {
              kind: "error",
              code: "CITY_NOT_FOUND",
              message: error instanceof Error ? error.message : "Failed to build that city.",
            });
          });
        break;
      }
      case "city.refresh":
        void workspace.refreshRoster().catch((error: unknown) => {
          app.log.error({ error }, "Failed to refresh the city roster");
          send(socket, { kind: "error", code: "CITY_NOT_FOUND", message: "Failed to refresh open pull requests." });
        });
        break;
      case "diff.request": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        void workspace
          .diff(data.cityId, data.path)
          .then((patch) => {
            send(socket, { kind: "diff", cityId: data.cityId, path: data.path, patch });
          })
          .catch((error: unknown) => {
            app.log.error({ error, cityId: data.cityId, path: data.path }, "Failed to compute file diff");
            send(socket, { kind: "error", code: "CITY_NOT_FOUND", message: "Failed to compute that diff." });
          });
        break;
      }
      default: {
        const exhaustive: never = data;
        throw new Error(`Unhandled command: ${String(exhaustive)}`);
      }
    }
    } catch (error) {
      app.log.error({ error, command: data.type }, "Unhandled error processing a mayor command");
      send(socket, { kind: "error", code: "INTERNAL_ERROR", message: "That command failed unexpectedly." });
    }
  }
});

if (process.env.SUDO_CITY_WEB_ROOT?.trim()) {
  const webRoot = resolve(process.env.SUDO_CITY_WEB_ROOT.trim());
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/auth") || request.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "Not Found" });
    }
    return reply.sendFile("index.html");
  });
}

app.log.info(
  {
    mode: isLocalMode() ? "local" : "hosted",
    creditMode: creditMode(),
    budgetPolicy: budgetPolicy.kind,
    settingSources: localSettingSources() ?? "none",
    desktopTokenRequired: Boolean(desktopToken),
  },
  "Deployment mode",
);

await app.listen({ host, port });
