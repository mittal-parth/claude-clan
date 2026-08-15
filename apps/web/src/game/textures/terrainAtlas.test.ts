/**
 * The terrain atlas batches every ground and road tile into one texture, so a
 * frame outside the generated canvas is a silent crop rather than an error --
 * the atlas fits its declared size, or a large city loses tiles with no
 * warning. Adding the road hierarchy tripled the road frame count (16 masks x
 * 3 classes instead of 16), which is exactly the kind of change that can
 * quietly overflow a fixed-column atlas.
 */

import type { Scene } from "phaser";
import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => {
  class Vector2 {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  class Color {
    constructor(public color: number) {}
    lighten(): Color {
      return this;
    }
    darken(): Color {
      return this;
    }
  }
  return {
    default: {
      Math: { Vector2 },
      Display: { Color: { IntegerToColor: (value: number) => new Color(value) } },
    },
  };
});

interface Drawn {
  x: number;
  y: number;
}

function recordingScene(): {
  scene: Scene;
  drawn: Drawn[];
  baked: { key: string; width: number; height: number }[];
  frames: Set<string>;
} {
  const drawn: Drawn[] = [];
  const baked: { key: string; width: number; height: number }[] = [];
  const frames = new Set<string>();

  const graphics = {
    fillStyle: () => graphics,
    lineStyle: () => graphics,
    fillPoints: (points: Drawn[]) => {
      drawn.push(...points);
      return graphics;
    },
    strokePoints: (points: Drawn[]) => {
      drawn.push(...points);
      return graphics;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      drawn.push({ x, y }, { x: x + w, y: y + h });
      return graphics;
    },
    lineBetween: (x1: number, y1: number, x2: number, y2: number) => {
      drawn.push({ x: x1, y: y1 }, { x: x2, y: y2 });
      return graphics;
    },
    generateTexture: (key: string, width: number, height: number) => {
      baked.push({ key, width, height });
      return graphics;
    },
    clear: () => graphics,
    destroy: () => undefined,
  };

  const scene = {
    make: { graphics: () => graphics },
    textures: {
      exists: () => false,
      remove: () => undefined,
      get: () => ({
        add: (_index: number, x: number, y: number, w: number, h: number) => {
          frames.add(`${x}:${y}:${w}:${h}`);
        },
      }),
    },
  } as unknown as Scene;

  return { scene, drawn, baked, frames };
}

describe("the terrain atlas", () => {
  it("fits every drawn point inside its own canvas", async () => {
    const { bakeTerrainAtlas } = await import("./terrain");
    const { createBaker } = await import("./core");
    const { scene, drawn, baked } = recordingScene();
    const baker = createBaker(scene);

    bakeTerrainAtlas(scene, baker);

    expect(baked).toHaveLength(1);
    const canvas = baked[0]!;
    const minX = Math.min(...drawn.map((point) => point.x));
    const maxX = Math.max(...drawn.map((point) => point.x));
    const minY = Math.min(...drawn.map((point) => point.y));
    const maxY = Math.max(...drawn.map((point) => point.y));

    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(canvas.width);
    expect(maxY).toBeLessThanOrEqual(canvas.height);
  });

  it("gives every (class, mask) pair its own frame", async () => {
    const { bakeTerrainAtlas, ROAD_CLASSES } = await import("./terrain");
    const { createBaker } = await import("./core");
    const { scene, frames } = recordingScene();
    const baker = createBaker(scene);

    bakeTerrainAtlas(scene, baker);

    // 3 classes x 16 masks = 48 distinct road frames, each with its own atlas
    // slot -- plus the non-road ground frames, so strictly more than 48 total.
    expect(frames.size).toBeGreaterThan(48);
    expect(ROAD_CLASSES).toHaveLength(3);
  });
});
