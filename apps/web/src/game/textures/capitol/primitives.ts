import { Baker, fillFace, Point3, strokeFace } from "../core";
import { Colors, STONE, CAPITOL } from "../capitol/base";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  z0: number;
  z1: number;
}


/**
 * The three faces a fixed-orientation box shows: top, +u and +v. The far faces
 * project inside the silhouette and are covered, so drawing them would be pure
 * cost. (This is only safe because the capitol never rotates — see the
 * isometric-props notes on props baked at several headings.)
 */
export function drawCapitolBox(
  baker: Baker,
  box: Box,
  originX: number,
  originY: number,
  colors: Colors,
): void {
  const { u0, u1, v0, v1, z0, z1 } = box;
  fillFace(baker, colors.top, 1, [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], originX, originY);
  fillFace(baker, colors.frontRight, 1, [[u1, v0, z1], [u1, v1, z1], [u1, v1, z0], [u1, v0, z0]], originX, originY);
  fillFace(baker, colors.frontLeft, 1, [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]], originX, originY);
}


/**
 * A projecting band right around a box — cornice, string course, plinth cap.
 * Classical buildings are mostly horizontal lines; without these the wings are
 * indistinguishable from a warehouse.
 */
export function drawCornice(
  baker: Baker,
  box: Box,
  originX: number,
  originY: number,
  overhang: number,
  thickness: number,
  colors: Colors = STONE,
): void {
  drawCapitolBox(
    baker,
    {
      u0: box.u0 - overhang,
      u1: box.u1 + overhang,
      v0: box.v0 - overhang,
      v1: box.v1 + overhang,
      z0: box.z1 - thickness,
      z1: box.z1,
    },
    originX,
    originY,
    colors,
  );
}


/**
 * A run of windows on one visible face, each with a sill and a shaded head.
 *
 * `face` picks which elevation: "u" is the shaded right-hand face, "v" the lit
 * left-hand one. Only those two are ever visible, so nothing here needs a
 * visibility guard.
 */
export function drawWindowBand(
  baker: Baker,
  originX: number,
  originY: number,
  face: "u" | "v",
  at: number,
  from: number,
  to: number,
  z0: number,
  z1: number,
  count: number,
): void {
  if (count <= 0) {
    return;
  }
  const pitch = (to - from) / count;
  const width = pitch * 0.46;
  const sill = 2;

  for (let index = 0; index < count; index += 1) {
    const centre = from + pitch * (index + 0.5);
    const a = centre - width / 2;
    const b = centre + width / 2;
    const pane: Point3[] =
      face === "u"
        ? [[at, a, z1], [at, b, z1], [at, b, z0], [at, a, z0]]
        : [[a, at, z1], [b, at, z1], [b, at, z0], [a, at, z0]];
    fillFace(baker, face === "u" ? CAPITOL.window : CAPITOL.windowLit, 1, pane, originX, originY);

    // The sill is what stops a window band reading as a row of stickers.
    const sillFace: Point3[] =
      face === "u"
        ? [[at, a - 0.02, z0], [at, b + 0.02, z0], [at, b + 0.02, z0 - sill], [at, a - 0.02, z0 - sill]]
        : [[a - 0.02, at, z0], [b + 0.02, at, z0], [b + 0.02, at, z0 - sill], [a - 0.02, at, z0 - sill]];
    fillFace(baker, CAPITOL.glassSill, 1, sillFace, originX, originY);
  }
}


/**
 * Shallow vertical pilasters between the windows. They cost two fills each and
 * are the single biggest thing separating "classical" from "office block".
 */
export function drawPilasters(
  baker: Baker,
  originX: number,
  originY: number,
  face: "u" | "v",
  at: number,
  from: number,
  to: number,
  z0: number,
  z1: number,
  count: number,
): void {
  const pitch = (to - from) / count;
  for (let index = 0; index <= count; index += 1) {
    const centre = from + pitch * index;
    const a = centre - 0.045;
    const b = centre + 0.045;
    const shaft: Point3[] =
      face === "u"
        ? [[at, a, z1], [at, b, z1], [at, b, z0], [at, a, z0]]
        : [[a, at, z1], [b, at, z1], [b, at, z0], [a, at, z0]];
    fillFace(baker, face === "u" ? CAPITOL.stoneShade : CAPITOL.stoneLit, 1, shaft, originX, originY);
    strokeFace(
      baker,
      face === "u" ? CAPITOL.stoneDark : CAPITOL.stoneShade,
      0.5,
      1,
      shaft,
      originX,
      originY,
    );
  }
}


/**
 * A balustrade along one roof edge: capping rail plus turned posts. Runs on the
 * two visible faces only.
 */
export function drawBalustrade(
  baker: Baker,
  originX: number,
  originY: number,
  face: "u" | "v",
  at: number,
  from: number,
  to: number,
  z: number,
  height = 7,
): void {
  const posts = Math.max(2, Math.round(Math.abs(to - from) / 0.16));
  for (let index = 0; index <= posts; index += 1) {
    const centre = from + ((to - from) * index) / posts;
    const a = centre - 0.03;
    const b = centre + 0.03;
    const post: Point3[] =
      face === "u"
        ? [[at, a, z + height], [at, b, z + height], [at, b, z], [at, a, z]]
        : [[a, at, z + height], [b, at, z + height], [b, at, z], [a, at, z]];
    fillFace(baker, face === "u" ? CAPITOL.stoneShade : CAPITOL.stoneLit, 1, post, originX, originY);
  }
  // Capping rail over the posts.
  const rail: Point3[] =
    face === "u"
      ? [[at, from, z + height + 2], [at, to, z + height + 2], [at, to, z + height], [at, from, z + height]]
      : [[from, at, z + height + 2], [to, at, z + height + 2], [to, at, z + height], [from, at, z + height]];
  fillFace(baker, face === "u" ? CAPITOL.stoneShade : CAPITOL.stone, 1, rail, originX, originY);
}
