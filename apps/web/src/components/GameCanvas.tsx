import type {
  Building,
  CitySummary,
  Issue,
  PullRequestOverlay,
  WorldSnapshot,
} from "@sudo-city/protocol";
import Phaser from "phaser";
import { useEffect, useRef } from "react";
import {
  WorldScene,
  type FileChange,
  type ShipHoverInfo,
} from "../game/WorldScene";

export interface CanvasFileChange {
  /** Monotonic id so the same path changing twice still re-triggers. */
  id: string;
  cityId: string;
  path: string;
  change: FileChange;
}

export interface CanvasTravelRequest {
  id: string;
  cityId: string;
}

interface GameCanvasProps {
  cityId: string;
  world?: WorldSnapshot;
  overlay?: PullRequestOverlay;
  /** Snapshot that may be revealed once a ship has reached this city. */
  travelCityId?: string;
  travelWorld?: WorldSnapshot;
  travelOverlay?: PullRequestOverlay;
  fileChange?: CanvasFileChange;
  cities?: readonly CitySummary[];
  issues?: readonly Issue[];
  /** Programmatic travel from the issue shop, still using the cloud sequence. */
  travelRequest?: CanvasTravelRequest;
  /** Starts loading the destination while the current city remains on screen. */
  onTravelRequest?: (cityId: string) => void;
  /** Commits the application chrome to the new city after the arrival animation. */
  onTravelComplete?: (cityId: string) => void;
  /** Lets the HTML map overlays yield to the canvas whiteout. */
  onTravelTransitionChange?: (transitioning: boolean) => void;
  onIssueShopClick?: () => void;
  onSelectBuilding?: (building?: Building) => void;
  onShipHover?: (info?: ShipHoverInfo) => void;
}

export function GameCanvas({
  cityId,
  world,
  overlay,
  travelCityId,
  travelWorld,
  travelOverlay,
  fileChange,
  cities,
  issues,
  travelRequest,
  onTravelRequest,
  onTravelComplete,
  onTravelTransitionChange,
  onIssueShopClick,
  onSelectBuilding,
  onShipHover,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>(null);
  const sceneRef = useRef<WorldScene>(null);
  const selectRef = useRef(onSelectBuilding);
  const shipHoverRef = useRef(onShipHover);
  const travelRequestRef = useRef(onTravelRequest);
  const travelCompleteRef = useRef(onTravelComplete);
  const travelTransitionRef = useRef(onTravelTransitionChange);
  const issueShopClickRef = useRef(onIssueShopClick);
  const cityIdRef = useRef(cityId);
  const travelCityRef = useRef(travelCityId);
  const travelWorldRef = useRef(travelWorld);
  const travelOverlayRef = useRef(travelOverlay);
  /** True from a ship click until the arriving city is fully revealed. */
  const transitioningRef = useRef(false);
  /** True once the cover animation itself has finished. */
  const coverDoneRef = useRef(false);
  const revealStartedRef = useRef(false);
  const departureCityRef = useRef<string | undefined>(undefined);
  const destinationCityRef = useRef<string | undefined>(undefined);
  const handledTravelRequestRef = useRef<string | undefined>(undefined);

  // Kept in refs so a changing prop identity never rebuilds the game, and so
  // the ship-click listener (registered once, at scene creation) always sees
  // the latest values.
  selectRef.current = onSelectBuilding;
  shipHoverRef.current = onShipHover;
  travelRequestRef.current = onTravelRequest;
  travelCompleteRef.current = onTravelComplete;
  travelTransitionRef.current = onTravelTransitionChange;
  issueShopClickRef.current = onIssueShopClick;
  cityIdRef.current = cityId;
  travelCityRef.current = travelCityId;
  travelWorldRef.current = travelWorld;
  travelOverlayRef.current = travelOverlay;

  function tryReveal(): void {
    const destinationCityId = destinationCityRef.current;
    const destinationWorld = travelWorldRef.current;
    if (
      !transitioningRef.current ||
      !coverDoneRef.current ||
      revealStartedRef.current ||
      !destinationCityId ||
      travelCityRef.current !== destinationCityId ||
      !destinationWorld
    ) {
      return;
    }

    // The outgoing city stays intact until clouds completely cover it. This
    // is the key difference from changing React's active city on click: a
    // cached destination can no longer replace the sailing ship mid-flight.
    revealStartedRef.current = true;
    const scene = sceneRef.current;
    scene?.setWorld(destinationWorld, destinationCityId);
    scene?.setOverlay(travelOverlayRef.current);
    scene?.prepareArrivalForTravel(departureCityRef.current, destinationCityId);
    void scene?.revealAfterTravel().then(() => {
      const completedCityId = destinationCityRef.current;
      transitioningRef.current = false;
      coverDoneRef.current = false;
      revealStartedRef.current = false;
      departureCityRef.current = undefined;
      destinationCityRef.current = undefined;
      travelTransitionRef.current?.(false);
      if (completedCityId) {
        travelCompleteRef.current?.(completedCityId);
      }
    });
  }

  function beginTravel(targetCityId: string): boolean {
    const scene = sceneRef.current;
    if (
      !scene ||
      transitioningRef.current ||
      targetCityId === cityIdRef.current
    ) {
      return false;
    }
    transitioningRef.current = true;
    coverDoneRef.current = false;
    revealStartedRef.current = false;
    departureCityRef.current = cityIdRef.current;
    destinationCityRef.current = targetCityId;
    travelTransitionRef.current?.(true);
    void scene.coverForTravel(targetCityId).then(() => {
      coverDoneRef.current = true;
      tryReveal();
    });
    travelRequestRef.current?.(targetCityId);
    return true;
  }

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return;
    }

    const host = hostRef.current;
    const scene = new WorldScene();
    scene.setSelectionListener((building) => selectRef.current?.(building));
    scene.setShipHoverListener((info) => shipHoverRef.current?.(info));
    scene.setShipClickListener(beginTravel);
    scene.setIssueShopClickListener(() => issueShopClickRef.current?.());
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      backgroundColor: "#2e9fe0",
      scene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true,
      },
    });
    gameRef.current = game;

    // Phaser's RESIZE mode only listens on window resize, so dragging the
    // panel divider left the canvas at the wrong size until the window moved.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        game.scale.resize(width, height);
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (world) {
      sceneRef.current?.setWorld(world, cityId);
      // The new city's snapshot has landed; if a travel transition is mid-
      // flight, this is one of the two conditions revealAfterTravel waits on.
      tryReveal();
    }
  }, [world, cityId]);

  useEffect(() => {
    sceneRef.current?.setOverlay(overlay);
  }, [overlay]);

  useEffect(() => {
    // A destination may be cached before the click or may arrive over the
    // socket while clouds are closing. In both cases tryReveal waits until
    // the cover is complete before replacing the visual world.
    tryReveal();
  }, [travelCityId, travelWorld, travelOverlay]);

  useEffect(() => {
    sceneRef.current?.setCities(cities ?? []);
  }, [cities]);

  useEffect(() => {
    sceneRef.current?.setIssues(issues ?? []);
  }, [issues]);

  useEffect(() => {
    if (
      !travelRequest ||
      travelRequest.id === handledTravelRequestRef.current ||
      !sceneRef.current
    ) {
      return;
    }
    if (beginTravel(travelRequest.cityId)) {
      handledTravelRequestRef.current = travelRequest.id;
    }
  }, [travelRequest]);

  useEffect(() => {
    if (fileChange) {
      sceneRef.current?.applyFileChange(
        fileChange.path,
        fileChange.change,
        fileChange.cityId,
      );
    }
  }, [fileChange]);

  return (
    <div
      ref={hostRef}
      className="game-canvas"
      aria-label="Isometric repository world"
    />
  );
}
