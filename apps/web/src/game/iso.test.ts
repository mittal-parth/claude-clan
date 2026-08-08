import { describe, expect, it } from "vitest";
import { createIsoProjection } from "./iso";

const TILE_WIDTH = 96;
const TILE_HEIGHT = 48;

describe("isometric projection", () => {
  const projection = createIsoProjection(TILE_WIDTH, TILE_HEIGHT);

  it("round-trips grid coordinates through screen space", () => {
    for (let x = -20; x <= 20; x += 3) {
      for (let y = -20; y <= 20; y += 3) {
        const screen = projection.project(x, y);
        const grid = projection.unproject(screen.x, screen.y);
        expect(grid.x).toBeCloseTo(x, 9);
        expect(grid.y).toBeCloseTo(y, 9);
      }
    }
  });

  it("recovers the cell a pointer lands in anywhere within the diamond", () => {
    // Picking rounds the unprojected point, so every offset inside the tile
    // must round back to the tile itself.
    const offsets: Array<[number, number]> = [
      [0, 0],
      [TILE_WIDTH / 4, 0],
      [-TILE_WIDTH / 4, 0],
      [0, TILE_HEIGHT / 4],
      [0, -TILE_HEIGHT / 4],
    ];
    for (const [dx, dy] of offsets) {
      const center = projection.project(6, 9);
      const grid = projection.unproject(center.x + dx, center.y + dy);
      expect(Math.round(grid.x)).toBe(6);
      expect(Math.round(grid.y)).toBe(9);
    }
  });

  it("lays the grid out as a 2:1 diamond", () => {
    expect(projection.project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(projection.project(1, 0)).toEqual({ x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
    expect(projection.project(0, 1)).toEqual({ x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
    expect(projection.project(1, 1)).toEqual({ x: 0, y: TILE_HEIGHT });
  });

  it("lifts a tile straight up by its elevation", () => {
    const flat = projection.project(3, 4);
    const raised = projection.project(3, 4, 40);

    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 40);
  });

  it("orders depth back-to-front along the view axis", () => {
    expect(projection.depth(0, 0)).toBeLessThan(projection.depth(1, 0));
    expect(projection.depth(1, 0)).toBeLessThan(projection.depth(1, 1));
    expect(projection.depth(5, 5)).toBeLessThan(projection.depth(5, 6));
  });
});
