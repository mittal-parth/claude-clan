import type { Building, WorldSnapshot } from "@sudo-city/protocol";
import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { WorldScene, type FileChange } from "../game/WorldScene";

export interface CanvasFileChange {
  /** Monotonic id so the same path changing twice still re-triggers. */
  id: string;
  path: string;
  change: FileChange;
}

interface GameCanvasProps {
  world?: WorldSnapshot;
  fileChange?: CanvasFileChange;
  onSelectBuilding?: (building?: Building) => void;
}

export function GameCanvas({
  world,
  fileChange,
  onSelectBuilding,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>(null);
  const sceneRef = useRef<WorldScene>(null);
  const selectRef = useRef(onSelectBuilding);

  // Kept in a ref so a changing callback identity never rebuilds the game.
  selectRef.current = onSelectBuilding;

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return;
    }

    const host = hostRef.current;
    const scene = new WorldScene();
    scene.setSelectionListener((building) => selectRef.current?.(building));
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      backgroundColor: "#7fc9e8",
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
      sceneRef.current?.setWorld(world);
    }
  }, [world]);

  useEffect(() => {
    if (fileChange) {
      sceneRef.current?.applyFileChange(fileChange.path, fileChange.change);
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
