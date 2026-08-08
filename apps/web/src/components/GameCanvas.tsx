import type { Building, WorldSnapshot } from "@sudo-city/protocol";
import Phaser from "phaser";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { WorldScene, type FileChange } from "../game/WorldScene";

export interface CanvasFileChange {
  /** Monotonic id so the same path changing twice still re-triggers. */
  id: string;
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
  world?: WorldSnapshot;
  fileChange?: CanvasFileChange;
  onSelectBuilding?: (building?: Building) => void;
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
      world,
      fileChange,
      onSelectBuilding,
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
    const dragStartRef = useRef(onBuildingDragStart);
    const dragMoveRef = useRef(onBuildingDragMove);
    const dragEndRef = useRef(onBuildingDragEnd);
    const draggingBuildingRef = useRef<Building | undefined>(undefined);

    // Kept in refs so changing callback identities never rebuilds the game.
    selectRef.current = onSelectBuilding;
    dragStartRef.current = onBuildingDragStart;
    dragMoveRef.current = onBuildingDragMove;
    dragEndRef.current = onBuildingDragEnd;

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
  },
);
