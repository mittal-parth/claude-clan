import { Baker, fillFace, strokeFace, diamond } from "../core";
import { TERRAIN_COLORS } from "../../palette";
import { drawAirportLabel } from "../airport/runway";

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
  gold: 0xf6bd60,
  goldDark: 0xb9782f,
  white: 0xf5f7f2,
  red: 0xf05d68,
  green: 0x6ee7b7,
} as const;


/** Cohesive landmark kit for the southwest repository airport. */
export const AIRPORT_TERMINAL_KEY = "fx:airport-terminal";

export const AIRPORT_TERMINAL_ANCHOR_Y = 58;

export const AIRPORT_TOWER_KEY = "fx:airport-tower";

export const AIRPORT_TOWER_ANCHOR_Y = 16;


/** Low modern terminal: stone plinth, luminous hall, canopy and solar roof. */
export function bakeAirportTerminal(baker: Baker): void {
  const width = 300;
  const height = 222;
  const originX = width / 2;
  const originY = height - AIRPORT_TERMINAL_ANCHOR_Y;
  const halfU = 1.55;
  const halfV = 0.82;
  const plinth = 9;
  const roof = 72;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    [
      [-halfU - 0.08, -halfV - 0.08, 0],
      [halfU + 0.14, -halfV - 0.08, 0],
      [halfU + 0.14, halfV + 0.14, 0],
      [-halfU - 0.08, halfV + 0.14, 0],
    ],
    originX,
    originY,
  );
  // Pale stone base.
  fillFace(
    baker,
    AIRPORT.concreteLight,
    1,
    [[-halfU, halfV, plinth], [halfU, halfV, plinth], [halfU, halfV, 0], [-halfU, halfV, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.concreteDark,
    1,
    [[halfU, halfV, plinth], [halfU, -halfV, plinth], [halfU, -halfV, 0], [halfU, halfV, 0]],
    originX,
    originY,
  );

  // Curtain-wall hall on both visible faces.
  fillFace(
    baker,
    AIRPORT.glass,
    1,
    [[-halfU, halfV, roof], [halfU, halfV, roof], [halfU, halfV, plinth], [-halfU, halfV, plinth]],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.glassDark,
    1,
    [[halfU, halfV, roof], [halfU, -halfV, roof], [halfU, -halfV, plinth], [halfU, halfV, plinth]],
    originX,
    originY,
  );

  // Mullions and warm interior bays.
  for (const u of [-1.18, -0.78, -0.38, 0.02, 0.42, 0.82, 1.22]) {
    const top = baker.at([u, halfV + 0.01, roof - 7], originX, originY);
    const bottom = baker.at([u, halfV + 0.01, plinth + 5], originX, originY);
    baker.graphics.lineStyle(2, AIRPORT.ink, 0.62);
    baker.graphics.lineBetween(top.x, top.y, bottom.x, bottom.y);
  }
  for (const z of [29, 51]) {
    const left = baker.at([-halfU, halfV + 0.01, z], originX, originY);
    const right = baker.at([halfU, halfV + 0.01, z], originX, originY);
    baker.graphics.lineStyle(1, AIRPORT.glassLight, 0.45);
    baker.graphics.lineBetween(left.x, left.y, right.x, right.y);
  }

  // Deep roof and gold fascia make the silhouette readable at fit zoom.
  fillFace(
    baker,
    AIRPORT.ink,
    1,
    [[-1.68, -0.94, roof], [1.68, -0.94, roof], [1.68, 0.94, roof], [-1.68, 0.94, roof]],
    originX,
    originY,
  );
  strokeFace(
    baker,
    AIRPORT.glassLight,
    0.34,
    1,
    [[-1.68, -0.94, roof + 1], [1.68, -0.94, roof + 1], [1.68, 0.94, roof + 1], [-1.68, 0.94, roof + 1]],
    originX,
    originY,
  );
  fillFace(
    baker,
    AIRPORT.gold,
    1,
    [[-1.68, 0.94, roof], [1.68, 0.94, roof], [1.68, 0.94, roof - 7], [-1.68, 0.94, roof - 7]],
    originX,
    originY,
  );

  // Solar skylights on the roof.
  for (const u of [-0.92, -0.3, 0.32, 0.94]) {
    fillFace(
      baker,
      AIRPORT.glassDark,
      1,
      [[u - 0.23, -0.54, roof + 2], [u + 0.23, -0.54, roof + 2], [u + 0.23, 0.25, roof + 2], [u - 0.23, 0.25, roof + 2]],
      originX,
      originY,
    );
    strokeFace(
      baker,
      AIRPORT.glassLight,
      0.38,
      1,
      [[u - 0.23, -0.54, roof + 3], [u + 0.23, -0.54, roof + 3], [u + 0.23, 0.25, roof + 3], [u - 0.23, 0.25, roof + 3]],
      originX,
      originY,
    );
  }

  // Entrance canopy, doors and a crisp CCX identifier.
  fillFace(
    baker,
    AIRPORT.ink,
    1,
    [[-0.72, 1.18, 27], [0.72, 1.18, 27], [0.72, 0.82, 27], [-0.72, 0.82, 27]],
    originX,
    originY,
  );
  const sign = baker.at([0.15, halfV + 0.03, 55], originX, originY);
  baker.graphics.fillStyle(AIRPORT.ink, 0.94);
  baker.graphics.fillRoundedRect(sign.x - 31, sign.y - 8, 62, 17, 2);
  drawAirportLabel(baker, "CCX", sign.x, sign.y - 5, 2);

  const doorCenter = baker.at([0, halfV + 0.02, 19], originX, originY);
  baker.graphics.fillStyle(0x173d4d, 1);
  baker.graphics.fillRect(doorCenter.x - 13, doorCenter.y - 18, 26, 21);
  baker.graphics.lineStyle(1, AIRPORT.glassLight, 0.7);
  baker.graphics.lineBetween(doorCenter.x, doorCenter.y - 18, doorCenter.x, doorCenter.y + 3);

  baker.finish(AIRPORT_TERMINAL_KEY, width, height);
}


export function bakeAirportTower(baker: Baker): void {
  const width = 128;
  const height = 246;
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
