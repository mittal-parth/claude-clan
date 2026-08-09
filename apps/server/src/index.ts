import { loadEnvFile } from "node:process";
import { join } from "node:path";
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
import { buildAuthContext, type AuthContext } from "./auth-context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { openSession } from "./session.js";
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
  authContext = buildAuthContext();
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
  workspaceKey: string;
  cityId: CityId;
  userId?: number;
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

const demoWorkspace = await workspaces.openDemo(demoRepoPath);

if (authContext) {
  registerAuthRoutes(app, authContext);
  registerRepoRoutes(app, authContext, workspaces, broadcastRepoStatus);
}

app.get("/health", async () => ({ ok: true, service: "sudo-city" }));
app.addHook("onClose", async () => {
  await workspaces.disposeAll();
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
  sendWorld(socket, workspace, cityId);
  sendOverlay(socket, workspace, cityId);
}

app.get("/ws", { websocket: true }, (socket) => {
  clients.set(socket, { workspaceKey: demoWorkspace.key, cityId: "main" });
  sendWorkspaceState(socket, demoWorkspace, "main");
  socket.once("close", () => clients.delete(socket));

  function currentWorkspace(): Workspace | undefined {
    const state = clients.get(socket);
    return state ? workspaces.get(state.workspaceKey) : undefined;
  }

  socket.on("message", (payload: RawData) => {
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
      // Decoded synchronously (no refresh-and-reseal dance, unlike the REST
      // routes' resolveSession) -- the client sends repo.select immediately
      // after this over the same socket, and on a single read both frames
      // can be parsed and dispatched in the same synchronous pass, before
      // any awaited work here would get a chance to run. An async path here
      // would make repo.select lose that race and silently see an
      // unauthenticated socket.
      const decodedSession = openSession(data.token, authContext.sessionKey, new Date());
      if (!decodedSession) {
        send(socket, { kind: "error", code: "AUTH_INVALID", message: "Session is invalid or expired." });
        return;
      }
      clients.set(socket, { ...state, userId: decodedSession.userId });
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
      const existing = workspaces.get(existingKey);
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
          send(socket, { kind: "error", code: "PERMIT_NOT_FOUND", message: "This permit is no longer pending." });
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
  });
});

await app.listen({ host, port });
