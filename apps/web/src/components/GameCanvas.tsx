import type {
  Building,
  CitySummary,
  Issue,
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

export interface CanvasTravelRequest {
  id: string;
  cityId: string;
}

/** A cross-repository journey: its world arrives only after the flight leaves. */
export interface CanvasAirportTravel {
  id: string;
  sourceKey: string;
  destinationKey: string;
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
  captureScreenshot: () => Promise<string>;
};

interface GameCanvasProps {
  cityId: string;
  /** Repository identity is separate from cityId (both repositories have a main). */
  worldKey: string;
  world?: WorldSnapshot;
  /** Fires once the first world is applied and the initial viewport has settled. */
  onInitialWorldReady?: () => void;
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
  /** Starts an airport departure after a repository has finished importing. */
  airportTravel?: CanvasAirportTravel;
  /** Opens the cloud cover onto the first world from the newly selected repo. */
  airportArrival?: CanvasAirportTravel;
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
  /** Changes the repository only once the outgoing city is hidden by clouds. */
  onAirportTravelCovered?: (travel: CanvasAirportTravel) => void;
  onAirportArrivalComplete?: (travel: CanvasAirportTravel) => void;
  onIssueShopClick?: () => void;
  onAirportClick?: () => void;
  onAirportHover?: (info?: ShipHoverInfo) => void;
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
      worldKey,
      world,
      onInitialWorldReady,
      overlay,
      travelCityId,
      travelWorld,
      travelOverlay,
      fileChange,
      cities,
      issues,
      travelRequest,
      airportTravel,
      airportArrival,
      crewSprite,
      buildingPaths,
      onTravelRequest,
      onTravelComplete,
      onTravelTransitionChange,
      onAirportTravelCovered,
      onAirportArrivalComplete,
      onIssueShopClick,
      onAirportClick,
      onAirportHover,
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
    const airportHoverRef = useRef(onAirportHover);
    const airportClickRef = useRef(onAirportClick);
    const travelRequestRef = useRef(onTravelRequest);
    const travelCompleteRef = useRef(onTravelComplete);
    const travelTransitionRef = useRef(onTravelTransitionChange);
    const airportTravelCoveredRef = useRef(onAirportTravelCovered);
    const airportArrivalCompleteRef = useRef(onAirportArrivalComplete);
    const issueShopClickRef = useRef(onIssueShopClick);
    const cityIdRef = useRef(cityId);
    const worldKeyRef = useRef(worldKey);
    const initialWorldReadyRef = useRef(false);
    const initialWorldReadyCallbackRef = useRef(onInitialWorldReady);
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
    const handledTravelRequestRef = useRef<string | undefined>(undefined);
    const handledAirportTravelRef = useRef<string | undefined>(undefined);
    const handledAirportArrivalRef = useRef<string | undefined>(undefined);

    // Kept in refs so a changing prop identity never rebuilds the game, and so
    // the ship-click listener (registered once, at scene creation) always sees
    // the latest values.
    selectRef.current = onSelectBuilding;
    shipHoverRef.current = onShipHover;
    airportHoverRef.current = onAirportHover;
    airportClickRef.current = onAirportClick;
    travelRequestRef.current = onTravelRequest;
    travelCompleteRef.current = onTravelComplete;
    travelTransitionRef.current = onTravelTransitionChange;
    airportTravelCoveredRef.current = onAirportTravelCovered;
    airportArrivalCompleteRef.current = onAirportArrivalComplete;
    issueShopClickRef.current = onIssueShopClick;
    cityIdRef.current = cityId;
    worldKeyRef.current = worldKey;
    initialWorldReadyCallbackRef.current = onInitialWorldReady;
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
      scene?.setWorld(destinationWorld, destinationCityId, worldKeyRef.current);
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
        scene?.setTravelTransitionActive(false);
        travelTransitionRef.current?.(false);
        if (completedCityId) {
          travelCompleteRef.current?.(completedCityId);
        }
      });
    }

    // Ignore a re-click on the city already being viewed, and ignore clicks
    // that land mid-transition -- the cloud cover already hides the world,
    // so a second click can't mean anything useful yet. Shared by the
    // in-scene ship click and the issue shop's programmatic travel request.
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
      scene.setTravelTransitionActive(true);
      travelTransitionRef.current?.(true);
      // The network round trip runs concurrently with the departure/cover
      // animation rather than after it, so a fast (already-built) travel
      // isn't needlessly delayed by the animation's fixed duration; a slow
      // (lazy PR build) travel just leaves the clouds covering a little
      // longer, which reads fine as a loading state.
      void scene.coverForTravel(targetCityId).then(() => {
        coverDoneRef.current = true;
        tryReveal();
      });
      travelRequestRef.current?.(targetCityId);
      return true;
    }

    function beginAirportTravel(travel: CanvasAirportTravel): boolean {
      const scene = sceneRef.current;
      if (
        !scene ||
        transitioningRef.current ||
        travel.sourceKey !== worldKeyRef.current
      ) {
        return false;
      }
      transitioningRef.current = true;
      coverDoneRef.current = false;
      revealStartedRef.current = false;
      departureCityRef.current = cityIdRef.current;
      destinationCityRef.current = undefined;
      scene.setTravelTransitionActive(true);
      travelTransitionRef.current?.(true);
      void scene.coverForAirportTravel().then(() => {
        coverDoneRef.current = true;
        airportTravelCoveredRef.current?.(travel);
      });
      return true;
    }

    useImperativeHandle(
      ref,
      () => ({
        focusBuilding: (path: string) =>
          sceneRef.current?.focusBuilding(path) ?? false,
        captureScreenshot: (): Promise<string> => {
          return new Promise((resolve, reject) => {
            const game = gameRef.current;
            const scene = sceneRef.current;
            if (!game || !scene) {
              reject(new Error("Game canvas not ready"));
              return;
            }

            try {
              // 1. Save user's current camera state
              const camera = scene.cameras.main;
              const savedScrollX = camera.scrollX;
              const savedScrollY = camera.scrollY;
              const savedZoom = camera.zoom;
              const savedZoomTarget = (scene as any).zoomTarget;

              // 2. Center and fit camera to the full city island
              scene.fitCamera();

              const restoreCamera = () => {
                camera.setZoom(savedZoom);
                camera.scrollX = savedScrollX;
                camera.scrollY = savedScrollY;
                if (savedZoomTarget !== undefined) {
                  (scene as any).zoomTarget = savedZoomTarget;
                }
              };

              // 3. Wait for the game loop to render a frame with the new camera state
              game.events.once("postrender", () => {
                try {
                  const canvas = game.canvas || hostRef.current?.querySelector("canvas");
                  if (canvas) {
                    const dataUrl = canvas.toDataURL("image/png");
                    restoreCamera();
                    resolve(dataUrl);
                  } else {
                    restoreCamera();
                    reject(new Error("Canvas element not found"));
                  }
                } catch (err) {
                  restoreCamera();
                  reject(err);
                }
              });
            } catch (err) {
              reject(err);
            }
          });
        },
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
      scene.setShipClickListener(beginTravel);
      scene.setAirportHoverListener((info) =>
        (airportHoverRef.current ?? shipHoverRef.current)?.(info),
      );
      scene.setAirportClickListener(() => airportClickRef.current?.());
      scene.setIssueShopClickListener(() => issueShopClickRef.current?.());
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
          preserveDrawingBuffer: true,
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
          scene.resizeViewport(width, height);
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
      if (!world) return;

      const scene = sceneRef.current;
      scene?.setWorld(world, cityId, worldKey);
      // The new city's snapshot has landed; if a travel transition is mid-
      // flight, this is one of the two conditions revealAfterTravel waits on.
      tryReveal();

      if (!onInitialWorldReady || !scene || initialWorldReadyRef.current) {
        return;
      }

      let cancelled = false;
      let frame: number | undefined;
      const notifyWhenSettled = (): void => {
        frame = window.requestAnimationFrame(() => {
          // Let Phaser's resize observer and camera fit finish before the
          // login cover starts revealing the second canvas.
          frame = window.requestAnimationFrame(() => {
            if (
              cancelled ||
              initialWorldReadyRef.current ||
              !scene.scene.isActive()
            ) {
              return;
            }
            initialWorldReadyRef.current = true;
            initialWorldReadyCallbackRef.current?.();
          });
        });
      };

      if (scene.scene.isActive()) {
        notifyWhenSettled();
      } else {
        scene.events.once(Phaser.Scenes.Events.CREATE, notifyWhenSettled);
      }

      return () => {
        cancelled = true;
        if (frame !== undefined) {
          window.cancelAnimationFrame(frame);
        }
        scene.events.off(Phaser.Scenes.Events.CREATE, notifyWhenSettled);
      };
    }, [world, cityId, worldKey, Boolean(onInitialWorldReady)]);

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
      if (
        !airportTravel ||
        airportTravel.id === handledAirportTravelRef.current ||
        !sceneRef.current
      ) {
        return;
      }
      if (beginAirportTravel(airportTravel)) {
        handledAirportTravelRef.current = airportTravel.id;
      }
    }, [airportTravel]);

    useEffect(() => {
      if (
        !airportArrival ||
        airportArrival.id === handledAirportArrivalRef.current ||
        !world ||
        airportArrival.destinationKey !== worldKey ||
        !sceneRef.current ||
        !transitioningRef.current ||
        !coverDoneRef.current
      ) {
        return;
      }
      handledAirportArrivalRef.current = airportArrival.id;
      void sceneRef.current.revealAfterAirportTravel().then(() => {
        transitioningRef.current = false;
        coverDoneRef.current = false;
        departureCityRef.current = undefined;
        sceneRef.current?.setTravelTransitionActive(false);
        travelTransitionRef.current?.(false);
        airportArrivalCompleteRef.current?.(airportArrival);
      });
    }, [airportArrival, world, worldKey]);

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
