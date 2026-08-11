/**
 * The terminal is the airport's landmark and the failure it is prone to is
 * silent: geometry reaching past the canvas is cropped, and the crop only
 * shows at the zoom where someone is looking straight at it. So rather than
 * trusting the derived canvas size, this drives the real bake through a
 * recording Graphics and checks where every point actually landed.
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
    fillRoundedRect: (x: number, y: number, w: number, h: number) => {
      drawn.push({ x, y }, { x: x + w, y: y + h });
      return graphics;
    },
    fillCircle: (x: number, y: number, r: number) => {
      drawn.push({ x: x - r, y: y - r }, { x: x + r, y: y + r });
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

async function bake(
  name: "bakeAirportTerminal" | "bakeAirportTower",
): Promise<void> {
  const { createBaker } = await import("../textures/core");
  const module = await import("../textures/airport/terminal");
  module[name](createBaker(recordingScene()));
}

describe("the baked airport terminal", () => {
  beforeEach(() => {
    drawn.length = 0;
    baked = undefined;
  });

  it("fits every drawn point inside its own canvas", async () => {
    await bake("bakeAirportTerminal");

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
    const { AIRPORT_TERMINAL_ANCHOR_Y } = await import(
      "../textures/airport/terminal"
    );
    await bake("bakeAirportTerminal");

    // The sprite is placed with origin (0.5, 1) at point.y + ANCHOR_Y, so
    // anything drawn lower than that hangs off the bottom of the texture.
    const originY = baked!.height - AIRPORT_TERMINAL_ANCHOR_Y;
    const lowest = Math.max(...drawn.map((point) => point.y));

    expect(lowest - originY).toBeLessThanOrEqual(AIRPORT_TERMINAL_ANCHOR_Y);
  });

  it("draws about a horizontally centred origin", async () => {
    await bake("bakeAirportTerminal");

    // setOrigin(0.5, 1) centres the texture on the tile point, so a drawing
    // origin anywhere else slides the terminal off its own grid square.
    const originX = baked!.width / 2;
    const minX = Math.min(...drawn.map((point) => point.x));
    const maxX = Math.max(...drawn.map((point) => point.x));

    expect(Math.abs((originX - minX) - (maxX - originX))).toBeLessThan(24);
  });

  it("crowns the vault above both flanking piers", async () => {
    await bake("bakeAirportTerminal");

    // The highest point belongs to the barrel vault over the hall. If a pier
    // out-tops it the silhouette has stopped being a terminal, and the roof
    // that the whole design rests on has been buried.
    const highest = drawn.reduce((best, point) => (point.y < best.y ? point : best));
    expect(Math.abs(highest.x - baked!.width / 2)).toBeLessThan(90);
  });

  it("is far longer than it is deep", async () => {
    await bake("bakeAirportTerminal");

    // A terminal reads as a terminal because the frontage runs; the property
    // that matters is the ratio, not the tuned half-extents behind it.
    const { AIRPORT_TERMINAL_HALF_U, AIRPORT_TERMINAL_HALF_V } = await import(
      "./airport"
    );
    expect(AIRPORT_TERMINAL_HALF_U / AIRPORT_TERMINAL_HALF_V).toBeGreaterThan(2.4);
  });
});

describe("the baked control tower", () => {
  beforeEach(() => {
    drawn.length = 0;
    baked = undefined;
  });

  it("fits every drawn point inside its own canvas", async () => {
    await bake("bakeAirportTower");

    const minX = Math.min(...drawn.map((point) => point.x));
    const maxX = Math.max(...drawn.map((point) => point.x));
    const minY = Math.min(...drawn.map((point) => point.y));
    const maxY = Math.max(...drawn.map((point) => point.y));

    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(baked!.width);
    expect(maxY).toBeLessThanOrEqual(baked!.height);
  });
});
