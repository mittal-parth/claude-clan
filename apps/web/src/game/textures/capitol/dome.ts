import { Point3, shade, Baker, fillFace } from "../core";
import { CAPITOL, ATTIC_Z, DRUM_BASE, PERISTYLE_Z, DRUM_TOP, DOME_TOP, LANTERN_TOP } from "../capitol/base";
import { Box, drawCapitolBox } from "../capitol/primitives";

/** One face of a cylinder wall, keyed by depth so the caller can sort. */
export interface Slice {
  depth: number;
  points: Point3[];
  color: number;
}


/**
 * Cylinder walls as depth-sorted quads. The near half must be drawn last or the
 * drum's far wall shows through it.
 */
export function cylinderSlices(
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


export function drawCylinder(
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
export function drawColonnade(
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
        drawCapitolBox(baker, shaft, originX, originY, {
          top: CAPITOL.stoneLit,
          frontRight: shade(lit, -12),
          frontLeft: lit,
        });
        // Capital and base. Three pixels each is enough to read as an order
        // rather than a stick.
        const flare = columnHalf * 1.45;
        const collar = { u0: cu - flare, u1: cu + flare, v0: cv - flare, v1: cv + flare };
        drawCapitolBox(baker, { ...collar, z0: z1 - 3, z1 }, originX, originY, {
          top: CAPITOL.stoneLit,
          frontRight: CAPITOL.stoneShade,
          frontLeft: CAPITOL.stoneLit,
        });
        drawCapitolBox(baker, { ...collar, z0, z1: z0 + 3 }, originX, originY, {
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
export function drawDome(
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
export function drawSaucer(
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
  drawCapitolBox(
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


/** Drum, peristyle, dome, lantern and the statue on top. */
export function drawDrumAndDome(baker: Baker, originX: number, originY: number): void {
  // Square base tying the drum to the attic.
  drawCapitolBox(
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
