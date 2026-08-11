/**
 * The capitol — the city's one civic monument.
 *
 * Everything here is building. The lawn, the avenue of trees and the boulevard
 * that rings the block are ordinary terrain cells laid by capitol.ts, so they
 * use the city's own grass and road tiles; this texture starts at the terrace
 * and goes up.
 *
 * Two rules govern the whole file and are easy to break by accident:
 *
 *  1. **Painter's order is depth order.** The projection puts larger (u + v)
 *     nearer the camera, so every mass must be drawn in ascending depth or a
 *     far block lands on top of a near one. The connectors used to be drawn
 *     after the wings and were painted over them, which read as a spare
 *     building parked on the south wing's roof. drawMass() exists so that
 *     ordering is stated once, in a sorted list, rather than implied by where
 *     a call happens to sit in the function.
 *
 *  2. **Light is fixed to the world.** The sun is upper-left: the +v face is
 *     lit, the +u face is in shade, tops are lightest. The capitol never
 *     rotates, so this is a straight palette choice rather than a computed
 *     normal — but it has to be applied consistently or the massing goes flat.
 */

import type { Scene } from "phaser";
import {
  Baker,
  HALF_H,
  HALF_W,
  Point3,
  createBaker,
  fillFace,
  shade,
  strokeFace,
} from "./textures";

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
const CAPITOL = {
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
const WING_OUTER = 5.2;
const WING_INNER = 2.65;
const LINK_INNER = 1.6;
const CENTER_HALF = 1.6;

/**
 * How far the masses run fore and aft of the centre line, in tiles.
 *
 * The composition is symmetric about v = 0, deliberately: the reserve is a
 * rectangle centred on the same tile, so any fore-and-aft imbalance in the
 * building shows up as an uneven lawn — a wide gap on one side and a pinched
 * one on the other. The rear portico is deep enough to answer the grand stair.
 */
const BLOCK_BACK = -1.2;
const BLOCK_FRONT = 1.2;
const CENTER_BACK = -1.5;
const CENTER_FRONT = 1.35;

/** The rear portico's outer face and the foot of the grand stair. */
const REAR_FACE_V = -2.4;
const STAIR_FOOT_V = 2.4;

/** Heights, in pixels above the tile point. */
const GROUND_Z = 0;
const PLINTH_Z = 20;
const WING_EAVE = 62;
const LINK_EAVE = 52;
const CENTER_EAVE = 78;
const ATTIC_Z = 92;
const DRUM_BASE = 100;
const PERISTYLE_Z = 148;
const DRUM_TOP = 168;
const DOME_TOP = 250;
const LANTERN_TOP = 282;

type Colors = { top: number; frontRight: number; frontLeft: number };

const STONE: Colors = {
  top: CAPITOL.roof,
  frontRight: CAPITOL.stoneShade,
  frontLeft: CAPITOL.stone,
};

const PLINTH_COLORS: Colors = {
  top: CAPITOL.plinth,
  frontRight: CAPITOL.plinthShade,
  frontLeft: CAPITOL.plinth,
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

interface Box {
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
function drawBox(
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
function drawCornice(
  baker: Baker,
  box: Box,
  originX: number,
  originY: number,
  overhang: number,
  thickness: number,
  colors: Colors = STONE,
): void {
  drawBox(
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
function drawWindowBand(
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
function drawPilasters(
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

/** One face of a cylinder wall, keyed by depth so the caller can sort. */
interface Slice {
  depth: number;
  points: Point3[];
  color: number;
}

/**
 * Cylinder walls as depth-sorted quads. The near half must be drawn last or the
 * drum's far wall shows through it.
 */
function cylinderSlices(
  cu: number,
  cv: number,
  radius: number,
  z0: number,
  z1: number,
  segments: number,
  color: number,
): { slices: Slice[]; top: Point3[] } {
  const top: Point3[] = [];
  const bottom: Point3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    const u = cu + Math.cos(angle) * radius;
    const v = cv + Math.sin(angle) * radius;
    top.push([u, v, z1]);
    bottom.push([u, v, z0]);
  }

  const slices: Slice[] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const a = top[index] as Point3;
    const b = top[next] as Point3;
    // The outward normal is taken from the segment's mid-angle, as a unit
    // vector. Deriving it from the edge instead makes its length proportional
    // to the radius, which blows the shading out on anything small — the
    // lantern and the tholos came out charcoal, and the dome's tiers banded
    // into a wireframe as their radius shrank toward the crown.
    const mid = (Math.PI * 2 * (index + 0.5)) / segments;
    slices.push({
      depth: (a[0] + b[0] + a[1] + b[1]) / 2,
      points: [a, b, bottom[next] as Point3, bottom[index] as Point3],
      // Sun upper-left: +v lit, +u shaded. Same weights the rest of the world
      // uses, so the capitol sits under the same light as the harbour cranes.
      color: shade(color, Math.round(9 * Math.sin(mid) - 28 * Math.cos(mid))),
    });
  }
  slices.sort((left, right) => left.depth - right.depth);
  return { slices, top };
}

function drawCylinder(
  baker: Baker,
  originX: number,
  originY: number,
  cu: number,
  cv: number,
  radius: number,
  z0: number,
  z1: number,
  color: number,
  topColor: number,
  segments = 20,
): void {
  const { slices, top } = cylinderSlices(cu, cv, radius, z0, z1, segments, color);
  for (const slice of slices) {
    fillFace(baker, slice.color, 1, slice.points, originX, originY);
  }
  fillFace(baker, topColor, 1, top, originX, originY);
}

/**
 * The peristyle: a ring of free-standing columns around the drum, with the
 * drum wall visible between them.
 *
 * This is the detail that makes the dome read as a capitol rather than a
 * silo, so it is drawn honestly — recessed wall first, then only the near
 * columns, so the far side of the colonnade is correctly hidden.
 */
function drawColonnade(
  baker: Baker,
  originX: number,
  originY: number,
  radius: number,
  z0: number,
  z1: number,
  columns: number,
  columnHalf = 0.06,
): void {
  // Recessed wall behind the columns. Darker than the shafts so the gaps read
  // as depth, but not so dark it becomes a band of raw concrete when seen
  // between widely spaced columns.
  drawCylinder(
    baker,
    originX,
    originY,
    0,
    0,
    radius * 0.8,
    z0,
    z1,
    CAPITOL.stoneShade,
    CAPITOL.stone,
    Math.max(12, columns),
  );

  const shafts: Array<{ depth: number; draw: () => void }> = [];
  for (let index = 0; index < columns; index += 1) {
    const angle = (Math.PI * 2 * index) / columns;
    const cu = Math.cos(angle) * radius;
    const cv = Math.sin(angle) * radius;
    const depth = cu + cv;
    // Columns on the far side are behind the recessed wall; skipping them
    // costs nothing and keeps the near ones crisp.
    if (depth < -radius * 0.35) {
      continue;
    }
    const lit = shade(CAPITOL.stone, Math.round(-10 * Math.cos(angle) + 4 * Math.sin(angle)));
    shafts.push({
      depth,
      draw: () => {
        // A column is a box, not a quad. Spanning the shaft from (cu−h, cv−h)
        // to (cu+h, cv+h) keeps (u − v) constant, and (u − v) is the entire
        // screen x — so the "columns" projected to zero-width slivers and the
        // peristyle was an empty grey ring.
        const shaft: Box = {
          u0: cu - columnHalf,
          u1: cu + columnHalf,
          v0: cv - columnHalf,
          v1: cv + columnHalf,
          z0,
          z1,
        };
        drawBox(baker, shaft, originX, originY, {
          top: CAPITOL.stoneLit,
          frontRight: shade(lit, -12),
          frontLeft: lit,
        });
        // Capital and base. Three pixels each is enough to read as an order
        // rather than a stick.
        const flare = columnHalf * 1.45;
        const collar = { u0: cu - flare, u1: cu + flare, v0: cv - flare, v1: cv + flare };
        drawBox(baker, { ...collar, z0: z1 - 3, z1 }, originX, originY, {
          top: CAPITOL.stoneLit,
          frontRight: CAPITOL.stoneShade,
          frontLeft: CAPITOL.stoneLit,
        });
        drawBox(baker, { ...collar, z0, z1: z0 + 3 }, originX, originY, {
          top: CAPITOL.stoneShade,
          frontRight: CAPITOL.stoneDark,
          frontLeft: CAPITOL.stoneShade,
        });
      },
    });
  }
  shafts.sort((left, right) => left.depth - right.depth);
  for (const shaft of shafts) {
    shaft.draw();
  }
}

/**
 * A ribbed dome, built as stacked bands.
 *
 * The profile is `cos` in radius against `sin` in height, which is a hemisphere
 * — but the real thing is taller than a hemisphere, so the height is eased with
 * a power curve to pull the crown up. That silhouette is the whole landmark at
 * fit zoom.
 */
function drawDome(
  baker: Baker,
  originX: number,
  originY: number,
  radius: number,
  z0: number,
  z1: number,
  ribs: number,
): void {
  const tiers = 14;
  const segments = 24;

  for (let tier = 0; tier < tiers; tier += 1) {
    const t0 = tier / tiers;
    const t1 = (tier + 1) / tiers;
    const r0 = radius * Math.cos((Math.PI / 2) * t0);
    const r1 = radius * Math.cos((Math.PI / 2) * t1);
    const h0 = z0 + (z1 - z0) * Math.pow(Math.sin((Math.PI / 2) * t0), 0.78);
    const h1 = z0 + (z1 - z0) * Math.pow(Math.sin((Math.PI / 2) * t1), 0.78);

    const { slices } = cylinderSlices(0, 0, (r0 + r1) / 2, h0, h1, segments, CAPITOL.dome);
    for (const slice of slices) {
      fillFace(baker, slice.color, 1, slice.points, originX, originY);
    }
  }

  // Meridian ribs, drawn over the shell on the near side only. Sampling the
  // same profile means a rib sits on the surface instead of floating off it.
  for (let index = 0; index < ribs; index += 1) {
    const angle = (Math.PI * 2 * index) / ribs;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (cos + sin < -0.25) {
      continue;
    }
    const line: Point3[] = [];
    for (let step = 0; step <= 10; step += 1) {
      const t = step / 10;
      const r = radius * Math.cos((Math.PI / 2) * t) * 1.005;
      const h = z0 + (z1 - z0) * Math.pow(Math.sin((Math.PI / 2) * t), 0.78);
      line.push([cos * r, sin * r, h]);
    }
    baker.graphics.lineStyle(1, CAPITOL.domeShade, 0.55);
    for (let step = 0; step < line.length - 1; step += 1) {
      const from = baker.at(line[step] as Point3, originX, originY);
      const to = baker.at(line[step + 1] as Point3, originX, originY);
      baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
  }
}

/** A low saucer roof over a chamber — the House and Senate skylights. */
function drawSaucer(
  baker: Baker,
  originX: number,
  originY: number,
  cu: number,
  cv: number,
  radius: number,
  z0: number,
  z1: number,
): void {
  // Square lantern base under the saucer, so it sits on the roof rather than
  // being a bubble stuck to it.
  drawBox(
    baker,
    { u0: cu - radius, u1: cu + radius, v0: cv - radius, v1: cv + radius, z0, z1: z0 + 5 },
    originX,
    originY,
    { top: CAPITOL.roofShade, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stone },
  );

  const tiers = 6;
  for (let tier = 0; tier < tiers; tier += 1) {
    const t0 = tier / tiers;
    const t1 = (tier + 1) / tiers;
    const r = radius * 0.92 * Math.cos((Math.PI / 2) * ((t0 + t1) / 2));
    const h0 = z0 + 5 + (z1 - z0 - 5) * Math.sin((Math.PI / 2) * t0);
    const h1 = z0 + 5 + (z1 - z0 - 5) * Math.sin((Math.PI / 2) * t1);
    const { slices } = cylinderSlices(cu, cv, r, h0, h1, 14, CAPITOL.saucer);
    for (const slice of slices) {
      fillFace(baker, slice.color, 1, slice.points, originX, originY);
    }
  }
  fillFace(baker, CAPITOL.gold, 1, [
    [cu - 0.05, cv - 0.05, z1 + 6],
    [cu + 0.05, cv + 0.05, z1 + 6],
    [cu + 0.05, cv + 0.05, z1],
    [cu - 0.05, cv - 0.05, z1],
  ], originX, originY);
}

/**
 * A balustrade along one roof edge: capping rail plus turned posts. Runs on the
 * two visible faces only.
 */
function drawBalustrade(
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

/**
 * A portico: columns, entablature and pediment, projecting from a face.
 *
 * `dir` is +1 for the front (+v) elevation and −1 for the rear. Both are drawn
 * because the capitol is seen from every camera angle the world allows, and the
 * rear portico is what gives the back of the building something to be.
 */
function drawPortico(
  baker: Baker,
  originX: number,
  originY: number,
  half: number,
  vFace: number,
  depth: number,
  dir: 1 | -1,
  z0: number,
  eave: number,
  peak: number,
  columns: number,
): void {
  const vOuter = vFace + dir * depth;
  const vNear = dir === 1 ? vOuter : vFace;
  const vFar = dir === 1 ? vFace : vOuter;

  // Stylobate the columns stand on.
  drawBox(
    baker,
    { u0: -half, u1: half, v0: vFar, v1: vNear, z0: z0 - 6, z1: z0 },
    originX,
    originY,
    PLINTH_COLORS,
  );

  // Columns, near-to-far along u so the shading gradient reads left to right.
  const pitch = (half * 2) / columns;
  for (let index = 0; index <= columns; index += 1) {
    const centre = -half + pitch * index;
    drawBox(
      baker,
      {
        u0: centre - 0.075,
        u1: centre + 0.075,
        v0: vOuter - dir * 0.16,
        v1: vOuter,
        z0,
        z1: eave - 5,
      },
      originX,
      originY,
      { top: CAPITOL.stoneLit, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
    );
    // Capital.
    drawBox(
      baker,
      {
        u0: centre - 0.1,
        u1: centre + 0.1,
        v0: vOuter - dir * 0.2,
        v1: vOuter + dir * 0.02,
        z0: eave - 5,
        z1: eave - 1,
      },
      originX,
      originY,
      { top: CAPITOL.stoneLit, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stone },
    );
  }

  // Entablature over the colonnade.
  drawBox(
    baker,
    { u0: -half - 0.12, u1: half + 0.12, v0: vFar, v1: vNear, z0: eave - 1, z1: eave + 7 },
    originX,
    originY,
    STONE,
  );

  // Pediment.
  //
  // Drawn as a flat roof deck with a triangular gable standing on its front
  // edge, NOT as two sloping planes meeting at a ridge. A true sloped roof is
  // geometrically honest and looks wrong here: a plane that gains both u and v
  // covers an enormous amount of screen in this projection, so the far slope
  // became a dark grey mass twice the size of the colonnade and the whole
  // front of the building read as a lean-to shed. The deck-and-parapet reading
  // is what isometric art uses instead, and at this scale it is what a viewer
  // sees anyway.
  const vp = vOuter;
  const back = vFace + dir * 0.12;

  fillFace(baker, CAPITOL.roof, 1, [
    [-half - 0.14, back, eave + 7],
    [half + 0.14, back, eave + 7],
    [half + 0.14, vp, eave + 7],
    [-half - 0.14, vp, eave + 7],
  ], originX, originY);

  const gable: Point3[] = [
    [-half - 0.14, vp, eave + 7],
    [half + 0.14, vp, eave + 7],
    [0, vp, peak],
  ];
  fillFace(baker, dir === 1 ? CAPITOL.stoneLit : CAPITOL.stoneShade, 1, gable, originX, originY);
  // Raking cornice along the gable's two slopes — the moulding that separates
  // roof from wall, and the line that makes the triangle read at this size.
  strokeFace(baker, CAPITOL.stoneShade, 0.9, 2, gable, originX, originY);

  // Sculpture in the tympanum, suggested rather than drawn — three figures at
  // this scale is all that survives the projection.
  for (const offset of [-0.5, 0, 0.5]) {
    const rise = offset === 0 ? 8 : 5;
    fillFace(baker, CAPITOL.bronze, 0.5, [
      [offset - 0.06, vp, eave + 9],
      [offset + 0.06, vp, eave + 9],
      [offset + 0.06, vp, eave + 9 + rise],
      [offset - 0.06, vp, eave + 9 + rise],
    ], originX, originY);
  }
}

/** The grand stair: three flights with cheek walls, stepping down to the lawn. */
function drawGrandStair(
  baker: Baker,
  originX: number,
  originY: number,
  half: number,
  vTop: number,
  vBottom: number,
  zTop: number,
): void {
  const flights = 7;
  const depth = (vBottom - vTop) / flights;
  for (let index = 0; index < flights; index += 1) {
    const v0 = vTop + depth * index;
    const z = zTop - (zTop / flights) * index;
    drawBox(
      baker,
      { u0: -half, u1: half, v0, v1: v0 + depth, z0: 0, z1: z },
      originX,
      originY,
      // The riser has to be distinctly darker than the tread. Painting both in
      // terrace stone made the flight vanish into the slab it stands on.
      {
        top: CAPITOL.path,
        frontRight: shade(CAPITOL.terraceShade, -12),
        frontLeft: CAPITOL.terraceShade,
      },
    );
  }
  // Cheek walls, so the flights are held between something rather than
  // floating as a stack of slabs.
  for (const side of [-1, 1] as const) {
    const u = side * half;
    drawBox(
      baker,
      { u0: u - 0.16, u1: u + 0.16, v0: vTop, v1: vBottom, z0: 0, z1: zTop * 0.55 },
      originX,
      originY,
      PLINTH_COLORS,
    );
    // Lamp standard on the newel: a slender stone column carrying a gold lamp.
    // Rendering the whole standard in gold turned it into an orange lump on the
    // one part of the building the eye lands on first.
    const newel = zTop * 0.55;
    const lampV = vBottom - 0.24;
    drawBox(
      baker,
      { u0: u - 0.045, u1: u + 0.045, v0: lampV - 0.045, v1: lampV + 0.045, z0: newel, z1: newel + 17 },
      originX,
      originY,
      { top: CAPITOL.stoneLit, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
    );
    drawBox(
      baker,
      { u0: u - 0.075, u1: u + 0.075, v0: lampV - 0.075, v1: lampV + 0.075, z0: newel + 17, z1: newel + 23 },
      originX,
      originY,
      { top: CAPITOL.gold, frontRight: CAPITOL.goldDark, frontLeft: CAPITOL.gold },
    );
  }
}

/**
 * One wing or link block: plinth, pilastered elevation, cornice, attic and
 * roof balustrade. Factored out because the two wings and the two links are the
 * same composition at different sizes, and because it has to be callable from
 * the depth-sorted list rather than in source order.
 */
function drawWingBlock(
  baker: Baker,
  originX: number,
  originY: number,
  u0: number,
  u1: number,
  eave: number,
  bays: number,
  saucer: boolean,
): void {
  const v0 = BLOCK_BACK;
  const v1 = BLOCK_FRONT;

  // Rusticated basement.
  drawBox(baker, { u0, u1, v0, v1, z0: GROUND_Z, z1: PLINTH_Z }, originX, originY, PLINTH_COLORS);
  drawCornice(baker, { u0, u1, v0, v1, z0: GROUND_Z, z1: PLINTH_Z }, originX, originY, 0.06, 3, {
    top: CAPITOL.plinth,
    frontRight: CAPITOL.plinthDark,
    frontLeft: CAPITOL.plinthShade,
  });

  // Main storey.
  drawBox(baker, { u0, u1, v0, v1, z0: PLINTH_Z, z1: eave }, originX, originY, STONE);

  drawPilasters(baker, originX, originY, "u", u1, v0, v1, PLINTH_Z + 3, eave - 6, 2);
  drawPilasters(baker, originX, originY, "v", v1, u0, u1, PLINTH_Z + 3, eave - 6, bays);

  const bandTop = PLINTH_Z + (eave - PLINTH_Z) * 0.52;
  drawWindowBand(baker, originX, originY, "u", u1, v0, v1, PLINTH_Z + 8, bandTop - 4, 2);
  drawWindowBand(baker, originX, originY, "v", v1, u0, u1, PLINTH_Z + 8, bandTop - 4, bays);
  drawWindowBand(baker, originX, originY, "u", u1, v0, v1, bandTop + 4, eave - 9, 2);
  drawWindowBand(baker, originX, originY, "v", v1, u0, u1, bandTop + 4, eave - 9, bays);

  // Cornice, then the attic storey set back behind it.
  drawCornice(baker, { u0, u1, v0, v1, z0: PLINTH_Z, z1: eave }, originX, originY, 0.11, 6);
  drawBox(
    baker,
    { u0: u0 + 0.22, u1: u1 - 0.22, v0: v0 + 0.22, v1: v1 - 0.22, z0: eave, z1: eave + 10 },
    originX,
    originY,
    { top: CAPITOL.roof, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
  );

  // The balustrade runs the block's own length exactly. Following the
  // cornice's overhang instead left a rail and a post projecting past the far
  // corner into open air.
  drawBalustrade(baker, originX, originY, "v", v1 + 0.11, u0, u1, eave);
  drawBalustrade(baker, originX, originY, "u", u1 + 0.11, v0, v1, eave);

  if (saucer) {
    drawSaucer(baker, originX, originY, (u0 + u1) / 2, (v0 + v1) / 2, 0.78, eave + 10, eave + 30);
  }
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
const APRON = 0.5;
const APRON_Z = 3;

function drawGrounds(baker: Baker, originX: number, originY: number): void {
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
    drawBox(baker, { u0: -u, u1: u, v0, v1, z0: 0, z1: APRON_Z }, originX, originY, paving);
  };

  // Back to front, so each piece overlaps the one behind it correctly.
  apron(CENTER_HALF + APRON, REAR_FACE_V - APRON, BLOCK_BACK - APRON);
  apron(WING_OUTER + APRON, BLOCK_BACK - APRON, BLOCK_FRONT + APRON);
  apron(CENTER_HALF + 0.45 + APRON, BLOCK_FRONT + APRON, STAIR_FOOT_V + APRON);
}

/** The centre block: the mass the dome stands on, with its rear portico. */
function drawCenterBlock(baker: Baker, originX: number, originY: number): void {
  const u0 = -CENTER_HALF;
  const u1 = CENTER_HALF;

  drawBox(
    baker,
    { u0, u1, v0: CENTER_BACK, v1: CENTER_FRONT, z0: GROUND_Z, z1: PLINTH_Z },
    originX,
    originY,
    PLINTH_COLORS,
  );
  drawBox(
    baker,
    { u0, u1, v0: CENTER_BACK, v1: CENTER_FRONT, z0: PLINTH_Z, z1: CENTER_EAVE },
    originX,
    originY,
    STONE,
  );

  drawPilasters(baker, originX, originY, "u", u1, CENTER_BACK, CENTER_FRONT, PLINTH_Z + 4, CENTER_EAVE - 8, 3);
  drawWindowBand(baker, originX, originY, "u", u1, CENTER_BACK, CENTER_FRONT, PLINTH_Z + 10, PLINTH_Z + 24, 3);
  drawWindowBand(baker, originX, originY, "u", u1, CENTER_BACK, CENTER_FRONT, PLINTH_Z + 32, CENTER_EAVE - 12, 3);

  // Rear portico. It is as deep as the grand stair is long, which is what
  // keeps the composition symmetric about v = 0 and the lawn even all round.
  drawPortico(baker, originX, originY, CENTER_HALF - 0.2, CENTER_BACK, -(REAR_FACE_V - CENTER_BACK), -1, PLINTH_Z, CENTER_EAVE - 12, CENTER_EAVE + 8, 6);

  drawCornice(
    baker,
    { u0, u1, v0: CENTER_BACK, v1: CENTER_FRONT, z0: PLINTH_Z, z1: CENTER_EAVE },
    originX,
    originY,
    0.14,
    7,
  );

  // Attic that carries the dome's square base.
  drawBox(
    baker,
    {
      u0: u0 + 0.2,
      u1: u1 - 0.2,
      v0: CENTER_BACK + 0.2,
      v1: CENTER_FRONT - 0.2,
      z0: CENTER_EAVE,
      z1: ATTIC_Z,
    },
    originX,
    originY,
    { top: CAPITOL.roof, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
  );
  drawBalustrade(baker, originX, originY, "v", CENTER_FRONT + 0.14, u0, u1, CENTER_EAVE);
  drawBalustrade(baker, originX, originY, "u", u1 + 0.14, CENTER_BACK, CENTER_FRONT, CENTER_EAVE);
}

/** Drum, peristyle, dome, lantern and the statue on top. */
function drawDrumAndDome(baker: Baker, originX: number, originY: number): void {
  // Square base tying the drum to the attic.
  drawBox(
    baker,
    { u0: -1.05, u1: 1.05, v0: -1.0, v1: 1.0, z0: ATTIC_Z, z1: DRUM_BASE },
    originX,
    originY,
    { top: CAPITOL.roof, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
  );

  // Rusticated lower drum.
  drawCylinder(baker, originX, originY, 0, 0, 0.98, DRUM_BASE, DRUM_BASE + 14, CAPITOL.plinth, CAPITOL.plinth, 22);

  // The peristyle — 30 columns is fine enough to read as a ring at fit zoom
  // without turning into a picket fence.
  drawColonnade(baker, originX, originY, 0.94, DRUM_BASE + 14, PERISTYLE_Z, 30);

  // Entablature and balustrade capping the colonnade.
  drawCylinder(baker, originX, originY, 0, 0, 1.02, PERISTYLE_Z, PERISTYLE_Z + 7, CAPITOL.stone, CAPITOL.roof, 24);
  drawCylinder(baker, originX, originY, 0, 0, 0.86, PERISTYLE_Z + 7, DRUM_TOP, CAPITOL.stone, CAPITOL.roof, 22);

  drawDome(baker, originX, originY, 0.8, DRUM_TOP, DOME_TOP, 20);

  // Tholos: the little colonnade under the lantern. Its columns are sized from
  // its own radius, not the peristyle's, or ten of them would merge into a
  // solid post.
  drawColonnade(baker, originX, originY, 0.2, DOME_TOP, DOME_TOP + 16, 10, 0.032);
  drawCylinder(baker, originX, originY, 0, 0, 0.24, DOME_TOP + 16, DOME_TOP + 20, CAPITOL.stone, CAPITOL.roof, 12);

  // Cupola and the gilded finial, in the accent the airport and harbour share.
  const cupola = DOME_TOP + 20;
  drawCylinder(baker, originX, originY, 0, 0, 0.15, cupola, LANTERN_TOP - 12, CAPITOL.stone, CAPITOL.stoneLit, 12);
  drawCylinder(baker, originX, originY, 0, 0, 0.1, LANTERN_TOP - 12, LANTERN_TOP - 6, CAPITOL.gold, CAPITOL.gold, 10);

  // The statue: a silhouette, which is all that survives at this size, but a
  // distinctive one — it is the highest point on the map.
  fillFace(baker, CAPITOL.bronze, 1, [
    [-0.07, 0, LANTERN_TOP - 6],
    [0.07, 0, LANTERN_TOP - 6],
    [0.05, 0, LANTERN_TOP - 1],
    [-0.05, 0, LANTERN_TOP - 1],
  ], originX, originY);
  fillFace(baker, CAPITOL.gold, 1, [
    [-0.04, 0, LANTERN_TOP - 1],
    [0.04, 0, LANTERN_TOP - 1],
    [0.04, 0, LANTERN_TOP],
    [-0.04, 0, LANTERN_TOP],
  ], originX, originY);
}
