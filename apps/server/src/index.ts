import { loadEnvFile } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import {
  MayorCommandSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILES,
  type CityId,
  type GameEvent,
  type RepoStatusPhase,
  type ServerMessage,
} from "@sudo-city/protocol";
import Fastify from "fastify";
import { WebSocket, type RawData } from "ws";
import { buildAuthContext, resolveSession, type AuthContext } from "./auth-context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerLocalRoutes } from "./routes/local.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { UploadStore } from "./upload-store.js";
import { Workspace } from "./workspace.js";
import { WorkspaceManager } from "./workspaces.js";

export type DeployMode = "local" | "hosted";
// Explicit rather than inferred: the local-only routes below hand out a native
// file dialog and open arbitrary filesystem paths as cities. Deriving that from
// "is WEB_ORIGIN https" would turn one misconfigured env var into a directory
// -traversal hole on a public server, so it must be opted into by name.
const mode: DeployMode = process.env.SUDO_CITY_MODE === "local" ? "local" : "hosted";

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
await app.register(multipart, {
  limits: {
    fileSize: UPLOAD_MAX_FILE_BYTES,
    files: UPLOAD_MAX_FILES,
  },
});

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
const cloneRoot = process.env.SUDO_CITY_CLONE_ROOT ?? join(tmpdir(), "sudocity");

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

const uploadStore = new UploadStore({ log: app.log });
registerUploadRoutes(app, uploadStore, workspaces);

if (mode === "local") {
  registerLocalRoutes(app, workspaces);
}

const demoWorkspace = await workspaces.openDemo(demoRepoPath);

if (authContext) {
  registerAuthRoutes(app, authContext);
  registerRepoRoutes(app, authContext, workspaces, broadcastRepoStatus);
}

app.get("/health", async () => ({ ok: true, service: "sudo-city" }));
app.get("/api/config", async () => ({
  mode,
  maxUploadBytes: UPLOAD_MAX_BYTES,
}));

app.addHook("onClose", async () => {
  await uploadStore.disposeAll(async (key) => {
    await workspaces.evict(key);
  });
  await workspaces.disposeAll();
  await authContext?.db.close();
});

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
  socket.once("close", () => {
    const state = clients.get(socket);
    clients.delete(socket);
    if (state?.workspaceKey?.startsWith("upload:")) {
      const closingKey = state.workspaceKey;
      const uploadId = closingKey.slice("upload:".length);
      const hasOtherClients = [...clients.values()].some(
        (c) => c.workspaceKey === closingKey,
      );
      if (!hasOtherClients) {
        uploadStore.scheduleGraceDeletion(uploadId, async (key) => {
          await workspaces.evict(key);
        });
      }
    }
  });

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
      if (data.repoKey.startsWith("upload:")) {
        const uploadId = data.repoKey.slice("upload:".length);
        uploadStore.cancelGraceDeletion(uploadId);
        uploadStore.touch(uploadId);
        const existing = workspaces.get(data.repoKey);
        if (!existing) {
          send(socket, { kind: "error", code: "REPO_NOT_FOUND", message: "Upload session expired or not found." });
          return;
        }
        clients.set(socket, { workspaceKey: existing.key, cityId: "main", userId: currentState.userId });
        sendWorkspaceState(socket, existing, "main");
        return;
      }
      if (data.repoKey.startsWith("local:")) {
        const existing = workspaces.get(data.repoKey);
        if (!existing) {
          send(socket, { kind: "error", code: "REPO_NOT_FOUND", message: "Local workspace not found." });
          return;
        }
        clients.set(socket, { workspaceKey: existing.key, cityId: "main", userId: currentState.userId });
        sendWorkspaceState(socket, existing, "main");
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
