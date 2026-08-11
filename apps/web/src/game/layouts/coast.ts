/**
 * How the island's east coast is shared out — pure geometry, no Phaser.
 *
 * Three landmarks stand on that coast and they are spaced against each other,
 * not each placed on its own hunch:
 *
 *   - the **lighthouse** marks the middle of the coast,
 *   - the **naval base** takes the centre of the top half,
 *   - the **container harbour** takes the centre of the bottom half.
 *
 * So the waterfront reads as an evenly-spaced set of three, with the tower
 * standing in the water between the two working ports rather than tucked into
 * one of their corners.
 *
 * Both aprons are the same slab, so their size lives here too: it is what
 * decides whether the ideal quarter-lanes leave any water between them.
 */

// From rings.ts rather than terrain.ts: terrain.ts imports the dock road, which
// imports this module, so taking the constants from terrain would close a cycle.
import { COAST_RING, COUNTRYSIDE_RING } from "./rings";

/** Depth of an apron (inland to seaward) and half its length along the coast. */
export const COAST_QUAY_HALF_U = 1.8;
export const COAST_QUAY_HALF_V = 6.2;

/** Clear coast that must survive between the two aprons, however short it is. */
const MIN_APRON_GAP = 2;

export interface CoastLanes {
  /** Mid-coast. The lighthouse's lane, and the seam between the two halves. */
  lighthouse: number;
  /** Centre of the top half. */
  navy: number;
  /** Centre of the bottom half. */
  harbour: number;
}

/**
 * The three lanes, as grid-y. Note both aprons are placed by the same reach
 * from the centre, so they stay symmetric about the lighthouse whatever the
 * city's size.
 */
export function coastLanes(height: number): CoastLanes {
  const safeHeight = Math.max(1, Math.round(height));
  const centre = safeHeight / 2;
  // A quarter of the height from the centre *is* the centre of that half. On a
  // very short coast that would overlap the two aprons, so it is floored at the
  // reach where they still clear each other by MIN_APRON_GAP.
  const reach = Math.max(safeHeight / 4, COAST_QUAY_HALF_V + MIN_APRON_GAP / 2);
  return {
    lighthouse: centre,
    navy: centre - reach,
    harbour: centre + reach,
  };
}

/**
 * The water line on the port frontage.
 *
 * Sand runs out to `COUNTRYSIDE_RING + COAST_RING` *cells*, and a cell is drawn
 * as a diamond centred on its own coordinate — so the beach actually reaches
 * half a tile further than the last sand cell's centre. Missing that half tile
 * is what left a strip of sand standing in front of the quay wall.
 */
export function coastWaterLine(width: number): number {
  const edge = Math.max(1, Math.round(width)) - 1;
  return edge + COUNTRYSIDE_RING + COAST_RING + 0.5;
}

/**
 * Centre of an apron, seated so its seaward wall lands exactly on the water
 * line: the landward half meets the grass, the sea wall stands in the sea, and
 * no beach shows through in between.
 */
export function coastQuayX(width: number): number {
  return coastWaterLine(width) - COAST_QUAY_HALF_U;
}

/**
 * Where the lighthouse stands: mid-coast, and far enough out that its rock is
 * at the water line rather than back on the beach.
 */
export function coastLighthouse(
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    // Just inshore of the water line, so its rock is beach rather than sea.
    x: coastWaterLine(width) - 0.8,
    y: coastLanes(height).lighthouse,
  };
}

/**
 * How far beyond the bare apron slab an installation's own fixtures reach:
 * the harbour's warehouse and sign, the naval base's perimeter fence and its
 * command precinct, none of which are drawn as terrain (see CLAUDE.md on the
 * capitol) and so are otherwise invisible to the countryside's own tree
 * scatter -- a pine can and did grow inside the naval base's own fence line.
 * Generous rather than exact: this only ever suppresses a prop, never a tile
 * kind, so erring wide costs nothing but a slightly larger clearing.
 */
const INSTALLATION_MARGIN_U = 1.6;
const INSTALLATION_MARGIN_V = 1.6;

/** True for any tile inside either coastal installation's own reserved ground. */
export function isOnCoastInstallation(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const quayX = coastQuayX(width);
  const lanes = coastLanes(height);
  const halfU = COAST_QUAY_HALF_U + INSTALLATION_MARGIN_U;
  const halfV = COAST_QUAY_HALF_V + INSTALLATION_MARGIN_V;
  const withinApron = (laneY: number): boolean =>
    x >= quayX - halfU && x <= quayX + halfU && y >= laneY - halfV && y <= laneY + halfV;
  return withinApron(lanes.navy) || withinApron(lanes.harbour);
}
