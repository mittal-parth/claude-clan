import { BLOCK } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { COAST_QUAY_HALF_U, coastLanes, coastQuayX } from "./coast";
import { createPortRoads, type PortRoadOptions, type PortRoadPlan } from "./portRoads";
import { COAST_RING, COUNTRYSIDE_RING } from "./terrain";

/**
 * A field with the global lattice's own street rows — exactly what
 * classifyCity produces, since isRoadLane no longer takes a district.
 */
function plan(width: number, height: number, overrides: Partial<PortRoadOptions> = {}): PortRoadPlan {
  return createPortRoads({
    width,
    height,
    isLand: (x, y) =>
      Math.hypot(
        x < 0 ? -x : Math.max(0, x - (width - 1)),
        y < 0 ? -y : Math.max(0, y - (height - 1)),
      ) <= COUNTRYSIDE_RING + COAST_RING,
    isCityRoad: (x, y) =>
      x >= 0 && x < width && y >= 0 && y < height && y % BLOCK === 0,
    ...overrides,
  });
}

const SIZES: Array<[number, number]> = [
  [16, 16],
  [24, 40],
  [48, 60],
  [12, 12],
];

describe("the dock road", () => {
  it("never lays a tile inside the city field", () => {
    for (const [width, height] of SIZES) {
      for (const cell of plan(width, height).cells) {
        expect(cell.x).toBeGreaterThan(width - 1);
      }
    }
  });

  it("stays clear of the aprons it serves", () => {
    for (const [width, height] of SIZES) {
      const lip = coastQuayX(width) - COAST_QUAY_HALF_U;
      for (const cell of plan(width, height).cells) {
        // Half a tile of the cell's own diamond, and it must still not reach.
        expect(cell.x + 0.5).toBeLessThan(lip);
      }
    }
  });

  it("is one connected run, not islands of tarmac", () => {
    for (const [width, height] of SIZES) {
      const road = plan(width, height);
      expect(road.cells.length).toBeGreaterThan(0);

      const seen = new Set<string>([`${road.cells[0]!.x}:${road.cells[0]!.y}`]);
      const queue = [road.cells[0]!];
      while (queue.length > 0) {
        const { x, y } = queue.pop()!;
        for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
          const key = `${nx}:${ny}`;
          if (road.has(nx!, ny!) && !seen.has(key)) {
            seen.add(key);
            queue.push({ x: nx!, y: ny! });
          }
        }
      }
      expect(seen.size).toBe(road.cells.length);
    }
  });

  it("runs past both aprons, so the two ports are joined to each other", () => {
    for (const [width, height] of SIZES) {
      const road = plan(width, height);
      const lanes = coastLanes(height);

      expect(road.has(road.spineX, Math.round(lanes.navy))).toBe(true);
      expect(road.has(road.spineX, Math.round(lanes.harbour))).toBe(true);
    }
  });

  it("reaches the city edge on a row that is already a street", () => {
    for (const [width, height] of SIZES) {
      const road = plan(width, height);

      // The last inland tile abuts the field; the edge cell itself is the
      // city's own street, which is what makes the junction.
      expect(road.has(width, road.linkRow)).toBe(true);
      expect(road.linkRow % BLOCK).toBe(0);
    }
  });

  it("joins the city as near the middle of the coast as a street allows", () => {
    // Both ports should get a comparable run inland rather than the link
    // hanging off one end of the spine.
    const road = plan(48, 60);
    const lanes = coastLanes(60);

    expect(Math.abs(road.linkRow - lanes.lighthouse)).toBeLessThanOrEqual(
      BLOCK / 2,
    );
  });

  it("stops at the water rather than planking across it", () => {
    for (const [width, height] of SIZES) {
      const isLand = (x: number, y: number): boolean =>
        Math.hypot(
          x < 0 ? -x : Math.max(0, x - (width - 1)),
          y < 0 ? -y : Math.max(0, y - (height - 1)),
        ) <= COUNTRYSIDE_RING + COAST_RING;
      for (const cell of plan(width, height).cells) {
        expect(isLand(cell.x, cell.y)).toBe(true);
      }
    }
  });

  it("lays nothing at all when its own junction is under water", () => {
    const road = plan(16, 16, { isLand: () => false });

    expect(road.cells).toEqual([]);
  });

  it("still reaches the coast when the field has no streets to join", () => {
    const road = plan(16, 16, { isCityRoad: () => false });
    const lanes = coastLanes(16);

    expect(road.has(road.spineX, Math.round(lanes.navy))).toBe(true);
    expect(road.has(road.spineX, Math.round(lanes.harbour))).toBe(true);
  });

  it("is deterministic", () => {
    expect(plan(24, 40).cells).toEqual(plan(24, 40).cells);
  });
});
