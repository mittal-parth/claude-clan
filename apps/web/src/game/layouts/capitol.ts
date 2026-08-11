/**
 * The capitol mall — the ground the monument stands on.
 *
 * Pure, no Phaser import, so it stays unit-testable alongside terrain.ts.
 *
 * The grounds are terrain, not part of the capitol sprite. That is deliberate:
 * a baked ground plate is a grey rectangle laid over the city, it clips at the
 * texture edge, and its grass never quite matches the field it sits in. Laying
 * the mall as ordinary terrain cells means it is the *same* grass atlas and the
 * *same* road tiles as everywhere else, and the boulevard's connectivity mask
 * is solved by roadMaskAt along with every other street — so a city lane
 * running into the mall makes a proper T-junction with the ring instead of
 * dead-ending against a sprite.
 *
 * The reserve's extents live in @sudo-city/protocol, because the layout
 * allocator has to agree with them exactly (see reserveCapitol there).
 */

import {
  CAPITOL_FRONT_EXTENT_V,
  CAPITOL_HALF_U,
  CAPITOL_HALF_V,
  inCapitolDistrict,
  type CapitolDistrict,
} from "@sudo-city/protocol";
import { chance, hashCoords, pickIndex, unitFloat } from "../math/hash";
import type { PropKind, TerrainCell } from "./terrain";

/**
 * Tiles the capitol's own sprite covers, measured from the centre — the wings
 * along u, and the rear portico to the foot of the grand stair along v.
 */
const BUILDING_HALF_U = 5;
const BUILDING_HALF_V = 2;

/** The reserve stays centred; the whole baked building sits one tile to the rear. */
export const CAPITOL_OFFSET_V = -1;

/**
 * The mall in layers, working outward from the building:
 *
 *   building | half-tile apron | 1 tile lawn | boulevard
 *
 * The apron is half a tile wide, so it cannot be terrain — the grid has no
 * half tiles. It is baked into the capitol's own texture instead and simply
 * overhangs the first lawn ring, which is why the tiles it covers are still
 * classified as lawn here. Only the walk out to the road, which has to line up
 * with the road, is real paving.
 */
const LAWN_HALF_U = CAPITOL_HALF_U - 1;
const LAWN_BACK_V = CAPITOL_HALF_V - 1;
const LAWN_FRONT_V = CAPITOL_FRONT_EXTENT_V - 1;

/**
 * Half-width of the ceremonial approach, in tiles.
 *
 * This is the grand stair's own width: the walk that runs from the apron out
 * to the boulevard is the stair continued across the lawn, so the two have to
 * be the same span or the approach steps in and out as it crosses the grass.
 */
const AXIS_HALF = 1;
const APPROACH_START_V = BUILDING_HALF_V - 1;

/**
 * Classifies one tile of the mall, or returns undefined if the tile is not in
 * the reserve and should be classified normally.
 *
 * Every kind returned here is a kind the terrain atlas already bakes, so the
 * mall is drawn with the city's own tiles and needs no texture of its own.
 */
export function capitolCell(
  mall: CapitolDistrict,
  x: number,
  y: number,
): TerrainCell | undefined {
  const du = x - mall.centerX;
  const dv = y - mall.centerY;

  if (!inCapitolDistrict(mall, x, y)) {
    return undefined;
  }

  // The boulevard. roadMask is filled in later by roadMaskAt, which sees these
  // cells exactly as it sees the city's own streets — that is what welds the
  // ring to the surrounding grid. It is always the widest class: the one
  // landmark every city has in common should never read as a back lane.
  if (
    x === mall.minX ||
    x === mall.maxX ||
    y === mall.minY ||
    y === mall.maxY
  ) {
    return { x, y, kind: "road", variant: 0, roadMask: 0, roadClass: "boulevard" };
  }

  if (isPaved(du, dv)) {
    return { x, y, kind: "plaza", variant: 0, roadMask: 0 };
  }

  return {
    x,
    y,
    kind: "park",
    variant: pickIndex(hashCoords(x, y, 0xca9), 2),
    roadMask: 0,
    prop: mallProp(du, dv),
    keepProp: true,
  };
}

/**
 * The walk that carries the grand stair out to the boulevard.
 *
 * It is the only thing that crosses the lawn, and it does so on the building's
 * own axis at the stair's width, so the approach reads as one continuous line
 * from the road to the portico. The first plaza row meets the foot of the
 * rearward-shifted sprite's baked apron, and the second carries the concrete
 * cleanly into the scaled stair instead of leaving a grass seam.
 */
function isPaved(du: number, dv: number): boolean {
  return Math.abs(du) <= AXIS_HALF && dv >= APPROACH_START_V;
}

/**
 * Formal planting, not scatter.
 *
 * A random sprinkling of trees reads as neglected countryside; what makes a
 * mall read as a mall is symmetry. Trees stand in an unbroken line one tile
 * inside the boulevard, mirrored on all four sides, with the central approach
 * left open and fountains marking the corners of the lawn.
 */
function mallProp(du: number, dv: number): PropKind | undefined {
  // Planting is confined to the row against the boulevard — street trees, in
  // effect. The lawn is only one tile deep, and filling it would close
  // the gap the mall is there to give the building.
  const edgeU = Math.abs(du) === LAWN_HALF_U;
  const edgeV = dv === -LAWN_BACK_V || dv === LAWN_FRONT_V;

  // Corners get a fountain; the rest of the perimeter gets its avenue of
  // trees, broken only where the ceremonial approach crosses it.
  if (edgeU && edgeV) {
    return "fountain";
  }
  if (edgeU || edgeV) {
    if (edgeV && Math.abs(du) <= AXIS_HALF) {
      return undefined;
    }
    // Alternating tree and pine keeps the avenue from looking stamped.
    return (du + dv) % 2 === 0 ? "tree" : "pine";
  }

  return undefined;
}

/**
 * Where the capitol sprite's depth is taken from.
 *
 * The prop is one sprite covering many tiles, so it needs a single sort key.
 * Taking it from the front of the building — rather than the centre tile —
 * means a city block standing across the boulevard in front of the portico
 * draws over the capitol, which is what a viewer expects of something nearer
 * the camera.
 */
export function capitolDepthTile(mall: CapitolDistrict): {
  x: number;
  y: number;
} {
  return {
    x: mall.centerX,
    y: mall.centerY + CAPITOL_OFFSET_V + BUILDING_HALF_V,
  };
}
