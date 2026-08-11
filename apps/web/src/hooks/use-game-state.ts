import { useState, useRef, useEffect, useMemo, FormEvent } from "react";
import {
  type Building,
  type CitySummary,
  type GameEvent,
  type Issue,
  type MayorCommand,
  type PermissionMode,
  type PullRequestOverlay,
  type WorldSnapshot,
  ServerMessageSchema,
} from "@sudo-city/protocol";
import type { AuthUser } from "@/auth/gate";
import type {
  CanvasDragPreview,
  CanvasFileChange,
  CanvasPointerPosition,
  CanvasTravelRequest,
  CanvasAirportTravel,
  GameCanvasHandle,
} from "@/components/GameCanvas";
import type { ShipHoverInfo } from "@/game/WorldScene";
import {
  type ConnectionState,
  websocketUrl,
  CONSTRUCTION_GRACE_MS,
  RESCAN_DEBOUNCE_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  EVENTS_PER_CITY_CAP,
  loadStoredEvents,
  clearStoredEvents,
  eventsStorageKey,
  promptForIssue,
  pointIsInside,
} from "@/lib/app-utils";
import { createLocalPermitDismissal } from "@/lib/quest-utils";
import { ConstructionTracker } from "@/lib/construction-tracker";
import {
  readHudState,
  type HudPanelId,
  toggleHudPanel,
} from "@/components/hud/hud-state";
import { DEFAULT_CREW_ID, DEFAULT_EFFORT, getCrewMember } from "@/crew/catalog";
import { type CrewSelection } from "@/components/CrewSelectDialog";

export interface GameStateProps {
  activeRepoKey: string;
  sessionToken?: string;
  user?: AuthUser;
  repoConnectionGeneration: number;
  initialReveal?: boolean;
  airportArrival?: CanvasAirportTravel;
  onInitialRevealReady?: () => void;
  onInitialRevealComplete?: () => void;
}

export function useGameState({
  activeRepoKey,
  sessionToken,
  user,
  repoConnectionGeneration,
  initialReveal = false,
  airportArrival,
  onInitialRevealReady,
  onInitialRevealComplete,
}: GameStateProps) {
  const socketRef = useRef<WebSocket>(null);
  const canvasRef = useRef<GameCanvasHandle>(null);
  const orderFormRef = useRef<HTMLFormElement>(null);
  const initialRevealReadyRef = useRef(false);
  const initialRevealTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const initialRevealReadyCallbackRef = useRef(onInitialRevealReady);
  const initialRevealCompleteCallbackRef = useRef(onInitialRevealComplete);
  initialRevealReadyCallbackRef.current = onInitialRevealReady;
  initialRevealCompleteCallbackRef.current = onInitialRevealComplete;

  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [viewerLogin, setViewerLogin] = useState<string>();
  const [activeCityId, setActiveCityId] = useState("main");
  const [eventsByCity, setEventsByCity] = useState<Record<string, GameEvent[]>>(
    () => ({ main: loadStoredEvents(activeRepoKey, "main") }),
  );
  const [worldByCity, setWorldByCity] = useState<Record<string, WorldSnapshot>>(
    {},
  );
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
  const [dragPosition, setDragPosition] = useState<CanvasPointerPosition>();
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [orderPermissionMode, setOrderPermissionMode] =
    useState<PermissionMode>("default");
  const [crewSelection, setCrewSelection] = useState<CrewSelection>({
    crewId: DEFAULT_CREW_ID,
    effort: DEFAULT_EFFORT,
  });
  const [crewDialogOpen, setCrewDialogOpen] = useState(false);
  const [hud, setHud] = useState(readHudState);
  const [fileChange, setFileChange] = useState<CanvasFileChange>();
  const [buildingPaths, setBuildingPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<Building>();
  const [shipHover, setShipHover] = useState<ShipHoverInfo>();
  const [shipTravelTargetId, setShipTravelTargetId] = useState<string>();
  const [shipTransitioning, setShipTransitioning] = useState(false);
  const [issueShopOpen, setIssueShopOpen] = useState(false);
  const [prShopOpen, setPrShopOpen] = useState(false);
  const [worktreeShopOpen, setWorktreeShopOpen] = useState(false);
  const [issueTravelRequest, setIssueTravelRequest] =
    useState<CanvasTravelRequest>();
  const [navyTravelRequest, setNavyTravelRequest] =
    useState<CanvasTravelRequest>();
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
  const world =
    worldRepoKey === activeRepoKey ? worldByCity[activeCityId] : undefined;
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

  useEffect(() => {
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
    setPrShopOpen(false);
    setIssueTravelRequest(undefined);
    setNavyTravelRequest(undefined);
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

      const scheduleRescan = (cityId: string): void => {
        clearTimeout(rescanTimers[cityId]);
        rescanTimers[cityId] = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "world.request",
                cityId,
              } satisfies MayorCommand),
            );
          }
        }, RESCAN_DEBOUNCE_MS);
      };

      ws.addEventListener("open", () => {
        attempt = 0;
        setReconnectAttempt(0);
        setConnection("online");
        if (sessionToken) {
          ws.send(
            JSON.stringify({
              type: "session.auth",
              token: sessionToken,
            } satisfies MayorCommand),
          );
        }
        ws.send(
          JSON.stringify({
            type: "repo.select",
            repoKey: activeRepoKey,
          } satisfies MayorCommand),
        );
      });
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

        if (decoded.data.kind === "viewer") {
          setViewerLogin(decoded.data.login);
          return;
        }

        if (decoded.data.kind === "error") {
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
          sites.start(event.path);
          scheduleRescan(event.cityId);
        }
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
    const timer = window.setTimeout(
      () => setAirportArrivalDelayed(true),
      12_000,
    );
    return () => window.clearTimeout(timer);
  }, [airportArrival, world]);

  useEffect(() => {
    for (const [cityId, bucket] of Object.entries(eventsByCity)) {
      try {
        localStorage.setItem(
          eventsStorageKey(activeRepoKey, cityId),
          JSON.stringify(bucket),
        );
      } catch {}
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

  function travelTo(cityId: string): void {
    setActiveCityId(cityId);
    setSelected(undefined);
    setDiff(undefined);
    setEventsByCity((current) =>
      cityId in current
        ? current
        : { ...current, [cityId]: loadStoredEvents(activeRepoKey, cityId) },
    );
    send({ type: "city.travel", cityId });
  }

  function requestShipTravel(cityId: string): void {
    setShipTravelTargetId(cityId);
    setSelected(undefined);
    setDiff(undefined);
    setEventsByCity((current) =>
      cityId in current
        ? current
        : { ...current, [cityId]: loadStoredEvents(activeRepoKey, cityId) },
    );
    send({ type: "city.travel", cityId });
  }

  function completeShipTravel(cityId: string): void {
    setActiveCityId(cityId);
    setShipTravelTargetId(undefined);
    setIssueTravelRequest(undefined);
    setNavyTravelRequest(undefined);
  }

  function takeIssueToFix(issue: Issue): void {
    setIssueShopOpen(false);
    setPrompt(promptForIssue(issue));
  }

  const mayorLogin = user?.login ?? viewerLogin;
  const isMayorAuthor = (author?: string): boolean => {
    if (!author || !mayorLogin) return false;
    const a = author.toLowerCase().replace(/[-_]/g, "");
    const m = mayorLogin.toLowerCase().replace(/[-_]/g, "");
    return a === m;
  };
  const ownWorkCities = useMemo(
    () =>
      cities.filter(
        (city) =>
          city.kind === "issue" ||
          (city.kind === "pull-request" && isMayorAuthor(city.author)),
      ),
    [cities, mayorLogin],
  );
  const reviewPrCities = useMemo(
    () =>
      cities.filter(
        (city) => city.kind === "pull-request" && !isMayorAuthor(city.author),
      ),
    [cities, mayorLogin],
  );

  function handleHarbourShipClick(): void {
    if (shipTransitioning) return;
    setSelected(undefined);
    setDiff(undefined);
    if (activeCityId === "main") {
      setWorktreeShopOpen(true);
      return;
    }
    setIssueTravelRequest({
      id: `home-${activeCityId}-${Date.now()}`,
      cityId: "main",
      ship: "container",
      carriesContainer: false,
    });
  }

  function handleNavyShipClick(): void {
    if (shipTransitioning) return;
    setSelected(undefined);
    setDiff(undefined);
    if (activeCityId === "main") {
      setPrShopOpen(true);
      return;
    }
    setNavyTravelRequest({
      id: `navy-home-${activeCityId}-${Date.now()}`,
      cityId: "main",
      ship: "navy",
      carriesContainer: false,
    });
  }

  function takeOwnWorkToDeploy(item: CitySummary): void {
    if (item.id === activeCityId) {
      setWorktreeShopOpen(false);
      return;
    }
    setWorktreeShopOpen(false);
    setSelected(undefined);
    setDiff(undefined);
    setIssueTravelRequest({
      id: `worktree-${item.id}-${Date.now()}`,
      cityId: item.id,
      ship: "container",
      carriesContainer: true,
    });
  }

  function takePrToDeploy(pr: CitySummary): void {
    if (pr.id === activeCityId) {
      setPrShopOpen(false);
      return;
    }
    setPrShopOpen(false);
    setSelected(undefined);
    setDiff(undefined);
    setNavyTravelRequest({
      id: `navy-pr-${pr.id}-${Date.now()}`,
      cityId: pr.id,
      ship: "navy",
      carriesContainer: false,
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

  return {
    socketRef,
    canvasRef,
    orderFormRef,
    connection,
    reconnectAttempt,
    cities,
    issues,
    viewerLogin,
    activeCityId,
    eventsByCity,
    worldByCity,
    worldRepoKey,
    overlayByCity,
    diff,
    prompt,
    commandOpen,
    draggingBuilding,
    dragPreview,
    dragPosition,
    contextPaths,
    orderPermissionMode,
    crewSelection,
    crewDialogOpen,
    hud,
    fileChange,
    buildingPaths,
    selected,
    shipHover,
    shipTravelTargetId,
    shipTransitioning,
    issueShopOpen,
    prShopOpen,
    worktreeShopOpen,
    issueTravelRequest,
    navyTravelRequest,
    airportArrivalDelayed,
    initialRevealReady,
    initialRevealComplete,
    shareModalOpen,
    screenshotUrl,
    isCapturingSnapshot,
    isFlashingShutter,
    events,
    world,
    overlay,
    ownWorkCities,
    reviewPrCities,
    airportArrival,
    setConnection,
    setReconnectAttempt,
    setCities,
    setIssues,
    setViewerLogin,
    setActiveCityId,
    setEventsByCity,
    setWorldByCity,
    setWorldRepoKey,
    setOverlayByCity,
    setDiff,
    setPrompt,
    setCommandOpen,
    setDraggingBuilding,
    setDragPreview,
    setDragPosition,
    setContextPaths,
    setOrderPermissionMode,
    setCrewSelection,
    setCrewDialogOpen,
    setHud,
    setFileChange,
    setBuildingPaths,
    setSelected,
    setShipHover,
    setShipTravelTargetId,
    setShipTransitioning,
    setIssueShopOpen,
    setPrShopOpen,
    setWorktreeShopOpen,
    setIssueTravelRequest,
    setNavyTravelRequest,
    setAirportArrivalDelayed,
    setInitialRevealReady,
    setInitialRevealComplete,
    setShareModalOpen,
    setScreenshotUrl,
    setIsCapturingSnapshot,
    setIsFlashingShutter,
    handleTakeSnapshot,
    notifyInitialRevealReady,
    toggleHud,
    send,
    clearTransmissions,
    travelTo,
    requestShipTravel,
    completeShipTravel,
    takeIssueToFix,
    handleHarbourShipClick,
    handleNavyShipClick,
    takeOwnWorkToDeploy,
    takePrToDeploy,
    selectBuilding,
    handleBuildingDragStart,
    handleBuildingDragMove,
    handleBuildingDrop,
    removeContextPath,
    submitPrompt,
  };
}
