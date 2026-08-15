import type { WorldSnapshot } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { OUTER_RING, buildTerrain } from "./terrain";
import {
  MAX_AIRPORT_RUNWAY_LENGTH,
  MIN_AIRPORT_RUNWAY_LENGTH,
  connectAirportToRoad,
  createAirportLayout,
  runwayExitPoint,
  AIRPORT_APRON_HALF_U,
  AIRPORT_APRON_HALF_V,
  AIRPORT_TERMINAL_HALF_U,
  AIRPORT_TERMINAL_HALF_V,
} from "./airport";

describe("createAirportLayout", () => {
  it("keeps a long airport on the southwest edge of a small city", () => {
    const layout = createAirportLayout(8, 8);

    expect(layout.runwayLength).toBeGreaterThanOrEqual(MIN_AIRPORT_RUNWAY_LENGTH);
    expect(layout.runwayStart.x).toBeLessThan(0);
    expect(layout.runwayStart.y).toBeGreaterThan(7);
    expect(layout.terminal.x).toBeLessThan(0);
    expect(layout.terminal.y).toBeLessThan(layout.runwayStart.y);
    expect(layout.gate.y).toBeLessThan(layout.runwayEntry.y);
    expect(layout.runwayEntry.x).toBeGreaterThan(layout.runwayStart.x + 5);
    expect(layout.runwayEntry.x).toBeLessThan(layout.runwayEnd.x);
    expect(layout.departureThreshold.x).toBeCloseTo(layout.runwayStart.x + 0.42);
    expect(layout.departureThreshold.y).toBe(layout.runwayStart.y);
    expect(layout.runwayEnd.x - layout.departureThreshold.x).toBeGreaterThan(16);
  });

  it("keeps the whole terminal footprint outside the buildable field", () => {
    // The terminal is drawn from its centre and is over five tiles long, so
    // the invariant is about its *near end*, not its grid point: reach x >= 0
    // and the frontage stands through whatever file owns that plot.
    for (const [width, height] of [[8, 8], [20, 14], [64, 40]] as const) {
      const layout = createAirportLayout(width, height);
      expect(
        layout.terminal.x + AIRPORT_TERMINAL_HALF_U < 0 ||
          layout.terminal.y + AIRPORT_TERMINAL_HALF_V > height - 1,
      ).toBe(true);
      expect(layout.terminal.y + AIRPORT_TERMINAL_HALF_V).toBeLessThan(
        layout.runwayStart.y,
      );
    }
  });

  it("stands the control tower on tarmac, clear of the hall and the strip", () => {
    for (const [width, height] of [[8, 8], [20, 14], [64, 40]] as const) {
      const layout = createAirportLayout(width, height);

      // Past the terminal's near end, so the lengthened hall cannot swallow
      // it — but still south of the field's last row, so a positive x does
      // not put the tower on somebody's plot.
      expect(layout.tower.x).toBeGreaterThan(
        layout.terminal.x + AIRPORT_TERMINAL_HALF_U,
      );
      expect(layout.tower.y).toBeGreaterThan(height - 1);
      expect(layout.runwayStart.y - layout.runwayWidth / 2 - layout.tower.y)
        .toBeGreaterThan(0.5);

      // And on the slab: a tower standing in the grass beside the apron is
      // the failure this whole pair of shared extents exists to prevent.
      expect(layout.tower.x).toBeLessThan(layout.apron.x + AIRPORT_APRON_HALF_U);
      expect(layout.tower.y).toBeLessThan(layout.apron.y + AIRPORT_APRON_HALF_V);
    }
  });

  it("keeps the apron under the whole terminal frontage", () => {
    const layout = createAirportLayout(20, 14);

    expect(layout.apron.x - AIRPORT_APRON_HALF_U).toBeLessThan(
      layout.terminal.x - AIRPORT_TERMINAL_HALF_U,
    );
  });

  it("grows with the city but stays within the authored runway kit", () => {
    const medium = createAirportLayout(20, 14);
    const huge = createAirportLayout(500, 300);

    expect(medium.runwayLength).toBeGreaterThan(MIN_AIRPORT_RUNWAY_LENGTH);
    expect(huge.runwayLength).toBe(MAX_AIRPORT_RUNWAY_LENGTH);
    expect(huge.runwayEnd.x - huge.runwayStart.x + 1).toBe(
      MAX_AIRPORT_RUNWAY_LENGTH,
    );
  });

  it("extends takeoff on the exact runway tile line", () => {
    const layout = createAirportLayout(12, 10);
    const exit = runwayExitPoint(layout, 40);

    expect(exit.x).toBe(layout.runwayEnd.x + 40);
    expect(exit.y).toBe(layout.runwayStart.y);
    expect(exit.y).toBe(layout.runwayEnd.y);
  });

  it("keeps taxi geometry clear of the terminal", () => {
    const layout = createAirportLayout(12, 10);

    expect(layout.taxiHold.y).toBeGreaterThan(layout.gate.y);
    expect(layout.taxiway.every((tile) => tile.x === layout.runwayEntry.x)).toBe(true);
  });
});

/**
 * The bug this pins: the arrival cutscene derived its runway from whichever
 * snapshot the scene happened to be holding. Flying a big city's approach into
 * a small one put the aeroplane down in open water, because the runway is
 * placed off the field's own southwest shore and so moves with the field.
 */
describe("a runway belongs to its own field", () => {
  function fieldOf(size: number): WorldSnapshot {
    return {
      id: `world:${size}`,
      repoPath: "/fixture",
      revision: "test",
      generatedAt: "2026-08-11T00:00:00.000Z",
      size: { width: size, height: size },
      districts: [
        { path: "src", x: 0, y: 0, width: size, height: size, weight: 100 },
      ],
      buildings: [],
    };
  }

  it("touches down on dry ground in the city it was derived from", () => {
    for (const size of [24, 40, 64]) {
      const airport = createAirportLayout(size, size);
      const grid = buildTerrain(fieldOf(size));
      const touchdown = grid.cellAt(
        Math.round(airport.runwayEnd.x),
        Math.round(airport.runwayEnd.y),
      );

      expect(touchdown?.kind).not.toBe("water");
    }
  });

  it("aims at nothing at all when flown into a smaller city", () => {
    // The case the user hit, and the reason the landing must be handed the
    // destination's own snapshot rather than the scene's current one: the big
    // city's runway is not merely offshore of the small one, it is past the
    // edge of its ocean entirely.
    const departure = createAirportLayout(64, 64);
    const destination = buildTerrain(fieldOf(24));
    const aimedAt = destination.cellAt(
      Math.round(departure.runwayEnd.x),
      Math.round(departure.runwayEnd.y),
    );

    expect(aimedAt === undefined || aimedAt.kind === "water").toBe(true);
    expect(Math.round(departure.runwayEnd.y)).toBeGreaterThan(
      destination.bounds.maxY - OUTER_RING,
    );
  });
});

describe("connectAirportToRoad", () => {
  it("extends through countryside to the nearest real west-edge road", () => {
    const path = connectAirportToRoad(
      { x: -2, y: 8 },
      [
        { x: 0, y: 0 },
        { x: 0, y: 6 },
        { x: 6, y: 8 },
      ],
    );

    expect(path[0]).toEqual({ x: -2, y: 8 });
    expect(path.at(-1)).toEqual({ x: 0, y: 6 });
    expect(path.slice(0, -1).every((cell) => cell.x < 0)).toBe(true);
  });

  it("falls back safely when terrain has not supplied road cells", () => {
    expect(connectAirportToRoad({ x: -2.2, y: 5.8 }, [])).toEqual([
      { x: -2, y: 6 },
    ]);
  });
});
