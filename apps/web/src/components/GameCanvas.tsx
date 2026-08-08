import type {
  Building,
  CitySummary,
  PullRequestOverlay,
  WorldSnapshot,
} from "@sudo-city/protocol";
import Phaser from "phaser";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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

export interface CanvasPointerPosition {
  clientX: number;
  clientY: number;
}

export interface CanvasDragPreview {
  src: string;
}

export type GameCanvasHandle = {
  focusBuilding: (path: string) => boolean;
};

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
  /** Public URL of the portrait to stand on every construction site. */
  crewSprite?: string;
  /** Files the crew is working on; each gets a construction site. */
  buildingPaths?: string[];
  /** Starts loading the destination while the current city remains on screen. */
  onTravelRequest?: (cityId: string) => void;
  /** Commits the application chrome to the new city after the arrival animation. */
  onTravelComplete?: (cityId: string) => void;
  /** Lets the HTML map overlays yield to the canvas whiteout. */
  onTravelTransitionChange?: (transitioning: boolean) => void;
  onSelectBuilding?: (building?: Building) => void;
  onShipHover?: (info?: ShipHoverInfo) => void;
  onBuildingDragStart?: (
    building: Building,
    preview?: CanvasDragPreview,
  ) => void;
  onBuildingDragMove?: (position: CanvasPointerPosition) => void;
  onBuildingDragEnd?: (
    building: Building,
    position: CanvasPointerPosition,
  ) => void;
}

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      cityId,
      world,
      overlay,
      travelCityId,
      travelWorld,
      travelOverlay,
      fileChange,
      cities,
      crewSprite,
      buildingPaths,
      onTravelRequest,
      onTravelComplete,
      onTravelTransitionChange,
      onSelectBuilding,
      onShipHover,
      onBuildingDragStart,
      onBuildingDragMove,
      onBuildingDragEnd,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const gameRef = useRef<Phaser.Game>(null);
    const sceneRef = useRef<WorldScene>(null);
    const selectRef = useRef(onSelectBuilding);
    const shipHoverRef = useRef(onShipHover);
    const travelRequestRef = useRef(onTravelRequest);
    const travelCompleteRef = useRef(onTravelComplete);
    const travelTransitionRef = useRef(onTravelTransitionChange);
    const cityIdRef = useRef(cityId);
    const travelCityRef = useRef(travelCityId);
    const travelWorldRef = useRef(travelWorld);
    const travelOverlayRef = useRef(travelOverlay);
    const dragStartRef = useRef(onBuildingDragStart);
    const dragMoveRef = useRef(onBuildingDragMove);
    const dragEndRef = useRef(onBuildingDragEnd);
    const draggingBuildingRef = useRef<Building | undefined>(undefined);
    /** True from a ship click until the arriving city is fully revealed. */
    const transitioningRef = useRef(false);
    /** True once the cover animation itself has finished. */
    const coverDoneRef = useRef(false);
    const revealStartedRef = useRef(false);
    const departureCityRef = useRef<string | undefined>(undefined);
    const destinationCityRef = useRef<string | undefined>(undefined);

    // Kept in refs so a changing prop identity never rebuilds the game, and so
    // the ship-click listener (registered once, at scene creation) always sees
    // the latest values.
    selectRef.current = onSelectBuilding;
    shipHoverRef.current = onShipHover;
    travelRequestRef.current = onTravelRequest;
    travelCompleteRef.current = onTravelComplete;
    travelTransitionRef.current = onTravelTransitionChange;
    cityIdRef.current = cityId;
    travelCityRef.current = travelCityId;
    travelWorldRef.current = travelWorld;
    travelOverlayRef.current = travelOverlay;
    dragStartRef.current = onBuildingDragStart;
    dragMoveRef.current = onBuildingDragMove;
    dragEndRef.current = onBuildingDragEnd;

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
      scene?.prepareArrivalForTravel(
        departureCityRef.current,
        destinationCityId,
      );
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

    useImperativeHandle(
      ref,
      () => ({
        focusBuilding: (path: string) =>
          sceneRef.current?.focusBuilding(path) ?? false,
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current || gameRef.current) {
        return;
      }

      const host = hostRef.current;
      const scene = new WorldScene();
      scene.setSelectionListener((building) => selectRef.current?.(building));
      scene.setShipHoverListener((info) => shipHoverRef.current?.(info));
      scene.setShipClickListener((targetCityId) => {
        // Ignore a re-click on the city already being viewed, and ignore
        // clicks that land mid-transition -- the cloud cover already hides
        // the world, so a second click can't mean anything useful yet.
        if (transitioningRef.current || targetCityId === cityIdRef.current) {
          return;
        }
        transitioningRef.current = true;
        coverDoneRef.current = false;
        revealStartedRef.current = false;
        departureCityRef.current = cityIdRef.current;
        destinationCityRef.current = targetCityId;
        travelTransitionRef.current?.(true);
        // The network round trip runs concurrently with the departure/cover
        // animation rather than after it, so a fast (already-built) travel
        // isn't needlessly delayed by the animation's fixed duration; a slow
        // (lazy PR build) travel just leaves the clouds covering a little
        // longer, which reads fine as a loading state.
        scene.coverForTravel(targetCityId).then(() => {
          coverDoneRef.current = true;
          tryReveal();
        });
        travelRequestRef.current?.(targetCityId);
      });
      scene.setBuildingDragListener((building) => {
        draggingBuildingRef.current = building;
        const source = scene.getBuildingPreviewSource(building);
        dragStartRef.current?.(
          building,
          source ? { src: source } : undefined,
        );
      });
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

      const finishBuildingDrop = (event: PointerEvent): void => {
        const building = draggingBuildingRef.current;
        if (!building) {
          return;
        }

        draggingBuildingRef.current = undefined;
        scene.cancelBuildingDrag();
        dragEndRef.current?.(building, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      };
      const moveBuildingDrag = (event: PointerEvent): void => {
        if (!draggingBuildingRef.current) {
          return;
        }

        dragMoveRef.current?.({
          clientX: event.clientX,
          clientY: event.clientY,
        });
      };
      window.addEventListener("pointermove", moveBuildingDrag);
      window.addEventListener("pointerup", finishBuildingDrop);
      window.addEventListener("pointercancel", finishBuildingDrop);

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
        window.removeEventListener("pointermove", moveBuildingDrag);
        window.removeEventListener("pointerup", finishBuildingDrop);
        window.removeEventListener("pointercancel", finishBuildingDrop);
        draggingBuildingRef.current = undefined;
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
      if (fileChange) {
        sceneRef.current?.applyFileChange(
          fileChange.path,
          fileChange.change,
          fileChange.cityId,
        );
      }
    }, [fileChange]);

    useEffect(() => {
      sceneRef.current?.setCrewSprite(crewSprite);
    }, [crewSprite]);

    // Joined rather than passed by identity: the parent rebuilds this array on
    // every event, and only a change in membership should disturb the sites.
    const pathKey = (buildingPaths ?? []).join("\0");
    useEffect(() => {
      sceneRef.current?.setBuildingPaths(pathKey ? pathKey.split("\0") : []);
    }, [pathKey]);

    return (
      <div
        ref={hostRef}
        className="game-canvas"
        aria-label="Isometric repository world"
      />
    );
  },
);
