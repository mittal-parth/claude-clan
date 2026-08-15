import { describe, expect, it } from "vitest";

import {
  NAVY_QUAY_HALF_U,
  NAVY_QUAY_HALF_V,
  createNavyHarbourLayout,
  navyHarbourLayoutKey,
  type HarbourPoint,
} from "./navyHarbour";
import { createHarbourLayout, HARBOUR_QUAY_HALF_V } from "./harbour";

/**
 * Roughly how much apron each prop occupies, in tiles, measured from its tile
 * point. These are the numbers the "not cramped" property is judged against;
 * the positions themselves are knobs and are free to move.
 */
const FOOTPRINT: Record<string, number> = {
  command: 0.88,
  hangar: 0.95,
  barracks: 0.75,
  radar: 0.55,
  missile: 0.5,
  gun: 0.45,
  panzer: 0.5,
  fuelTank: 0.45,
  helipad: 0.8,
  flag: 0.25,
  floodlight: 0.25,
  bollard: 0.15,
  crate: 0.3,
  sign: 0.4,
};

interface PlacedProp {
  name: string;
  kind: keyof typeof FOOTPRINT;
  point: HarbourPoint;
}

/** Every prop that stands on the open apron. The perimeter fence is a run by design. */
function placedProps(
  layout: ReturnType<typeof createNavyHarbourLayout>,
): PlacedProp[] {
  const many = (kind: string, points: HarbourPoint[]): PlacedProp[] =>
    points.map((point, index) => ({ name: `${kind}[${index}]`, kind, point }));

  return [
    { name: "command", kind: "command", point: layout.command },
    { name: "hangar", kind: "hangar", point: layout.hangar },
    { name: "barracks", kind: "barracks", point: layout.barracks },
    { name: "helipad", kind: "helipad", point: layout.helicopterPad },
    { name: "sign", kind: "sign", point: layout.sign },
    ...many("radar", layout.radar),
    ...many("missile", layout.missileBatteries),
    ...many("gun", layout.gunEmplacements),
    ...many("panzer", layout.panzers),
    ...many("fuelTank", layout.fuelTanks),
    ...many("flag", layout.flags),
    ...many("floodlight", layout.floodlights),
    ...many("bollard", layout.bollards),
    ...many("crate", layout.crates),
  ];
}

describe("naval base layout", () => {
  const layout = createNavyHarbourLayout(80, 60);

  it("keeps the base kit inside the raised apron footprint", () => {
    const props = [...placedProps(layout).map((p) => p.point), ...layout.fences];

    for (const point of props) {
      expect(Math.abs(point.x - layout.quay.x)).toBeLessThanOrEqual(
        NAVY_QUAY_HALF_U,
      );
      expect(Math.abs(point.y - layout.quay.y)).toBeLessThanOrEqual(
        NAVY_QUAY_HALF_V,
      );
    }
  });

  it("never lets two props crowd each other's footprint", () => {
    const props = placedProps(layout);
    for (let i = 0; i < props.length; i += 1) {
      for (let j = i + 1; j < props.length; j += 1) {
        const a = props[i]!;
        const b = props[j]!;
        const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
        const clearance = FOOTPRINT[a.kind]! + FOOTPRINT[b.kind]!;
        expect(
          distance,
          `${a.name} and ${b.name} are ${distance.toFixed(2)} apart, need ${clearance}`,
        ).toBeGreaterThanOrEqual(clearance);
      }
    }
  });

  it("leaves the berth apron clear so the jetty and ship stay readable", () => {
    // A corridor along the mooring lane, on the seaward half of the apron.
    for (const { name, point } of placedProps(layout)) {
      if (name.startsWith("bollard")) continue;
      const seaward = point.x - layout.quay.x > 0.6;
      const onLane = Math.abs(point.y - layout.quay.y) < 0.8;
      expect(seaward && onLane, `${name} blocks the berth`).toBe(false);
    }
  });

  it("puts the tall masses at the far and inland sides of the apron", () => {
    for (const point of [layout.command, layout.hangar, layout.barracks, ...layout.radar]) {
      expect(point.x).toBeLessThan(layout.quay.x);
    }
  });

  it("runs a continuous perimeter fence down the inland lip", () => {
    expect(layout.fences.length).toBeGreaterThan(8);
    const inlandLip = layout.quay.x - NAVY_QUAY_HALF_U;
    for (const panel of layout.fences) {
      expect(panel.x - inlandLip).toBeLessThan(0.3);
    }
    const lanes = layout.fences.map((panel) => panel.y).sort((a, b) => a - b);
    for (let i = 1; i < lanes.length; i += 1) {
      // Panels are 0.92 tiles long, so a stride under that leaves no gap.
      expect(lanes[i]! - lanes[i - 1]!).toBeLessThan(0.92);
    }
  });

  it("keeps a clear stretch of coast between the naval and cargo aprons", () => {
    const cargo = createHarbourLayout(80, 60);
    const navyNearEnd = layout.quay.y + NAVY_QUAY_HALF_V;
    const cargoFarEnd = cargo.quay.y - HARBOUR_QUAY_HALF_V;
    expect(cargoFarEnd - navyNearEnd).toBeGreaterThanOrEqual(1.5);
  });

  it("keeps the battleship beyond the apron and lays a finite jetty toward it", () => {
    expect(layout.battleship.x).toBeGreaterThan(
      layout.quay.x + NAVY_QUAY_HALF_U,
    );
    expect(layout.pier.length).toBeGreaterThan(0);
    expect(layout.pier.length).toBeLessThanOrEqual(3);
    expect(layout.pier.at(-1)?.x).toBeLessThan(layout.battleship.x);
    for (const tile of layout.pier) {
      expect(tile.y).toBe(layout.mooringLane);
    }
  });

  it("changes its signature when the world geometry changes", () => {
    const larger = createNavyHarbourLayout(96, 60);
    expect(navyHarbourLayoutKey(larger)).not.toBe(navyHarbourLayoutKey(layout));
  });
});
