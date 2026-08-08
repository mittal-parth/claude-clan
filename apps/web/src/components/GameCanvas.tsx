import type {
  Building,
  CitySummary,
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

interface GameCanvasProps {
  cityId: string;
  world?: WorldSnapshot;
  overlay?: PullRequestOverlay;
  fileChange?: CanvasFileChange;
  cities?: readonly CitySummary[];
  /** Sends the real travel command; called immediately on a ship click, in parallel with the departure/cloud-cover animation. */
  onTravel?: (cityId: string) => void;
  onSelectBuilding?: (building?: Building) => void;
  onShipHover?: (info?: ShipHoverInfo) => void;
}

export function GameCanvas({
  cityId,
  world,
  overlay,
  fileChange,
  cities,
  onTravel,
  onSelectBuilding,
  onShipHover,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>(null);
  const sceneRef = useRef<WorldScene>(null);
  const selectRef = useRef(onSelectBuilding);
  const shipHoverRef = useRef(onShipHover);
  const travelRef = useRef(onTravel);
  const cityIdRef = useRef(cityId);
  /** True from a ship click until revealAfterTravel has run. */
  const transitioningRef = useRef(false);
  /** True once the cover animation itself has finished (independent of whether the new world has arrived yet). */
  const coverDoneRef = useRef(false);

  // Kept in refs so a changing prop identity never rebuilds the game, and so
  // the ship-click listener (registered once, at scene creation) always sees
  // the latest values.
  selectRef.current = onSelectBuilding;
  shipHoverRef.current = onShipHover;
  travelRef.current = onTravel;
  cityIdRef.current = cityId;

  function tryReveal(): void {
    if (transitioningRef.current && coverDoneRef.current) {
      transitioningRef.current = false;
      coverDoneRef.current = false;
      sceneRef.current?.revealAfterTravel();
    }
  }

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
      // The network round trip runs concurrently with the departure/cover
      // animation rather than after it, so a fast (already-built) travel
      // isn't needlessly delayed by the animation's fixed duration; a slow
      // (lazy PR build) travel just leaves the clouds covering a little
      // longer, which reads fine as a loading state.
      scene.coverForTravel(targetCityId).then(() => {
        coverDoneRef.current = true;
        tryReveal();
      });
      travelRef.current?.(targetCityId);
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

  return (
    <div
      ref={hostRef}
      className="game-canvas"
      aria-label="Isometric repository world"
    />
  );
}
