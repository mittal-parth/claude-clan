/**
 * The house and townhouse bakes gained a facing-dependent doorway/awning
 * (see FACING_VARIES) -- a small addition, but it is new geometry on an
 * existing wall, and the failure mode for anything drawn off a baked
 * texture's canvas is silent clipping, not an error. Driving the real bake
 * through a recording Graphics and checking where the points actually
 * landed is the cheap way to catch that (see the isometric-props skill).
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

function recordingScene(): { scene: Scene; drawn: Drawn[]; baked: { key: string; width: number; height: number }[] } {
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

describe("the baked house and townhouse, with a street-facing doorway", () => {
  it.each(["house", "townhouse"] as const)(
    "keeps every drawn point inside its own canvas — %s, facing v",
    async (archetype) => {
      const { bakeBuilding } = await import("./buildings");
      const { scene, drawn, baked } = recordingScene();

      bakeBuilding(scene, archetype, 1, "TypeScript", "v");

      expect(baked).toHaveLength(1);
      const canvas = baked[0]!;
      expect(Math.min(...drawn.map((p) => p.x))).toBeGreaterThanOrEqual(0);
      expect(Math.min(...drawn.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...drawn.map((p) => p.x))).toBeLessThanOrEqual(canvas.width);
      expect(Math.max(...drawn.map((p) => p.y))).toBeLessThanOrEqual(canvas.height);
    },
  );

  it.each(["house", "townhouse"] as const)(
    "keeps every drawn point inside its own canvas — %s, facing u",
    async (archetype) => {
      const { bakeBuilding } = await import("./buildings");
      const { scene, drawn, baked } = recordingScene();

      bakeBuilding(scene, archetype, 1, "TypeScript", "u");

      expect(baked).toHaveLength(1);
      const canvas = baked[0]!;
      expect(Math.min(...drawn.map((p) => p.x))).toBeGreaterThanOrEqual(0);
      expect(Math.min(...drawn.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...drawn.map((p) => p.x))).toBeLessThanOrEqual(canvas.width);
      expect(Math.max(...drawn.map((p) => p.y))).toBeLessThanOrEqual(canvas.height);
    },
  );

  it.each(["office", "tower", "utility"] as const)(
    "keeps every drawn point inside its own canvas — %s (no facing-dependent geometry)",
    async (archetype) => {
      const { bakeBuilding } = await import("./buildings");
      const { scene, drawn, baked } = recordingScene();

      bakeBuilding(scene, archetype, 2, "TypeScript", "v");

      expect(baked).toHaveLength(1);
      const canvas = baked[0]!;
      expect(Math.min(...drawn.map((p) => p.x))).toBeGreaterThanOrEqual(0);
      expect(Math.min(...drawn.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...drawn.map((p) => p.x))).toBeLessThanOrEqual(canvas.width);
      expect(Math.max(...drawn.map((p) => p.y))).toBeLessThanOrEqual(canvas.height);
    },
  );

  it("gives the two facings distinct texture keys, so both bake and neither overwrites the other", async () => {
    const { buildingTextureKey } = await import("./buildings");

    expect(buildingTextureKey("house", 1, "TypeScript", "u")).not.toBe(
      buildingTextureKey("house", 1, "TypeScript", "v"),
    );
    // Office has no facing-dependent geometry, so its key is unaffected --
    // the cache is not doubled for archetypes where the two would be identical.
    expect(buildingTextureKey("office", 1, "TypeScript", "u")).toBe(
      buildingTextureKey("office", 1, "TypeScript", "v"),
    );
  });
});
