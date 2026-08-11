/**
 * Harbour layout — pure geometry, no Phaser, so it stays unit-testable the same
 * way the airport's does.
 *
 * The airport owns the island's southwest edge; the harbour owns the opposite
 * corner. Ships moor on main's east coast (layoutShips docks them at
 * `width - 1 + COUNTRYSIDE_RING + COAST_RING + 2`, centred on the `height / 2`
 * lane), and in the isometric projection +x and +y both run screen-down, so
 * that coast is the bottom-right of the screen. Every measurement here is
 * anchored to those two facts: the quay sits in the sand ring on the mooring
 * lane, and the pier reaches out towards the ships without touching them.
 */

import {
  COAST_QUAY_HALF_U,
  COAST_QUAY_HALF_V,
  coastLanes,
  coastLighthouse,
  coastQuayX,
} from "./coast";
import { COAST_RING, COUNTRYSIDE_RING } from "./terrain";

export interface HarbourPoint {
  x: number;
  y: number;
}

export interface HarbourLayout {
  /** Centre of the stone wharf slab. */
  quay: HarbourPoint;
  quayHalfU: number;
  quayHalfV: number;
  /** Timber deck tiles running seaward from the wharf's outer edge. */
  pier: HarbourPoint[];
  /** Channel marker beside the pier head. */
  pierHead: HarbourPoint;
  warehouse: HarbourPoint;
  /** A row of gantry cranes along the seaward edge, one tile clear of each other. */
  cranes: HarbourPoint[];
  /**
   * Container stacks: one beside the berths, the rest filling the yard on the
   * wharf's screen-left extension. The scene paints each a different colour.
   */
  containers: HarbourPoint[];
  /** Cargo piles, one per crane; the scene colours each differently. */
  cargo: HarbourPoint[];
  /** The PORT name board, on the wharf's seaward, screen-right corner. */
  sign: HarbourPoint;
  /**
   * The crane that works the container ship: the screen-left-most one, which
   * is the largest v because screen-x runs on (gx - gy).
   */
  workingCrane: HarbourPoint;
  /** Berth for the single container ship, right under the working crane's hook. */
  containerShip: HarbourPoint;
  /**
   * Where the outbound container waits on the quay, and where an arriving one
   * is set down: a right angle round from the ship, along the wharf.
   */
  containerDrop: HarbourPoint;
  lighthouse: HarbourPoint;
  bollards: HarbourPoint[];
  lamps: HarbourPoint[];
  /** Where layoutShips moors the fleet; the pier is aimed at this lane. */
  mooringLane: number;
  mooringX: number;
}

/** The wharf is one of the coast's two identical aprons. */
export const HARBOUR_QUAY_HALF_U = COAST_QUAY_HALF_U;
export const HARBOUR_QUAY_HALF_V = COAST_QUAY_HALF_V;

/**
 * Extra deck at the screen-left end of the wharf — grid +v, which runs
 * screen-left — given over to a container yard.
 */
const QUAY_YARD_LENGTH = 4;
/** Growing only one end slides the slab's centre half that far down-coast. */
const QUAY_CENTRE_SHIFT = QUAY_YARD_LENGTH / 2;
/**
 * What is left for berthing once the yard has taken its end. The cranes and
 * their cargo piles are laid out against this, not the whole slab.
 */
const QUAY_BERTH_HALF_V = HARBOUR_QUAY_HALF_V - QUAY_CENTRE_SHIFT;

/** Cranes and their cargo piles, paired off along the quay. */
const BERTHS = 4;
/**
 * Centre-to-centre spacing. A crane's portal is ~0.9 tiles across, so a
 * 2-tile stride leaves the full tile of clear quay between neighbours.
 */
const BERTH_STRIDE = 2;

/** Deck tiles overlap slightly at this stride so the pier reads as continuous. */
const PIER_STRIDE = 0.9;
/**
 * The pier is laid tile by tile until it runs out of clear water rather than
 * being a fixed length: deepening the wharf eats into the same stretch of
 * water, and a fixed-length pier would end up planked under a ship's hull.
 */
const PIER_MAX_TILES = 3;

/**
 * The name board is nudged off the wharf's corner in the same screen-space
 * terms as the lighthouse: tiles left along screen-x, and tiles up the screen
 * — which, from the seaward corner, is back inland.
 */
const SIGN_LEFT = 0.5;
const SIGN_INSET = 0;

/**
 * Mirrors of the crane and ship geometry authored in textures.ts. Kept as
 * plain numbers here so this module stays free of the Phaser-side import and
 * remains unit-testable; the texture module is the authority and these are
 * asserted against it in the scene's own constants.
 */
const CRANE_TROLLEY_REACH = 1.55;
const CRANE_TROLLEY_PICK = 1.1;
/** Grid-v offset from the ship's centre to the middle of its cargo bay. */
const SHIP_BAY_V = -0.2;

/**
 * Reserves the harbour on the island's east (bottom-right) coast, centred on
 * the lane the PR ships moor in.
 */
export function createHarbourLayout(width: number, height: number): HarbourLayout {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const edge = safeWidth - 1;
  const lane = coastLanes(safeHeight).harbour;

  // Seated so the sea wall lands on the water line -- see coast.ts.
  const quayX = coastQuayX(safeWidth);
  const seawardEdge = quayX + HARBOUR_QUAY_HALF_U;

  const mooringX = edge + COUNTRYSIDE_RING + COAST_RING + 2;
  const pier: HarbourPoint[] = [];
  for (
    let x = seawardEdge + 0.3;
    // Stop a clear tile short of the moorings.
    x <= mooringX - 1 && pier.length < PIER_MAX_TILES;
    x += PIER_STRIDE
  ) {
    pier.push({ x, y: lane });
  }
  const pierEnd = pier[pier.length - 1]!;

  // Berth lanes, centred on the mooring lane so the row stays symmetric about
  // the pier: at four berths and a 2-tile stride, that is lane -3, -1, +1, +3.
  const berths = Array.from(
    { length: BERTHS },
    (_unused, index) => lane + (index - (BERTHS - 1) / 2) * BERTH_STRIDE,
  );

  // Container yard on the new deck: two rows deep, three stacks along, inset
  // from the extension's edges so a walkway runs right round the boxes.
  const yardStart = lane + QUAY_BERTH_HALF_V;
  const yard: HarbourPoint[] = [];
  for (const row of [-0.85, 0.6]) {
    for (let column = 0; column < 3; column += 1) {
      yard.push({ x: quayX + row, y: yardStart + 0.75 + column * 1.25 });
    }
  }

  // The working crane is the screen-left-most, i.e. the largest v. Its hook
  // runs out along +u; the ship berths where the hook reaches, and sets down
  // on the quay where the trolley parks.
  const craneX = quayX + 1.0;
  const workingCrane = { x: craneX, y: berths[berths.length - 1]! };

  return {
    quay: { x: quayX, y: lane + QUAY_CENTRE_SHIFT },
    quayHalfU: HARBOUR_QUAY_HALF_U,
    quayHalfV: HARBOUR_QUAY_HALF_V,
    pier,
    pierHead: { x: pierEnd.x + 0.45, y: lane + 0.4 },
    // Landward, screen-up corner: the shed never hides the quay furniture.
    warehouse: { x: quayX - 1.12, y: lane - 2.7 },
    // Seaward edge, so every jib overhangs the water. The berths straddle the
    // mooring lane, leaving the pier a clear run out between the middle pair.
    //
    // The right-most berth is deliberately left as open quay: screen-x runs
    // along (gx - gy), so that is the smallest v, i.e. the head of the list.
    // Its cargo pile stays -- only the crane is gone.
    cranes: berths.slice(1).map((v) => ({ x: craneX, y: v })),
    workingCrane,
    // Lying along v, parallel to the quay wall. Offset in v by the ship's own
    // bay position so the cargo cell, not the hull's centre, sits under the
    // hook; offset in u by the trolley's reach.
    containerShip: {
      x: craneX + CRANE_TROLLEY_REACH,
      y: workingCrane.y - SHIP_BAY_V,
    },
    // The crane slews a right angle to reach this, so it lies along the quay
    // from the crane rather than behind it: grid +v, which is down-coast.
    containerDrop: { x: craneX, y: workingCrane.y + CRANE_TROLLEY_PICK },
    containers: [{ x: quayX - 1.06, y: lane + 2.5 }, ...yard],
    // One pile per crane, set back on the working strip behind the rails.
    cargo: berths.map((v) => ({ x: quayX - 0.22, y: v })),
    // Starts from the wharf's screen-right corner, (+u, -v): furthest along
    // (gx - gy), hard against the sea wall on both faces. A left nudge is an
    // equal -u/+v pair; an inland nudge is an equal -u/-v pair. Combined,
    // they resolve to these two offsets.
    sign: {
      x: quayX + HARBOUR_QUAY_HALF_U - 0.35 - (SIGN_LEFT + SIGN_INSET) / 2,
      y: lane - QUAY_BERTH_HALF_V + 0.35 + (SIGN_LEFT - SIGN_INSET) / 2,
    },
    // Mid-coast, on its own rock between the two ports -- see coast.ts.
    lighthouse: coastLighthouse(safeWidth, safeHeight),
    // Outboard of the crane rails, interleaved with the berths so a bollard
    // never lands under a portal leg. The corner slot is given over to the
    // name board, so the run starts inboard of it.
    bollards: [-2.0, -2, 0, 2, 3.9].map((offset) => ({
      x: quayX + 1.62,
      y: lane + offset,
    })),
    // Landward edge, arms reaching out over the working strip.
    lamps: [-2.9, 0.4, 3.6].map((offset) => ({
      x: quayX - 1.55,
      y: lane + offset,
    })),
    mooringLane: lane,
    mooringX,
  };
}

export function harbourLayoutKey(layout: HarbourLayout): string {
  return [layout.quay.x, layout.quay.y, layout.pier.length].join(":");
}
