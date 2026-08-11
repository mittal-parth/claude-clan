/**
 * Naval base layout — pure geometry, no Phaser, so it stays unit-testable the
 * same way the cargo harbour's does.
 *
 * The base takes the centre of the coast's top half, opposite the commercial
 * harbour in the bottom half, with the lighthouse between them -- see coast.ts,
 * which owns that division. Its apron is exactly the harbour's, so the two
 * installations read as one port authority rather than two unrelated slabs.
 *
 * In the isometric projection screen-x is (u - v) and screen-y is (u + v), so
 * on the apron:
 *
 *   -u is inland / up-left      +u is seaward / down-right
 *   -v is up-right (far end)    +v is down-left (near end)
 *
 * Everything is therefore authored as a small number of named *rows* across
 * the apron (constant u) and named *bands* along it (constant v). A prop is
 * placed by naming its row and its band, never by nudging a raw literal, which
 * is what stopped the old base from reading as a planned installation.
 *
 * Tall masses live on the inland row so they never occlude the berth, and the
 * middle band is left deliberately empty for the jetty and the battleship.
 */

import {
  COAST_QUAY_HALF_U,
  COAST_QUAY_HALF_V,
  coastLanes,
  coastQuayX,
} from "./coast";
import { COAST_RING, COUNTRYSIDE_RING } from "./terrain";

export interface HarbourPoint {
  x: number;
  y: number;
}

export interface NavyHarbourLayout {
  quay: HarbourPoint;
  quayHalfU: number;
  quayHalfV: number;
  /** Jetty deck tiles running seaward from the apron toward the battleship. */
  pier: HarbourPoint[];
  command: HarbourPoint;
  hangar: HarbourPoint;
  barracks: HarbourPoint;
  radar: HarbourPoint[];
  missileBatteries: HarbourPoint[];
  gunEmplacements: HarbourPoint[];
  panzers: HarbourPoint[];
  fuelTanks: HarbourPoint[];
  helicopterPad: HarbourPoint;
  helicopter: HarbourPoint;
  flags: HarbourPoint[];
  floodlights: HarbourPoint[];
  bollards: HarbourPoint[];
  /** Perimeter fence panels running along the inland lip of the apron. */
  fences: HarbourPoint[];
  crates: HarbourPoint[];
  sign: HarbourPoint;
  battleship: HarbourPoint;
  mooringLane: number;
  mooringX: number;
}

/**
 * The naval apron is the same slab as the cargo wharf — same depth, same
 * length. What separates the two is how they are laid out, not how big they
 * are, so these are derived rather than re-tuned.
 */
export const NAVY_QUAY_HALF_U = COAST_QUAY_HALF_U;
export const NAVY_QUAY_HALF_V = COAST_QUAY_HALF_V;

const PIER_STRIDE = 0.9;
const PIER_MAX_TILES = 3;
/** Tiles of open water between the apron's sea wall and the battleship's berth. */
const BERTH_OFFING = 2.55;

// --- Rows across the apron, inland to seaward -------------------------------
/** The wired perimeter, just inboard of the inland lip. */
const FENCE_ROW = -1.7;
/** Where the built mass stands: HQ, barracks, hangar, tank farm. */
const BUILDING_ROW = -0.92;
/** The service road down the middle of the apron. */
const LANE_ROW = 0.35;
/** Working yard: vehicles, stores, the helipad. */
const YARD_ROW = 1.0;
/** The quayside lip: bollards and seaward-facing weapons. */
const EDGE_ROW = 1.62;

/** Fence panels are 0.92 tiles long; this stride overlaps them into a run. */
const FENCE_STRIDE = 0.9;

/**
 * Reserves the naval base up-coast of the commercial harbour, far enough clear
 * that the two aprons never touch however either one is resized.
 */
export function createNavyHarbourLayout(width: number, height: number): NavyHarbourLayout {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const edge = safeWidth - 1;
  const lane = coastLanes(safeHeight).navy;

  // Seated on the coast exactly as the cargo wharf is: the landward half meets
  // the grass and the seaward wall lands on the water line.
  const quayX = coastQuayX(safeWidth);
  const seawardEdge = quayX + NAVY_QUAY_HALF_U;
  const mooringX = edge + COUNTRYSIDE_RING + COAST_RING + 2;

  const pier: HarbourPoint[] = [];
  for (
    let x = seawardEdge + 0.3;
    x <= mooringX - 1 && pier.length < PIER_MAX_TILES;
    x += PIER_STRIDE
  ) {
    pier.push({ x, y: lane });
  }

  const at = (u: number, v: number): HarbourPoint => ({
    x: quayX + u,
    y: lane + v,
  });

  // A continuous run of wire down the inland lip, which gives the base a hard
  // edge against the countryside instead of three orphaned panels.
  const fences: HarbourPoint[] = [];
  for (let v = -NAVY_QUAY_HALF_V + 0.45; v <= NAVY_QUAY_HALF_V - 0.45; v += FENCE_STRIDE) {
    fences.push(at(FENCE_ROW, v));
  }

  return {
    quay: { x: quayX, y: lane },
    quayHalfU: NAVY_QUAY_HALF_U,
    quayHalfV: NAVY_QUAY_HALF_V,
    pier,

    // --- Far band: command precinct and parade ground -------------------
    command: at(BUILDING_ROW, -4.45),
    flags: [at(0.55, -5.4), at(0.55, -3.95)],
    gunEmplacements: [at(1.35, -3.45)],

    // --- Sensor band ----------------------------------------------------
    radar: [at(BUILDING_ROW + 0.1, -2.15)],
    missileBatteries: [at(1.3, -1.35)],

    // --- Berth band: deliberately empty so the jetty and ship stay clear --

    // --- Support band ---------------------------------------------------
    fuelTanks: [at(BUILDING_ROW - 0.13, -0.55), at(BUILDING_ROW - 0.13, 0.5)],
    barracks: at(BUILDING_ROW - 0.06, 1.9),
    panzers: [at(LANE_ROW, 0.9), at(LANE_ROW, 2.4)],
    crates: [at(YARD_ROW + 0.15, 1.3), at(YARD_ROW - 0.15, 3.15)],

    // --- Near band: air wing and the gate board -------------------------
    hangar: at(BUILDING_ROW + 0.12, 4.5),
    helicopterPad: at(1.0, 4.6),
    helicopter: at(1.0, 4.6),
    sign: at(1.45, 5.85),

    // --- Perimeter ------------------------------------------------------
    floodlights: [
      at(EDGE_ROW - 0.07, -5.85),
      at(FENCE_ROW, -5.85),
      at(FENCE_ROW, 5.85),
      at(EDGE_ROW - 0.07, 1.95),
    ],
    bollards: [-4.8, -2.5, -0.7, 0.7, 2.8].map((v) => at(EDGE_ROW, v)),
    fences,

    // The jetty ends just before the battleship so the ship reads as floating,
    // with the red boot visible against the water rather than under the slab.
    battleship: { x: quayX + BERTH_OFFING, y: lane },
    mooringLane: lane,
    mooringX,
  };
}

export function navyHarbourLayoutKey(layout: NavyHarbourLayout): string {
  return JSON.stringify(layout);
}
