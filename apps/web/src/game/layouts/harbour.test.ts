import { describe, expect, it } from "vitest";
import {
  HARBOUR_QUAY_HALF_U,
  HARBOUR_QUAY_HALF_V,
  createHarbourLayout,
  harbourLayoutKey,
} from "./harbour";
import { coastLanes } from "./coast";
import { createNavyHarbourLayout, NAVY_QUAY_HALF_V } from "./navyHarbour";
import { COAST_RING, COUNTRYSIDE_RING } from "./terrain";

describe("createHarbourLayout", () => {
  it("sits on the east coast, in the centre of its lower half", () => {
    const layout = createHarbourLayout(20, 14);
    const edge = 19;

    expect(layout.mooringLane).toBe(coastLanes(14).harbour);
    // The slab is centred down-coast of the mooring lane, because the yard
    // extension only lengthens the screen-left end -- but the berths it serves
    // still straddle that lane.
    expect(layout.quay.y).toBeGreaterThan(layout.mooringLane);
    expect(Math.abs(layout.quay.y - layout.mooringLane)).toBeLessThan(
      HARBOUR_QUAY_HALF_V,
    );
    // The wharf straddles the sand ring: landward half on the beach, seaward
    // wall standing in the water.
    expect(layout.quay.x - HARBOUR_QUAY_HALF_U).toBeGreaterThan(edge);
    expect(layout.quay.x).toBeGreaterThan(edge + COUNTRYSIDE_RING);
    expect(layout.quay.x).toBeLessThan(edge + COUNTRYSIDE_RING + COAST_RING);
  });

  it("reaches the pier towards the moored ships without touching them", () => {
    const layout = createHarbourLayout(20, 14);
    const pierEnd = layout.pier.at(-1)!;

    expect(layout.pier.length).toBeGreaterThan(0);
    expect(layout.pier.every((tile) => tile.y === layout.mooringLane)).toBe(true);
    // Runs seaward from the quay's outer edge...
    expect(layout.pier[0]!.x).toBeGreaterThan(layout.quay.x + HARBOUR_QUAY_HALF_U);
    // ...and stops a clear tile short of the mooring, so no deck plank is ever
    // drawn under a ship's hull.
    expect(pierEnd.x).toBeLessThan(layout.mooringX - 1);
    expect(layout.pierHead.x).toBeGreaterThan(pierEnd.x);
    expect(layout.pierHead.x).toBeLessThan(layout.mooringX);
  });

  it("fills the screen-left extension with a container yard", () => {
    const layout = createHarbourLayout(20, 14);
    const berthEnd = Math.max(...layout.cranes.map((crane) => crane.y));
    // Grid +v runs screen-left, so the yard is everything past the last berth.
    const yard = layout.containers.filter((stack) => stack.y > berthEnd);

    expect(yard.length).toBeGreaterThanOrEqual(6);
    // Two rows deep, so the stacks read as a yard rather than a single line.
    expect(new Set(yard.map((stack) => stack.x)).size).toBe(2);
    // All of it on the new deck, clear of the working strip and the edges.
    for (const stack of yard) {
      expect(stack.y).toBeLessThanOrEqual(layout.quay.y + HARBOUR_QUAY_HALF_V);
      expect(Math.abs(stack.x - layout.quay.x)).toBeLessThan(HARBOUR_QUAY_HALF_U);
    }
    // Nothing but containers out there -- no crane, cargo pile or lamp strays
    // past the berths onto the yard.
    const others = [...layout.cranes, ...layout.cargo, ...layout.lamps];
    expect(others.every((part) => part.y <= berthEnd + 1)).toBe(true);
  });

  it("spaces the cranes a clear tile apart, leaving the right-most berth open", () => {
    const layout = createHarbourLayout(20, 14);
    const lanes = layout.cranes.map((crane) => crane.y);
    const cargoLanes = layout.cargo.map((pile) => pile.y);

    // Four berths are laid out and stocked, but the right-most carries no
    // crane -- screen-x runs along (gx - gy), so that is the smallest v.
    expect(layout.cargo).toHaveLength(4);
    expect(layout.cranes).toHaveLength(3);
    expect(Math.min(...lanes)).toBeGreaterThan(Math.min(...cargoLanes));

    // A crane portal is ~0.9 tiles across, so a 2-tile stride is a clear tile
    // of quay between neighbours.
    for (let index = 1; index < lanes.length; index += 1) {
      expect(lanes[index]! - lanes[index - 1]!).toBeCloseTo(2);
    }
    // The berths still straddle the mooring lane, so the pier runs out
    // between them rather than into a crane.
    expect(lanes).not.toContain(layout.mooringLane);
    expect(Math.min(...cargoLanes)).toBeLessThan(layout.mooringLane);
    expect(Math.max(...cargoLanes)).toBeGreaterThan(layout.mooringLane);
    // Every crane is on the stone, with its own pile set back behind it.
    for (const crane of layout.cranes) {
      expect(Math.abs(crane.y - layout.quay.y)).toBeLessThan(HARBOUR_QUAY_HALF_V);
      const pile = layout.cargo.find((candidate) => candidate.y === crane.y);
      expect(pile).toBeDefined();
      expect(pile!.x).toBeLessThan(crane.x);
    }
  });

  it("stands the name board on the wharf's seaward, screen-right corner", () => {
    const layout = createHarbourLayout(20, 14);
    const onStone = [...layout.cranes, ...layout.cargo, ...layout.bollards];

    // Furthest along screen-x, which runs on (gx - gy), of anything standing
    // on the quay -- so nothing on the wharf is between it and the water.
    const boardScreenX = layout.sign.x - layout.sign.y;
    for (const part of onStone) {
      expect(boardScreenX).toBeGreaterThan(part.x - part.y);
    }
    // Set in from both sea walls, but still on the stone.
    expect(layout.sign.x).toBeLessThan(layout.quay.x + HARBOUR_QUAY_HALF_U);
    expect(layout.sign.x).toBeGreaterThan(layout.quay.x - HARBOUR_QUAY_HALF_U);
    expect(layout.sign.y).toBeGreaterThan(layout.quay.y - HARBOUR_QUAY_HALF_V);
    expect(layout.sign.y).toBeLessThan(layout.quay.y + HARBOUR_QUAY_HALF_V);
    // No bollard left sharing the corner slot.
    for (const bollard of layout.bollards) {
      expect(Math.abs(bollard.y - layout.sign.y)).toBeGreaterThan(0.5);
    }
  });

  it("berths the container ship under the working crane's hook", () => {
    const layout = createHarbourLayout(20, 14);

    // The working crane is the screen-left-most of the row, so the ship lies
    // at the far end of the berths rather than in the middle of them.
    expect(layout.workingCrane.y).toBe(Math.max(...layout.cranes.map((c) => c.y)));
    expect(layout.cranes).toContainEqual(layout.workingCrane);

    // She floats off the stone, between the wharf wall and the PR moorings,
    // so neither the quay nor the fleet is drawn through her.
    expect(layout.containerShip.x).toBeGreaterThan(
      layout.quay.x + HARBOUR_QUAY_HALF_U,
    );
    expect(layout.containerShip.x).toBeLessThan(layout.mooringX);

    // The hold lies seaward of the crane, and the set-down spot a right angle
    // round from it, along the quay -- so the jib swings a quarter turn
    // between the two rather than reaching over its own portal.
    expect(layout.containerShip.x).toBeGreaterThan(layout.workingCrane.x);
    expect(layout.containerDrop.x).toBeCloseTo(layout.workingCrane.x);
    expect(layout.containerDrop.y).toBeGreaterThan(layout.workingCrane.y);
    // And the set-down lands on the wharf, not in the water.
    expect(Math.abs(layout.containerDrop.x - layout.quay.x)).toBeLessThan(
      HARBOUR_QUAY_HALF_U,
    );
    expect(Math.abs(layout.containerDrop.y - layout.quay.y)).toBeLessThan(
      HARBOUR_QUAY_HALF_V,
    );
    // Clear of the yard stacks, so the box is not set down on top of one.
    for (const stack of layout.containers) {
      const gap =
        Math.abs(stack.x - layout.containerDrop.x) +
        Math.abs(stack.y - layout.containerDrop.y);
      expect(gap).toBeGreaterThan(0.9);
    }
  });

  it("keeps every quayside prop on the stone", () => {
    const layout = createHarbourLayout(20, 14);
    // The pier and lighthouse are excluded by design: both stand off the slab
    // in open water.
    const parts = [
      layout.warehouse,
      ...layout.cranes,
      ...layout.containers,
      ...layout.cargo,
      layout.sign,
      ...layout.bollards,
      ...layout.lamps,
    ];
    for (const part of parts) {
      expect(Math.abs(part.y - layout.quay.y)).toBeLessThanOrEqual(
        HARBOUR_QUAY_HALF_V,
      );
      expect(Math.abs(part.x - layout.quay.x)).toBeLessThanOrEqual(
        HARBOUR_QUAY_HALF_U,
      );
    }
  });

  it("stands the lighthouse mid-coast, in clear water between the two ports", () => {
    const width = 20;
    const height = 40;
    const layout = createHarbourLayout(width, height);
    const navy = createNavyHarbourLayout(width, height);

    // Mid-coast: the seam between the naval base's half and the harbour's.
    expect(layout.lighthouse.y).toBe(coastLanes(height).lighthouse);
    // Clear of both aprons, so the tower never stands on either slab.
    expect(layout.lighthouse.y).toBeGreaterThan(navy.quay.y + NAVY_QUAY_HALF_V);
    expect(layout.lighthouse.y).toBeLessThan(layout.quay.y - HARBOUR_QUAY_HALF_V);
    // Out at the water line rather than back on the beach, and still inshore
    // of the moorings so it never sits on top of a PR ship.
    expect(layout.lighthouse.x).toBeGreaterThan(
      19 + COUNTRYSIDE_RING + COAST_RING - 1,
    );
    expect(layout.lighthouse.x).toBeLessThan(layout.mooringX);
  });

  it("scales with the city and stays stable for an unchanged size", () => {
    const small = createHarbourLayout(8, 8);
    const large = createHarbourLayout(60, 40);

    expect(small.quay.x).toBeLessThan(large.quay.x);
    expect(small.mooringLane).toBe(coastLanes(8).harbour);
    expect(large.mooringLane).toBe(coastLanes(40).harbour);
    // A taller city pushes the wharf further down its own coast.
    expect(small.mooringLane).toBeLessThan(large.mooringLane);
    expect(harbourLayoutKey(createHarbourLayout(20, 14))).toBe(
      harbourLayoutKey(createHarbourLayout(20, 14)),
    );
    expect(harbourLayoutKey(small)).not.toBe(harbourLayoutKey(large));
  });
});
