import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { join } from "node:path";
import {
  AgentSessionManager,
  type AgentEvent,
} from "@sudo-city/agent";
import websocket from "@fastify/websocket";
import { layoutWorld } from "@sudo-city/layout";
import {
  MayorCommandSchema,
  type CityId,
  type CitySummary,
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

const targetRepo =
  process.env.SUDO_CITY_REPO ?? process.env.INIT_CWD ?? process.cwd();
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
  /** Guards against a burst of file.changed events queueing parallel scans. */
  pendingScan?: Promise<WorldSnapshot>;
}

class CityRegistry {
  private readonly cities = new Map<CityId, City>();

  add(city: City): void {
    this.cities.set(city.id, city);
  }

  get(id: CityId): City | undefined {
    return this.cities.get(id);
  }

  list(): City[] {
    return [...this.cities.values()];
  }

  summaries(): CitySummary[] {
    return this.list().map((city) =>
      city.id === "main"
        ? {
            id: city.id,
            kind: "main",
            title: "main",
            ref: "main",
            status: "ready",
          }
        : {
            id: city.id,
            kind: "pull-request",
            title: city.id,
            ref: city.id,
            status: "ready",
          },
    );
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

async function generateWorld(city: CityId, cwd: string): Promise<WorldSnapshot> {
  try {
    const map = await scanRepository(cwd);
    const layout = layoutWorld(map, { previousPlots: store.loadPlots(city) });
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
  broadcastEvent(cityId, createEvent(city, event));
}

const mainSessionId = `local-${randomUUID()}`;
const mainAgent = new AgentSessionManager({
  cwd: targetRepo,
  emit: (event) => emitAgentEvent("main", event),
  maxBudgetUsd: Number(process.env.SUDO_CITY_MAX_BUDGET_USD ?? 1),
});

registry.add({
  id: "main",
  cwd: targetRepo,
  agent: mainAgent,
  sessionId: mainSessionId,
  sequence: 0,
  snapshot: await generateWorld("main", targetRepo),
});

function sendWorld(socket: WebSocket, city: City): void {
  send(socket, {
    kind: "event",
    event: createEvent(city, { type: "world.ready", snapshot: city.snapshot }),
  });
}

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
        broadcastEvent(
          city.id,
          createEvent(city, {
            type: "session.message",
            role: "mayor",
            text: data.prompt,
          }),
        );
        void city.agent.start(data.prompt).catch((error: unknown) => {
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
          });
        }
        break;
      }
      case "city.travel": {
        const city = requireCity(data.cityId);
        if (!city) {
          break;
        }
        clients.set(socket, { cityId: city.id });
        sendWorld(socket, city);
        break;
      }
      case "city.refresh":
        // gh pr list / worktree pruning land with packages/cities.
        broadcastCities();
        break;
      case "diff.request":
        send(socket, {
          kind: "error",
          code: "CITY_NOT_FOUND",
          message: "Diffs are not available until PR cities are wired up.",
        });
        break;
      default: {
        const exhaustiveCommand: never = data;
        throw new Error(`Unhandled command: ${String(exhaustiveCommand)}`);
      }
    }
  });
});

await app.listen({ host, port });
