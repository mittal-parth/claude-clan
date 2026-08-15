import {
  GameEventSchema,
  ServerMessageSchema,
  type Building,
  type CitySummary,
  type CrewPolicy,
  type EffortLevel,
  type GameEvent,
  type Issue,
  type MayorCommand,
  type PermissionMode,
  type PullRequestOverlay,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Command,
  LogOut,
  Plane,
  RefreshCw,
  ShieldAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AuthUser } from "@/auth/gate";
import { demoGatedAction, type DemoAction } from "@/auth/demo-gate";
import { useAudio } from "@/components/audio-provider";
import { Markdown } from "@/components/markdown";
import { ConstructionTracker } from "@/lib/construction-tracker";
import { cn } from "@/lib/utils";
import HudWindow from "@/components/hud/HudWindow";
import HudButton from "@/components/hud/HudButton";
import HudMeter from "@/components/hud/HudMeter";
import {
  readHudState,
  toggleHudPanel,
  writeHudState,
  type HudPanelId,
} from "@/components/hud/hud-state";
import QuestLog, {
  type Quest,
  type QuestStatus,
  type QuestTimelineStep,
} from "@/components/ui/8bit/blocks/quest-log";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/8bit/command";
import {
  colorToCss,
  paletteFor,
} from "./game/palette";
import {
  GameCanvas,
  type CanvasDragPreview,
  type CanvasFileChange,
  type CanvasAirportTravel,
  type CanvasPointerPosition,
  type CanvasTravelRequest,
  type GameCanvasHandle,
} from "./components/GameCanvas";
import type { ShipHoverInfo } from "./game/WorldScene";
import CrewSelectDialog, {
  type CrewSelection,
} from "./components/CrewSelectDialog";
import IssueShopDialog from "@/components/IssueShopDialog";
import SignInDialog from "@/components/SignInDialog";
import ShareCityCard from "./components/ShareCityCard";
import ShareCityModal from "./components/ShareCityModal";
import ShutterFlash from "./components/ShutterFlash";
import {
  CREW_MEMBERS,
  DEFAULT_CREW_ID,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  crewSpriteUrl,
  effortLabel,
  findCrewByModel,
  getCrewMember,
} from "./crew/catalog";

const UNRESTRICTED_POLICY: CrewPolicy = {
  allowedModels: CREW_MEMBERS.map((crew) => crew.model),
  allowedEfforts: [...EFFORT_LEVELS],
  demoInteractive: true,
};

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

/** Two repos can both have a "pr-42" city, so the transcript key is namespaced by repo, not just city id. */
function eventsStorageKey(repoKey: string, cityId: string): string {
  return `${EVENTS_STORAGE_PREFIX}${repoKey}:${cityId}`;
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;

function promptForIssue(issue: Issue): string {
  return [
    `Fix city issue #${issue.number}: ${issue.title}`,
    issue.body ? `Issue details:\n${issue.body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Basename of a repo path → title case words (claude-clan → Claude Clan). */
function titleFromRepoPath(repoPath: string): string {
  const base =
    repoPath.split(/[/\\]/).filter(Boolean).at(-1)?.replace(/[-_]+/g, " ").trim() ??
    "";
  if (!base) {
    return "City";
  }
  return base.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Header brand: `{Repo Name} City`, without doubling a trailing City. */
function cityNameFromRepo(repoPath: string | undefined): string {
  if (!repoPath) {
    return "City";
  }
  const titled = titleFromRepoPath(repoPath);
  if (/\bcity$/i.test(titled)) {
    return titled;
  }
  return `${titled} City`;
}

/**
 * How long a site stands after the work on it actually finishes.
 *
 * The site's lifetime is the work's lifetime: it opens when a tool starts on a
 * file and is held open until that tool completes, so a slow edit keeps its
 * crane for as long as it runs. This is only the tail on the end, so a write
 * that takes 40ms still leaves something up long enough to notice.
 */
const CONSTRUCTION_GRACE_MS = 6_000;

function fileBasename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function fileDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : ".";
}

interface LanguageSummary {
  language: string;
  count: number;
}

function summarizeLanguages(buildings: Building[]): LanguageSummary[] {
  const counts = new Map<string, number>();
  for (const building of buildings) {
    counts.set(building.language, (counts.get(building.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((left, right) =>
      right.count - left.count || left.language.localeCompare(right.language),
    );
}

function colorWithAlpha(color: number, alpha: number): string {
  return `${colorToCss(color)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function loadStoredEvents(repoKey: string, cityId: string): GameEvent[] {
  try {
    const raw = localStorage.getItem(eventsStorageKey(repoKey, cityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter(
      (item): item is GameEvent => GameEventSchema.safeParse(item).success,
    );
  } catch {
    return [];
  }
}

function clearStoredEvents(cityId: string): void {
  localStorage.removeItem(EVENTS_STORAGE_PREFIX + cityId);
}

function cityLabel(city: CitySummary): string {
  return city.kind === "main" ? "main" : city.title;
}

function statusLabel(status: ConnectionState, reconnectAttempt: number): string {
  switch (status) {
    case "connecting":
      return "Linking";
    case "online":
      return "Live";
    case "offline":
      // A free-tier server dyno spinning back up looks identical to a
      // dropped connection from the client's side -- reconnectAttempt only
      // climbs once a retry is already scheduled, so this reads as
      // deliberate progress rather than a stuck error.
      return reconnectAttempt > 0 ? "Waking the city…" : "Offline";
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

function permissionModeLabel(mode: PermissionMode): string {
  return mode === "auto" ? "Don’t Disturb Mayor" : "Mayor approval";
}

function sessionCrewLabel(model: string, effort: EffortLevel): string {
  const crew = findCrewByModel(model);
  const name = crew?.name ?? model;
  return `${name} · ${effortLabel(effort)} effort`;
}

function eventLabel(event: GameEvent): string {
  switch (event.type) {
    case "world.ready":
      return `${event.snapshot.buildings.length} structures surveyed`;
    case "session.started":
      return `${sessionCrewLabel(event.model, event.effort)} · ${permissionModeLabel(event.permissionMode)}`;
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
        label: `${sessionCrewLabel(event.model, event.effort)} · ${permissionModeLabel(event.permissionMode)}`,
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
    case "file.changed":
    case "diagnostics.updated":
      return "completed";
    case "permit.requested":
    case "tool.started":
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

  if (event.type === "task.changed") {
    step.taskId = event.taskId;
  }

  if (event.type === "subagent.changed") {
    step.subagentId = event.subagentId;
  }

  return step;
}

function collapseTimelineSteps(steps: QuestTimelineStep[]): QuestTimelineStep[] {
  const result: QuestTimelineStep[] = [];
  const toolSteps = new Map<string, QuestTimelineStep>();
  const taskSteps = new Map<string, QuestTimelineStep>();
  const subagentSteps = new Map<string, QuestTimelineStep>();
  let compactStep: QuestTimelineStep | undefined;

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
        if (step.type === "tool.started") {
          existing.type = "tool.started";
          existing.markdown = step.markdown ?? existing.markdown;
          existing.tool = step.tool ?? existing.tool;
        } else if (step.type === "permit.requested") {
          existing.markdown = step.markdown ?? existing.markdown;
        }
        continue;
      }

      toolSteps.set(step.toolCallId, step);
      result.push(step);
      continue;
    }

    if (step.type === "task.changed" && step.taskId) {
      if (step.status === "completed") {
        const existing = taskSteps.get(step.taskId);
        if (existing) {
          existing.status = "completed";
          existing.label = step.label ?? existing.label;
        }
        continue;
      }

      const existing = taskSteps.get(step.taskId);
      if (existing) {
        continue;
      }

      taskSteps.set(step.taskId, step);
      result.push(step);
      continue;
    }

    if (step.type === "subagent.changed" && step.subagentId) {
      if (step.status === "completed") {
        const existing = subagentSteps.get(step.subagentId);
        if (existing) {
          existing.status = "completed";
          existing.label = step.label ?? existing.label;
        }
        continue;
      }

      const existing = subagentSteps.get(step.subagentId);
      if (existing) {
        continue;
      }

      subagentSteps.set(step.subagentId, step);
      result.push(step);
      continue;
    }

    if (step.type === "compact.changed") {
      if (step.status === "completed" && compactStep) {
        compactStep.status = "completed";
        continue;
      }

      compactStep = step;
      result.push(step);
      continue;
    }

    if (step.type === "session.started") {
      result.push({ ...step, status: "completed" });
      continue;
    }

    result.push(step);
  }

  return finalizeStalePermitSteps(result);
}

function finalizeStalePermitSteps(
  steps: QuestTimelineStep[],
): QuestTimelineStep[] {
  let sawLaterActivity = false;

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;

    if (
      step.type === "permit.requested" &&
      step.status === "active" &&
      sawLaterActivity
    ) {
      step.status = "completed";
    }

    if (countsAsStalePermitResolution(step)) {
      sawLaterActivity = true;
    }
  }

  return steps;
}

function countsAsStalePermitResolution(step: QuestTimelineStep): boolean {
  if (step.type === "session.message") {
    return true;
  }

  if (step.type === "session.started" || step.type === "permit.requested") {
    return false;
  }

  return step.status === "completed" || step.status === "failed";
}

function isMaxTurnsStopMessage(text: string): boolean {
  return /maximum number of turns/i.test(text);
}

function systemMessageStatus(text: string): QuestStatus {
  if (isMaxTurnsStopMessage(text)) {
    return "completed";
  }

  if (/error|stopped|failed/i.test(text)) {
    return "failed";
  }

  return "completed";
}

function isIgnorableFailureStep(step: QuestTimelineStep): boolean {
  return (
    step.type === "session.message" &&
    step.role === "system" &&
    step.markdown !== undefined &&
    isMaxTurnsStopMessage(step.markdown)
  );
}

function workUnitStatus(timeline: QuestTimelineStep[]): QuestStatus {
  const hasOpenTools = timeline.some(
    (step) =>
      (step.type === "permit.requested" || step.type === "tool.started") &&
      step.status === "active",
  );

  if (hasOpenTools) {
    return "active";
  }

  const hasMeaningfulFailure = timeline.some(
    (step) => step.status === "failed" && !isIgnorableFailureStep(step),
  );

  if (hasMeaningfulFailure) {
    return "failed";
  }

  return "completed";
}

function messageToTimelineStep(
  event: Extract<GameEvent, { type: "session.message" }>,
): QuestTimelineStep {
  return {
    id: event.id,
    type: "session.message",
    role: event.role,
    markdown: event.text,
    status:
      event.role === "system"
        ? systemMessageStatus(event.text)
        : "completed",
  };
}

function eventsToQuests(events: GameEvent[]): Quest[] {
  const ordered = events.slice().sort((a, b) => a.sequence - b.sequence);
  const mayorMessages = ordered.filter(
    (
      event,
    ): event is Extract<GameEvent, { type: "session.message" }> & {
      role: "mayor";
    } => event.type === "session.message" && event.role === "mayor",
  );

  if (mayorMessages.length === 0) {
    return [];
  }

  return mayorMessages.map((mayorMessage, index) => {
    const endSequence =
      index < mayorMessages.length - 1
        ? mayorMessages[index + 1]!.sequence
        : Number.POSITIVE_INFINITY;

    const unitEvents = ordered.filter((event) => {
      if (event.sequence <= mayorMessage.sequence) {
        return false;
      }

      if (event.sequence >= endSequence) {
        return false;
      }

      if (event.type === "world.ready" || event.type === "session.usage") {
        return false;
      }

      if (event.type === "session.message" && event.role === "mayor") {
        return false;
      }

      return true;
    });

    const timeline = collapseTimelineSteps(
      unitEvents.map((event) =>
        event.type === "session.message"
          ? messageToTimelineStep(event)
          : timelineStepFromEvent(event),
      ),
    );
    const description = mayorMessage.text;

    return {
      id: mayorMessage.id,
      title: "Work order",
      description,
      status: workUnitStatus(timeline),
      shortDescription: truncatePreview(description),
      role: "mayor" as const,
      timeline,
    };
  }).reverse();
}

function findPendingPermit(
  events: GameEvent[],
): Extract<GameEvent, { type: "permit.requested" }> | undefined {
  const latestSessionIndex = events.findLastIndex(
    (event) => event.type === "session.started",
  );
  const relevantEvents =
    latestSessionIndex >= 0 ? events.slice(latestSessionIndex) : events;
  const completed = new Set<string>();
  for (const event of relevantEvents.slice().reverse()) {
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

function createLocalPermitDismissal(
  cityId: string,
  toolCallId: string,
  events: GameEvent[],
): Extract<GameEvent, { type: "tool.completed" }> {
  const lastSequence = events.at(-1)?.sequence ?? 0;
  return {
    id: crypto.randomUUID(),
    cityId: cityId as GameEvent["cityId"],
    sessionId: "local",
    sequence: lastSequence + 1,
    timestamp: new Date().toISOString(),
    type: "tool.completed",
    toolCallId,
    outcome: "denied",
  };
}

function pointIsInside(
  element: HTMLElement | null,
  position: CanvasPointerPosition,
): boolean {
  if (!element) {
    return false;
  }

  const bounds = element.getBoundingClientRect();
  return (
    position.clientX >= bounds.left &&
    position.clientX <= bounds.right &&
    position.clientY >= bounds.top &&
    position.clientY <= bounds.bottom
  );
}

export interface AppProps {
  /** "demo", or an owner/name repo key the signed-in user imported. */
  activeRepoKey: string;
  /** The sealed session token, sent as the WS's first frame; absent in demo mode. */
  sessionToken?: string;
  user?: AuthUser;
  repoConnectionGeneration: number;
  /** Keeps the real demo canvas mounted behind the login card. */
  loginBackground?: boolean;
  /** Keeps the city visually staged while the login cover hands off to it. */
  initialReveal?: boolean;
  onInitialRevealReady?: () => void;
  onInitialRevealComplete?: () => void;
  airportTravel?: CanvasAirportTravel;
  airportArrival?: CanvasAirportTravel;
  onOpenAirport: () => void;
  onAirportTravelCovered: (travel: CanvasAirportTravel) => void;
  onAirportArrivalComplete: (travel: CanvasAirportTravel) => void;
  onRetryAirportArrival: (travel: CanvasAirportTravel) => void;
  onLogout: () => void;
  onSignIn: () => void;
}

export default function App({
  activeRepoKey,
  sessionToken,
  user,
  repoConnectionGeneration,
  loginBackground = false,
  initialReveal = false,
  onInitialRevealReady,
  onInitialRevealComplete,
  airportTravel,
  airportArrival,
  onOpenAirport,
  onAirportTravelCovered,
  onAirportArrivalComplete,
  onRetryAirportArrival,
  onLogout,
  onSignIn,
}: AppProps) {
  const { sfxEnabled, toggleSfx } = useAudio();
  const socketRef = useRef<WebSocket>(null);
  const canvasRef = useRef<GameCanvasHandle>(null);
  const orderFormRef = useRef<HTMLFormElement>(null);
  const initialRevealReadyRef = useRef(false);
  const initialRevealTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const initialRevealReadyCallbackRef = useRef(onInitialRevealReady);
  const initialRevealCompleteCallbackRef = useRef(onInitialRevealComplete);
  initialRevealReadyCallbackRef.current = onInitialRevealReady;
  initialRevealCompleteCallbackRef.current = onInitialRevealComplete;
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [activeCityId, setActiveCityId] = useState("main");
  const [eventsByCity, setEventsByCity] = useState<
    Record<string, GameEvent[]>
  >(() => ({ main: loadStoredEvents(activeRepoKey, "main") }));
  const [worldByCity, setWorldByCity] = useState<
    Record<string, WorldSnapshot>
  >({});
  /** Prevents an outgoing repository's cached map from being revealed as an arrival. */
  const [worldRepoKey, setWorldRepoKey] = useState<string>();
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
  const [draggingBuilding, setDraggingBuilding] = useState<Building>();
  const [dragPreview, setDragPreview] = useState<CanvasDragPreview>();
  const [dragPosition, setDragPosition] =
    useState<CanvasPointerPosition>();
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [orderPermissionMode, setOrderPermissionMode] =
    useState<PermissionMode>("default");
  const [crewSelection, setCrewSelection] = useState<CrewSelection>({
    crewId: DEFAULT_CREW_ID,
    effort: DEFAULT_EFFORT,
  });
  // Everything is on duty until the server says otherwise; its policy message
  // is the first thing it sends after the socket opens.
  const [crewPolicy, setCrewPolicy] = useState<CrewPolicy>(UNRESTRICTED_POLICY);
  /** The action a visitor reached for in the demo city; opens the sign-in modal. */
  const [signInAction, setSignInAction] = useState<string>();
  const [crewDialogOpen, setCrewDialogOpen] = useState(false);
  const [hud, setHud] = useState(readHudState);
  const [fileChange, setFileChange] = useState<CanvasFileChange>();
  const [buildingPaths, setBuildingPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<Building>();
  const [shipHover, setShipHover] = useState<ShipHoverInfo>();
  const [shipTravelTargetId, setShipTravelTargetId] = useState<string>();
  const [shipTransitioning, setShipTransitioning] = useState(false);
  const [issueShopOpen, setIssueShopOpen] = useState(false);
  const [issueTravelRequest, setIssueTravelRequest] =
    useState<CanvasTravelRequest>();
  const [issueBeingFixed, setIssueBeingFixed] = useState<Issue>();
  const [airportArrivalDelayed, setAirportArrivalDelayed] = useState(false);
  const [initialRevealReady, setInitialRevealReady] = useState(false);
  const [initialRevealComplete, setInitialRevealComplete] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const [isFlashingShutter, setIsFlashingShutter] = useState(false);

  const handleTakeSnapshot = async () => {
    if (isCapturingSnapshot || !canvasRef.current) return;
    setIsCapturingSnapshot(true);
    setIsFlashingShutter(true);

    try {
      const url = await canvasRef.current.captureScreenshot();
      setScreenshotUrl(url);
      setShareModalOpen(true);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingSnapshot(false);
    }
  };

  const events = eventsByCity[activeCityId] ?? [];
  const world = worldRepoKey === activeRepoKey ? worldByCity[activeCityId] : undefined;
  const overlay = overlayByCity[activeCityId];

  useEffect(() => {
    if (!initialReveal) {
      initialRevealReadyRef.current = false;
      setInitialRevealReady(false);
      if (initialRevealTimerRef.current !== undefined) {
        clearTimeout(initialRevealTimerRef.current);
        initialRevealTimerRef.current = undefined;
      }
      return;
    }

    setInitialRevealComplete(false);
    return () => {
      if (initialRevealTimerRef.current !== undefined) {
        clearTimeout(initialRevealTimerRef.current);
        initialRevealTimerRef.current = undefined;
      }
    };
  }, [initialReveal]);

  function notifyInitialRevealReady(): void {
    if (!initialReveal || initialRevealReadyRef.current) return;

    initialRevealReadyRef.current = true;
    setInitialRevealReady(true);
    initialRevealReadyCallbackRef.current?.();
    initialRevealTimerRef.current = setTimeout(() => {
      initialRevealTimerRef.current = undefined;
      setInitialRevealComplete(true);
      initialRevealCompleteCallbackRef.current?.();
    }, 1_100);
  }
  const activeCity = cities.find((city) => city.id === activeCityId);
  const selectedChange = selected
    ? overlay?.files.find((file) => file.path === selected.path)
    : undefined;
  const languageSummary = world ? summarizeLanguages(world.buildings) : [];
  const selectedPalette = paletteFor(selected?.language ?? "unknown");
  const draggingPalette = paletteFor(draggingBuilding?.language ?? "unknown");
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
  const selectedCrew = getCrewMember(crewSelection.crewId);
  // In the demo city these controls stay live and answer with a sign-in
  // prompt, rather than sitting greyed out: someone reaching for the crew is
  // exactly who the account is for.
  const demoLocked = activeRepoKey === "demo" && !crewPolicy.demoInteractive;
  const activeCrew =
    startedSession?.type === "session.started"
      ? (findCrewByModel(startedSession.model) ?? selectedCrew)
      : selectedCrew;
  const activeEffort =
    startedSession?.type === "session.started"
      ? startedSession.effort
      : crewSelection.effort;
  const crewAvatarSrc = crewSpriteUrl(activeCrew.id, activeEffort);
  const crewStatus = pendingPermit
    ? "Awaiting permit stamp"
    : `${effortLabel(activeEffort)} effort · ${activeCrew.title}`;
  const quests = eventsToQuests(events);
  const activeQuestCount = quests.filter(
    (quest) => quest.status === "active",
  ).length;
  // No snapshot yet is a survey still in flight, not an empty city.
  const surveying = !world && connection !== "offline";
  const showDragPreview = Boolean(
    draggingBuilding &&
      dragPreview?.src &&
      dragPosition &&
      pointIsInside(orderFormRef.current, dragPosition),
  );
  // A PR city is checked out under .sudocity/worktrees/pr-<n>, so deriving its
  // name from the repo path would brand the console "Pr 10 City". Only main is
  // named after the repo; a PR city is named after its pull request.
  const cityName =
    activeCity && activeCity.kind === "pull-request"
      ? cityLabel(activeCity)
      : cityNameFromRepo(world?.repoPath);
  const cityStatusLine =
    activeCity?.status === "building"
      ? "constructing…"
      : activeCity && activeCity.kind === "pull-request"
        ? activeCity.ref
        : world?.repoPath
          ? fileBasename(world.repoPath)
          : "linking";

  useEffect(() => {
    // A repo switch is a full reconnect: the previous socket was viewing a
    // different workspace entirely, and every city-keyed piece of state
    // (cities, issues, worlds, overlays, the active city itself) belongs to
    // that departing repo, not this one.
    setCities([]);
    setIssues([]);
    setWorldByCity({});
    setWorldRepoKey(undefined);
    setOverlayByCity({});
    setActiveCityId("main");
    setSelected(undefined);
    setDiff(undefined);
    setFileChange(undefined);
    setBuildingPaths([]);
    setShipHover(undefined);
    setShipTravelTargetId(undefined);
    setIssueShopOpen(false);
    setIssueTravelRequest(undefined);
    setIssueBeingFixed(undefined);
    setDraggingBuilding(undefined);
    setDragPreview(undefined);
    setDragPosition(undefined);
    setContextPaths([]);
    setEventsByCity({ main: loadStoredEvents(activeRepoKey, "main") });
    setConnection("connecting");
    setReconnectAttempt(0);

    let torndown = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    // Every city rescans on its own schedule -- an edit burst in one city
    // must not delay or coalesce with another city's rescan.
    const rescanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
    const sites = new ConstructionTracker({
      graceMs: CONSTRUCTION_GRACE_MS,
      onChange: setBuildingPaths,
    });

    function appendEvent(cityId: string, event: GameEvent): void {
      setEventsByCity((current) => {
        const bucket = current[cityId] ?? [];
        return {
          ...current,
          [cityId]: [...bucket.slice(-(EVENTS_PER_CITY_CAP - 1)), event],
        };
      });
    }

    function connect(): void {
      if (torndown) {
        return;
      }
      const ws = new WebSocket(websocketUrl);
      socket = ws;
      socketRef.current = ws;

      // The agent edits in bursts; one rescan after the burst settles is
      // enough, and the scene diffs the result so standing buildings don't
      // flicker.
      const scheduleRescan = (cityId: string): void => {
        clearTimeout(rescanTimers[cityId]);
        rescanTimers[cityId] = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "world.request", cityId } satisfies MayorCommand));
          }
        }, RESCAN_DEBOUNCE_MS);
      };

      ws.addEventListener("open", () => {
        attempt = 0;
        setReconnectAttempt(0);
        setConnection("online");
        if (sessionToken) {
          ws.send(JSON.stringify({ type: "session.auth", token: sessionToken } satisfies MayorCommand));
        }
        ws.send(JSON.stringify({ type: "repo.select", repoKey: activeRepoKey } satisfies MayorCommand));
      });
      // Render's free tier spins the dyno down after inactivity, so the
      // first visit after a quiet period drops the socket -- reconnect with
      // backoff rather than treating "offline" as final.
      ws.addEventListener("close", () => {
        if (torndown) {
          return;
        }
        setConnection("offline");
        attempt += 1;
        setReconnectAttempt(attempt);
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
          RECONNECT_MAX_DELAY_MS,
        );
        reconnectTimer = setTimeout(connect, delay);
      });
      ws.addEventListener("error", () => ws.close());
      ws.addEventListener("message", (message) => {
        if (torndown || socket !== ws) return;
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

        if (decoded.data.kind === "issues") {
          setIssues(decoded.data.issues);
          return;
        }

        if (decoded.data.kind === "policy") {
          const policy = decoded.data.policy;
          setCrewPolicy(policy);
          // A selection made before the policy arrived (or restored from a
          // server that allowed more) would otherwise sit in the HUD looking
          // dispatchable and be rejected on submit.
          setCrewSelection((current) => ({
            crewId: policy.allowedModels.includes(
              getCrewMember(current.crewId).model,
            )
              ? current.crewId
              : DEFAULT_CREW_ID,
            effort: policy.allowedEfforts.includes(current.effort)
              ? current.effort
              : DEFAULT_EFFORT,
          }));
          return;
        }

        if (decoded.data.kind === "error") {
          // Backstop: if any path reaches the server without the HUD having
          // caught it, the refusal still surfaces as the sign-in prompt
          // rather than vanishing silently.
          if (decoded.data.code === "SIGN_IN_REQUIRED") {
            setSignInAction((current) => current ?? "keep building");
            return;
          }
          if (
            decoded.data.code === "PERMIT_NOT_FOUND" &&
            decoded.data.toolCallId
          ) {
            const toolCallId = decoded.data.toolCallId;
            setEventsByCity((current) => {
              for (const [cityId, bucket] of Object.entries(current)) {
                if (
                  bucket.some(
                    (event) =>
                      event.type === "permit.requested" &&
                      event.toolCallId === toolCallId,
                  )
                ) {
                  return {
                    ...current,
                    [cityId]: [
                      ...bucket,
                      createLocalPermitDismissal(cityId, toolCallId, bucket),
                    ],
                  };
                }
              }
              return current;
            });
          }
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
          setWorldRepoKey(activeRepoKey);
        }
        if (event.type === "file.changed") {
          setFileChange({
            id: event.id,
            cityId: event.cityId,
            path: event.path,
            change: event.change,
          });
          // Covers a change with no tool behind it; a tool-driven one is
          // already held open by its own hold.
          sites.start(event.path);
          scheduleRescan(event.cityId);
        }
        // A tool's target is the earliest signal that work has started — the
        // crane goes up before the file is written, and stays up while the
        // tool runs. Targets that are not a building path (a shell command,
        // say) simply match no building.
        if (event.type === "tool.started" && event.target) {
          sites.start(event.target, event.toolCallId);
        }
        if (event.type === "tool.completed") {
          sites.finish(event.toolCallId);
        }
      });
    }

    connect();

    return () => {
      torndown = true;
      clearTimeout(reconnectTimer);
      for (const timer of Object.values(rescanTimers)) {
        clearTimeout(timer);
      }
      sites.dispose();
      socket?.close();
      socketRef.current = null;
    };
  }, [activeRepoKey, sessionToken, repoConnectionGeneration]);

  useEffect(() => {
    setAirportArrivalDelayed(false);
    if (!airportArrival || world) return;
    const timer = window.setTimeout(() => setAirportArrivalDelayed(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [airportArrival, world]);

  useEffect(() => {
    for (const [cityId, bucket] of Object.entries(eventsByCity)) {
      try {
        localStorage.setItem(eventsStorageKey(activeRepoKey, cityId), JSON.stringify(bucket));
      } catch {
        // A world.ready event carries the full building list, so a large
        // enough repo can blow the quota on its own -- losing the on-disk
        // transcript for this tick isn't worth crashing the render tree
        // over (uncaught here, this throw propagates out of the effect and
        // takes down the whole component with no error boundary to catch it).
      }
    }
  }, [activeRepoKey, eventsByCity]);

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

  useEffect(() => {
    writeHudState(hud);
  }, [hud]);

  function toggleHud(id: HudPanelId): void {
    setHud((current) => toggleHudPanel(current, id));
  }

  function send(command: MayorCommand): void {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(command));
    }
  }

  function clearTransmissions(): void {
    setEventsByCity((current) => ({
      ...current,
      [activeCityId]: [],
    }));
    clearStoredEvents(activeCityId);
  }

  /** Opens the sign-in modal and reports whether the action should stop here. */
  function blockedByDemoGate(action: DemoAction): boolean {
    const gated = demoGatedAction({ ...action, demoLocked });
    if (!gated) {
      return false;
    }
    setSignInAction(gated);
    return true;
  }

  function resolvePermit(toolCallId: string, decision: "allow" | "deny"): void {
    if (blockedByDemoGate({ action: "permit" })) {
      return;
    }
    send({ type: "permit.resolve", toolCallId, decision });
  }

  function travelTo(cityId: string): void {
    if (blockedByDemoGate({ action: "travel", cityId })) {
      return;
    }
    setActiveCityId(cityId);
    setSelected(undefined);
    setDiff(undefined);
    setEventsByCity((current) =>
      cityId in current ? current : { ...current, [cityId]: loadStoredEvents(activeRepoKey, cityId) },
    );
    send({ type: "city.travel", cityId });
  }

  function requestShipTravel(cityId: string): void {
    if (blockedByDemoGate({ action: "travel", cityId })) {
      return;
    }
    // Keep activeCityId on the departing city until the canvas has covered it
    // in clouds. This prevents a cached PR snapshot from replacing the ship
    // before its departure animation can be seen.
    setShipTravelTargetId(cityId);
    setSelected(undefined);
    setDiff(undefined);
    setEventsByCity((current) =>
      cityId in current ? current : { ...current, [cityId]: loadStoredEvents(activeRepoKey, cityId) },
    );
    send({ type: "city.travel", cityId });
  }

  function completeShipTravel(cityId: string): void {
    setActiveCityId(cityId);
    setShipTravelTargetId(undefined);
    if (issueBeingFixed && cityId === `issue-${issueBeingFixed.number}`) {
      // Deliberately do not send this prompt. It is a ready-to-review draft
      // in Mayor's order, exactly as if the mayor had typed it themselves.
      setPrompt(promptForIssue(issueBeingFixed));
      setIssueBeingFixed(undefined);
    }
  }

  function takeIssueToFix(issue: Issue): void {
    // Caught here rather than at the travel call below, so the prompt appears
    // on the click instead of after the ship has already set sail.
    if (blockedByDemoGate({ action: "issue" })) {
      setIssueShopOpen(false);
      return;
    }
    setIssueShopOpen(false);
    setIssueBeingFixed(issue);
    setIssueTravelRequest({
      id: `issue-${issue.number}-${Date.now()}`,
      cityId: `issue-${issue.number}`,
    });
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

  function handleBuildingDragStart(
    building: Building,
    preview?: CanvasDragPreview,
  ): void {
    setDraggingBuilding(building);
    setDragPreview(preview);
    setDragPosition(undefined);
  }

  function handleBuildingDragMove(position: CanvasPointerPosition): void {
    setDragPosition(position);
  }

  function handleBuildingDrop(
    building: Building,
    position: CanvasPointerPosition,
  ): void {
    setDraggingBuilding(undefined);
    setDragPreview(undefined);
    setDragPosition(undefined);
    if (!pointIsInside(orderFormRef.current, position)) {
      return;
    }

    setContextPaths((current) =>
      current.includes(building.path) ? current : [...current, building.path],
    );
  }

  function removeContextPath(path: string): void {
    setContextPaths((current) => current.filter((item) => item !== path));
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      return;
    }
    if (blockedByDemoGate({ action: "dispatch" })) {
      return;
    }
    send({
      type: "session.prompt",
      cityId: activeCityId,
      prompt: nextPrompt,
      permissionMode: orderPermissionMode,
      model: getCrewMember(crewSelection.crewId).model,
      effort: crewSelection.effort,
      contextPaths,
    });
    setPrompt("");
    setContextPaths([]);
    setOrderPermissionMode("default");
  }
  return (
    <div
      className={cn(
        "hud-root",
        loginBackground && "hud-root--login-background",
        initialRevealComplete && "hud-root--reveal-complete",
        initialReveal && !initialRevealReady && "hud-root--handoff-loading",
        initialReveal && initialRevealReady && "hud-root--initializing",
        initialReveal && initialRevealReady && world && "hud-root--revealing",
      )}
    >
      {showDragPreview && dragPreview && dragPosition ? (
        <img
          src={dragPreview.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none fixed z-[100] select-none"
          style={{
            left: dragPosition.clientX,
            top: dragPosition.clientY,
            transform: "translate(-50%, -100%)",
            opacity: 0.48,
            width: 32,
            height: "auto",
            imageRendering: "pixelated",
          }}
        />
      ) : null}
      <GameCanvas
        ref={canvasRef}
        cityId={activeCityId}
        worldKey={activeRepoKey}
        world={world}
        onInitialWorldReady={
          initialReveal ? notifyInitialRevealReady : undefined
        }
        overlay={overlay}
        travelCityId={shipTravelTargetId}
        travelWorld={
          shipTravelTargetId ? worldByCity[shipTravelTargetId] : undefined
        }
        travelOverlay={
          shipTravelTargetId ? overlayByCity[shipTravelTargetId] : undefined
        }
        fileChange={fileChange}
        cities={cities}
        buildingPaths={buildingPaths}
        crewSprite={crewAvatarSrc}
        issues={issues}
        travelRequest={issueTravelRequest}
        airportTravel={airportTravel}
        airportArrival={airportArrival}
        onTravelRequest={requestShipTravel}
        onTravelComplete={completeShipTravel}
        onTravelTransitionChange={setShipTransitioning}
        onAirportTravelCovered={onAirportTravelCovered}
        onAirportArrivalComplete={onAirportArrivalComplete}
        onAirportClick={() => {
          if (!shipTransitioning) onOpenAirport();
        }}
        onAirportHover={setShipHover}
        onIssueShopClick={() => {
          setSelected(undefined);
          setDiff(undefined);
          setIssueShopOpen(true);
        }}
        onShipHover={setShipHover}
        onSelectBuilding={selectBuilding}
        onBuildingDragStart={handleBuildingDragStart}
        onBuildingDragMove={handleBuildingDragMove}
        onBuildingDragEnd={handleBuildingDrop}
      />

      <IssueShopDialog
        open={issueShopOpen}
        onOpenChange={setIssueShopOpen}
        issues={issues}
        activeCityId={activeCityId}
        onTakeIssue={takeIssueToFix}
      />

      {shipHover ? (
        <div
          className="pointer-events-none absolute z-30 min-w-max -translate-x-1/2 -translate-y-full border border-white/20 bg-[#081923]/95 px-3 py-2 text-left text-white shadow-xl backdrop-blur-sm"
          style={{ left: shipHover.screenX, top: shipHover.screenY - 12 }}
        >
          <span className="retro block text-[8px] text-amber-200">{shipHover.title}</span>
          <span className="mt-1 block text-[10px] text-sky-100/65">{shipHover.action}</span>
        </div>
      ) : null}

      <div aria-hidden="true" className="hud-vignette" />

      {airportArrival && !world ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 border border-sky-100/20 bg-[#081923]/92 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
            <span className="airport-icon-grid shrink-0">
              <Plane className="size-4 animate-pulse" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="retro truncate text-[8px] text-amber-200">
                ARRIVING · {airportArrival.destinationKey}
              </p>
              <p className="mt-1 text-[10px] text-sky-100/60">
                {airportArrivalDelayed
                  ? "The destination survey is taking longer than expected."
                  : "Cloud cover holding while the destination city is surveyed…"}
              </p>
            </div>
            {airportArrivalDelayed ? (
              <HudButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRetryAirportArrival(airportArrival)}
              >
                <RefreshCw className="mr-1 size-3" aria-hidden="true" /> retry
              </HudButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The canvas whiteout owns the screen while a ship is sailing; the
          HUD would otherwise float over clouds describing the city being
          left behind. */}
      <div className="hud-layer" hidden={shipTransitioning}>
        <div className="hud-column hud-column--main">
          <HudWindow
            id="hud-scan"
            title="City scan"
            hint={surveying ? "surveying" : world ? "live" : "offline"}
            expanded={hud.scan}
            onToggle={() => toggleHud("scan")}
            className="w-[min(20rem,100%)]"
            meta={
              <span
                className={cn("hud-pill", !world && "hud-pill--muted")}
              >
                <span
                  aria-hidden="true"
                  className={cn("hud-dot", world && "hud-dot--live")}
                />
                {world ? "synced" : surveying ? "linking" : "no link"}
              </span>
            }
          >
            <div className="grid gap-2 p-2.5">
              <div className="flex items-baseline gap-2">
                <span className="hud-figure retro">
                  {world ? world.buildings.length : "—"}
                </span>
                <span className="hud-label flex-1">structures mapped</span>
                <span className="hud-label">
                  {languageSummary.length} types
                </span>
              </div>

              {surveying ? (
                <div className="hud-scanline" aria-label="Surveying district" />
              ) : null}

              {languageSummary.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {languageSummary.slice(0, 8).map(({ language, count }) => {
                    const palette = paletteFor(language);
                    return (
                      <span
                        key={language}
                        title={`${count} ${language} structures`}
                        className="retro inline-flex items-center gap-1 border px-1 py-0.5 text-[8px]"
                        style={{
                          backgroundColor: colorWithAlpha(palette.accent, 0.14),
                          borderColor: colorWithAlpha(palette.accent, 0.6),
                          color: colorToCss(palette.accent),
                        }}
                      >
                        <span>{palette.mark}</span>
                        <span className="text-foreground/75">{count}</span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </HudWindow>

          {/* Share Repo City card right under City scan card */}
          <ShareCityCard
            onSnapshot={handleTakeSnapshot}
            isCapturing={isCapturingSnapshot}
          />

          <div className="flex-1" />

          {selected ? (
            <HudWindow
              id="hud-inspector"
              title={fileBasename(selected.path)}
              hint={selected.language}
              accent={colorToCss(selectedPalette.accent)}
              expanded={hud.inspector}
              onToggle={() => toggleHud("inspector")}
              className="w-[min(22rem,100%)]"
              icon={
                <span
                  className="hud-mark retro size-[18px] text-[8px]"
                  style={{
                    backgroundColor: colorToCss(selectedPalette.accent),
                    borderColor: colorToCss(selectedPalette.accentDark),
                    color: colorToCss(selectedPalette.ink),
                  }}
                >
                  {selectedPalette.mark}
                </span>
              }
              actions={
                <button
                  type="button"
                  className="hud-icon-button"
                  aria-label="Close structure details"
                  title="Close"
                  onClick={() => selectBuilding(undefined)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              }
            >
              <div className="grid gap-2 p-2.5">
                <code className="retro block truncate text-[9px] text-muted-foreground">
                  {fileDirname(selected.path)}
                </code>
                <dl className="retro flex flex-wrap gap-1.5 text-[9px]">
                  <div className="border border-border/60 bg-background/30 px-1.5 py-1">
                    <dt className="inline text-[7px] text-muted-foreground">
                      LINES{" "}
                    </dt>
                    <dd className="inline text-foreground">
                      {selected.loc.toLocaleString()}
                    </dd>
                  </div>
                  <div className="border border-border/60 bg-background/30 px-1.5 py-1">
                    <dt className="inline text-[7px] text-muted-foreground">
                      TYPE{" "}
                    </dt>
                    <dd
                      className="inline"
                      style={{ color: colorToCss(selectedPalette.accent) }}
                    >
                      {selected.language}
                    </dd>
                  </div>
                  {selectedChange ? (
                    <div className="border border-border/60 bg-background/30 px-1.5 py-1">
                      <dt className="inline text-[7px] text-muted-foreground">
                        IN THIS PR{" "}
                      </dt>
                      <dd className="inline text-foreground">
                        {selectedChange.change}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {selectedChange && selectedChange.change !== "deleted" ? (
                  <div className="max-h-64 overflow-auto border-t border-border/50 pt-2">
                    {diff &&
                    diff.cityId === activeCityId &&
                    diff.path === selected.path ? (
                      <Markdown className="retro text-[9px]">
                        {`\`\`\`diff\n${diff.patch}\n\`\`\``}
                      </Markdown>
                    ) : (
                      <p className="retro text-[9px] text-muted-foreground">
                        Loading diff…
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </HudWindow>
          ) : (
            <p className="hud-caption retro">
              Drag to pan · Scroll to zoom · Click a building
            </p>
          )}

          <form
            ref={orderFormRef}
            onSubmit={submitPrompt}
            className={cn(
              "hud-form w-[min(34rem,100%)]",
              draggingBuilding && "is-drop-target",
            )}
          >
            <HudWindow
              id="hud-order"
              title="Mayor's order"
              hint={draggingBuilding ? "drop to attach" : undefined}
              expanded={hud.order}
              onToggle={() => toggleHud("order")}
              bodyClassName="grid gap-2 p-2.5"
              meta={
                contextPaths.length > 0 ? (
                  <span className="hud-pill">
                    {contextPaths.length} in context
                  </span>
                ) : null
              }
              persistent={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="hud-field min-w-0 flex-1">
                    <span aria-hidden="true" className="hud-field__caret">
                      ❯
                    </span>
                    <input
                      id="mayor-prompt"
                      className="hud-field__input retro"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="What should the crew build?"
                      aria-label="Mayor's order"
                      autoComplete="off"
                      disabled={connection !== "online"}
                    />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <HudButton
                      type="submit"
                      size="sm"
                      disabled={connection !== "online" || !prompt.trim()}
                    >
                      Dispatch
                    </HudButton>
                    <HudButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        send({
                          type: "session.interrupt",
                          cityId: activeCityId,
                        })
                      }
                      disabled={connection !== "online"}
                    >
                      Halt
                    </HudButton>
                  </div>
                </div>
              }
            >
              {demoLocked ? (
                <p className="retro text-[8px] leading-relaxed text-muted-foreground">
                  You're touring the demo city — dispatching a crew needs an
                  account.
                </p>
              ) : null}

              {draggingBuilding ? (
                <div
                  className="flex items-center gap-2 border px-2 py-1.5"
                  style={{
                    backgroundColor: colorWithAlpha(draggingPalette.accent, 0.14),
                    borderColor: colorWithAlpha(draggingPalette.accent, 0.7),
                  }}
                >
                  <span
                    className="hud-mark retro size-5 text-[8px]"
                    style={{
                      backgroundColor: colorToCss(draggingPalette.accent),
                      borderColor: colorToCss(draggingPalette.accentDark),
                      color: colorToCss(draggingPalette.ink),
                    }}
                  >
                    {draggingPalette.mark}
                  </span>
                  <code className="retro min-w-0 flex-1 truncate text-[9px] text-foreground">
                    {draggingBuilding.path}
                  </code>
                </div>
              ) : null}

              {contextPaths.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {contextPaths.map((path) => {
                    const contextBuilding = world?.buildings.find(
                      (building) => building.path === path,
                    );
                    const palette = paletteFor(
                      contextBuilding?.language ?? "unknown",
                    );
                    return (
                      <button
                        key={path}
                        type="button"
                        title={`Remove ${path} from context`}
                        onClick={() => removeContextPath(path)}
                        className="retro inline-flex max-w-full items-center gap-1.5 border px-1.5 py-1 text-left text-[8px] transition-colors hover:border-primary"
                        style={{
                          backgroundColor: colorWithAlpha(palette.accent, 0.12),
                          borderColor: colorWithAlpha(palette.accent, 0.6),
                        }}
                      >
                        <span
                          className="hud-mark size-3.5 text-[7px]"
                          style={{
                            backgroundColor: colorToCss(palette.accent),
                            borderColor: colorToCss(palette.accentDark),
                            color: colorToCss(palette.ink),
                          }}
                        >
                          {palette.mark}
                        </span>
                        <span className="max-w-[14rem] truncate text-foreground">
                          {path}
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground">
                          ×
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="hud-label">Crew</span>
                <HudButton
                  type="button"
                  size="auto"
                  variant="outline"
                  disabled={connection !== "online"}
                  onClick={() => setCrewDialogOpen(true)}
                  className="justify-start gap-2 text-left"
                >
                  <img
                    src={crewSpriteUrl(
                      crewSelection.crewId,
                      crewSelection.effort,
                    )}
                    alt=""
                    className="size-6 object-contain [image-rendering:pixelated]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[8px] text-primary">
                      {getCrewMember(crewSelection.crewId).name}
                    </span>
                    <span className="block text-[8px] text-muted-foreground">
                      {effortLabel(crewSelection.effort)} effort
                    </span>
                  </span>
                </HudButton>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="hud-label">Permissions</span>
                <div
                  className="flex gap-1.5"
                  role="group"
                  aria-label="Permission mode for this order"
                >
                  <HudButton
                    type="button"
                    size="sm"
                    variant={
                      orderPermissionMode === "default" ? "primary" : "outline"
                    }
                    aria-pressed={orderPermissionMode === "default"}
                    onClick={() => setOrderPermissionMode("default")}
                    disabled={connection !== "online"}
                  >
                    Ask Mayor
                  </HudButton>
                  <HudButton
                    type="button"
                    size="sm"
                    variant={
                      orderPermissionMode === "auto" ? "primary" : "outline"
                    }
                    aria-pressed={orderPermissionMode === "auto"}
                    onClick={() => setOrderPermissionMode("auto")}
                    disabled={connection !== "online"}
                  >
                    Don&apos;t Disturb
                  </HudButton>
                </div>
              </div>

              <p className="retro text-[8px] leading-relaxed text-muted-foreground">
                {orderPermissionMode === "auto"
                  ? "Auto mode applies only to this order."
                  : "Default mode pauses for your approval."}
              </p>
            </HudWindow>
          </form>
        </div>

        <div className="hud-column hud-column--console">
          <HudWindow
            id="hud-console"
            title={cityName}
            fill
            expanded={hud.console}
            onToggle={() => toggleHud("console")}
            bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5"
            meta={
              <span
                className={cn(
                  "hud-pill",
                  connection !== "online" && "hud-pill--muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "hud-dot",
                    connection === "online" && "hud-dot--live",
                  )}
                />
                {statusLabel(connection, reconnectAttempt)}
              </span>
            }
            actions={
              <>
                {user ? (
                  <>
                    <img
                      src={user.avatarUrl}
                      alt={user.login}
                      title={user.login}
                      className="size-5 rounded-none border-2 border-foreground dark:border-ring"
                    />
                    <button
                      type="button"
                      className="hud-icon-button"
                      aria-label="Sign out"
                      title="Sign out"
                      onClick={onLogout}
                    >
                      <LogOut className="size-3" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <button type="button" className="hud-pill retro" onClick={onSignIn}>
                    SIGN IN
                  </button>
                )}
                <button
                  type="button"
                  className="hud-icon-button"
                  aria-label={sfxEnabled ? "Mute sound" : "Unmute sound"}
                  aria-pressed={!sfxEnabled}
                  title={sfxEnabled ? "Mute sound" : "Unmute sound"}
                  onClick={toggleSfx}
                >
                  {sfxEnabled ? (
                    <Volume2 className="size-3" aria-hidden="true" />
                  ) : (
                    <VolumeX className="size-3" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="hud-icon-button retro gap-0.5 px-1 text-[8px]"
                  aria-label="Open the command palette"
                  title="Command palette (⌘K)"
                  onClick={() => setCommandOpen(true)}
                >
                  <Command className="size-2.5" aria-hidden="true" />K
                </button>
              </>
            }
            footer={
              <div className="flex items-center justify-between gap-2">
                <span className="hud-label">
                  Permits · {orderPermissionMode === "auto" ? "auto" : "mayor"}
                </span>
                <span className="hud-label">
                  {world?.buildings.length ?? 0} structures ·{" "}
                  {languageSummary.length} types
                </span>
              </div>
            }
          >
            <div className="hud-masthead justify-between">
              <div className="min-w-0">
                <h1 className="hud-masthead__name retro">{cityName}</h1>
                <p className="hud-masthead__sub retro">
                  {cityStatusLine} · mayor console
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <img
                src={crewAvatarSrc}
                alt=""
                className="hud-crew__portrait"
              />
              <div className="min-w-0 flex-1">
                <span className="hud-label">Crew on duty</span>
                <p className="retro truncate text-[11px] text-foreground">
                  {activeCrew.name}
                </p>
                <p className="retro truncate text-[9px] text-muted-foreground">
                  {crewStatus}
                </p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <HudMeter
                label="Context stamina"
                readout="100%"
                value={100}
                tone="var(--color-signal, oklch(0.74 0.16 155))"
              />
              <HudMeter
                label="Treasury"
                readout={`$${treasuryUsed.toFixed(4)} / $${maxBudgetUsd.toFixed(2)}`}
                value={treasuryPercent}
              />
            </div>

            {pendingPermit ? (
              <div className="hud-permit grid gap-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert
                    className="size-3 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="hud-label truncate text-primary">
                    Permit · {pendingPermit.tool}
                  </span>
                </div>
                <p className="retro text-[9px] leading-relaxed text-foreground">
                  {pendingPermit.message}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <HudButton
                    type="button"
                    size="sm"
                    onClick={() => resolvePermit(pendingPermit.toolCallId, "allow")}
                  >
                    Stamp
                  </HudButton>
                  <HudButton
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => resolvePermit(pendingPermit.toolCallId, "deny")}
                  >
                    Deny
                  </HudButton>
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border/50 pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="hud-label">Transmissions</span>
                <div className="flex items-center gap-2">
                  {quests.length > 0 ? (
                    <button
                      type="button"
                      className="retro text-[8px] uppercase text-muted-foreground transition-colors hover:text-foreground"
                      onClick={clearTransmissions}
                    >
                      Clear
                    </button>
                  ) : null}
                  {activeQuestCount > 0 ? (
                    <span className="hud-pill">{activeQuestCount} active</span>
                  ) : null}
                </div>
              </div>
              <QuestLog
                variant="bare"
                quests={quests}
                emptyStateMessage="The radio is quiet."
                className="min-h-0 flex-1"
              />
            </div>
          </HudWindow>
        </div>
      </div>

      <CrewSelectDialog
        open={crewDialogOpen}
        onOpenChange={setCrewDialogOpen}
        value={crewSelection}
        policy={crewPolicy}
        onConfirm={setCrewSelection}
      />

      <SignInDialog
        action={signInAction}
        onOpenChange={(open) => {
          if (!open) {
            setSignInAction(undefined);
          }
        }}
      />

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search files or mayor commands..." />
        <CommandList>
          <CommandEmpty>No file or command found.</CommandEmpty>
          {world?.buildings.length ? (
            <CommandGroup heading="Files">
              {world.buildings.map((building) => (
                <CommandItem
                  key={building.path}
                  value={building.path}
                  onSelect={() => {
                    canvasRef.current?.focusBuilding(building.path);
                    selectBuilding(building);
                    setCommandOpen(false);
                  }}
                >
                  <span className="truncate">{fileBasename(building.path)}</span>
                  <span className="text-muted-foreground ml-2 truncate text-xs">
                    {fileDirname(building.path)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
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

      <ShutterFlash
        isFlashing={isFlashingShutter}
        onAnimationEnd={() => setIsFlashingShutter(false)}
      />

      <ShareCityModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        screenshotUrl={screenshotUrl}
        activeRepoKey={activeRepoKey}
      />
    </div>
  );
}
