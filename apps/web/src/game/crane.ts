/**
 * Tower crane geometry, kept free of Phaser so it can be checked.
 *
 * The texture, the jib's reach and the point the cable hangs from all derive
 * from these numbers. They were separate values once, and the cable ended up
 * hanging in mid-air past the end of the arm; crane.test.ts holds them together.
 *
 * All coordinates are texture pixels with the origin at the texture's top-left.
 */

export const CRANE_WIDTH = 210;
export const CRANE_HEIGHT = 230;

/** Half a tile, matching TILE_ANCHOR_Y — sprites anchor at the tile's corner. */
const ANCHOR_Y = 24;

/** Mast foot inside the texture. */
export const CRANE_FOOT_X = 152;
export const CRANE_FOOT_Y = CRANE_HEIGHT - ANCHOR_Y;

/** Texture row the jib springs from. */
export const CRANE_JIB_Y = 70;

/** The jib runs 2 across for every 1 up, matching the isometric axis. */
export const CRANE_JIB_RUN_OVER_RISE = 2;
export const CRANE_JIB_REACH = 110;
export const CRANE_TAIL_REACH = 44;

/** Distance along the jib at which the trolley carries the cable. */
export const CRANE_TROLLEY_REACH = 92;

/** A point on the jib, `reach` pixels out from the mast. */
export function jibPoint(reach: number): { x: number; y: number } {
  return {
    x: CRANE_FOOT_X - reach,
    y: CRANE_JIB_Y - reach / CRANE_JIB_RUN_OVER_RISE,
  };
}

/** A point on the counter-jib, `reach` pixels out from the mast. */
export function counterJibPoint(reach: number): { x: number; y: number } {
  return {
    x: CRANE_FOOT_X + reach,
    y: CRANE_JIB_Y + reach / CRANE_JIB_RUN_OVER_RISE,
  };
}

/**
 * Where the cable leaves the jib, as an offset from the sprite's anchor —
 * bottom-centre, because that is how every sprite in this scene is placed.
 */
export const CRANE_CABLE_OFFSET = {
  x: jibPoint(CRANE_TROLLEY_REACH).x - CRANE_WIDTH / 2,
  // Drop it just under the jib so the cable starts at the arm, not through it.
  y: jibPoint(CRANE_TROLLEY_REACH).y + 4 - CRANE_HEIGHT,
} as const;
