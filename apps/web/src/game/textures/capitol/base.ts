import { Baker, fillFace, createBaker, HALF_W, HALF_H } from "../core";
import { drawCapitolBox } from "../capitol/primitives";
import { Scene } from "phaser";
import { drawWingBlock, drawCenterBlock, drawPortico, drawGrandStair } from "../capitol/blocks";
import { drawDrumAndDome } from "../capitol/dome";

export const CAPITOL_KEY = "prop:capitol";

/** Visual scale for the baked capitol; terrain geometry remains unchanged. */
export const CAPITOL_SCALE = 0.75;


/**
 * Pixels the texture reserves below its tile point.
 *
 * The lowest thing drawn is the contact shadow's near corner, at
 * (WING_OUTER + APRON + 0.35) + (STAIR_FOOT_V + APRON + 0.35) = 9.3 tiles
 * along the depth axis, which is 9.3 * HALF_H = 223px below the tile point.
 * Rounded up with a margin — anything short of it slices the front of the
 * building off, and the cut only shows at the zoom where someone is actually
 * looking at it. capitolTextures.test.ts asserts the real bake fits what this
 * reserves.
 */
export const CAPITOL_ANCHOR_Y = 238;


/**
 * Marble, not white. A pure #ffffff building against the field's saturated
 * green reads as a hole punched in the map; warming the stone very slightly
 * and letting the shaded faces go properly grey is what gives it mass.
 *
 * The gold is the accent the airport's fascia and the harbour's quay line
 * already share — the note that makes three very different landmarks read as
 * one city.
 */
export const CAPITOL = {
  stone: 0xf4f2ea,
  stoneLit: 0xfbfaf5,
  stoneShade: 0xd6d3c6,
  stoneDark: 0xb3af9f,
  stoneEdge: 0x8d8878,
  plinth: 0xdedacb,
  plinthShade: 0xbdb8a5,
  plinthDark: 0x9d9884,
  roof: 0xe7e5da,
  roofShade: 0xc6c3b3,
  saucer: 0xcfd3cd,
  saucerShade: 0xa9aea6,
  dome: 0xfaf9f4,
  domeShade: 0xd2cfc2,
  domeRib: 0xe4e1d4,
  window: 0x27384a,
  windowLit: 0x3d5568,
  glassSill: 0xcbc7b7,
  terrace: 0xe2ded0,
  terraceShade: 0xc4bfae,
  path: 0xd9d4c2,
  water: 0x2e9fe0,
  waterDeep: 0x1f7fbd,
  lawn: 0x49ab33,
  lawnLight: 0x5bbf3e,
  hedge: 0x2f8f3c,
  gold: 0xf6bd60,
  goldDark: 0xb9782f,
  bronze: 0x8a7a4a,
} as const;


// ---------------------------------------------------------------------------
// Massing geometry
//
// Named once so the canvas, the terrace and the depth ordering all derive from
// the same numbers instead of drifting apart.
// ---------------------------------------------------------------------------

/**
 * The building stands directly on the mall's lawn. There is no stone terrace
 * under it: a slab wide enough to hold the wings reads as a concrete car park
 * from anything but the closest zoom, and it fought the grass it sat on. The
 * rusticated basement each block already carries is the plinth.
 *
 * Because the terrace is gone, these extents ARE the building's footprint, and
 * the mall reserve in @sudo-city/protocol is sized directly from them: one
 * clear tile of lawn on every side, then the boulevard. Widening anything
 * here without widening the reserve eats that gap.
 */

/** Half-length of the building along the wing axis, in tiles. */
export const WING_OUTER = 5.2;

export const WING_INNER = 2.65;

export const LINK_INNER = 1.6;

export const CENTER_HALF = 1.6;


/**
 * How far the masses run fore and aft of the centre line, in tiles.
 *
 * The composition is symmetric about v = 0, deliberately: the reserve is a
 * rectangle centred on the same tile, so any fore-and-aft imbalance in the
 * building shows up as an uneven lawn — a wide gap on one side and a pinched
 * one on the other. The rear portico is deep enough to answer the grand stair.
 */
export const BLOCK_BACK = -1.2;

export const BLOCK_FRONT = 1.2;

export const CENTER_BACK = -1.5;

export const CENTER_FRONT = 1.35;


/** The rear portico's outer face and the foot of the grand stair. */
export const REAR_FACE_V = -2.4;

export const STAIR_FOOT_V = 2.4;


/** Heights, in pixels above the tile point. */
export const GROUND_Z = 0;

export const PLINTH_Z = 20;

export const WING_EAVE = 62;

export const LINK_EAVE = 52;

export const CENTER_EAVE = 78;

export const ATTIC_Z = 92;

export const DRUM_BASE = 100;

export const PERISTYLE_Z = 148;

export const DRUM_TOP = 168;

export const DOME_TOP = 250;

export const LANTERN_TOP = 282;


export type Colors = { top: number; frontRight: number; frontLeft: number };


export const STONE: Colors = {
  top: CAPITOL.roof,
  frontRight: CAPITOL.stoneShade,
  frontLeft: CAPITOL.stone,
};


export const PLINTH_COLORS: Colors = {
  top: CAPITOL.plinth,
  frontRight: CAPITOL.plinthShade,
  frontLeft: CAPITOL.plinth,
};


/**
 * The contact shadow and the apron.
 *
 * Everything beyond the apron is real terrain: the lawn is the map's own grass
 * atlas, the walk out to the road is its pavement, and the boulevard is its
 * road tiles — all laid by capitol.ts. Baking a full stone terrace here
 * instead was what put a grey slab over the city and gave the monument a hard
 * cropped edge of its own.
 *
 * What survives is a half-tile apron, and it has to live here rather than in
 * terrain because the grid has no half tiles. It follows the building's
 * silhouette in three pieces — rear portico, main body, front steps — rather
 * than boxing the whole footprint, which would put dead stone in the corners
 * the wings do not reach.
 */
export const APRON = 0.5;

export const APRON_Z = 3;


export function drawGrounds(baker: Baker, originX: number, originY: number): void {
  // Contact shadow first, offset down-right. Without it the prop looks pasted
  // on rather than standing on the ground.
  fillFace(baker, 0x000000, 0.2, [
    [-WING_OUTER - APRON + 0.3, REAR_FACE_V - APRON + 0.3, 0],
    [WING_OUTER + APRON + 0.35, REAR_FACE_V - APRON + 0.3, 0],
    [WING_OUTER + APRON + 0.35, STAIR_FOOT_V + APRON + 0.35, 0],
    [-WING_OUTER - APRON + 0.3, STAIR_FOOT_V + APRON + 0.35, 0],
  ], originX, originY);

  const paving: Colors = {
    top: CAPITOL.terrace,
    frontRight: CAPITOL.terraceShade,
    frontLeft: CAPITOL.terrace,
  };
  const apron = (u: number, v0: number, v1: number): void => {
    drawCapitolBox(baker, { u0: -u, u1: u, v0, v1, z0: 0, z1: APRON_Z }, originX, originY, paving);
  };

  // Back to front, so each piece overlaps the one behind it correctly.
  apron(CENTER_HALF + APRON, REAR_FACE_V - APRON, BLOCK_BACK - APRON);
  apron(WING_OUTER + APRON, BLOCK_BACK - APRON, BLOCK_FRONT + APRON);
  apron(CENTER_HALF + 0.45 + APRON, BLOCK_FRONT + APRON, STAIR_FOOT_V + APRON);
}


// ---------------------------------------------------------------------------
// The bake
// ---------------------------------------------------------------------------

export function bakeCapitol(scene: Scene): void {
  const baker = createBaker(scene);

  // Canvas sized from the real extents. The widest screen half-span is the far
  // corner of the terrace; the tallest point is the statue on the lantern.
  const spanU = WING_OUTER + APRON + 0.5;
  const spanV = Math.max(-REAR_FACE_V, STAIR_FOOT_V) + APRON + 0.5;
  const width = Math.ceil((spanU + spanV) * HALF_W * 2) + 32;
  const height =
    Math.ceil((spanU + spanV) * HALF_H) + LANTERN_TOP + CAPITOL_ANCHOR_Y + 24;
  const originX = width / 2;
  const originY = height - CAPITOL_ANCHOR_Y;

  drawGrounds(baker, originX, originY);

  /**
   * Every mass, sorted by how near it is to the camera. `depth` is the near
   * corner's (u + v): the projection puts larger values in front, so ascending
   * order is exactly painter's order. This list is the fix for the connector
   * that used to be stamped on top of the south wing.
   */
  const masses: Array<{ depth: number; draw: () => void }> = [
    {
      // North wing (far along −u).
      depth: -WING_INNER + BLOCK_FRONT,
      draw: () => drawWingBlock(baker, originX, originY, -WING_OUTER, -WING_INNER, WING_EAVE, 6, true),
    },
    {
      depth: -LINK_INNER + BLOCK_FRONT,
      draw: () => drawWingBlock(baker, originX, originY, -WING_INNER, -LINK_INNER, LINK_EAVE, 2, false),
    },
    {
      depth: CENTER_HALF + CENTER_FRONT,
      draw: () => drawCenterBlock(baker, originX, originY),
    },
    {
      depth: WING_INNER + BLOCK_FRONT,
      draw: () => drawWingBlock(baker, originX, originY, LINK_INNER, WING_INNER, LINK_EAVE, 2, false),
    },
    {
      // South wing (near along +u) — must be last of the four, which is what
      // the sort guarantees regardless of the order written here.
      depth: WING_OUTER + BLOCK_FRONT,
      draw: () => drawWingBlock(baker, originX, originY, WING_INNER, WING_OUTER, WING_EAVE, 6, true),
    },
  ];
  masses.sort((left, right) => left.depth - right.depth);
  for (const mass of masses) {
    mass.draw();
  }

  // The dome sits above every mass, so it is drawn after all of them
  // regardless of footprint depth.
  drawDrumAndDome(baker, originX, originY);

  // The front portico projects further toward the camera than anything else,
  // and the stair further still — down to the lawn it now stands on.
  drawPortico(baker, originX, originY, CENTER_HALF - 0.1, CENTER_FRONT, 0.5, 1, PLINTH_Z, CENTER_EAVE - 6, CENTER_EAVE + 20, 8);
  drawGrandStair(baker, originX, originY, CENTER_HALF + 0.45, CENTER_FRONT + 0.5, STAIR_FOOT_V, PLINTH_Z);

  baker.finish(CAPITOL_KEY, width, height);
}
