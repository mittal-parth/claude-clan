/**
 * Billboard frame baking tests.
 *
 * Checks that every baked billboard frame fits cleanly inside its canvas
 * and that all size and facing variants bake valid textures without errors.
 */

import type { Scene } from "phaser";
import { describe, expect, it, vi } from "vitest";
import { BILLBOARD_SIZES, BILLBOARD_FACINGS } from "../layouts/billboards";

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
} {
  const drawn: Drawn[] = [];
  const baked: { key: string; width: number; height: number }[] = [];

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
    strokeRect: (x: number, y: number, w: number, h: number) => {
      drawn.push({ x, y }, { x: x + w, y: y + h });
      return graphics;
    },
    fillEllipse: (x: number, y: number, width: number, height: number) => {
      const rx = width / 2;
      const ry = height / 2;
      drawn.push({ x: x - rx, y: y - ry }, { x: x + rx, y: y + ry });
      return graphics;
    },
    fillCircle: (x: number, y: number, radius: number) => {
      drawn.push({ x: x - radius, y: y - radius }, { x: x + radius, y: y + radius });
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
    textures: { exists: () => false, remove: () => undefined },
  } as unknown as Scene;

  return { scene, drawn, baked };
}

describe("bakeBillboard", () => {
  for (const size of BILLBOARD_SIZES) {
    for (const facing of BILLBOARD_FACINGS) {
      it(`keeps every drawn point inside the canvas — ${size}, ${facing}`, async () => {
        const { createBaker } = await import("./core");
        const { bakeBillboard } = await import("./billboards");
        const { scene, drawn, baked } = recordingScene();
        const baker = createBaker(scene);

        bakeBillboard(baker, size, facing);

        expect(baked).toHaveLength(1);
        const canvas = baked[0]!;
        expect(Math.min(...drawn.map((p) => p.x))).toBeGreaterThanOrEqual(0);
        expect(Math.min(...drawn.map((p) => p.y))).toBeGreaterThanOrEqual(0);
        expect(Math.max(...drawn.map((p) => p.x))).toBeLessThanOrEqual(canvas.width);
        expect(Math.max(...drawn.map((p) => p.y))).toBeLessThanOrEqual(canvas.height);
      });
    }
  }
});
