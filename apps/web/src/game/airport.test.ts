import { describe, expect, it } from "vitest";
import {
  MAX_AIRPORT_RUNWAY_LENGTH,
  MIN_AIRPORT_RUNWAY_LENGTH,
  connectAirportToRoad,
  createAirportLayout,
  runwayExitPoint,
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
