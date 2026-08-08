import type { WorldSnapshot } from "@sudo-city/protocol";
import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { WorldScene } from "../game/WorldScene";

interface GameCanvasProps {
  world?: WorldSnapshot;
}

export function GameCanvas({ world }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>(null);
  const sceneRef = useRef<WorldScene>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return;
    }

    const scene = new WorldScene();
    sceneRef.current = scene;
    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: "#101a24",
      scene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
      render: {
        antialias: false,
        pixelArt: true,
      },
    });

    return () => {
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

  return (
    <div
      ref={hostRef}
      className="game-canvas"
      aria-label="Isometric repository world"
    />
  );
}
