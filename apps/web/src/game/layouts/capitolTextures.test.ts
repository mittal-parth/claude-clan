/**
 * The capitol is the largest single texture in the world, and the failure it
 * is prone to is silent: geometry that reaches past the canvas is simply
 * cropped, and the crop only shows at the zoom where someone is looking
 * straight at the building. The first version shipped with its terrace sliced
 * off along a hard horizontal line for exactly this reason.
 *
 * So rather than trusting the derived canvas size, this drives the real bake
 * through a recording Graphics and checks where every point actually landed.
 */

import type { Scene } from "phaser";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const drawn: Drawn[] = [];
let baked: { key: string; width: number; height: number } | undefined;

function recordingScene(): Scene {
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
      baked = { key, width, height };
      return graphics;
    },
    clear: () => graphics,
    destroy: () => undefined,
  };

  return {
    make: { graphics: () => graphics },
    textures: { exists: () => false, remove: () => undefined },
  } as unknown as Scene;
}

describe("the baked capitol", () => {
  beforeEach(() => {
    drawn.length = 0;
    baked = undefined;
  });

  it("fits every drawn point inside its own canvas", async () => {
    const { bakeCapitol } = await import("../textures/capitol/base");
    bakeCapitol(recordingScene());

    expect(baked).toBeDefined();
    const minX = Math.min(...drawn.map((point) => point.x));
    const maxX = Math.max(...drawn.map((point) => point.x));
    const minY = Math.min(...drawn.map((point) => point.y));
    const maxY = Math.max(...drawn.map((point) => point.y));

    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(baked!.width);
    expect(maxY).toBeLessThanOrEqual(baked!.height);
  });

  it("reserves exactly the room below its tile point that it uses", async () => {
    const { bakeCapitol, CAPITOL_ANCHOR_Y } = await import("../textures/capitol/base");
    bakeCapitol(recordingScene());

    // The sprite is placed with origin (0.5, 1) at point.y + CAPITOL_ANCHOR_Y,
    // so anything drawn lower than ANCHOR_Y below the tile point hangs off the
    // bottom of the texture and is cropped.
    const originY = baked!.height - CAPITOL_ANCHOR_Y;
    const lowest = Math.max(...drawn.map((point) => point.y));

    expect(lowest - originY).toBeLessThanOrEqual(CAPITOL_ANCHOR_Y);
  });

  it("draws about a horizontally centred origin", async () => {
    const { bakeCapitol } = await import("../textures/capitol/base");
    bakeCapitol(recordingScene());

    // setOrigin(0.5, 1) centres the texture on the tile point, so a drawing
    // origin anywhere else slides the whole building off its own grid square.
    const originX = baked!.width / 2;
    const minX = Math.min(...drawn.map((point) => point.x));
    const maxX = Math.max(...drawn.map((point) => point.x));

    expect(originX - minX).toBeGreaterThan(0);
    expect(maxX - originX).toBeGreaterThan(0);
  });

  it("stands the dome above every other mass", async () => {
    const { bakeCapitol } = await import("../textures/capitol/base");
    bakeCapitol(recordingScene());

    // The highest point on the map should be on the building's centre line —
    // if a wing out-tops the dome, the silhouette has stopped being a capitol.
    const highest = drawn.reduce((best, point) =>
      point.y < best.y ? point : best,
    );
    expect(Math.abs(highest.x - baked!.width / 2)).toBeLessThan(20);
  });
});
