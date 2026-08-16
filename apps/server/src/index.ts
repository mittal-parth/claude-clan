import { loadEnvFile } from "node:process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import cors from "@fastify/cors";
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
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { Workspace } from "./workspace.js";
import { WorkspaceManager } from "./workspaces.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4100);
const app = Fastify({ logger: true });

const webOrigin = process.env.WEB_ORIGIN;
await app.register(cors, {
  origin: [webOrigin, "http://127.0.0.1:5173"].filter((value): value is string => Boolean(value)),
});
await app.register(websocket);

const demoRepoPath = process.env.SUDO_CITY_REPO ?? process.env.INIT_CWD ?? process.cwd();

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    loadEnvFile(join(demoRepoPath, ".env"));
  } catch {
    // Existing Claude Code credentials remain the local-development fallback.
  }
}

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
  buildSandboxSettings({ repoPath, cloneRoot });
app.log.info(
  { crewPolicy, sandbox: sandboxFor(cloneRoot) ?? "disabled" },
  "Crew policy for this deployment",
);

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
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
  globalMaxBudgetUsd: GLOBAL_MAX_BUDGET_USD,
  perUserMaxBudgetUsd: PER_USER_MAX_BUDGET_USD,
  sandboxFor,
  spendStore: authContext
    ? {
        spentUsd: (userId) => authContext!.db.userSpentUsd(userId),
        addSpend: (userId, amountUsd) =>
          authContext!.db.addUserSpend(userId, amountUsd),
      }
    : undefined,
  sink: {
    onEvent(workspaceKey, cityId, event: GameEvent) {
      const message = JSON.stringify({ kind: "event", event } satisfies ServerMessage);
      for (const [socket, state] of clients) {
        if (
          state.workspaceKey === workspaceKey &&
          state.cityId === cityId &&
          socket.readyState === WebSocket.OPEN
        ) {
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
  },
});

const demoWorkspace = await workspaces.openDemo(demoRepoPath);

if (authContext) {
  registerAuthRoutes(app, authContext);
  registerRepoRoutes(app, authContext, workspaces, broadcastRepoStatus);
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
    event: workspace.createEvent(city, { type: "world.ready", snapshot: city.snapshot }),
  });
}

function sendOverlay(socket: WebSocket, workspace: Workspace, cityId: CityId): void {
  const overlay = workspace.overlayFor(cityId);
  if (overlay) {
    send(socket, { kind: "overlay", overlay });
  }
}

function sendWorkspaceState(socket: WebSocket, workspace: Workspace, cityId: CityId): void {
  send(socket, { kind: "cities", cities: workspace.summaries() });
  send(socket, { kind: "issues", issues: workspace.listIssues() });
  send(socket, { kind: "viewer", login: workspace.viewerLogin() });
  sendWorld(socket, workspace, cityId);
  sendOverlay(socket, workspace, cityId);
}

app.get("/ws", { websocket: true }, (socket) => {
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
  clients.set(socket, { cityId: "main" });
  // Connection-level rather than workspace-level, so unlike the world state
  // below it is sent on open: the HUD has to know which crews and thinking
  // levels this deployment allows before the mayor picks either.
  send(socket, { kind: "policy", policy: crewPolicy });
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
      const session = await resolveSession(data.token, authContext, new Date());
      if (!session) {
        send(socket, { kind: "error", code: "AUTH_INVALID", message: "Session is invalid or expired." });
        return;
      }
      clients.set(socket, { ...state, userId: session.userId, githubToken: session.tokens.accessToken });
      return;
    }

    if (data.type === "repo.select") {
      const currentState = clients.get(socket);
      if (!currentState) {
        return;
      }
      if (data.repoKey === "demo") {
        clients.set(socket, { workspaceKey: demoWorkspace.key, cityId: "main" });
        sendWorkspaceState(socket, demoWorkspace, "main");
        return;
      }
      if (currentState.userId === undefined) {
        send(socket, { kind: "error", code: "AUTH_REQUIRED", message: "Sign in to select your own repos." });
        return;
      }
      const [owner, name] = data.repoKey.split("/");
      if (!owner || !name) {
        send(socket, { kind: "error", code: "REPO_NOT_FOUND", message: "Unknown repository." });
        return;
      }
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
      clients.set(socket, { workspaceKey: existing.key, cityId: "main", userId: currentState.userId });
      sendWorkspaceState(socket, existing, "main");
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
      case "session.prompt": {
        if (!requireCity(data.cityId)) {
          break;
        }
        // The HUD opens a sign-in modal instead of sending this, but the
        // socket is the real boundary -- nothing stops a client sending
        // whatever it likes.
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "dispatch a crew");
          break;
        }
        if (data.model && !crewPolicy.allowedModels.includes(data.model)) {
          send(socket, {
            kind: "error",
            code: "MODEL_NOT_ALLOWED",
            message: `The ${data.model} crew is not on duty on this server.`,
          });
          break;
        }
        if (data.effort && !crewPolicy.allowedEfforts.includes(data.effort)) {
          send(socket, {
            kind: "error",
            code: "EFFORT_NOT_ALLOWED",
            message: `Thinking level "${data.effort}" is not available on this server.`,
          });
          break;
        }
        // Reject up front rather than starting a run with a $0 ceiling, which
        // would fail somewhere inside the SDK with a much worse message.
        if (workspace.remainingBudgetUsd() <= 0) {
          const spent = state.userId === undefined
            ? undefined
            : workspaces.userSpentUsd(state.userId);
          send(socket, {
            kind: "error",
            code: "BUDGET_EXHAUSTED",
            message:
              spent !== undefined && workspaces.remainingUserBudget(state.userId!) <= 0
                ? `The treasury is empty: you have spent $${spent.toFixed(2)} of your $${PER_USER_MAX_BUDGET_USD.toFixed(2)} allowance.`
                : "The city treasury is empty. No further orders can be funded right now.",
          });
          break;
        }
        workspace.prompt(data.cityId, data.prompt, {
          permissionMode: data.permissionMode,
          contextPaths: data.contextPaths,
          model: data.model,
          effort: data.effort,
        });
        break;
      }
      case "session.interrupt": {
        if (!requireCity(data.cityId)) {
          break;
        }
        workspace.interrupt(data.cityId);
        break;
      }
      case "permit.resolve": {
        if (demoIsLocked(workspace)) {
          sendSignInRequired(socket, "stamp a permit");
          break;
        }
        const resolved = workspace.resolvePermit(data.toolCallId, data.decision);
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

await app.listen({ host, port });
