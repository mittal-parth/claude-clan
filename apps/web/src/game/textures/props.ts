import { PropKind } from "../layouts/terrain";
import { TILE_ANCHOR_Y, Baker, fillFace, diamond, HALF_W, TILE_WIDTH, shade } from "./core";
import { TERRAIN_COLORS, PROP_COLORS } from "../math/palette";

export function propTextureKey(prop: PropKind): string {
  return `prop:${prop}`;
}


// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export const PROP_HEIGHT = 56;

export const PROP_ORIGIN_Y = PROP_HEIGHT - TILE_ANCHOR_Y;


export function propShadow(baker: Baker, half: number): void {
  fillFace(baker, TERRAIN_COLORS.shadow, 0.22, diamond(half), HALF_W, PROP_ORIGIN_Y);
}


export function bakeTree(baker: Baker): void {
  propShadow(baker, 0.2);
  const trunk = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.trunk, 1);
  baker.graphics.fillRect(trunk.x - 3, trunk.y - 16, 6, 16);

  baker.graphics.fillStyle(PROP_COLORS.leaf, 1);
  baker.graphics.fillCircle(trunk.x, trunk.y - 26, 13);
  baker.graphics.fillStyle(PROP_COLORS.leafLight, 1);
  baker.graphics.fillCircle(trunk.x - 4, trunk.y - 30, 8);

  baker.finish(propTextureKey("tree"), TILE_WIDTH, PROP_HEIGHT);
}


export function bakePine(baker: Baker): void {
  propShadow(baker, 0.18);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.trunk, 1);
  baker.graphics.fillRect(base.x - 3, base.y - 12, 5, 12);

  baker.graphics.fillStyle(PROP_COLORS.pine, 1);
  for (const [offset, width] of [
    [10, 14],
    [22, 11],
    [32, 7],
  ] as const) {
    baker.graphics.fillTriangle(
      base.x - width,
      base.y - offset,
      base.x + width,
      base.y - offset,
      base.x,
      base.y - offset - 16,
    );
  }

  baker.finish(propTextureKey("pine"), TILE_WIDTH, PROP_HEIGHT);
}


export function bakeBush(baker: Baker): void {
  propShadow(baker, 0.14);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.bush, 1);
  baker.graphics.fillCircle(base.x - 5, base.y - 5, 7);
  baker.graphics.fillCircle(base.x + 5, base.y - 4, 6);
  baker.graphics.fillStyle(shade(PROP_COLORS.bush, 12), 1);
  baker.graphics.fillCircle(base.x, base.y - 9, 7);

  baker.finish(propTextureKey("bush"), TILE_WIDTH, PROP_HEIGHT);
}


export function bakeRock(baker: Baker): void {
  propShadow(baker, 0.13);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.rock, 1);
  baker.graphics.fillTriangle(
    base.x - 9,
    base.y,
    base.x + 9,
    base.y,
    base.x - 1,
    base.y - 11,
  );
  baker.graphics.fillStyle(shade(PROP_COLORS.rock, 12), 1);
  baker.graphics.fillTriangle(
    base.x - 1,
    base.y - 11,
    base.x + 9,
    base.y,
    base.x + 3,
    base.y - 6,
  );

  baker.finish(propTextureKey("rock"), TILE_WIDTH, PROP_HEIGHT);
}


/**
 * A boulevard lamp, standing on a road cell at a junction. A slender dark
 * post so it reads as ironwork rather than a mast, and the accent colour
 * kept to the small lamp head at the top -- a whole gold post would read as
 * an orange lump, per the same lesson the harbour's own lamp learned.
 *
 * Sized to fit PROP_HEIGHT's existing headroom (PROP_ORIGIN_Y = 32px above
 * the tile point): post to -20, head centre at -23, outer halo radius 6, so
 * the highest point drawn is at 32 - 23 - 6 = 3px -- inside the canvas with
 * margin, not clipped against its top edge.
 */
export function bakeLamp(baker: Baker): void {
  propShadow(baker, 0.1);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  const postTop = base.y - 20;
  const headY = base.y - 23;

  baker.graphics.fillStyle(PROP_COLORS.lampPost, 1);
  baker.graphics.fillRect(base.x - 1, postTop, 3, 20);

  // Two short crossarms just under the head -- what separates a lamp from a flagpole.
  baker.graphics.fillRect(base.x - 5, postTop, 4, 2);
  baker.graphics.fillRect(base.x + 1, postTop, 4, 2);

  baker.graphics.fillStyle(shade(PROP_COLORS.lampGlow, -20), 1);
  baker.graphics.fillCircle(base.x, headY, 4);
  baker.graphics.fillStyle(PROP_COLORS.lampGlow, 0.9);
  baker.graphics.fillCircle(base.x, headY, 2.5);
  // A soft halo, the same trick the harbour's beacon uses to read as lit
  // rather than as a coloured disc.
  baker.graphics.fillStyle(PROP_COLORS.lampGlow, 0.18);
  baker.graphics.fillCircle(base.x, headY, 6);

  baker.finish(propTextureKey("lamp"), TILE_WIDTH, PROP_HEIGHT);
}


export function bakeFountain(baker: Baker): void {
  propShadow(baker, 0.24);
  fillFace(
    baker,
    PROP_COLORS.fountain,
    1,
    diamond(0.26),
    HALF_W,
    PROP_ORIGIN_Y,
  );
  fillFace(
    baker,
    PROP_COLORS.fountainWater,
    1,
    diamond(0.18),
    HALF_W,
    PROP_ORIGIN_Y,
  );
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.fountain, 1);
  baker.graphics.fillRect(base.x - 2, base.y - 14, 4, 14);
  baker.graphics.fillStyle(PROP_COLORS.fountainWater, 0.8);
  baker.graphics.fillCircle(base.x, base.y - 17, 5);

  baker.finish(propTextureKey("fountain"), TILE_WIDTH, PROP_HEIGHT);
}
