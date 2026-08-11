/**
 * The dock road — how the naval base and the container harbour reach the city.
 *
 * Pure geometry, no Phaser import, so it stays unit-testable alongside
 * terrain.ts and capitol.ts.
 *
 * Both aprons sit out on the east coast with nothing but countryside between
 * them and the city edge, so the two working ports read as installations that
 * arrived by sea and are served by nothing. The fix is the capitol's: lay the
 * road as ordinary terrain cells rather than baking it into either landmark's
 * texture. Then it is the same road atlas as every street in town, roadMaskAt
 * solves its junctions along with everything else, and the ambient traffic
 * system picks it up for free because it only ever looks at terrain roads.
 *
 * The route is three named pieces, each anchored to geometry that already
 * exists rather than to a hunch:
 *
 *   - a **spine** running down the coast one clear tile inland of both aprons'
 *     lips, the full frontage of each quay, which is what joins the two ports
 *     to each other;
 *   - a **link** running inland from the spine to the city edge;
 *   - nothing else. The spine passes each apron's own lane, so neither port
 *     needs a spur.
 *
 * The link meets the city on a row that is already a street at the city's east
 * edge. That matters: a street row runs the whole width of its district, so
 * joining one is the difference between a T-junction and a road that stops
 * dead against a park.
 */

import { COAST_QUAY_HALF_U, COAST_QUAY_HALF_V, coastLanes, coastQuayX } from "./coast";

export interface PortRoadOptions {
  width: number;
  height: number;
  /**
   * Whether a cell is dry ground. The shoreline wanders, so the far ends of
   * the spine can run out of coast; the road is truncated there rather than
   * planked across the sea.
   */
  isLand(x: number, y: number): boolean;
  /**
   * Whether a city cell is already a street. Supplied by terrain.ts, which
   * owns the district index — passing it in is also what keeps this module
   * free of an import cycle back into terrain.
   */
  isCityRoad(x: number, y: number): boolean;
}

export interface PortRoadPlan {
  /** The column the spine runs down, just inland of both aprons. */
  spineX: number;
  /** The row the link runs along, and where it joins the city's own grid. */
  linkRow: number;
  has(x: number, y: number): boolean;
  cells: readonly { x: number; y: number }[];
}

/**
 * How far along the coast the spine runs past each apron's centre lane. It is
 * the apron's own half-length, so the road runs the full frontage of both
 * quays and stops — a dock road, not a coastal highway.
 */
const QUAY_FRONTAGE = Math.round(COAST_QUAY_HALF_V);

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/**
 * Picks the row the link joins the city on: the street row nearest the
 * lighthouse lane, which is the midpoint between the two ports and so gives
 * both of them an equal run inland.
 *
 * Searching outward from that lane rather than taking the first street row
 * found keeps the junction near the middle of the coast; falling back to the
 * lane itself keeps a district-less field (an empty repo) from having no road
 * at all, at the cost of the link dead-ending in grass.
 */
function findLinkRow(options: PortRoadOptions): number {
  const { width, height } = options;
  const ideal = Math.round(coastLanes(height).lighthouse);
  const clamped = Math.min(height - 1, Math.max(0, ideal));

  for (let offset = 0; offset < height; offset += 1) {
    for (const row of offset === 0 ? [clamped] : [clamped - offset, clamped + offset]) {
      if (row < 0 || row > height - 1) {
        continue;
      }
      if (options.isCityRoad(width - 1, row)) {
        return row;
      }
    }
  }
  return clamped;
}

/**
 * Lays the dock road.
 *
 * Every run is walked outward from the junction of the two legs and stops at
 * the first cell that is not dry ground, so the result is always one connected
 * run. Clipping a route by filtering its cells instead would leave whatever
 * lies beyond the gap stranded as an island of road with no way off it.
 */
export function createPortRoads(options: PortRoadOptions): PortRoadPlan {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const lanes = coastLanes(height);

  // The last whole column inland of the aprons' lips. Both aprons are seated
  // at the same x by coast.ts, so one column serves both. Flooring is what
  // keeps the clearance: the lip lands at a fractional x -- the apron is
  // seated on the water line, not on the grid -- so the road tile always
  // stops short of the quay slab rather than drawing beneath it.
  const spineX = Math.floor(coastQuayX(width) - COAST_QUAY_HALF_U);
  const linkRow = findLinkRow({ ...options, width, height });

  const keys = new Set<string>();
  const cells: { x: number; y: number }[] = [];
  const lay = (x: number, y: number): boolean => {
    if (!options.isLand(x, y)) {
      return false;
    }
    const key = cellKey(x, y);
    if (!keys.has(key)) {
      keys.add(key);
      cells.push({ x, y });
    }
    return true;
  };

  // The junction first: everything else is walked away from it, so if this one
  // cell is under water there is no road to lay.
  if (lay(spineX, linkRow)) {
    const navyEnd = Math.round(lanes.navy) - QUAY_FRONTAGE;
    const harbourEnd = Math.round(lanes.harbour) + QUAY_FRONTAGE;
    for (let y = linkRow - 1; y >= navyEnd; y -= 1) {
      if (!lay(spineX, y)) break;
    }
    for (let y = linkRow + 1; y <= harbourEnd; y += 1) {
      if (!lay(spineX, y)) break;
    }
    // Inland to the city edge. The edge cell itself is left to classifyCity,
    // which has already made it a street — the link only has to reach it.
    for (let x = spineX - 1; x >= width; x -= 1) {
      if (!lay(x, linkRow)) break;
    }
  }

  return {
    spineX,
    linkRow,
    has: (x, y) => keys.has(cellKey(x, y)),
    cells,
  };
}
