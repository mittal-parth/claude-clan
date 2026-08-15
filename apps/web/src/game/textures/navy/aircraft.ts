import { Baker, HALF_W, HALF_H, fillFace, strokeFace, shade } from "../core";
import { navyShadow, NAVY_BASE, navyRing, navyScreenLine } from "../navy/base";
import { harbourBox, harbourPost } from "../harbour/base";

export const NAVY_HELIPAD_KEY = "fx:navy-helipad";

export const NAVY_HELIPAD_ANCHOR_Y = 40;

export const NAVY_HELICOPTER_KEY = "fx:navy-helicopter";

export const NAVY_HELICOPTER_ANCHOR_Y = 32;

/** Pixels above the helicopter's tile point where the main rotor head sits. */
export const NAVY_ROTOR_HUB_Z = 46;

/**
 * Four blades repeat every quarter turn, so eight frames over 90 degrees give
 * an 11.25-degree step -- fast enough to blur rather than strobe.
 */
export const NAVY_ROTOR_FRAMES = 8;

export const NAVY_ROTOR_KEYS = Array.from(
  { length: NAVY_ROTOR_FRAMES },
  (_unused, index) => `fx:navy-rotor:${index}`,
);

export const NAVY_ROTOR_ANCHOR_Y = 38;


/** The helipad: a marked TLOF square with perimeter lights and tie-downs. */
export function bakeNavyHelipad(baker: Baker): void {
  const halfU = 0.72;
  const halfV = 0.6;
  const width = Math.ceil((halfU + halfV) * 2 * HALF_W) + 20;
  const height = NAVY_HELIPAD_ANCHOR_Y + Math.ceil((halfU + halfV + 0.25) * HALF_H) + 12;
  const originX = width / 2;
  const originY = height - NAVY_HELIPAD_ANCHOR_Y;

  navyShadow(baker, originX, originY, halfU + 0.1, halfV + 0.1);
  fillFace(baker, NAVY_BASE.deckDark, 1, [[-halfU - 0.06, -halfV - 0.06, 2], [halfU + 0.06, -halfV - 0.06, 2], [halfU + 0.06, halfV + 0.06, 2], [-halfU - 0.06, halfV + 0.06, 2]], originX, originY);
  fillFace(baker, NAVY_BASE.tarmac, 1, [[-halfU, -halfV, 4], [halfU, -halfV, 4], [halfU, halfV, 4], [-halfU, halfV, 4]], originX, originY);
  strokeFace(baker, NAVY_BASE.warning, 0.92, 2, [[-halfU + 0.07, -halfV + 0.07, 5], [halfU - 0.07, -halfV + 0.07, 5], [halfU - 0.07, halfV - 0.07, 5], [-halfU + 0.07, halfV - 0.07, 5]], originX, originY);

  // Touchdown circle and the H, drawn in grid space so they lie on the deck.
  strokeFace(baker, NAVY_BASE.white, 0.9, 3, navyRing(0.42, 5.5), originX, originY);
  for (const v of [-0.17, 0.17]) {
    navyScreenLine(baker, originX, originY, [-0.24, v, 6], [0.24, v, 6], 4, NAVY_BASE.white, 0.95);
  }
  navyScreenLine(baker, originX, originY, [0, -0.17, 6], [0, 0.17, 6], 4, NAVY_BASE.white, 0.95);

  // Perimeter lights on the corners and mid-sides, plus four tie-down rings.
  for (const [u, v] of [
    [-halfU + 0.04, -halfV + 0.04],
    [halfU - 0.04, -halfV + 0.04],
    [halfU - 0.04, halfV - 0.04],
    [-halfU + 0.04, halfV - 0.04],
    [0, -halfV + 0.04],
    [0, halfV - 0.04],
  ] as const) {
    const light = baker.at([u, v, 6], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warningDark, 1);
    baker.graphics.fillCircle(light.x, light.y + 1, 3);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillCircle(light.x, light.y, 2);
  }
  for (const [u, v] of [[-0.34, -0.28], [0.34, -0.28], [0.34, 0.28], [-0.34, 0.28]] as const) {
    strokeFace(baker, NAVY_BASE.steelDark, 0.85, 1, navyRing(0.05, 5.5).map(
      (point) => [point[0] + u, point[1] + v, point[2]] as const,
    ), originX, originY);
  }
  baker.finish(NAVY_HELIPAD_KEY, width, height);
}


/**
 * The naval helicopter, less its main rotor — that is a separate sprite so it
 * can spin (`bakeNavyRotor`).
 *
 * Authored nose-toward-+u and then yawed once, so the aircraft sits across the
 * screen at three-quarters rather than square-on: that is the pose where both
 * the long flank and the nose are visible at the same time.
 */
export function bakeNavyHelicopter(source: Baker): void {
  const width = 148;
  const height = 120;
  const originX = width / 2;
  const originY = height - NAVY_HELICOPTER_ANCHOR_Y;

  const yaw = -0.55;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const baker: Baker = {
    ...source,
    at: (point, ox, oy) =>
      source.at(
        [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2]],
        ox,
        oy,
      ),
  };

  const belly = 14;
  const deck = 33;
  /** Half-widths of the cabin down its length, nose last. */
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [-0.34, 0.14],
    [-0.2, 0.22],
    [0.02, 0.24],
    [0.24, 0.23],
    [0.42, 0.19],
    [0.55, 0.12],
    [0.62, 0],
  ];
  const outline: Array<readonly [number, number]> = [
    ...sheer.map(([u, v]) => [u, v] as const),
    ...[...sheer].reverse().slice(1).map(([u, v]) => [u, -v] as const),
  ];

  navyShadow(baker, originX, originY, 0.5, 0.24);

  // Skids: two rails on struts, under the cabin.
  for (const v of [-0.27, 0.27]) {
    navyScreenLine(baker, originX, originY, [-0.28, v, 1], [0.44, v, 1], 4, NAVY_BASE.black, 1);
    navyScreenLine(baker, originX, originY, [-0.26, v, 2], [0.42, v, 2], 2, NAVY_BASE.steelDark, 1);
    for (const u of [-0.14, 0.3]) {
      navyScreenLine(baker, originX, originY, [u, v, 1], [u + 0.03, v * 0.5, belly + 2], 3, NAVY_BASE.steelDark, 1);
    }
  }

  // Tail boom, stabiliser and fin, drawn before the cabin so the cabin reads
  // as the nearest mass.
  navyScreenLine(baker, originX, originY, [-0.24, 0, deck - 8], [-0.92, 0, deck - 2], 9, NAVY_BASE.black, 1);
  navyScreenLine(baker, originX, originY, [-0.24, 0, deck - 8], [-0.92, 0, deck - 2], 6, NAVY_BASE.olive, 1);
  navyScreenLine(baker, originX, originY, [-0.26, 0, deck - 5], [-0.9, 0, deck + 1], 2, NAVY_BASE.oliveLight, 0.8);
  fillFace(
    baker,
    NAVY_BASE.oliveDark,
    1,
    [[-0.66, -0.26, deck - 2], [-0.56, -0.26, deck - 2], [-0.56, 0.26, deck - 2], [-0.66, 0.26, deck - 2]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.olive,
    1,
    [[-0.86, 0, deck], [-1.0, 0, deck + 26], [-0.86, 0, deck + 26], [-0.8, 0, deck + 6]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.red,
    1,
    [[-0.99, 0.01, deck + 20], [-0.87, 0.01, deck + 20], [-0.87, 0.01, deck + 26], [-1.0, 0.01, deck + 26]],
    originX,
    originY,
  );

  // Tail rotor: a blurred disc with two ghost blades, on the fin's near face.
  const tail = baker.at([-0.9, 0.04, deck + 13], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 0.28);
  baker.graphics.fillCircle(tail.x, tail.y, 11);
  baker.graphics.lineStyle(2, NAVY_BASE.black, 0.55);
  baker.graphics.lineBetween(tail.x - 9, tail.y - 6, tail.x + 9, tail.y + 6);
  baker.graphics.lineBetween(tail.x - 5, tail.y + 9, tail.x + 5, tail.y - 9);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillCircle(tail.x, tail.y, 2);

  // Cabin: hull plating dropped from the outline, then the roof.
  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    // Outward normal of edge A->B on a counter-clockwise outline.
    const length = Math.hypot(v1 - v0, u1 - u0) || 1;
    const nu = (v1 - v0) / length;
    const nv = -(u1 - u0) / length;
    fillFace(
      baker,
      shade(NAVY_BASE.olive, Math.round(11 * nv - 26 * nu)),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, belly], [u0, v0, belly]],
      originX,
      originY,
    );
  }
  fillFace(
    baker,
    NAVY_BASE.oliveLight,
    1,
    outline.map(([u, v]) => [u * 0.94, v * 0.88, deck] as const),
    originX,
    originY,
  );

  // Cockpit glazing over the nose, and a cabin window on the near flank.
  fillFace(
    baker,
    NAVY_BASE.glassDark,
    1,
    [[0.26, 0.2, deck - 1], [0.46, 0.17, deck - 1], [0.58, 0.1, deck - 4], [0.62, 0, deck - 6], [0.62, 0, belly + 3], [0.5, 0.14, belly + 3], [0.3, 0.2, belly + 4]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.glass,
    0.85,
    [[0.3, 0.19, deck - 3], [0.46, 0.16, deck - 3], [0.54, 0.11, deck - 6], [0.44, 0.15, belly + 6], [0.32, 0.18, belly + 6]],
    originX,
    originY,
  );
  navyScreenLine(baker, originX, originY, [0.44, 0.16, deck - 2], [0.44, 0.16, belly + 4], 1, NAVY_BASE.steelDark, 0.85);
  fillFace(
    baker,
    NAVY_BASE.glassDark,
    1,
    [[0.0, 0.235, deck - 4], [0.2, 0.23, deck - 4], [0.2, 0.23, belly + 7], [0.0, 0.235, belly + 7]],
    originX,
    originY,
  );

  // Engine deck, exhaust and the rotor mast.
  harbourBox(baker, originX, originY, [-0.24, 0.08, -0.13, 0.13, deck - 1, deck + 6], NAVY_BASE.oliveDark);
  navyScreenLine(baker, originX, originY, [-0.26, 0.1, deck + 3], [-0.36, 0.14, deck + 1], 4, NAVY_BASE.black, 1);
  harbourPost(baker, originX, originY, 0.02, 0, deck + 5, NAVY_ROTOR_HUB_Z, 5, NAVY_BASE.steelDark);
  const hub = baker.at([0.02, 0, NAVY_ROTOR_HUB_Z], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillCircle(hub.x, hub.y, 5);

  // Livery: a red flank stripe, the roundel, and the navigation lamps.
  navyScreenLine(baker, originX, originY, [-0.2, 0.235, belly + 10], [0.36, 0.215, belly + 10], 3, NAVY_BASE.red, 0.95);
  const roundel = baker.at([0.06, 0.24, belly + 16], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.white, 0.95);
  baker.graphics.fillCircle(roundel.x, roundel.y, 5);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(roundel.x, roundel.y, 3);
  const nose = baker.at([0.62, 0, belly + 2], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.white, 1);
  baker.graphics.fillCircle(nose.x, nose.y, 2);
  const port = baker.at([-0.3, 0.24, deck - 2], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(port.x, port.y, 2);

  source.finish(NAVY_HELICOPTER_KEY, width, height);
}


/**
 * One frame of the main rotor. The blades lie in the ground plane, so yawing
 * (u, v) about the hub is exactly the spin — no sprite rotation involved.
 */
export function bakeNavyRotor(source: Baker, key: string, frame: number): void {
  const width = 136;
  const height = 80;
  const originX = width / 2;
  const originY = height - NAVY_ROTOR_ANCHOR_Y;

  // Four blades repeat every quarter turn, so the frames only need to cover 90.
  const angle = (frame / NAVY_ROTOR_FRAMES) * (Math.PI / 2);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker = {
    ...source,
    at: (point, ox, oy) =>
      source.at(
        [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2]],
        ox,
        oy,
      ),
  };

  const radius = 0.84;

  // The blur disc the blades sweep, laid flat so it reads as a rotor plane.
  fillFace(baker, NAVY_BASE.steel, 0.1, navyRing(radius, 0, 24), originX, originY);
  strokeFace(baker, NAVY_BASE.steel, 0.22, 1, navyRing(radius, 0, 24), originX, originY);

  for (let index = 0; index < 4; index += 1) {
    const phi = (index / 4) * Math.PI * 2;
    const du = Math.cos(phi);
    const dv = Math.sin(phi);
    // A blade tapers: wide at the root, thin at the tip.
    const across = 0.055;
    fillFace(
      baker,
      NAVY_BASE.black,
      0.95,
      [
        [du * 0.08 - dv * across, dv * 0.08 + du * across, 1],
        [du * radius - dv * across * 0.45, dv * radius + du * across * 0.45, 1],
        [du * radius + dv * across * 0.45, dv * radius - du * across * 0.45, 1],
        [du * 0.08 + dv * across, dv * 0.08 - du * across, 1],
      ],
      originX,
      originY,
    );
    navyScreenLine(
      baker,
      originX,
      originY,
      [du * 0.12, dv * 0.12, 2],
      [du * (radius - 0.02), dv * (radius - 0.02), 2],
      1,
      NAVY_BASE.steel,
      0.5,
    );
    const tip = baker.at([du * (radius - 0.06), dv * (radius - 0.06), 2], originX, originY);
    baker.graphics.fillStyle(index % 2 === 0 ? NAVY_BASE.warning : NAVY_BASE.white, 0.95);
    baker.graphics.fillCircle(tip.x, tip.y, 2);
  }

  const hub = baker.at([0, 0, 3], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillCircle(hub.x, hub.y, 6);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillCircle(hub.x - 1, hub.y - 1, 2);

  source.finish(key, width, height);
}
