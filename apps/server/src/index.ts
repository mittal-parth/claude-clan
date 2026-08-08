import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { join, relative, resolve, sep } from "node:path";
import {
  AgentSessionManager,
  type AgentEvent,
} from "@sudo-city/agent";
import websocket from "@fastify/websocket";
import { layoutWorld } from "@sudo-city/layout";
import {
  MayorCommandSchema,
  type GameEvent,
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

let sequence = 0;
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
const sessionId = `local-${randomUUID()}`;
const store = new SQLiteWorldStore(
  join(targetRepo, ".sudocity", "world.db"),
);
const clients = new Set<WebSocket>();
type EventInput<Event extends GameEvent = GameEvent> = Event extends GameEvent
  ? Omit<Event, "id" | "sessionId" | "sequence" | "timestamp">
  : never;

const fallbackWorld: WorldSnapshot = {
  id: "preview-city",
  repoPath: targetRepo,
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

let currentWorld = await generateWorld();
/** Guards against a burst of file.changed events queueing parallel scans. */
let pendingScan: Promise<WorldSnapshot> | undefined;

async function generateWorld(): Promise<WorldSnapshot> {
  try {
    const map = await scanRepository(targetRepo);
    const layout = layoutWorld(map, { previousPlots: store.loadPlots() });
    store.savePlots(layout.plots);
    store.saveSnapshot(layout.snapshot);
    return layout.snapshot;
  } catch (error) {
    app.log.warn({ error }, "Repository scan failed; using preview world");
    return fallbackWorld;
  }
}

function createEvent(
  event: EventInput,
): GameEvent {
  const currentSequence = sequence++;
  const completedEvent = {
    ...event,
    id: `evt_${currentSequence}`,
    sessionId,
    sequence: currentSequence,
    timestamp: new Date().toISOString(),
  } as GameEvent;
  store.appendEvent(completedEvent);
  return completedEvent;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function broadcastEvent(event: GameEvent): void {
  const message = JSON.stringify({ kind: "event", event } satisfies ServerMessage);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function emitAgentEvent(event: AgentEvent): void {
  broadcastEvent(createEvent(event));
}

const agent = new AgentSessionManager({
  cwd: targetRepo,
  emit: emitAgentEvent,
  maxBudgetUsd: Number(process.env.SUDO_CITY_MAX_BUDGET_USD ?? 1),
});

function sendWorld(socket: WebSocket): void {
  send(socket, {
    kind: "event",
    event: createEvent({ type: "world.ready", snapshot: currentWorld }),
  });
}

/**
 * Rescans the repository and broadcasts the result. Plots are persisted, so a
 * file that already exists keeps its city block and the client's diff leaves
 * the standing building alone.
 */
async function rescanWorld(): Promise<void> {
  pendingScan ??= generateWorld().finally(() => {
    pendingScan = undefined;
  });
  currentWorld = await pendingScan;
  broadcastEvent(createEvent({ type: "world.ready", snapshot: currentWorld }));
}

app.get("/health", async () => ({ ok: true, service: "sudo-city" }));
app.addHook("onClose", async () => {
  await agent.interrupt();
  store.close();
});

app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  sendWorld(socket);
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

    switch (decoded.data.type) {
      case "world.request":
        void rescanWorld().catch((error: unknown) => {
          app.log.error({ error }, "World rescan failed");
          send(socket, {
            kind: "error",
            code: "WORLD_SCAN_FAILED",
            message:
              error instanceof Error ? error.message : "Repository scan failed",
          });
        });
        break;
      case "session.prompt": {
        const contextPaths = sanitizeContextPaths(decoded.data.contextPaths);
        broadcastEvent(
          createEvent({
            type: "session.message",
            role: "mayor",
            text: mayorMessage(decoded.data.prompt, contextPaths),
          }),
        );
        void agent
          .start(
            decoded.data.prompt,
            decoded.data.permissionMode ?? "default",
            contextPaths,
          )
          .catch((error: unknown) => {
            emitAgentEvent({
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
      case "session.interrupt":
        void agent.interrupt();
        broadcastEvent(
          createEvent({
            type: "session.message",
            role: "system",
            text: "Construction paused by the mayor.",
          }),
        );
        break;
      case "permit.resolve":
        if (!agent.resolvePermit(
          decoded.data.toolCallId,
          decoded.data.decision,
        )) {
          send(socket, {
            kind: "error",
            code: "PERMIT_NOT_FOUND",
            message: "This permit is no longer pending.",
          });
        }
        break;
      default: {
        const exhaustiveCommand: never = decoded.data;
        throw new Error(`Unhandled command: ${String(exhaustiveCommand)}`);
      }
    }
  });
});

await app.listen({ host, port });
