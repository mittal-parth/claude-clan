import { Baker, fillFace, Point3, shade, TILE_HEIGHT, diamond, HALF_W, HALF_H, strokeFace, TILE_ANCHOR_Y } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { NAVY_QUAY_HALF_U, NAVY_QUAY_HALF_V } from "../../layouts/navyHarbour";
import { harbourPost, harbourBox, drawHarbourLabel } from "../harbour/base";
import { band } from "../terrain";
import Phaser from "phaser";

/**
 * The naval base kit.
 *
 * Cooler and harder than the cargo harbour next door — grey concrete, olive
 * steel and glass instead of warm stone and timber — but it keeps the same
 * amber accent, which is what makes the two installations read as one port.
 */
export const NAVY_BASE = {
  deck: 0x53616b,
  deckLight: 0x71818b,
  deckDark: 0x2c3944,
  concrete: 0x9aa7ad,
  concreteLight: 0xc8d0d1,
  concreteDark: 0x58656d,
  steel: 0xd4e0e2,
  steelDark: 0x68777f,
  olive: 0x4f625e,
  oliveLight: 0x718064,
  oliveDark: 0x2d3c35,
  glass: 0x8bd7e4,
  glassDark: 0x24566b,
  warning: 0xf3bd42,
  warningDark: 0x9c6d22,
  red: 0xd45147,
  redDark: 0x702d32,
  blue: 0x4e9ab3,
  white: 0xe8f0eb,
  black: 0x172027,
  rope: 0xd4c99e,
  /** Painted asphalt for the service road that runs the length of the apron. */
  tarmac: 0x3b4750,
} as const;


export function navyShadow(
  baker: Baker,
  originX: number,
  originY: number,
  halfU: number,
  halfV: number,
): void {
  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.28,
    [
      [-halfU + 0.1, -halfV + 0.12, 0],
      [halfU + 0.1, -halfV + 0.12, 0],
      [halfU + 0.1, halfV + 0.12, 0],
      [-halfU + 0.1, halfV + 0.12, 0],
    ],
    originX,
    originY,
  );
}


/**
 * A horizontal circle in grid space. A screen-space ellipse is a guess at the
 * projection; this is the projection, so painted circles and cylinder lids sit
 * on the ground at the same angle as everything else.
 */
export function navyRing(radius: number, z: number, segments = 20): Point3[] {
  return Array.from({ length: segments }, (_unused, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, z] as const;
  });
}


/**
 * An upright cylinder — tanks, revetments, gun pits. Side plates are shaded by
 * where each one faces under the world's fixed upper-left sun and drawn
 * furthest-first, so the near plating always wins.
 */
export function navyCylinder(
  baker: Baker,
  originX: number,
  originY: number,
  radius: number,
  z0: number,
  z1: number,
  color: number,
  segments = 18,
): void {
  const plates = Array.from({ length: segments }, (_unused, index) => {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    return { a0, a1, nu: Math.cos(mid), nv: Math.sin(mid) };
  }).sort((a, b) => a.nu + a.nv - (b.nu + b.nv));

  for (const plate of plates) {
    const u0 = Math.cos(plate.a0) * radius;
    const v0 = Math.sin(plate.a0) * radius;
    const u1 = Math.cos(plate.a1) * radius;
    const v1 = Math.sin(plate.a1) * radius;
    fillFace(
      baker,
      shade(color, Math.round(11 * plate.nv - 27 * plate.nu)),
      1,
      [[u0, v0, z1], [u1, v1, z1], [u1, v1, z0], [u0, v0, z0]],
      originX,
      originY,
    );
  }
  fillFace(baker, shade(color, 16), 1, navyRing(radius, z1, segments), originX, originY);
}


export function navyWindow(
  baker: Baker,
  originX: number,
  originY: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z0: number,
  z1: number,
): void {
  fillFace(
    baker,
    NAVY_BASE.glassDark,
    1,
    [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.glass,
    0.82,
    [[u1, v0, z1], [u1, v1, z1], [u1, v1, z0], [u1, v0, z0]],
    originX,
    originY,
  );
  baker.graphics.lineStyle(1, NAVY_BASE.steel, 0.46);
  for (const u of [u0 + (u1 - u0) / 2]) {
    const a = baker.at([u, v1 + 0.01, z1], originX, originY);
    const b = baker.at([u, v1 + 0.01, z0], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
}


export function navyScreenLine(
  baker: Baker,
  originX: number,
  originY: number,
  from: Point3,
  to: Point3,
  width: number,
  color: number,
  alpha = 1,
): void {
  const a = baker.at(from, originX, originY);
  const b = baker.at(to, originX, originY);
  baker.graphics.lineStyle(width, color, alpha);
  baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
}


/** Paint on the apron: a strip of line marking laid flat on the deck. */
export function navyDeckLine(
  baker: Baker,
  originX: number,
  originY: number,
  from: readonly [number, number],
  to: readonly [number, number],
  width: number,
  color: number,
  alpha = 1,
): void {
  navyScreenLine(
    baker,
    originX,
    originY,
    [from[0], from[1], NAVY_QUAY_DECK + 1],
    [to[0], to[1], NAVY_QUAY_DECK + 1],
    width,
    color,
    alpha,
  );
}


/** Navy-base kit. Every anchor is the gap from the tile point to the texture's bottom. */
export const NAVY_QUAY_KEY = "fx:navy-quay";

export const NAVY_QUAY_DECK = 16;

export const NAVY_QUAY_ANCHOR_Y =
  (NAVY_QUAY_HALF_U + NAVY_QUAY_HALF_V) * (TILE_HEIGHT / 2) + 14;

export const NAVY_PIER_KEY = "fx:navy-pier";

export const NAVY_PIER_DECK = 12;

export const NAVY_PIER_ANCHOR_Y = 38;

export const NAVY_COMMAND_KEY = "fx:navy-command";

export const NAVY_COMMAND_ANCHOR_Y = 60;

/** Pixels above the HQ's tile point where its masthead obstruction light sits. */
export const NAVY_COMMAND_BEACON_Z = 146;

export const NAVY_HANGAR_KEY = "fx:navy-hangar";

export const NAVY_HANGAR_ANCHOR_Y = 48;

export const NAVY_BARRACKS_KEY = "fx:navy-barracks";

export const NAVY_BARRACKS_ANCHOR_Y = 42;

/** The lattice tower the dish turns on. Static — only the dish is baked per heading. */
export const NAVY_RADAR_KEY = "fx:navy-radar";

export const NAVY_RADAR_ANCHOR_Y = 40;

/** Pixels above the radar's tile point where the dish's bearing sits. */
export const NAVY_RADAR_HUB_Z = 116;

/**
 * The dish is its own sprite so the tower can stay one texture while the head
 * sweeps. 24 headings is 15 degrees a step -- the coarsest that still reads as
 * a turn rather than a stutter (see the isometric-animation notes).
 */
export const NAVY_RADAR_DISH_FRAMES = 24;

export const NAVY_RADAR_DISH_KEYS = Array.from(
  { length: NAVY_RADAR_DISH_FRAMES },
  (_unused, index) => `fx:navy-radar-dish:${index}`,
);

/** The dish texture is drawn about its own bearing, so its anchor is its centre. */
export const NAVY_RADAR_DISH_ANCHOR_Y = 54;

export const NAVY_FENCE_KEY = "fx:navy-fence";

export const NAVY_FENCE_ANCHOR_Y = 20;

export const NAVY_FLOODLIGHT_KEY = "fx:navy-floodlight";

export const NAVY_FLOODLIGHT_ANCHOR_Y = 18;

/** Pixels above a floodlight's tile point where its lamp head burns. */
export const NAVY_FLOODLIGHT_LAMP_Z = 66;

export const NAVY_FLAG_KEY = "fx:navy-flag";

export const NAVY_FLAG_ANCHOR_Y = 18;

export const NAVY_CRATE_KEY = "fx:navy-crate";

export const NAVY_CRATE_ANCHOR_Y = 22;

export const NAVY_BOLLARD_KEY = "fx:navy-bollard";

export const NAVY_SIGN_KEY = "fx:navy-sign";

export const NAVY_SIGN_ANCHOR_Y = 30;

/** Pixels above the gate board's tile point where its beacon sits. */
export const NAVY_SIGN_BEACON_Z = 84;


export function bakeNavyPier(baker: Baker): void {
  const width = 120;
  const height = 112;
  const originX = width / 2;
  const originY = height - NAVY_PIER_ANCHOR_Y;
  const half = 0.5;
  const deck = NAVY_PIER_DECK;

  navyShadow(baker, originX, originY, half, half);
  fillFace(baker, NAVY_BASE.deckDark, 1, diamond(half, deck), originX, originY);
  fillFace(
    baker,
    NAVY_BASE.concreteDark,
    1,
    [[-half, half, deck], [half, half, deck], [half, half, 0], [-half, half, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(NAVY_BASE.concreteDark, -20),
    1,
    [[half, half, deck], [half, -half, deck], [half, -half, 0], [half, half, 0]],
    originX,
    originY,
  );
  for (const u of [-0.3, 0, 0.3]) {
    navyScreenLine(
      baker,
      originX,
      originY,
      [u, -half + 0.05, deck + 1],
      [u, half - 0.05, deck + 1],
      1,
      NAVY_BASE.deckLight,
      0.58,
    );
  }
  navyScreenLine(
    baker,
    originX,
    originY,
    [-half + 0.08, half - 0.1, deck + 1],
    [half - 0.08, half - 0.1, deck + 1],
    2,
    NAVY_BASE.warning,
    0.9,
  );
  for (const [u, v] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as const) {
    harbourPost(baker, originX, originY, u, v, -8, deck, 5, NAVY_BASE.oliveDark);
    const water = baker.at([u, v, 0], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.white, 0.48);
    baker.graphics.fillEllipse(water.x, water.y + 1, 13, 4);
  }
  baker.finish(NAVY_PIER_KEY, width, height);
}


/**
 * Naval Operations HQ. Three stepped masses under a glazed operations bridge:
 * the setback is what gives the building a silhouette you can pick out at fit
 * zoom, where a single box just reads as another warehouse.
 */
export function bakeNavyCommand(baker: Baker): void {
  const half = 0.72;
  const plinthHalf = half + 0.06;
  const plinth = 6;
  const body = 44;
  const band = 48;
  const setbackHalf = 0.52;
  const setback = 72;
  const bridgeHalf = 0.44;
  const bridge = 96;
  const cap = 102;
  const mast = 146;

  const width = Math.ceil(plinthHalf * 4 * HALF_W) + 24;
  const height = NAVY_COMMAND_ANCHOR_Y + Math.ceil(plinthHalf * 2 * HALF_H) + mast + 10;
  const originX = width / 2;
  const originY = height - NAVY_COMMAND_ANCHOR_Y;

  navyShadow(baker, originX, originY, plinthHalf + 0.1, plinthHalf + 0.08);

  // Stepped concrete: plinth, main block, string course, setback storey.
  harbourBox(baker, originX, originY, [-plinthHalf, plinthHalf, -plinthHalf, plinthHalf, 0, plinth], NAVY_BASE.concreteDark);
  harbourBox(baker, originX, originY, [-half, half, -half, half, plinth, body], NAVY_BASE.concreteLight);
  harbourBox(baker, originX, originY, [-half - 0.04, half + 0.04, -half - 0.04, half + 0.04, body, band], NAVY_BASE.deckDark);
  harbourBox(baker, originX, originY, [-setbackHalf, setbackHalf, -setbackHalf, setbackHalf, band, setback], NAVY_BASE.concrete);

  // Two window bands on the main block and one on the setback.
  for (const z of [14, 30] as const) {
    for (const u of [-0.5, -0.17, 0.16, 0.49]) {
      navyWindow(baker, originX, originY, u - 0.1, u + 0.1, half + 0.02, half + 0.02, z, z + 11);
    }
  }
  for (const u of [-0.34, -0.02, 0.3]) {
    navyWindow(baker, originX, originY, u - 0.09, u + 0.09, setbackHalf + 0.02, setbackHalf + 0.02, 54, 64);
  }

  // Entrance: a cantilevered canopy over the doors, with a lit sign band.
  fillFace(
    baker,
    NAVY_BASE.redDark,
    1,
    [[-0.26, half + 0.02, 24], [0.26, half + 0.02, 24], [0.26, half + 0.02, plinth], [-0.26, half + 0.02, plinth]],
    originX,
    originY,
  );
  harbourBox(baker, originX, originY, [-0.36, 0.36, half, half + 0.26, 24, 28], NAVY_BASE.deckDark);
  navyScreenLine(baker, originX, originY, [-0.36, half + 0.26, 25], [0.36, half + 0.26, 25], 2, NAVY_BASE.warning, 0.9);

  // Operations bridge: glazed on all four sides, on a flared sill.
  harbourBox(baker, originX, originY, [-bridgeHalf - 0.09, bridgeHalf + 0.09, -bridgeHalf - 0.09, bridgeHalf + 0.09, setback, setback + 5], NAVY_BASE.deckDark);
  harbourBox(baker, originX, originY, [-bridgeHalf, bridgeHalf, -bridgeHalf, bridgeHalf, setback + 5, bridge], NAVY_BASE.glassDark);
  fillFace(
    baker,
    NAVY_BASE.glass,
    0.86,
    [[-bridgeHalf, bridgeHalf + 0.01, bridge - 2], [bridgeHalf, bridgeHalf + 0.01, bridge - 2], [bridgeHalf, bridgeHalf + 0.01, setback + 8], [-bridgeHalf, bridgeHalf + 0.01, setback + 8]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.glass,
    0.6,
    [[bridgeHalf + 0.01, bridgeHalf, bridge - 2], [bridgeHalf + 0.01, -bridgeHalf, bridge - 2], [bridgeHalf + 0.01, -bridgeHalf, setback + 8], [bridgeHalf + 0.01, bridgeHalf, setback + 8]],
    originX,
    originY,
  );
  for (const u of [-0.2, 0.06]) {
    navyScreenLine(baker, originX, originY, [u, bridgeHalf + 0.03, bridge - 2], [u, bridgeHalf + 0.03, setback + 8], 1, NAVY_BASE.steelDark, 0.7);
  }
  harbourBox(baker, originX, originY, [-bridgeHalf - 0.06, bridgeHalf + 0.06, -bridgeHalf - 0.06, bridgeHalf + 0.06, bridge, cap], NAVY_BASE.deckDark);

  // Roof furniture: mast with a yardarm, a radome and the obstruction light.
  harbourPost(baker, originX, originY, 0.06, -0.08, cap, mast, 4, NAVY_BASE.steelDark);
  navyScreenLine(baker, originX, originY, [-0.22, -0.08, mast - 22], [0.34, -0.08, mast - 22], 2, NAVY_BASE.steel, 0.92);
  navyScreenLine(baker, originX, originY, [-0.22, -0.08, mast - 22], [0.06, -0.08, mast - 6], 1, NAVY_BASE.rope, 0.6);
  navyScreenLine(baker, originX, originY, [0.34, -0.08, mast - 22], [0.06, -0.08, mast - 6], 1, NAVY_BASE.rope, 0.6);
  const radome = baker.at([-0.3, 0.16, cap], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillRect(radome.x - 3, radome.y - 12, 6, 12);
  baker.graphics.fillStyle(NAVY_BASE.concreteLight, 1);
  baker.graphics.fillCircle(radome.x, radome.y - 15, 7);
  baker.graphics.fillStyle(NAVY_BASE.steel, 0.7);
  baker.graphics.fillCircle(radome.x - 2, radome.y - 17, 3);
  const beacon = baker.at([0.06, -0.08, mast], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(beacon.x, beacon.y - 1, 3);

  const plaque = baker.at([0, half + 0.03, 30], originX, originY);
  drawHarbourLabel(baker, "NAVY", plaque.x, plaque.y - 4, NAVY_BASE.white, 1);
  baker.finish(NAVY_COMMAND_KEY, width, height);
}


/**
 * Fleet maintenance hangar. The barrel vault is the whole point: an arched
 * roof is unmistakable at any zoom, where the flat-topped shed it replaced was
 * indistinguishable from the barracks.
 */
export function bakeNavyHangar(baker: Baker): void {
  const halfU = 0.86;
  const halfV = 0.78;
  const wall = 24;
  const crown = 62;
  const segments = 14;

  const width = Math.ceil((halfU + halfV) * 2 * HALF_W) + 24;
  const height = NAVY_HANGAR_ANCHOR_Y + Math.ceil((halfU + halfV) * HALF_H) + crown + 12;
  const originX = width / 2;
  const originY = height - NAVY_HANGAR_ANCHOR_Y;

  /** Height of the vault a fraction `t` of the way across the span. */
  const archZ = (v: number): number =>
    wall + (crown - wall) * Math.sqrt(Math.max(0, 1 - (v / halfV) ** 2));

  navyShadow(baker, originX, originY, halfU + 0.12, halfV + 0.12);

  // Side wall under the lit (+v) eaves, then the vault laid on far-to-near.
  harbourBox(baker, originX, originY, [-halfU, halfU, halfV - 0.06, halfV, 0, wall], NAVY_BASE.olive);
  for (let index = 0; index < segments; index += 1) {
    const v0 = -halfV + (index / segments) * halfV * 2;
    const v1 = -halfV + ((index + 1) / segments) * halfV * 2;
    const mid = (v0 + v1) / 2;
    fillFace(
      baker,
      shade(NAVY_BASE.olive, Math.round(6 + 22 * (mid / halfV))),
      1,
      [[-halfU, v0, archZ(v0)], [halfU, v0, archZ(v0)], [halfU, v1, archZ(v1)], [-halfU, v1, archZ(v1)]],
      originX,
      originY,
    );
    // Corrugation: one rib per segment, drawn on the segment's own crown.
    navyScreenLine(baker, originX, originY, [-halfU, v1, archZ(v1) + 0.4], [halfU, v1, archZ(v1) + 0.4], 1, NAVY_BASE.oliveDark, 0.5);
  }

  // Gable end facing the apron, following the same arch.
  const gable: Point3[] = [[halfU, -halfV, 0]];
  for (let index = 0; index <= segments; index += 1) {
    const v = -halfV + (index / segments) * halfV * 2;
    gable.push([halfU, v, archZ(v)]);
  }
  gable.push([halfU, halfV, 0]);
  fillFace(baker, shade(NAVY_BASE.olive, -22), 1, gable, originX, originY);
  strokeFace(baker, NAVY_BASE.oliveDark, 0.8, 1, gable, originX, originY);

  // The main door: a black opening with a lit slot where it stands part-open.
  const doorHalf = 0.58;
  const doorTop = 40;
  fillFace(
    baker,
    NAVY_BASE.black,
    1,
    [[halfU + 0.01, -doorHalf, 4], [halfU + 0.01, -doorHalf, doorTop], [halfU + 0.01, doorHalf, doorTop], [halfU + 0.01, doorHalf, 4]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.warning,
    0.28,
    [[halfU + 0.02, 0.12, 6], [halfU + 0.02, 0.12, 30], [halfU + 0.02, doorHalf - 0.04, 30], [halfU + 0.02, doorHalf - 0.04, 6]],
    originX,
    originY,
  );
  for (const v of [-0.34, -0.06, 0.3]) {
    navyScreenLine(baker, originX, originY, [halfU + 0.03, v, doorTop - 2], [halfU + 0.03, v, 5], 1, NAVY_BASE.steelDark, 0.6);
  }
  // Hazard chevrons across the door sill.
  for (const v of [-0.5, -0.24, 0.02, 0.28]) {
    navyScreenLine(baker, originX, originY, [halfU + 0.04, v, 3], [halfU + 0.04, v + 0.14, 11], 3, NAVY_BASE.warning, 0.92);
  }
  // Door rail and header beam.
  navyScreenLine(baker, originX, originY, [halfU + 0.04, -doorHalf - 0.06, doorTop + 2], [halfU + 0.04, doorHalf + 0.06, doorTop + 2], 3, NAVY_BASE.steelDark, 1);

  // Roof ridge vents and a beacon on the near apex.
  for (const u of [-0.5, 0, 0.5]) {
    harbourBox(baker, originX, originY, [u - 0.13, u + 0.13, -0.1, 0.1, crown - 2, crown + 6], NAVY_BASE.steelDark);
  }
  const apex = baker.at([halfU, 0, crown], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(apex.x, apex.y - 4, 3);
  baker.graphics.fillStyle(NAVY_BASE.white, 0.9);
  baker.graphics.fillCircle(apex.x - 1, apex.y - 5, 1);

  // Unit number stencilled on the gable, above the door.
  const stencil = baker.at([halfU + 0.05, 0, doorTop + 12], originX, originY);
  drawHarbourLabel(baker, "NAVY", stencil.x, stencil.y - 4, NAVY_BASE.warning, 1);

  baker.finish(NAVY_HANGAR_KEY, width, height);
}


/** Crew barracks: two storeys under a pitched roof, with a porch on the apron side. */
export function bakeNavyBarracks(baker: Baker): void {
  const half = 0.64;
  const body = 36;
  const eave = body + 3;
  const ridge = body + 19;
  /** The roof oversails the walls, so the canvas is sized from it, not them. */
  const overhang = half + 0.08;

  const width = Math.ceil(overhang * 4 * HALF_W) + 20;
  const height =
    NAVY_BARRACKS_ANCHOR_Y + Math.ceil(overhang * 2 * HALF_H) + ridge + 12;
  const originX = width / 2;
  const originY = height - NAVY_BARRACKS_ANCHOR_Y;

  navyShadow(baker, originX, originY, half + 0.1, half + 0.1);
  harbourBox(baker, originX, originY, [-half, half, -half, half, 0, 5], NAVY_BASE.concreteDark);
  harbourBox(baker, originX, originY, [-half, half, -half, half, 5, body], NAVY_BASE.concreteLight);

  // Pitched roof, ridge running along u.
  //
  // Looking down at this angle you see BOTH slopes of the ridge, not just the
  // near one -- the far eave projects *above* the ridge line, because dropping
  // 0.8 of a tile in v lifts a point further up the screen than the roof's
  // pitch brings it down. Plating only the +v slope left the far half of the
  // roof as a hole.
  const slope = (side: 1 | -1): Point3[] => [
    [-overhang, 0, ridge],
    [overhang, 0, ridge],
    [overhang, side * overhang, eave],
    [-overhang, side * overhang, eave],
  ];

  // Gable wall first: both slopes overhang it, so they cap it cleanly.
  fillFace(
    baker,
    NAVY_BASE.concrete,
    1,
    [[half, -half, body - 2], [half, 0, ridge], [half, half, body - 2]],
    originX,
    originY,
  );
  // Far slope, then near. The far one faces -v, away from the sun, so it is
  // the darker of the two.
  fillFace(baker, shade(NAVY_BASE.redDark, -10), 1, slope(-1), originX, originY);
  fillFace(baker, shade(NAVY_BASE.redDark, 18), 1, slope(1), originX, originY);
  // Barge boards: the roof's own thickness, seen at the near gable end.
  fillFace(
    baker,
    NAVY_BASE.redDark,
    1,
    [[overhang, 0, ridge], [overhang, overhang, eave], [overhang, overhang, eave - 3], [overhang, 0, ridge - 3]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(NAVY_BASE.redDark, -18),
    1,
    [[overhang, -overhang, eave], [overhang, 0, ridge], [overhang, 0, ridge - 3], [overhang, -overhang, eave - 3]],
    originX,
    originY,
  );
  navyScreenLine(baker, originX, originY, [-overhang, 0, ridge], [overhang, 0, ridge], 2, shade(NAVY_BASE.redDark, -26), 1);

  // Two rows of windows, and a porch over the door at the near end.
  for (const z of [11, 24] as const) {
    for (const u of [-0.44, -0.15, 0.14, 0.43]) {
      navyWindow(baker, originX, originY, u - 0.08, u + 0.08, half + 0.02, half + 0.02, z, z + 9);
    }
  }
  fillFace(
    baker,
    NAVY_BASE.deckDark,
    1,
    [[0.36, half + 0.02, 20], [0.6, half + 0.02, 20], [0.6, half + 0.02, 5], [0.36, half + 0.02, 5]],
    originX,
    originY,
  );
  harbourBox(baker, originX, originY, [0.3, 0.66, half, half + 0.2, 20, 23], NAVY_BASE.deckDark);
  harbourPost(baker, originX, originY, 0.64, half + 0.18, 0, 20, 2, NAVY_BASE.steelDark);
  navyScreenLine(baker, originX, originY, [-0.5, half + 0.04, 6], [0.66, half + 0.04, 6], 2, NAVY_BASE.warning, 0.6);

  // Roof vents and a flue keep the ridge from reading as a bare line.
  for (const u of [-0.34, 0.16]) {
    harbourPost(baker, originX, originY, u, -0.14, ridge - 6, ridge + 8, 3, NAVY_BASE.steelDark);
  }
  baker.finish(NAVY_BARRACKS_KEY, width, height);
}


/**
 * The radar tower — the mast only. Its dish is a separate sprite baked once per
 * heading (`bakeNavyRadarDish`), because an isometric prop cannot be rotated at
 * runtime; spinning the sprite would read as a spinning picture.
 */
export function bakeNavyRadar(baker: Baker): void {
  const foundationHalf = 0.46;
  const footHalf = 0.3;
  const headHalf = 0.14;
  const legFoot = 12;
  const platform = 92;
  const railing = platform + 11;
  const top = NAVY_RADAR_HUB_Z;

  const width = Math.ceil((foundationHalf + 0.1) * 4 * HALF_W) + 20;
  const height = NAVY_RADAR_ANCHOR_Y + Math.ceil(foundationHalf * 2 * HALF_H) + top + 14;
  const originX = width / 2;
  const originY = height - NAVY_RADAR_ANCHOR_Y;

  navyShadow(baker, originX, originY, foundationHalf + 0.12, foundationHalf + 0.12);

  // Poured foundation with a hazard border and holding-down bolts.
  harbourBox(baker, originX, originY, [-foundationHalf, foundationHalf, -foundationHalf, foundationHalf, 0, 10], NAVY_BASE.concreteDark);
  fillFace(baker, NAVY_BASE.concreteLight, 1, diamond(foundationHalf - 0.03, 11), originX, originY);
  strokeFace(baker, NAVY_BASE.warning, 0.9, 2, diamond(foundationHalf - 0.08, 12), originX, originY);
  for (const [u, v] of [[-footHalf, -footHalf], [footHalf, -footHalf], [footHalf, footHalf], [-footHalf, footHalf]] as const) {
    const bolt = baker.at([u, v, 12], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.black, 1);
    baker.graphics.fillCircle(bolt.x, bolt.y, 2);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillCircle(bolt.x, bolt.y - 1, 1);
  }

  // Signal cabinet at the foot, with its status panel facing the apron.
  harbourBox(baker, originX, originY, [0.16, 0.44, 0.12, 0.4, 11, 32], NAVY_BASE.oliveDark);
  navyScreenLine(baker, originX, originY, [0.17, 0.4, 25], [0.43, 0.4, 25], 2, NAVY_BASE.warning, 0.82);
  const panel = baker.at([0.3, 0.41, 20], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillRect(panel.x - 5, panel.y - 4, 10, 7);
  baker.graphics.fillStyle(NAVY_BASE.blue, 1);
  baker.graphics.fillRect(panel.x - 3, panel.y - 2, 2, 2);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillRect(panel.x + 1, panel.y - 2, 2, 2);

  // Tapering lattice: four legs that converge toward the platform, which is
  // what makes it read as an engineered mast rather than a chimney.
  const legs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  for (const [su, sv] of legs) {
    navyScreenLine(
      baker,
      originX,
      originY,
      [su * footHalf, sv * footHalf, legFoot],
      [su * headHalf, sv * headHalf, platform],
      3,
      NAVY_BASE.steelDark,
      1,
    );
  }
  // X-bracing on the two faces the viewer can see (+u and +v).
  const bays = 5;
  for (let index = 0; index < bays; index += 1) {
    const t0 = index / bays;
    const t1 = (index + 1) / bays;
    const z0 = legFoot + (platform - legFoot) * t0;
    const z1 = legFoot + (platform - legFoot) * t1;
    const w0 = footHalf + (headHalf - footHalf) * t0;
    const w1 = footHalf + (headHalf - footHalf) * t1;
    for (const face of [
      { a: [-1, 1], b: [1, 1] },
      { a: [1, 1], b: [1, -1] },
    ] as const) {
      navyScreenLine(baker, originX, originY, [face.a[0] * w0, face.a[1] * w0, z0], [face.b[0] * w1, face.b[1] * w1, z1], 1, NAVY_BASE.steel, 0.85);
      navyScreenLine(baker, originX, originY, [face.b[0] * w0, face.b[1] * w0, z0], [face.a[0] * w1, face.a[1] * w1, z1], 1, NAVY_BASE.steelDark, 0.9);
      navyScreenLine(baker, originX, originY, [face.a[0] * w1, face.a[1] * w1, z1], [face.b[0] * w1, face.b[1] * w1, z1], 1, NAVY_BASE.steelDark, 0.75);
    }
  }
  // Access ladder up the near leg.
  for (let z = legFoot + 6; z < platform - 6; z += 7) {
    const t = (z - legFoot) / (platform - legFoot);
    const w = footHalf + (headHalf - footHalf) * t;
    navyScreenLine(baker, originX, originY, [w + 0.06, w, z], [w - 0.04, w, z], 1, NAVY_BASE.steel, 0.8);
  }

  // Service platform, kick plate and railing.
  fillFace(baker, NAVY_BASE.deckDark, 1, diamond(0.34, platform), originX, originY);
  strokeFace(baker, NAVY_BASE.warning, 0.85, 1, diamond(0.3, platform + 1), originX, originY);
  const railPosts = [
    [-0.32, -0.32],
    [0.32, -0.32],
    [0.32, 0.32],
    [-0.32, 0.32],
  ] as const;
  for (const [u, v] of railPosts) {
    harbourPost(baker, originX, originY, u, v, platform, railing, 2, NAVY_BASE.steelDark);
  }
  for (const z of [railing, platform + 5]) {
    navyScreenLine(baker, originX, originY, [-0.32, 0.32, z], [0.32, 0.32, z], 1, NAVY_BASE.steel, 0.9);
    navyScreenLine(baker, originX, originY, [0.32, 0.32, z], [0.32, -0.32, z], 1, NAVY_BASE.steel, 0.72);
  }

  // King post the dish's bearing sits on, plus obstruction lights.
  harbourPost(baker, originX, originY, 0, 0, platform, top, 6, NAVY_BASE.black);
  harbourPost(baker, originX, originY, 0.02, -0.02, platform + 2, top - 2, 2, NAVY_BASE.steel);
  for (const z of [40, 66]) {
    const light = baker.at([0.16, 0.16, z], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillCircle(light.x, light.y, 2);
  }
  baker.finish(NAVY_RADAR_KEY, width, height);
}


/**
 * One heading of the radar head. Wrapping the baker's `at` rotates every point
 * the drawing puts down about the mast, so the same authored dish gives all 24
 * bearings and the feed horn swings round with it.
 */
export function bakeNavyRadarDish(source: Baker, key: string, frame: number): void {
  const width = 116;
  const height = 112;
  const originX = width / 2;
  const originY = height - NAVY_RADAR_DISH_ANCHOR_Y;

  const angle = (frame / NAVY_RADAR_DISH_FRAMES) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2]],
              ox,
              oy,
            ),
        };

  const radius = 0.6;
  /** How far the dish face leans back over its pedestal, per unit of rise. */
  const lean = 0.3;
  /** Pixels of height per unit of dish radius — sets how upright the face is. */
  const rise = 44;
  const segments = 26;

  /** A point on the dish rim: `phi` runs round the face, 0 at the lit side. */
  const rim = (phi: number, scale: number, out: number): Point3 => {
    const across = Math.cos(phi) * radius * scale;
    const up = Math.sin(phi) * radius * scale;
    return [-up * lean + out, across, up * rise];
  };
  const face = (scale: number, out: number): Point3[] =>
    Array.from({ length: segments }, (_unused, index) =>
      rim((index / segments) * Math.PI * 2, scale, out),
    );

  // Bearing housing and counterweight, below the dish and turning with it.
  harbourBox(baker, originX, originY, [-0.3, -0.08, -0.2, 0.2, -30, -12], NAVY_BASE.deckDark);
  harbourBox(baker, originX, originY, [-0.17, 0.17, -0.22, 0.22, -14, -2], NAVY_BASE.oliveDark);
  for (const v of [-0.19, 0.19]) {
    navyScreenLine(baker, originX, originY, [0.02, v, -4], [-0.09, v, 12], 3, NAVY_BASE.steelDark, 1);
  }

  // Dish: dark back shell, then the face, then the rim and ribs.
  fillFace(baker, NAVY_BASE.black, 1, face(1.02, -0.07), originX, originY);
  fillFace(baker, NAVY_BASE.deckDark, 1, face(1, -0.03), originX, originY);
  fillFace(baker, NAVY_BASE.concreteDark, 1, face(0.94, 0.02), originX, originY);
  fillFace(baker, NAVY_BASE.concrete, 1, face(0.78, 0.05), originX, originY);
  strokeFace(baker, NAVY_BASE.steel, 0.9, 2, face(1, -0.02), originX, originY);
  strokeFace(baker, NAVY_BASE.steelDark, 0.6, 1, face(0.6, 0.06), originX, originY);
  for (let index = 0; index < 8; index += 1) {
    const phi = (index / 8) * Math.PI * 2;
    navyScreenLine(baker, originX, originY, rim(phi, 0.96, 0.03), rim(phi, 0.08, 0.07), 1, NAVY_BASE.steelDark, 0.55);
  }

  // Feed horn on a tripod, out in front of the face.
  const feed: Point3 = [0.42, 0, 12];
  for (const phi of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]) {
    navyScreenLine(baker, originX, originY, rim(phi, 0.8, 0.04), feed, 1, NAVY_BASE.steel, 0.85);
  }
  const horn = baker.at(feed, originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillCircle(horn.x, horn.y, 5);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillCircle(horn.x - 1, horn.y - 1, 3);

  // Rim beacon, so the sweep is legible even when the dish is edge-on.
  const marker = baker.at(rim(Math.PI / 2, 1.02, 0), originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(marker.x, marker.y, 3);
  baker.graphics.fillStyle(NAVY_BASE.white, 0.9);
  baker.graphics.fillCircle(marker.x - 1, marker.y - 1, 1);

  baker.finish(key, width, height);
}


/**
 * One panel of the perimeter fence. It runs along grid v so a row of panels at
 * a constant u forms a continuous line — the old panel lay crosswise to the
 * run it was supposed to make.
 */
export function bakeNavyFence(baker: Baker): void {
  const width = 84;
  const height = 96;
  const originX = width / 2;
  const originY = height - NAVY_FENCE_ANCHOR_Y;
  const half = 0.46;
  const top = 30;

  navyShadow(baker, originX, originY, 0.12, half);
  for (const v of [-half, half]) {
    harbourPost(baker, originX, originY, 0, v, 0, top, 3, NAVY_BASE.steelDark);
    // Barbed-wire arm, canted outward over the countryside.
    navyScreenLine(baker, originX, originY, [0, v, top], [-0.13, v, top + 8], 2, NAVY_BASE.steelDark, 1);
  }
  // Mesh: a light diagonal weave between rails reads as wire at fit zoom.
  for (let v = -half; v < half; v += 0.115) {
    navyScreenLine(baker, originX, originY, [0, v, 3], [0, v + 0.115, top - 3], 1, NAVY_BASE.steel, 0.26);
    navyScreenLine(baker, originX, originY, [0, v, top - 3], [0, v + 0.115, 3], 1, NAVY_BASE.steel, 0.2);
  }
  for (const z of [4, top - 2]) {
    navyScreenLine(baker, originX, originY, [0, -half, z], [0, half, z], 1, NAVY_BASE.steel, 0.85);
  }
  for (const z of [top + 3, top + 7]) {
    navyScreenLine(baker, originX, originY, [-0.05, -half, z - 3], [-0.13, half, z + 1], 1, NAVY_BASE.steelDark, 0.75);
  }
  baker.finish(NAVY_FENCE_KEY, width, height);
}


/** Perimeter floodlight: a lattice column under a three-lamp crossbar. */
export function bakeNavyFloodlight(baker: Baker): void {
  const width = 88;
  const height = 104;
  const originX = width / 2;
  const originY = height - NAVY_FLOODLIGHT_ANCHOR_Y;
  const column = 62;

  navyShadow(baker, originX, originY, 0.18, 0.18);
  harbourBox(baker, originX, originY, [-0.16, 0.16, -0.16, 0.16, 0, 6], NAVY_BASE.concreteDark);
  for (const [u, v] of [[-0.09, -0.09], [0.09, 0.09]] as const) {
    harbourPost(baker, originX, originY, u, v, 5, column, 3, NAVY_BASE.steelDark);
  }
  for (let z = 12; z < column - 6; z += 11) {
    navyScreenLine(baker, originX, originY, [-0.09, -0.09, z], [0.09, 0.09, z + 11], 1, NAVY_BASE.steel, 0.7);
    navyScreenLine(baker, originX, originY, [0.09, 0.09, z], [-0.09, -0.09, z + 11], 1, NAVY_BASE.steelDark, 0.75);
  }

  // Head: a crossbar of three lamps, canted down over the apron.
  navyScreenLine(baker, originX, originY, [0, 0, column], [0.1, 0.1, column + 5], 3, NAVY_BASE.steelDark, 1);
  const bar = baker.at([0.1, 0.1, column + 5], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillRect(bar.x - 16, bar.y - 2, 32, 3);
  for (const offset of [-11, 0, 11]) {
    baker.graphics.fillStyle(NAVY_BASE.black, 1);
    baker.graphics.fillRect(bar.x + offset - 4, bar.y, 9, 7);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillRect(bar.x + offset - 3, bar.y + 2, 7, 5);
    baker.graphics.fillStyle(NAVY_BASE.white, 0.85);
    baker.graphics.fillRect(bar.x + offset - 2, bar.y + 3, 3, 2);
  }
  baker.finish(NAVY_FLOODLIGHT_KEY, width, height);
}


/** Ensign staff: a plinth, a stayed pole and a three-panel flag. */
export function bakeNavyFlag(baker: Baker): void {
  const width = 96;
  const height = 104;
  const originX = width / 2;
  const originY = height - NAVY_FLAG_ANCHOR_Y;
  const pole = 74;

  navyShadow(baker, originX, originY, 0.22, 0.22);
  harbourBox(baker, originX, originY, [-0.18, 0.18, -0.18, 0.18, 0, 6], NAVY_BASE.concreteLight);
  strokeFace(baker, NAVY_BASE.warning, 0.7, 1, diamond(0.16, 7), originX, originY);
  harbourPost(baker, originX, originY, 0, 0, 5, pole, 3, NAVY_BASE.steel);
  const truck = baker.at([0, 0, pole], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillCircle(truck.x, truck.y - 1, 3);

  // The ensign, in three panels so it reads as flying rather than as a decal.
  const head = baker.at([0, 0, pole - 4], originX, originY);
  const panels = [
    { x0: 0, x1: 11, y0: 0, y1: 15, drop: 0 },
    { x0: 11, x1: 22, y0: 1, y1: 17, drop: 2 },
    { x0: 22, x1: 32, y0: 4, y1: 17, drop: 5 },
  ];
  panels.forEach((panel, index) => {
    baker.graphics.fillStyle(index === 1 ? shade(NAVY_BASE.red, -12) : NAVY_BASE.red, 1);
    baker.graphics.fillPoints(
      [
        new Phaser.Math.Vector2(head.x + panel.x0, head.y + panel.y0),
        new Phaser.Math.Vector2(head.x + panel.x1, head.y + panel.y0 + panel.drop),
        new Phaser.Math.Vector2(head.x + panel.x1, head.y + panel.y1 + panel.drop),
        new Phaser.Math.Vector2(head.x + panel.x0, head.y + panel.y1),
      ],
      true,
    );
  });
  baker.graphics.fillStyle(NAVY_BASE.white, 1);
  baker.graphics.fillRect(head.x + 3, head.y + 4, 9, 3);
  baker.graphics.fillRect(head.x + 6, head.y + 4, 3, 9);
  // Halyard down the pole.
  baker.graphics.lineStyle(1, NAVY_BASE.rope, 0.7);
  baker.graphics.lineBetween(head.x - 1, head.y, head.x - 1, head.y + 34);
  baker.finish(NAVY_FLAG_KEY, width, height);
}


/** Stores pallet: two crates, a fuel drum and a lashed tarpaulin. */
export function bakeNavyCrate(baker: Baker): void {
  const width = 92;
  const height = 84;
  const originX = width / 2;
  const originY = height - NAVY_CRATE_ANCHOR_Y;

  navyShadow(baker, originX, originY, 0.4, 0.34);
  // Pallet.
  harbourBox(baker, originX, originY, [-0.38, 0.38, -0.3, 0.3, 0, 4], NAVY_BASE.warningDark);
  // Two stacked ammunition crates.
  harbourBox(baker, originX, originY, [-0.36, 0.06, -0.26, 0.26, 4, 18], NAVY_BASE.oliveDark);
  harbourBox(baker, originX, originY, [-0.3, 0.0, -0.22, 0.22, 18, 29], NAVY_BASE.olive);
  navyScreenLine(baker, originX, originY, [-0.34, 0.27, 11], [0.04, 0.27, 11], 1, NAVY_BASE.warning, 0.8);
  navyScreenLine(baker, originX, originY, [-0.28, 0.23, 24], [-0.02, 0.23, 24], 1, NAVY_BASE.warning, 0.7);
  // A drum beside the stack, and a tarp thrown over the near corner.
  navyCylinder(baker, originX, originY, 0.14, 4, 22, NAVY_BASE.red, 12);
  strokeFace(baker, NAVY_BASE.black, 0.4, 1, navyRing(0.145, 13), originX, originY);
  fillFace(
    baker,
    NAVY_BASE.deckDark,
    1,
    [[0.1, -0.3, 4], [0.4, -0.24, 4], [0.4, 0.1, 4], [0.16, 0.12, 14], [0.06, -0.16, 14]],
    originX,
    originY,
  );
  baker.finish(NAVY_CRATE_KEY, width, height);
}


export function bakeNavyBollard(baker: Baker): void {
  const width = 52;
  const height = 58;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.24);
  baker.graphics.fillEllipse(base.x + 2, base.y + 1, 18, 7);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillEllipse(base.x, base.y - 1, 17, 7);
  baker.graphics.fillRect(base.x - 5, base.y - 16, 10, 15);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillRect(base.x - 5, base.y - 16, 3, 15);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillEllipse(base.x, base.y - 18, 14, 6);
  baker.graphics.lineStyle(2, NAVY_BASE.rope, 0.9);
  baker.graphics.strokeEllipse(base.x, base.y - 13, 14, 6);
  baker.graphics.lineBetween(base.x + 6, base.y - 10, base.x + 15, base.y - 3);
  baker.finish(NAVY_BOLLARD_KEY, width, height);
}


/**
 * The apron. Baked as one texture — like the cargo wharf — because a slab drawn
 * per tile would show a seam down every expansion joint. The markings are laid
 * out from the same named rows the layout module places props on, so the paint
 * and the props can never drift apart.
 */
export function bakeNavyQuay(baker: Baker): void {
  const halfU = NAVY_QUAY_HALF_U;
  const halfV = NAVY_QUAY_HALF_V;
  const deck = NAVY_QUAY_DECK;
  const spanX = (halfU + halfV) * HALF_W;
  const spanY = (halfU + halfV) * HALF_H;
  const width = Math.ceil(spanX * 2) + 22;
  const height = Math.ceil(spanY * 2) + deck + 30;
  const originX = width / 2;
  const originY = height - NAVY_QUAY_ANCHOR_Y;
  const slab: Point3[] = [[-halfU, -halfV, deck], [halfU, -halfV, deck], [halfU, halfV, deck], [-halfU, halfV, deck]];

  navyShadow(baker, originX, originY, halfU, halfV);
  fillFace(baker, NAVY_BASE.concreteDark, 1, [[-halfU, halfV, deck], [halfU, halfV, deck], [halfU, halfV, 0], [-halfU, halfV, 0]], originX, originY);
  fillFace(baker, shade(NAVY_BASE.concreteDark, -28), 1, [[halfU, halfV, deck], [halfU, -halfV, deck], [halfU, -halfV, 0], [halfU, halfV, 0]], originX, originY);
  fillFace(baker, NAVY_BASE.deck, 1, slab, originX, originY);

  // Expansion joints across the whole slab, so it reads as poured bays.
  for (let v = -halfV + 0.6; v < halfV; v += 1.24) {
    navyDeckLine(baker, originX, originY, [-halfU + 0.06, v], [halfU - 0.06, v], 1, NAVY_BASE.deckLight, 0.26);
  }
  navyDeckLine(baker, originX, originY, [0.0, -halfV + 0.1], [0.0, halfV - 0.1], 1, NAVY_BASE.deckLight, 0.22);

  // Service road: an asphalt band down the middle with a dashed centre line.
  fillFace(
    baker,
    NAVY_BASE.tarmac,
    0.9,
    [[-0.18, -halfV + 0.3, deck + 0.4], [0.9, -halfV + 0.3, deck + 0.4], [0.9, halfV - 0.3, deck + 0.4], [-0.18, halfV - 0.3, deck + 0.4]],
    originX,
    originY,
  );
  for (let v = -halfV + 0.5; v < halfV - 0.5; v += 0.62) {
    navyDeckLine(baker, originX, originY, [0.36, v], [0.36, v + 0.3], 2, NAVY_BASE.warning, 0.55);
  }

  // Hardstanding under the inland building row. The vehicles park straight on
  // it -- painted bay markings read as noise under the tracks at fit zoom.
  fillFace(
    baker,
    shade(NAVY_BASE.deck, 8),
    1,
    [[-halfU + 0.18, -halfV + 0.4, deck + 0.3], [-0.3, -halfV + 0.4, deck + 0.3], [-0.3, halfV - 0.4, deck + 0.3], [-halfU + 0.18, halfV - 0.4, deck + 0.3]],
    originX,
    originY,
  );

  // Keep-clear box on the berth, the one part of the apron nothing stands on.
  for (const [from, to] of [
    [[0.86, -0.95], [1.66, -0.95]],
    [[0.86, 0.95], [1.66, 0.95]],
    [[0.86, -0.95], [0.86, 0.95]],
  ] as const) {
    navyDeckLine(baker, originX, originY, from, to, 2, NAVY_BASE.warning, 0.8);
  }
  navyDeckLine(baker, originX, originY, [0.9, -0.9], [1.62, 0.9], 1, NAVY_BASE.warning, 0.45);
  navyDeckLine(baker, originX, originY, [0.9, 0.9], [1.62, -0.9], 1, NAVY_BASE.warning, 0.45);

  // Hazard chevrons and the continuous edge line along the seaward lip.
  navyDeckLine(baker, originX, originY, [halfU - 0.1, -halfV + 0.1], [halfU - 0.1, halfV - 0.1], 3, NAVY_BASE.warning, 0.9);
  for (let v = -halfV + 0.35; v < halfV - 0.3; v += 0.5) {
    navyDeckLine(baker, originX, originY, [halfU - 0.24, v], [halfU - 0.02, v + 0.24], 2, NAVY_BASE.warning, 0.4);
  }
  // Kerb along the inland lip, where the fence stands.
  navyDeckLine(baker, originX, originY, [-halfU + 0.08, -halfV + 0.1], [-halfU + 0.08, halfV - 0.1], 2, NAVY_BASE.concreteLight, 0.4);
  strokeFace(baker, NAVY_BASE.concreteLight, 0.34, 1, slab, originX, originY);

  // Bolted sea wall and a broken foam line make the apron feel raised above water.
  for (const z of [5, 10]) {
    navyScreenLine(baker, originX, originY, [-halfU, halfV, z], [halfU, halfV, z], 1, NAVY_BASE.steelDark, 0.55);
    navyScreenLine(baker, originX, originY, [halfU, halfV, z], [halfU, -halfV, z], 1, NAVY_BASE.steelDark, 0.55);
  }
  baker.graphics.fillStyle(NAVY_BASE.white, 0.38);
  for (let u = -halfU + 0.25; u < halfU; u += 0.38) {
    const point = baker.at([u, halfV, 0], originX, originY);
    baker.graphics.fillEllipse(point.x, point.y + 1, 11, 3);
  }
  baker.finish(NAVY_QUAY_KEY, width, height);
}


/** The gate board: the base's front door, and the one prop that names it. */
export function bakeNavySign(baker: Baker): void {
  const width = 152;
  const height = 124;
  const originX = width / 2;
  const originY = height - NAVY_SIGN_ANCHOR_Y;
  const board = 58;

  navyShadow(baker, originX, originY, 0.32, 0.24);
  harbourBox(baker, originX, originY, [-0.3, 0.3, -0.14, 0.14, 0, 7], NAVY_BASE.concreteDark);
  const base = baker.at([0, 0, 6], originX, originY);
  for (const offset of [-40, 40]) {
    baker.graphics.fillStyle(NAVY_BASE.black, 1);
    baker.graphics.fillRect(base.x + offset - 3, base.y - board - 12, 6, board + 12);
    baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
    baker.graphics.fillRect(base.x + offset - 3, base.y - board - 12, 2, board + 12);
  }
  const panel = baker.at([0, 0, board], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.deckDark, 1);
  baker.graphics.fillRect(panel.x - 54, panel.y - 20, 108, 40);
  baker.graphics.fillStyle(NAVY_BASE.deck, 1);
  baker.graphics.fillRect(panel.x - 51, panel.y - 17, 102, 34);
  baker.graphics.lineStyle(2, NAVY_BASE.warning, 1);
  baker.graphics.strokeRect(panel.x - 54, panel.y - 20, 108, 40);
  // Crest block on the left, then the name.
  baker.graphics.fillStyle(NAVY_BASE.redDark, 1);
  baker.graphics.fillRect(panel.x - 48, panel.y - 14, 22, 28);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillTriangle(panel.x - 37, panel.y - 11, panel.x - 45, panel.y + 2, panel.x - 29, panel.y + 2);
  baker.graphics.fillStyle(NAVY_BASE.white, 1);
  baker.graphics.fillRect(panel.x - 39, panel.y + 4, 5, 7);
  drawHarbourLabel(baker, "NAVY", panel.x + 12, panel.y - 12, NAVY_BASE.white, 2);
  drawHarbourLabel(baker, "PORT", panel.x + 12, panel.y + 3, NAVY_BASE.warning, 1);
  const beacon = baker.at([0, 0, board + 26], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillRect(beacon.x - 4, beacon.y, 8, 4);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(beacon.x, beacon.y - 1, 3);
  baker.finish(NAVY_SIGN_KEY, width, height);
}
