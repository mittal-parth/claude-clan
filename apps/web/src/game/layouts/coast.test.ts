import { describe, expect, it } from "vitest";

import {
  COAST_QUAY_HALF_U,
  COAST_QUAY_HALF_V,
  coastLanes,
  coastLighthouse,
  coastQuayX,
  coastWaterLine,
} from "./coast";
import { createHarbourLayout } from "./harbour";
import { createNavyHarbourLayout } from "./navyHarbour";
import { buildTerrain } from "./terrain";
import { portFrontageSnapshot } from "../test-support/worldSnapshot";

describe("coastLanes", () => {
  it("puts the lighthouse mid-coast with a port centred in each half", () => {
    const height = 40;
    const lanes = coastLanes(height);

    expect(lanes.lighthouse).toBe(height / 2);
    expect(lanes.navy).toBe(height / 4);
    expect(lanes.harbour).toBe((height * 3) / 4);
  });

  it("keeps the two ports symmetric about the lighthouse at every size", () => {
    for (const height of [12, 24, 37, 40, 96]) {
      const lanes = coastLanes(height);
      expect(lanes.lighthouse - lanes.navy).toBeCloseTo(
        lanes.harbour - lanes.lighthouse,
      );
      expect(lanes.navy).toBeLessThan(lanes.lighthouse);
      expect(lanes.lighthouse).toBeLessThan(lanes.harbour);
    }
  });

  it("never lets the two aprons touch, however short the coast is", () => {
    for (const height of [1, 8, 12, 20, 40]) {
      const lanes = coastLanes(height);
      const gap =
        lanes.harbour - COAST_QUAY_HALF_V - (lanes.navy + COAST_QUAY_HALF_V);
      // The floor is 2 tiles; the slack absorbs float error in the subtraction.
      expect(gap).toBeGreaterThan(1.99);
    }
  });

  it("seats both aprons so no beach shows in front of the sea wall", () => {
    const size = 40;
    const grid = buildTerrain(portFrontageSnapshot(size));
    const seaWall = coastQuayX(size) + COAST_QUAY_HALF_U;

    expect(seaWall).toBe(coastWaterLine(size));
    // Along the whole frontage, the last sand cell's own diamond must end at
    // the sea wall -- a cell is drawn half a tile past its centre.
    for (let y = 0; y < size; y += 1) {
      for (let x = size; x < size + 14; x += 1) {
        const cell = grid.cellAt(x, y);
        if (cell?.kind !== "sand") continue;
        expect(
          x + 0.5,
          `sand at (${x},${y}) reaches past the sea wall`,
        ).toBeLessThanOrEqual(seaWall);
      }
    }
  });

  it("leaves open water under both berths and the jetties reaching them", () => {
    const size = 40;
    const grid = buildTerrain(portFrontageSnapshot(size));
    const harbour = createHarbourLayout(size, size);
    const navy = createNavyHarbourLayout(size, size);

    const afloat = (point: { x: number; y: number }, what: string): void => {
      const cell = grid.cellAt(Math.round(point.x), Math.round(point.y));
      expect(cell?.kind, `${what} is aground on ${cell?.kind}`).toBe("water");
    };

    afloat(harbour.containerShip, "the container ship");
    afloat(navy.battleship, "the battleship");
    for (const tile of [...harbour.pier, ...navy.pier]) {
      // A jetty deck is planked over water, never over the beach.
      expect(tile.x).toBeGreaterThan(coastWaterLine(size));
    }
  });

  it("stands the lighthouse on the coast's own lane", () => {
    expect(coastLighthouse(20, 40).y).toBe(coastLanes(40).lighthouse);
    // Further out to sea on a wider city, because the coast itself moves out.
    expect(coastLighthouse(40, 40).x).toBeGreaterThan(coastLighthouse(20, 40).x);
  });
});
