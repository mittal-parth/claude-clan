import { Baker, fillFace, Point3, strokeFace, shade } from "../core";
import { drawCapitolBox, drawCornice, drawPilasters, drawWindowBand, drawBalustrade } from "../capitol/primitives";
import { PLINTH_COLORS, CAPITOL, STONE, BLOCK_BACK, BLOCK_FRONT, GROUND_Z, PLINTH_Z, CENTER_HALF, CENTER_BACK, CENTER_FRONT, CENTER_EAVE, REAR_FACE_V, ATTIC_Z } from "../capitol/base";
import { drawSaucer } from "../capitol/dome";

/**
 * A portico: columns, entablature and pediment, projecting from a face.
 *
 * `dir` is +1 for the front (+v) elevation and −1 for the rear. Both are drawn
 * because the capitol is seen from every camera angle the world allows, and the
 * rear portico is what gives the back of the building something to be.
 */
export function drawPortico(
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
  drawCapitolBox(
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
    drawCapitolBox(
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
    drawCapitolBox(
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
  drawCapitolBox(
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
export function drawGrandStair(
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
    drawCapitolBox(
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
    drawCapitolBox(
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
    drawCapitolBox(
      baker,
      { u0: u - 0.045, u1: u + 0.045, v0: lampV - 0.045, v1: lampV + 0.045, z0: newel, z1: newel + 17 },
      originX,
      originY,
      { top: CAPITOL.stoneLit, frontRight: CAPITOL.stoneShade, frontLeft: CAPITOL.stoneLit },
    );
    drawCapitolBox(
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
export function drawWingBlock(
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
  drawCapitolBox(baker, { u0, u1, v0, v1, z0: GROUND_Z, z1: PLINTH_Z }, originX, originY, PLINTH_COLORS);
  drawCornice(baker, { u0, u1, v0, v1, z0: GROUND_Z, z1: PLINTH_Z }, originX, originY, 0.06, 3, {
    top: CAPITOL.plinth,
    frontRight: CAPITOL.plinthDark,
    frontLeft: CAPITOL.plinthShade,
  });

  // Main storey.
  drawCapitolBox(baker, { u0, u1, v0, v1, z0: PLINTH_Z, z1: eave }, originX, originY, STONE);

  drawPilasters(baker, originX, originY, "u", u1, v0, v1, PLINTH_Z + 3, eave - 6, 2);
  drawPilasters(baker, originX, originY, "v", v1, u0, u1, PLINTH_Z + 3, eave - 6, bays);

  const bandTop = PLINTH_Z + (eave - PLINTH_Z) * 0.52;
  drawWindowBand(baker, originX, originY, "u", u1, v0, v1, PLINTH_Z + 8, bandTop - 4, 2);
  drawWindowBand(baker, originX, originY, "v", v1, u0, u1, PLINTH_Z + 8, bandTop - 4, bays);
  drawWindowBand(baker, originX, originY, "u", u1, v0, v1, bandTop + 4, eave - 9, 2);
  drawWindowBand(baker, originX, originY, "v", v1, u0, u1, bandTop + 4, eave - 9, bays);

  // Cornice, then the attic storey set back behind it.
  drawCornice(baker, { u0, u1, v0, v1, z0: PLINTH_Z, z1: eave }, originX, originY, 0.11, 6);
  drawCapitolBox(
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


/** The centre block: the mass the dome stands on, with its rear portico. */
export function drawCenterBlock(baker: Baker, originX: number, originY: number): void {
  const u0 = -CENTER_HALF;
  const u1 = CENTER_HALF;

  drawCapitolBox(
    baker,
    { u0, u1, v0: CENTER_BACK, v1: CENTER_FRONT, z0: GROUND_Z, z1: PLINTH_Z },
    originX,
    originY,
    PLINTH_COLORS,
  );
  drawCapitolBox(
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
  drawCapitolBox(
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
