import {
  GameEventSchema,
  ServerMessageSchema,
  type Building,
  type CitySummary,
  type GameEvent,
  type MayorCommand,
  type PullRequestOverlay,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAudio } from "@/components/audio-provider";
import { Markdown } from "@/components/markdown";
import Dialogue from "@/components/ui/8bit/blocks/dialogue";
import QuestLog, {
  type Quest,
  type QuestStatus,
  type QuestTimelineStep,
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
import {
  GameCanvas,
  type CanvasFileChange,
} from "./components/GameCanvas";
import type { ShipHoverInfo } from "./game/WorldScene";

type ConnectionState = "connecting" | "online" | "offline";

const websocketUrl =
  import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:4100/ws";
const maxBudgetUsd = Number(import.meta.env.VITE_MAX_BUDGET_USD ?? 1);

/**
 * How long to wait for an edit burst to settle before asking the server to
 * rescan. The agent usually writes several files in a row.
 */
const RESCAN_DEBOUNCE_MS = 1_200;

const EVENTS_STORAGE_PREFIX = "sudo-city:events:";
/** The full quest log for a city; generous since each city keeps its own. */
const EVENTS_PER_CITY_CAP = 200;

function loadStoredEvents(cityId: string): GameEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_PREFIX + cityId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter(
      (item): item is GameEvent => GameEventSchema.safeParse(item).success,
    );
  } catch {
    return [];
  }
}

function cityLabel(city: CitySummary): string {
  return city.kind === "main" ? "main" : city.title;
}

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
      return `${event.tool} permit requested`;
    case "file.changed":
      return `${event.change}: ${event.path}`;
    case "tool.started":
      return `${event.tool}: ${event.target ?? "working"}`;
    case "tool.completed":
      return event.outcome === "success"
        ? "Completed"
        : event.outcome === "denied"
          ? "Denied"
          : "Failed";
    case "subagent.changed":
      return event.agentType ?? "Helper agent";
    case "task.changed":
      return (
        event.subject ??
        (event.status === "completed" ? "Task completed" : "Task created")
      );
    case "compact.changed":
      return event.status === "completed"
        ? "Context compacted"
        : "Compacting context";
    case "diagnostics.updated":
      return `${event.path}: ${event.errors} errors`;
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

function timelineContentForEvent(
  event: GameEvent,
): Pick<QuestTimelineStep, "label" | "markdown" | "tool"> {
  switch (event.type) {
    case "tool.started": {
      const command = event.target ?? "working";
      return {
        tool: event.tool,
        markdown: `\`${event.tool}: ${command}\``,
      };
    }
    case "permit.requested":
      return {
        tool: event.tool,
        markdown: `\`${event.tool}\` permit requested`,
      };
    case "file.changed":
      return {
        markdown: `\`${event.path}\` · ${event.change}`,
      };
    case "session.started":
      return {
        label: `${event.model} crew dispatched`,
      };
    case "subagent.changed":
      return {
        label: event.agentType ?? "Helper agent",
      };
    case "task.changed":
      return {
        label:
          event.subject ??
          (event.status === "completed" ? "Task completed" : "Task created"),
      };
    case "compact.changed":
      return {
        label:
          event.status === "completed"
            ? "Context compacted"
            : "Compacting context",
      };
    case "diagnostics.updated":
      return {
        label: `${event.path}: ${event.errors} errors`,
      };
    default:
      return {
        label: eventLabel(event),
      };
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

function truncatePreview(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength)}...`;
}

function roleDisplayName(role: "agent" | "mayor" | "system"): string {
  switch (role) {
    case "mayor":
      return "Mayor";
    case "agent":
      return "Crew";
    case "system":
      return "System";
    default: {
      const exhaustiveRole: never = role;
      return exhaustiveRole;
    }
  }
}

function isTimelineEvent(event: GameEvent): boolean {
  return (
    event.type !== "session.message" &&
    event.type !== "world.ready" &&
    event.type !== "session.usage"
  );
}

function timelineStepFromEvent(event: GameEvent): QuestTimelineStep {
  const content = timelineContentForEvent(event);

  const step: QuestTimelineStep = {
    id: event.id,
    type: event.type,
    label: content.label,
    markdown: content.markdown,
    tool: content.tool,
    status: questStatus(event),
  };

  if (
    event.type === "permit.requested" ||
    event.type === "tool.started" ||
    event.type === "tool.completed"
  ) {
    step.toolCallId = event.toolCallId;
  }

  return step;
}

function collapseTimelineSteps(steps: QuestTimelineStep[]): QuestTimelineStep[] {
  const result: QuestTimelineStep[] = [];
  const toolSteps = new Map<string, QuestTimelineStep>();

  for (const step of steps) {
    if (step.type === "tool.completed") {
      if (step.toolCallId) {
        const existing = toolSteps.get(step.toolCallId);
        if (existing) {
          existing.status = step.status;
        }
      }
      continue;
    }

    if (
      (step.type === "tool.started" || step.type === "permit.requested") &&
      step.toolCallId
    ) {
      const existing = toolSteps.get(step.toolCallId);
      if (existing) {
        if (step.type === "permit.requested") {
          existing.markdown = step.markdown ?? existing.markdown;
        } else {
          existing.markdown = step.markdown ?? existing.markdown;
          existing.tool = step.tool ?? existing.tool;
        }
        continue;
      }

      toolSteps.set(step.toolCallId, step);
      result.push(step);
      continue;
    }

    if (step.type === "session.started") {
      result.push({ ...step, status: "completed" });
      continue;
    }

    result.push(step);
  }

  return result;
}

function chatQuestStatus(
  role: "agent" | "mayor" | "system",
  timeline: QuestTimelineStep[],
): QuestStatus {
  const completedToolCalls = new Set<string>();

  for (const step of timeline) {
    if (step.type === "tool.completed" && step.toolCallId) {
      completedToolCalls.add(step.toolCallId);
    }
  }

  const hasOpenActivity = timeline.some(
    (step) =>
      (step.type === "permit.requested" || step.type === "tool.started") &&
      step.toolCallId !== undefined &&
      !completedToolCalls.has(step.toolCallId),
  );

  const hasActiveSteps = timeline.some((step) => step.status === "active");

  if (hasOpenActivity || hasActiveSteps) {
    return "active";
  }

  switch (role) {
    case "mayor":
      return "pending";
    case "agent":
    case "system":
      return "completed";
    default: {
      const exhaustiveRole: never = role;
      return exhaustiveRole;
    }
  }
}

function eventsToQuests(events: GameEvent[]): Quest[] {
  const ordered = events.slice().sort((a, b) => a.sequence - b.sequence);
  const messages = ordered.filter(
    (event): event is Extract<GameEvent, { type: "session.message" }> =>
      event.type === "session.message",
  );

  if (messages.length === 0) {
    return [];
  }

  return messages
    .map((message, index) => {
      const previousSequence =
        index > 0 ? messages[index - 1]!.sequence : -1;
      const isLast = index === messages.length - 1;

      const timelineEvents = ordered.filter((event) => {
        if (!isTimelineEvent(event)) {
          return false;
        }

        if (event.sequence <= previousSequence) {
          return false;
        }

        if (isLast) {
          return true;
        }

        return event.sequence <= message.sequence;
      });

      const timeline = collapseTimelineSteps(
        timelineEvents.map(timelineStepFromEvent),
      );
      const description = message.text;

      return {
        id: message.id,
        title: roleDisplayName(message.role),
        description,
        status: chatQuestStatus(message.role, timeline),
        shortDescription: truncatePreview(description),
        role: message.role,
        timeline,
      };
    })
    .reverse();
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
  const { sfxEnabled, toggleSfx } = useAudio();
  const socketRef = useRef<WebSocket>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [activeCityId, setActiveCityId] = useState("main");
  const [eventsByCity, setEventsByCity] = useState<
    Record<string, GameEvent[]>
  >(() => ({ main: loadStoredEvents("main") }));
  const [worldByCity, setWorldByCity] = useState<
    Record<string, WorldSnapshot>
  >({});
  const [overlayByCity, setOverlayByCity] = useState<
    Record<string, PullRequestOverlay>
  >({});
  const [diff, setDiff] = useState<{
    cityId: string;
    path: string;
    patch: string;
  }>();
  const [prompt, setPrompt] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [fileChange, setFileChange] = useState<CanvasFileChange>();
  const [selected, setSelected] = useState<Building>();
  const [shipHover, setShipHover] = useState<ShipHoverInfo>();

  const events = eventsByCity[activeCityId] ?? [];
  const world = worldByCity[activeCityId];
  const overlay = overlayByCity[activeCityId];
  const activeCity = cities.find((city) => city.id === activeCityId);
  const selectedChange = selected
    ? overlay?.files.find((file) => file.path === selected.path)
    : undefined;
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
    // Every city rescans on its own schedule -- an edit burst in one city
    // must not delay or coalesce with another city's rescan.
    const rescanTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    // The agent edits in bursts; one rescan after the burst settles is enough,
    // and the scene diffs the result so standing buildings do not flicker.
    const scheduleRescan = (cityId: string): void => {
      clearTimeout(rescanTimers[cityId]);
      rescanTimers[cityId] = setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "world.request",
              cityId,
            } satisfies MayorCommand),
          );
        }
      }, RESCAN_DEBOUNCE_MS);
    };

    function appendEvent(cityId: string, event: GameEvent): void {
      setEventsByCity((current) => {
        const bucket = current[cityId] ?? [];
        return {
          ...current,
          [cityId]: [
            ...bucket.slice(-(EVENTS_PER_CITY_CAP - 1)),
            event,
          ],
        };
      });
    }

    socket.addEventListener("open", () => setConnection("online"));
    socket.addEventListener("close", () => setConnection("offline"));
    socket.addEventListener("error", () => setConnection("offline"));
    socket.addEventListener("message", (message) => {
      const decoded = ServerMessageSchema.safeParse(
        JSON.parse(String(message.data)) as unknown,
      );
      if (!decoded.success) {
        return;
      }

      if (decoded.data.kind === "cities") {
        setCities(decoded.data.cities);
        return;
      }

      if (decoded.data.kind === "overlay") {
        const overlay = decoded.data.overlay;
        setOverlayByCity((current) => ({
          ...current,
          [overlay.cityId]: overlay,
        }));
        return;
      }

      if (decoded.data.kind === "diff") {
        setDiff(decoded.data);
        return;
      }

      if (decoded.data.kind !== "event") {
        return;
      }

      const event = decoded.data.event;
      appendEvent(event.cityId, event);
      if (event.type === "world.ready") {
        setWorldByCity((current) => ({
          ...current,
          [event.cityId]: event.snapshot,
        }));
      }
      if (event.type === "file.changed") {
        setFileChange({
          id: event.id,
          cityId: event.cityId,
          path: event.path,
          change: event.change,
        });
        scheduleRescan(event.cityId);
      }
    });

    return () => {
      for (const timer of Object.values(rescanTimers)) {
        clearTimeout(timer);
      }
      socket.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    for (const [cityId, bucket] of Object.entries(eventsByCity)) {
      localStorage.setItem(
        EVENTS_STORAGE_PREFIX + cityId,
        JSON.stringify(bucket),
      );
    }
  }, [eventsByCity]);

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

  function travelTo(cityId: string): void {
    setActiveCityId(cityId);
    setSelected(undefined);
    setDiff(undefined);
    setEventsByCity((current) =>
      cityId in current ? current : { ...current, [cityId]: loadStoredEvents(cityId) },
    );
    send({ type: "city.travel", cityId });
  }

  function selectBuilding(building?: Building): void {
    setSelected(building);
    setDiff(undefined);
    const change = building
      ? overlay?.files.find((file) => file.path === building.path)
      : undefined;
    if (building && change && change.change !== "deleted") {
      send({ type: "diff.request", cityId: activeCityId, path: building.path });
    }
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      return;
    }
    send({ type: "session.prompt", cityId: activeCityId, prompt: nextPrompt });
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
            <p className="retro truncate text-[10px] text-muted-foreground">
              {activeCity ? cityLabel(activeCity) : activeCityId} · mayor
              console
              {activeCity?.status === "building" ? " · constructing…" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            sound={false}
            aria-label={sfxEnabled ? "Mute UI sounds" : "Unmute UI sounds"}
            aria-pressed={!sfxEnabled}
            onClick={toggleSfx}
          >
            {sfxEnabled ? (
              <Volume2 className="size-4" aria-hidden="true" />
            ) : (
              <VolumeX className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Badge
            variant={connection === "online" ? "default" : "outline"}
            className="retro text-[10px]"
          >
            {statusLabel(connection)}
          </Badge>
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={72} minSize={45}>
          <div className="flex h-full min-h-0 flex-col">
            <section className="relative min-h-0 flex-1 overflow-hidden">
              <GameCanvas
                cityId={activeCityId}
                world={world}
                overlay={overlay}
                fileChange={fileChange}
                cities={cities}
                onTravel={travelTo}
                onShipHover={setShipHover}
                onSelectBuilding={selectBuilding}
              />
              <div className="pointer-events-none absolute left-4 top-4 border-2 border-foreground bg-card px-3 py-2 dark:border-ring">
                <span className="retro block text-[10px] text-primary">
                  District survey
                </span>
                <strong className="retro block text-xs">
                  {world?.buildings.length ?? 0} structures mapped
                </strong>
              </div>

              {shipHover ? (
                <div
                  className="retro pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border-2 border-foreground bg-card px-2 py-1 text-[10px] text-foreground dark:border-ring"
                  style={{
                    left: shipHover.screenX,
                    top: shipHover.screenY - 12,
                  }}
                >
                  Sail to {shipHover.title}
                </div>
              ) : null}

              {selected ? (
                <div className="absolute bottom-4 left-4 max-w-[min(28rem,calc(100%-2rem))] border-2 border-foreground bg-card px-3 py-2 dark:border-ring">
                  <div className="flex items-start justify-between gap-3">
                    <span className="retro block text-[10px] text-primary">
                      {selected.district}
                    </span>
                    <button
                      type="button"
                      onClick={() => selectBuilding(undefined)}
                      aria-label="Close structure details"
                      className="retro shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="retro mt-1 break-all text-xs">{selected.path}</p>
                  <dl className="retro mt-2 flex gap-4 text-[10px] text-muted-foreground">
                    <div>
                      <dt className="inline">Language </dt>
                      <dd className="inline text-foreground">
                        {selected.language}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Lines </dt>
                      <dd className="inline text-foreground">{selected.loc}</dd>
                    </div>
                    {selectedChange ? (
                      <div>
                        <dt className="inline">PR </dt>
                        <dd className="inline text-foreground">
                          {selectedChange.change}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {selectedChange && selectedChange.change !== "deleted" ? (
                    <div className="mt-2 max-h-64 overflow-auto">
                      {diff &&
                      diff.cityId === activeCityId &&
                      diff.path === selected.path ? (
                        <Markdown className="retro text-[10px]">
                          {`\`\`\`diff\n${diff.patch}\n\`\`\``}
                        </Markdown>
                      ) : (
                        <p className="retro text-[10px] text-muted-foreground">
                          Loading diff…
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-4 right-4 border border-border bg-card/90 px-2 py-1">
                <span className="retro text-[8px] text-muted-foreground">
                  Drag to pan · Scroll to zoom · Click a building
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
                    onClick={() =>
                      send({
                        type: "session.interrupt",
                        cityId: activeCityId,
                      })
                    }
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
          <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l-4 border-foreground bg-card dark:border-ring">
            <div className="flex shrink-0 items-center justify-between border-b-4 border-foreground px-4 py-3 dark:border-ring">
              <span className="retro text-[10px] text-primary">City works</span>
              <Kbd>⌘ K</Kbd>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
              <div className="shrink-0 space-y-4">
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
              </div>

              <QuestLog
                quests={eventsToQuests(events)}
                emptyStateMessage="The radio is quiet."
                className="min-h-0 flex-1"
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
                send({ type: "world.request", cityId: activeCityId });
                setCommandOpen(false);
              }}
            >
              Rescan district
            </CommandItem>
            <CommandItem
              onSelect={() => {
                send({ type: "session.interrupt", cityId: activeCityId });
                setCommandOpen(false);
              }}
            >
              Halt construction
            </CommandItem>
            <CommandItem
              onSelect={() => {
                send({ type: "city.refresh" });
                setCommandOpen(false);
              }}
            >
              Refresh open pull requests
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Travel">
            {cities.map((city) => (
              <CommandItem
                key={city.id}
                disabled={city.id === activeCityId}
                onSelect={() => {
                  travelTo(city.id);
                  setCommandOpen(false);
                }}
              >
                {cityLabel(city)}
                {city.id === activeCityId ? " (current)" : ""}
                {city.status === "building" ? " · building…" : ""}
                {city.status === "failed" ? " · failed" : ""}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
