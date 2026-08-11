import { Baker, HALF_H, HALF_W, Point3, fillFace, strokeFace, diamond, shade } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { drawAirportLabel } from "../airport/runway";
import {
  AIRPORT_TERMINAL_HALF_U,
  AIRPORT_TERMINAL_HALF_V,
} from "../../layouts/airport";

/** Airport palette shared by every surface and structure. */
export const AIRPORT = {
  asphalt: 0x1b2830,
  asphaltEdge: 0x0d171d,
  asphaltWear: 0x33434b,
  concrete: 0x9ba9ad,
  concreteLight: 0xc2ccce,
  concreteDark: 0x67777d,
  ink: 0x10232e,
  glass: 0x68c9df,
  glassLight: 0xb7f1f7,
  glassDark: 0x26748d,
  glassDeep: 0x143f52,
  gold: 0xf6bd60,
  goldLight: 0xffe0a3,
  goldDark: 0xb9782f,
  amber: 0xffcf8f,
  white: 0xf5f7f2,
  red: 0xf05d68,
  green: 0x6ee7b7,
} as const;


/** Cohesive landmark kit for the southwest repository airport. */
export const AIRPORT_TERMINAL_KEY = "fx:airport-terminal";

export const AIRPORT_TOWER_KEY = "fx:airport-tower";

/**
 * The tower's contact shadow reaches 0.38 tiles past its own base, which is
 * 18px below the tile point — at the old 16 the near corner of the shadow was
 * cropped off along a hard line. Raising the canvas by the same amount keeps
 * the drawing origin, and so the beacon offset, exactly where it was.
 */
export const AIRPORT_TOWER_ANCHOR_Y = 20;


// ── Terminal geometry ───────────────────────────────────────────────────────
// Sized outward from the middle, one layer at a time:
//   pier | vaulted hall | pier   along u,   and   hall | canopy   along v.
// Everything else in this file is derived from these six numbers, so
// lengthening the terminal is a one-line change and the canvas follows.
/** Outer end of each flanking pier — the terminal's own half-length. */
const PIER_HALF_U = AIRPORT_TERMINAL_HALF_U;
const HALL_HALF_V = AIRPORT_TERMINAL_HALF_V;
const PIER_LENGTH = 0.82;
const HALL_HALF_U = PIER_HALF_U - PIER_LENGTH;
const PIER_HALF_V = 0.76;
const PIER_TOP = 38;
const PLINTH = 11;
/** Springing line of the barrel vault, and the top of the curtain wall. */
const EAVE = 58;
const VAULT_RISE = 42;
const VAULT_SEGMENTS = 16;
const FASCIA_OVERHANG = 0.08;
const CANOPY_HALF_U = 0.62;
const CANOPY_V = 1.34;
const CANOPY_Z = 34;
/** Door bank, wider than the canopy so the entrance survives being covered. */
const DOOR_HALF_U = 1.25;

/**
 * Room reserved below the tile point: the contact shadow's near corner, plus
 * a little margin. Used by both the bake and the sprite placement.
 */
export const AIRPORT_TERMINAL_ANCHOR_Y = 100;

const SHADOW_U = PIER_HALF_U + 0.14;
const SHADOW_V = HALL_HALF_V + 0.14;


interface Mass {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  z0: number;
  z1: number;
}


/**
 * The three faces of a rectangular mass the fixed camera can see: the lit +v
 * elevation, the shaded +u return, and the top. The -u/-v faces project inside
 * the silhouette, and the terminal is never rebaked at another heading, so
 * they are genuinely never needed.
 */
function drawMass(
  baker: Baker,
  mass: Mass,
  lit: number,
  shaded: number,
  top: number,
  originX: number,
  originY: number,
): void {
  fillFace(
    baker,
    lit,
    1,
    [
      [mass.u0, mass.v1, mass.z1],
      [mass.u1, mass.v1, mass.z1],
      [mass.u1, mass.v1, mass.z0],
      [mass.u0, mass.v1, mass.z0],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    shaded,
    1,
    [
      [mass.u1, mass.v1, mass.z1],
      [mass.u1, mass.v0, mass.z1],
      [mass.u1, mass.v0, mass.z0],
      [mass.u1, mass.v1, mass.z0],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    top,
    1,
    [
      [mass.u0, mass.v0, mass.z1],
      [mass.u1, mass.v0, mass.z1],
      [mass.u1, mass.v1, mass.z1],
      [mass.u0, mass.v1, mass.z1],
    ],
    originX,
    originY,
  );
}


/**
 * Cross-section of the barrel vault, sampled from the far springing (-v) round
 * to the near one (+v). `mid` is the segment's mid-angle, from which the unit
 * normal is taken — deriving it from the edge instead scales the shading with
 * the radius and bands the roof into a visible wireframe.
 */
function vaultProfile(): { v: number; z: number }[] {
  const points: { v: number; z: number }[] = [];
  for (let index = 0; index <= VAULT_SEGMENTS; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * index) / VAULT_SEGMENTS;
    points.push({
      v: HALL_HALF_V * Math.sin(angle),
      z: EAVE + VAULT_RISE * Math.cos(angle),
    });
  }
  return points;
}


/** Glazed curtain wall on the hall's +v frontage, with warm bays behind it. */
function drawFrontGlazing(baker: Baker, originX: number, originY: number): void {
  const face = HALL_HALF_V;
  fillFace(
    baker,
    AIRPORT.glass,
    1,
    [
      [-HALL_HALF_U, face, EAVE],
      [HALL_HALF_U, face, EAVE],
      [HALL_HALF_U, face, PLINTH],
      [-HALL_HALF_U, face, PLINTH],
    ],
    originX,
    originY,
  );

  // Warm departure-hall bays read through the glass. Kept off the two end bays
  // so the concourse doesn't glow right up to the structural corners.
  for (const u of [-1.32, -0.88, -0.44, 0.44, 0.88, 1.32]) {
    fillFace(
      baker,
      AIRPORT.amber,
      0.34,
      [
        [u - 0.16, face + 0.005, 44],
        [u + 0.16, face + 0.005, 44],
        [u + 0.16, face + 0.005, 30],
        [u - 0.16, face + 0.005, 30],
      ],
      originX,
      originY,
    );
  }

  // Spandrel courses. Two horizontals across a 5-tile frontage are what stop
  // the glass reading as one flat teal panel at fit zoom.
  for (const z of [28, 46]) {
    const left = baker.at([-HALL_HALF_U, face + 0.01, z], originX, originY);
    const right = baker.at([HALL_HALF_U, face + 0.01, z], originX, originY);
    baker.graphics.lineStyle(1, AIRPORT.glassLight, 0.4);
    baker.graphics.lineBetween(left.x, left.y, right.x, right.y);
  }

  // Gold mullion fins standing proud of the glass. Each is a pair of faces —
  // the shaded +u flank and the lit sliver of its leading edge. A single quad
  // in the wall plane would have no width to catch the light at all.
  const fin = 0.055;
  for (let u = -1.56; u <= 1.57; u += 0.39) {
    fillFace(
      baker,
      AIRPORT.goldDark,
      1,
      [
        [u, face, EAVE],
        [u, face + fin, EAVE],
        [u, face + fin, PLINTH],
        [u, face, PLINTH],
      ],
      originX,
      originY,
    );
    fillFace(
      baker,
      AIRPORT.gold,
      1,
      [
        [u - 0.03, face + fin, EAVE],
        [u, face + fin, EAVE],
        [u, face + fin, PLINTH],
        [u - 0.03, face + fin, PLINTH],
      ],
      originX,
      originY,
    );
  }
}


/**
 * The glazed barrel vault: bands across v, drawn far-first so the near half of
 * the roof paints over the far half, then gold ribs following the same profile
 * so they sit on the surface rather than floating above it.
 */
function drawVault(baker: Baker, originX: number, originY: number): void {
  const profile = vaultProfile();

  for (let index = 0; index < VAULT_SEGMENTS; index += 1) {
    const near = profile[index]!;
    const far = profile[index + 1]!;
    const mid = -Math.PI / 2 + (Math.PI * (index + 0.5)) / VAULT_SEGMENTS;
    // Sun upper-left: the +v flank is lit and the crown lightest, and neither
    // rotates, because the vault is baked at one heading only.
    const lit = shade(
      AIRPORT.glass,
      Math.round(11 * Math.sin(mid) + 16 * Math.cos(mid)),
    );
    fillFace(
      baker,
      lit,
      1,
      [
        [-HALL_HALF_U, near.v, near.z],
        [HALL_HALF_U, near.v, near.z],
        [HALL_HALF_U, far.v, far.z],
        [-HALL_HALF_U, far.v, far.z],
      ],
      originX,
      originY,
    );
  }

  // Transverse ribs. These, the fascia and the fins are the whole of the gold
  // in the landmark — enough to tie it to the harbour's amber quay line
  // without turning the roof into a slab of metal.
  for (let u = -HALL_HALF_U + 0.2; u <= HALL_HALF_U - 0.19; u += 0.445) {
    baker.graphics.lineStyle(1.5, AIRPORT.gold, 0.72);
    baker.graphics.strokePoints(
      profile.map((point) =>
        baker.at([u, point.v, point.z + 1] as Point3, originX, originY),
      ),
      false,
    );
  }

  // Crown ridge and its skylight strip.
  const crownFrom = baker.at([-HALL_HALF_U, 0, EAVE + VAULT_RISE + 1], originX, originY);
  const crownTo = baker.at([HALL_HALF_U, 0, EAVE + VAULT_RISE + 1], originX, originY);
  baker.graphics.lineStyle(2, AIRPORT.goldLight, 0.85);
  baker.graphics.lineBetween(crownFrom.x, crownFrom.y, crownTo.x, crownTo.y);
}


/**
 * The near gable: an arched glass end wall closing the vault. Drawn after the
 * vault because it stands nearer in u than every band, and stroked in gold so
 * the arch is legible as a shape at fit zoom.
 */
function drawGable(baker: Baker, originX: number, originY: number): void {
  const profile = vaultProfile();
  const arch: Point3[] = [
    [HALL_HALF_U, -HALL_HALF_V, PLINTH],
    ...profile.map((point) => [HALL_HALF_U, point.v, point.z] as Point3),
    [HALL_HALF_U, HALL_HALF_V, PLINTH],
  ];
  fillFace(baker, shade(AIRPORT.glassDark, 10), 1, arch, originX, originY);

  // Vertical mullions rising to the arch, and one ring inside it. Bars struck
  // radially from a hub instead turn the end wall into a fan — decorative, but
  // it stops reading as a window.
  baker.graphics.lineStyle(1, AIRPORT.glassDeep, 0.7);
  for (const point of profile) {
    const head = baker.at([HALL_HALF_U, point.v, point.z], originX, originY);
    const foot = baker.at([HALL_HALF_U, point.v, PLINTH], originX, originY);
    baker.graphics.lineBetween(head.x, head.y, foot.x, foot.y);
  }
  baker.graphics.lineStyle(1, AIRPORT.glassLight, 0.35);
  baker.graphics.strokePoints(
    profile.map((point) =>
      baker.at(
        [HALL_HALF_U + 0.005, point.v * 0.72, EAVE + (point.z - EAVE) * 0.72] as Point3,
        originX,
        originY,
      ),
    ),
    false,
  );

  baker.graphics.lineStyle(2, AIRPORT.gold, 0.92);
  baker.graphics.strokePoints(
    profile.map((point) =>
      baker.at([HALL_HALF_U + 0.005, point.v, point.z] as Point3, originX, originY),
    ),
    false,
  );
}


/** A projecting band right around the eave — the single strongest read. */
function drawFascia(baker: Baker, originX: number, originY: number): void {
  const v = HALL_HALF_V + FASCIA_OVERHANG;
  const u = HALL_HALF_U + FASCIA_OVERHANG;
  fillFace(
    baker,
    AIRPORT.gold,
    1,
    [
      [-u, v, EAVE + 2],
      [u, v, EAVE + 2],
      [u, v, EAVE - 8],
      [-u, v, EAVE - 8],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.goldDark,
    1,
    [
      [u, v, EAVE + 2],
      [u, -HALL_HALF_V, EAVE + 2],
      [u, -HALL_HALF_V, EAVE - 8],
      [u, v, EAVE - 8],
    ],
    originX,
    originY,
  );
  const soffitFrom = baker.at([-u, v, EAVE - 8], originX, originY);
  const soffitTo = baker.at([u, v, EAVE - 8], originX, originY);
  baker.graphics.lineStyle(1, AIRPORT.goldDark, 0.9);
  baker.graphics.lineBetween(soffitFrom.x, soffitFrom.y, soffitTo.x, soffitTo.y);
}


/** A flanking pier: stone box, glazed band, gold cornice, plant on the roof. */
function drawPier(
  baker: Baker,
  u0: number,
  u1: number,
  originX: number,
  originY: number,
): void {
  drawMass(
    baker,
    { u0, u1, v0: -PIER_HALF_V, v1: PIER_HALF_V, z0: 0, z1: PIER_TOP },
    AIRPORT.concreteLight,
    AIRPORT.concreteDark,
    AIRPORT.concrete,
    originX,
    originY,
  );

  // Glazed band on the lit elevation, with a sill under it — without the sill
  // a window band is a row of stickers on a blank wall.
  fillFace(
    baker,
    AIRPORT.glassDark,
    1,
    [
      [u0 + 0.14, PIER_HALF_V + 0.005, 30],
      [u1 - 0.14, PIER_HALF_V + 0.005, 30],
      [u1 - 0.14, PIER_HALF_V + 0.005, 17],
      [u0 + 0.14, PIER_HALF_V + 0.005, 17],
    ],
    originX,
    originY,
  );
  const sillFrom = baker.at([u0 + 0.14, PIER_HALF_V + 0.01, 16], originX, originY);
  const sillTo = baker.at([u1 - 0.14, PIER_HALF_V + 0.01, 16], originX, originY);
  baker.graphics.lineStyle(2, AIRPORT.concreteLight, 0.9);
  baker.graphics.lineBetween(sillFrom.x, sillFrom.y, sillTo.x, sillTo.y);

  // Cornice: an oversized slab capping the box, then a dark deck inset inside
  // it. Without the deck the cornice's own top face is the whole roof, and a
  // 2-tile plate of gold reads as a cream slab dropped on the building.
  drawMass(
    baker,
    {
      u0: u0 - 0.06,
      u1: u1 + 0.06,
      v0: -PIER_HALF_V - 0.06,
      v1: PIER_HALF_V + 0.06,
      z0: PIER_TOP,
      z1: PIER_TOP + 5,
    },
    AIRPORT.gold,
    AIRPORT.goldDark,
    AIRPORT.goldLight,
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.concreteDark,
    1,
    [
      [u0 + 0.08, -PIER_HALF_V + 0.08, PIER_TOP + 5],
      [u1 - 0.08, -PIER_HALF_V + 0.08, PIER_TOP + 5],
      [u1 - 0.08, PIER_HALF_V - 0.08, PIER_TOP + 5],
      [u0 + 0.08, PIER_HALF_V - 0.08, PIER_TOP + 5],
    ],
    originX,
    originY,
  );

  // Rooftop plant, set back from the cornice so the box still reads as a box.
  drawMass(
    baker,
    {
      u0: (u0 + u1) / 2 - 0.22,
      u1: (u0 + u1) / 2 + 0.22,
      v0: -0.24,
      v1: 0.24,
      z0: PIER_TOP + 5,
      z1: PIER_TOP + 13,
    },
    AIRPORT.concrete,
    AIRPORT.concreteDark,
    AIRPORT.concreteLight,
    originX,
    originY,
  );
}


/**
 * Entrance canopy, doors and the CCX identifier. Drawn last of everything: the
 * canopy projects nearer than any mass, so no depth sort can place it.
 */
function drawEntrance(baker: Baker, originX: number, originY: number): void {
  const face = HALL_HALF_V;

  // Doors, on the glass rather than in front of it. The bank is deliberately
  // wider than the canopy: at this projection a canopy covers everything
  // down-left of it, and a door band the canopy's own width vanishes whole.
  fillFace(
    baker,
    AIRPORT.glassDeep,
    1,
    [
      [-DOOR_HALF_U, face + 0.01, 24],
      [DOOR_HALF_U, face + 0.01, 24],
      [DOOR_HALF_U, face + 0.01, PLINTH],
      [-DOOR_HALF_U, face + 0.01, PLINTH],
    ],
    originX,
    originY,
  );
  baker.graphics.lineStyle(1, AIRPORT.glassLight, 0.6);
  for (let u = -DOOR_HALF_U + 0.42; u < DOOR_HALF_U; u += 0.42) {
    const top = baker.at([u, face + 0.02, 24], originX, originY);
    const foot = baker.at([u, face + 0.02, PLINTH], originX, originY);
    baker.graphics.lineBetween(top.x, top.y, foot.x, foot.y);
  }

  // Canopy columns, then the deck, so the deck caps them.
  for (const u of [-CANOPY_HALF_U + 0.1, CANOPY_HALF_U - 0.1]) {
    drawMass(
      baker,
      { u0: u - 0.05, u1: u + 0.05, v0: CANOPY_V - 0.16, v1: CANOPY_V - 0.06, z0: 0, z1: CANOPY_Z },
      AIRPORT.gold,
      AIRPORT.goldDark,
      AIRPORT.goldLight,
      originX,
      originY,
    );
  }
  // Glazed deck with a gold edge beam. A dark top face here is a mistake with
  // a name: at this projection the canopy's roof is most of what you see of
  // it, and in ink it read as a black plank laid across the frontage.
  drawMass(
    baker,
    {
      u0: -CANOPY_HALF_U,
      u1: CANOPY_HALF_U,
      v0: face,
      v1: CANOPY_V,
      z0: CANOPY_Z - 3,
      z1: CANOPY_Z,
    },
    AIRPORT.gold,
    AIRPORT.goldDark,
    AIRPORT.glass,
    originX,
    originY,
  );
  strokeFace(
    baker,
    AIRPORT.gold,
    0.9,
    1,
    [
      [-CANOPY_HALF_U, face, CANOPY_Z],
      [CANOPY_HALF_U, face, CANOPY_Z],
      [CANOPY_HALF_U, CANOPY_V, CANOPY_Z],
      [-CANOPY_HALF_U, CANOPY_V, CANOPY_Z],
    ],
    originX,
    originY,
  );

  // Fascia sign, on the glass above the canopy and clear of it.
  const sign = baker.at([0, face + 0.03, 42], originX, originY);
  baker.graphics.fillStyle(AIRPORT.ink, 0.94);
  baker.graphics.fillRoundedRect(sign.x - 31, sign.y - 8, 62, 17, 2);
  drawAirportLabel(baker, "CCX", sign.x, sign.y - 5, 2);
}


/**
 * The terminal: two stone piers flanking a glazed hall under a gold-ribbed
 * barrel vault. The masses are drawn from a list sorted by near corner, not in
 * source order — the near pier is written before the hall here and would
 * otherwise be painted underneath it.
 */
export function bakeAirportTerminal(baker: Baker): void {
  // Derived from the extents above. The contact shadow is the widest thing on
  // the ground plane and the crown the highest; hardcoding either rots the
  // moment the terminal is lengthened again.
  const width = Math.ceil((SHADOW_U + SHADOW_V) * HALF_W * 2) + 16;
  const height =
    Math.ceil((HALL_HALF_U + HALL_HALF_V) * HALF_H + EAVE + VAULT_RISE) +
    AIRPORT_TERMINAL_ANCHOR_Y;
  const originX = width / 2;
  const originY = height - AIRPORT_TERMINAL_ANCHOR_Y;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    [
      [-PIER_HALF_U - 0.08, -HALL_HALF_V - 0.08, 0],
      [SHADOW_U, -HALL_HALF_V - 0.08, 0],
      [SHADOW_U, SHADOW_V, 0],
      [-PIER_HALF_U - 0.08, SHADOW_V, 0],
    ],
    originX,
    originY,
  );

  const masses = [
    {
      depth: -HALL_HALF_U + PIER_HALF_V,
      draw: () => drawPier(baker, -PIER_HALF_U, -HALL_HALF_U, originX, originY),
    },
    {
      depth: HALL_HALF_U + HALL_HALF_V,
      draw: () => {
        // Plinth first, then the hall it carries.
        drawMass(
          baker,
          {
            u0: -HALL_HALF_U,
            u1: HALL_HALF_U,
            v0: -HALL_HALF_V,
            v1: HALL_HALF_V,
            z0: 0,
            z1: PLINTH,
          },
          AIRPORT.concreteLight,
          AIRPORT.concreteDark,
          AIRPORT.concrete,
          originX,
          originY,
        );
        drawFrontGlazing(baker, originX, originY);
        fillFace(
          baker,
          AIRPORT.glassDark,
          1,
          [
            [HALL_HALF_U, HALL_HALF_V, EAVE],
            [HALL_HALF_U, -HALL_HALF_V, EAVE],
            [HALL_HALF_U, -HALL_HALF_V, PLINTH],
            [HALL_HALF_U, HALL_HALF_V, PLINTH],
          ],
          originX,
          originY,
        );
        drawVault(baker, originX, originY);
        drawFascia(baker, originX, originY);
        drawGable(baker, originX, originY);
      },
    },
    {
      depth: PIER_HALF_U + PIER_HALF_V,
      draw: () => drawPier(baker, HALL_HALF_U, PIER_HALF_U, originX, originY),
    },
  ];
  masses.sort((left, right) => left.depth - right.depth);
  for (const mass of masses) mass.draw();

  drawEntrance(baker, originX, originY);

  baker.finish(AIRPORT_TERMINAL_KEY, width, height);
}


export function bakeAirportTower(baker: Baker): void {
  const width = 128;
  const height = 250;
  const originX = width / 2;
  const originY = height - AIRPORT_TOWER_ANCHOR_Y;
  const shaftTop = 132;
  const cabTop = 166;

  fillFace(baker, TERRAIN_COLORS.shadow, 0.22, diamond(0.38), originX, originY);
  fillFace(
    baker,
    AIRPORT.concrete,
    1,
    [[-0.2, 0.2, shaftTop], [0.2, 0.2, shaftTop], [0.28, 0.28, 0], [-0.28, 0.28, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.concreteDark,
    1,
    [[0.2, 0.2, shaftTop], [0.2, -0.2, shaftTop], [0.28, -0.28, 0], [0.28, 0.28, 0]],
    originX,
    originY,
  );

  // Gold string courses up the shaft. The tower is a tall blank mass and reads
  // as a chimney without horizontals on it.
  for (const z of [42, 84]) {
    const taper = 0.28 - (0.08 * z) / shaftTop;
    const left = baker.at([-taper, taper + 0.01, z], originX, originY);
    const right = baker.at([taper, taper + 0.01, z], originX, originY);
    baker.graphics.lineStyle(2, AIRPORT.gold, 0.55);
    baker.graphics.lineBetween(left.x, left.y, right.x, right.y);
  }

  // Collar under the cab, so the glass sits on something.
  fillFace(
    baker,
    AIRPORT.gold,
    1,
    [
      [-0.4, 0.4, shaftTop],
      [0.4, 0.4, shaftTop],
      [0.4, 0.4, shaftTop - 6],
      [-0.4, 0.4, shaftTop - 6],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.goldDark,
    1,
    [
      [0.4, 0.4, shaftTop],
      [0.4, -0.4, shaftTop],
      [0.4, -0.4, shaftTop - 6],
      [0.4, 0.4, shaftTop - 6],
    ],
    originX,
    originY,
  );

  fillFace(
    baker,
    AIRPORT.glassLight,
    1,
    [[-0.46, 0.46, cabTop], [0.46, 0.46, cabTop], [0.34, 0.34, shaftTop], [-0.34, 0.34, shaftTop]],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.glassDark,
    1,
    [[0.46, 0.46, cabTop], [0.46, -0.46, cabTop], [0.34, -0.34, shaftTop], [0.34, 0.34, shaftTop]],
    originX,
    originY,
  );
  fillFace(baker, AIRPORT.ink, 1, diamond(0.52, cabTop + 2), originX, originY);
  strokeFace(baker, AIRPORT.gold, 0.8, 2, diamond(0.52, cabTop + 3), originX, originY);

  const mast = baker.at([0, 0, cabTop + 2], originX, originY);
  baker.graphics.lineStyle(2, AIRPORT.concreteLight, 0.9);
  baker.graphics.lineBetween(mast.x, mast.y, mast.x, mast.y - 25);
  baker.graphics.fillStyle(AIRPORT.red, 1);
  baker.graphics.fillCircle(mast.x, mast.y - 28, 4);
  baker.finish(AIRPORT_TOWER_KEY, width, height);
}
