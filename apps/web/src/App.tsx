import {
  ServerMessageSchema,
  type GameEvent,
  type MayorCommand,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { FormEvent, useEffect, useRef, useState } from "react";
import Dialogue from "@/components/ui/8bit/blocks/dialogue";
import QuestLog, {
  type Quest,
  type QuestStatus,
} from "@/components/ui/8bit/blocks/quest-log";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/8bit/command";
import HealthBar from "@/components/ui/8bit/health-bar";
import { Input } from "@/components/ui/8bit/input";
import { Kbd } from "@/components/ui/8bit/kbd";
import ManaBar from "@/components/ui/8bit/mana-bar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/8bit/resizable";
import { GameCanvas } from "./components/GameCanvas";

type ConnectionState = "connecting" | "online" | "offline";

const websocketUrl =
  import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:4100/ws";
const maxBudgetUsd = Number(import.meta.env.VITE_MAX_BUDGET_USD ?? 1);

function statusLabel(status: ConnectionState): string {
  switch (status) {
    case "connecting":
      return "Linking";
    case "online":
      return "Live";
    case "offline":
      return "Offline";
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

function eventLabel(event: GameEvent): string {
  switch (event.type) {
    case "world.ready":
      return `${event.snapshot.buildings.length} structures surveyed`;
    case "session.started":
      return `${event.model} crew dispatched`;
    case "session.message":
      return `${event.role}: ${event.text}`;
    case "session.usage":
      return `$${event.costUsd.toFixed(4)} · ${event.outputTokens} tokens out`;
    case "permit.requested":
      return `permit requested: ${event.tool}`;
    case "file.changed":
      return `${event.change}: ${event.path}`;
    case "tool.started":
      return `${event.tool}: ${event.target ?? "working"}`;
    case "tool.completed":
      return `${event.outcome}: ${event.toolCallId}`;
    case "subagent.changed":
      return `${event.status}: ${event.agentType ?? "helper"}`;
    case "task.changed":
      return `${event.status}: ${event.subject ?? event.taskId}`;
    case "compact.changed":
      return `context rest ${event.status}`;
    case "diagnostics.updated":
      return `${event.path}: ${event.errors} errors`;
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

function questStatus(event: GameEvent): QuestStatus {
  switch (event.type) {
    case "permit.requested":
    case "tool.started":
    case "file.changed":
    case "session.started":
    case "subagent.changed":
      return event.type === "subagent.changed" && event.status === "stopped"
        ? "completed"
        : "active";
    case "tool.completed":
      return event.outcome === "success" ? "completed" : "failed";
    case "task.changed":
      return event.status === "completed" ? "completed" : "active";
    case "compact.changed":
      return event.status === "completed" ? "completed" : "active";
    default:
      return "pending";
  }
}

function eventsToQuests(events: GameEvent[]): Quest[] {
  return events.map((event) => ({
    id: event.id,
    title: event.type.replace(".", " · "),
    description: eventLabel(event),
    status: questStatus(event),
    shortDescription: eventLabel(event),
  }));
}

function findPendingPermit(
  events: GameEvent[],
): Extract<GameEvent, { type: "permit.requested" }> | undefined {
  const completed = new Set<string>();
  for (const event of events.slice().reverse()) {
    if (event.type === "tool.completed") {
      completed.add(event.toolCallId);
    }
    if (
      event.type === "permit.requested" &&
      !completed.has(event.toolCallId)
    ) {
      return event;
    }
  }
  return undefined;
}

export default function App() {
  const socketRef = useRef<WebSocket>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [world, setWorld] = useState<WorldSnapshot>();
  const pendingPermit = findPendingPermit(events);
  const usage = events
    .slice()
    .reverse()
    .find((event) => event.type === "session.usage");
  const treasuryUsed =
    usage?.type === "session.usage" ? usage.costUsd : 0;
  const treasuryPercent = Math.min(
    100,
    Math.round((treasuryUsed / maxBudgetUsd) * 100),
  );
  const startedSession = events
    .slice()
    .reverse()
    .find((event) => event.type === "session.started");
  const agentModel =
    startedSession?.type === "session.started"
      ? startedSession.model
      : "Engineer";

  useEffect(() => {
    const socket = new WebSocket(websocketUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => setConnection("online"));
    socket.addEventListener("close", () => setConnection("offline"));
    socket.addEventListener("error", () => setConnection("offline"));
    socket.addEventListener("message", (message) => {
      const decoded = ServerMessageSchema.safeParse(
        JSON.parse(String(message.data)) as unknown,
      );
      if (!decoded.success || decoded.data.kind === "error") {
        return;
      }

      const event = decoded.data.event;
      setEvents((current) => [...current.slice(-19), event]);
      if (event.type === "world.ready") {
        setWorld(event.snapshot);
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function send(command: MayorCommand): void {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(command));
    }
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      return;
    }
    send({ type: "session.prompt", prompt: nextPrompt });
    setPrompt("");
  }

  return (
    <div className="flex h-dvh min-h-[36rem] flex-col bg-background">
      <header className="flex items-center justify-between border-b-4 border-foreground px-4 py-3 dark:border-ring">
        <div className="flex min-w-0 items-center gap-3">
          <span className="retro flex size-9 shrink-0 items-center justify-center border-2 border-foreground bg-primary text-xs font-black text-primary-foreground dark:border-ring">
            SC
          </span>
          <div className="min-w-0">
            <h1 className="retro truncate text-sm md:text-base">Sudo City</h1>
            <p className="retro text-[10px] text-muted-foreground">
              Local repository · mayor console
            </p>
          </div>
        </div>
        <Badge
          variant={connection === "online" ? "default" : "outline"}
          className="retro text-[10px]"
        >
          {statusLabel(connection)}
        </Badge>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={72} minSize={45}>
          <div className="flex h-full min-h-0 flex-col">
            <section className="relative min-h-0 flex-1 overflow-hidden">
              <GameCanvas world={world} />
              <div className="pointer-events-none absolute left-4 top-4 border-2 border-foreground bg-card px-3 py-2 dark:border-ring">
                <span className="retro block text-[10px] text-primary">
                  District survey
                </span>
                <strong className="retro block text-xs">
                  {world?.buildings.length ?? 0} structures mapped
                </strong>
              </div>
              <div className="pointer-events-none absolute bottom-4 right-4 border border-border bg-card/90 px-2 py-1">
                <span className="retro text-[8px] text-muted-foreground">
                  Drag to pan · Scroll to zoom
                </span>
              </div>
            </section>

            <form
              className="border-t-4 border-foreground p-4 dark:border-ring"
              onSubmit={submitPrompt}
            >
              <label
                htmlFor="mayor-prompt"
                className="retro mb-2 block text-[10px] text-muted-foreground"
              >
                Mayor&apos;s order
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="mayor-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What should the crew build?"
                  disabled={connection !== "online"}
                  className="min-w-0 flex-1"
                />
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="submit"
                    disabled={connection !== "online" || !prompt.trim()}
                  >
                    Dispatch
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => send({ type: "session.interrupt" })}
                    disabled={connection !== "online"}
                  >
                    Halt
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={28} minSize={20}>
          <aside className="flex h-full min-h-0 flex-col overflow-y-auto border-l-4 border-foreground bg-card dark:border-ring">
            <div className="flex items-center justify-between border-b-4 border-foreground px-4 py-3 dark:border-ring">
              <span className="retro text-[10px] text-primary">City works</span>
              <Kbd>⌘ K</Kbd>
            </div>

            <div className="space-y-4 p-4">
              <Dialogue
                avatarFallback={agentModel.slice(0, 1).toUpperCase()}
                title={agentModel}
                description={
                  pendingPermit
                    ? "Awaiting permit stamp"
                    : "Awaiting orders"
                }
              />

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="retro flex justify-between text-[10px] text-muted-foreground">
                    <span>Context stamina</span>
                    <span>100%</span>
                  </div>
                  <HealthBar variant="retro" value={100} className="h-4" />
                </div>
                <div className="space-y-1">
                  <div className="retro flex justify-between text-[10px] text-muted-foreground">
                    <span>Treasury</span>
                    <span>${treasuryUsed.toFixed(4)}</span>
                  </div>
                  <ManaBar variant="retro" value={treasuryPercent} className="h-4" />
                </div>
              </div>

              {pendingPermit ? (
                <div className="space-y-3">
                  <Dialogue
                    player={false}
                    avatarFallback="!"
                    title={`Permit: ${pendingPermit.tool}`}
                    description={pendingPermit.message}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() =>
                        send({
                          type: "permit.resolve",
                          toolCallId: pendingPermit.toolCallId,
                          decision: "allow",
                        })
                      }
                    >
                      Stamp
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() =>
                        send({
                          type: "permit.resolve",
                          toolCallId: pendingPermit.toolCallId,
                          decision: "deny",
                        })
                      }
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              ) : null}

              <QuestLog
                quests={eventsToQuests(events.slice().reverse())}
                emptyStateMessage="The radio is quiet."
                className="[&_[data-slot=scroll-area]]:h-[280px]"
              />
            </div>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type a mayor command..." />
        <CommandList>
          <CommandEmpty>No command found.</CommandEmpty>
          <CommandGroup heading="Mayor">
            <CommandItem
              onSelect={() => {
                send({ type: "world.request" });
                setCommandOpen(false);
              }}
            >
              Rescan district
            </CommandItem>
            <CommandItem
              onSelect={() => {
                send({ type: "session.interrupt" });
                setCommandOpen(false);
              }}
            >
              Halt construction
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
