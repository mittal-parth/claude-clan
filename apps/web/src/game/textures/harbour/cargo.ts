import { Baker, fillFace, shade } from "../core";
import { harbourBox, HARBOUR } from "../harbour/base";
import { TERRAIN_COLORS } from "../../math/palette";
import { band } from "../terrain";

/** A single container, as carried by the crane and shipped in the vessel's bay. */
export const HARBOUR_CONTAINER_KEYS = [
  "fx:harbour-container:0",
  "fx:harbour-container:1",
  "fx:harbour-container:2",
  "fx:harbour-container:3",
  "fx:harbour-container:4",
  "fx:harbour-container:5",
] as const;

export const HARBOUR_CONTAINER_ANCHOR_Y = 22;

/**
 * The box that travels. Fixed rather than picked per city, so the one the
 * crane lifts is visibly the same one it sets down at the other end.
 */
export const HARBOUR_CARGO_CONTAINER_KEY = HARBOUR_CONTAINER_KEYS[0]!;

/**
 * Container stacks. Same three-box arrangement every time, repainted per
 * variant, so a yard of them reads as one operation rather than a jumble.
 */
export const HARBOUR_CONTAINERS_KEYS = [
  "fx:harbour-containers:0",
  "fx:harbour-containers:1",
  "fx:harbour-containers:2",
  "fx:harbour-containers:3",
  "fx:harbour-containers:4",
  "fx:harbour-containers:5",
] as const;

export const HARBOUR_CONTAINERS_ANCHOR_Y = 30;

/**
 * One cargo pile per berth. Same authored arrangement of crates, barrels and
 * rope every time -- only the paint changes -- so a row of them reads as one
 * working quay rather than four unrelated props.
 */
export const HARBOUR_CARGO_KEYS = [
  "fx:harbour-cargo:0",
  "fx:harbour-cargo:1",
  "fx:harbour-cargo:2",
  "fx:harbour-cargo:3",
] as const;

export const HARBOUR_CARGO_ANCHOR_Y = 28;


/** One container, for the crane to carry and the ship to hold. */
export function bakeHarbourContainer(baker: Baker, key: string, variantIndex: number): void {
  const width = 96;
  const height = 64;
  const originX = width / 2;
  const originY = height - HARBOUR_CONTAINER_ANCHOR_Y;
  const [color] =
    HARBOUR_CONTAINER_VARIANTS[variantIndex % HARBOUR_CONTAINER_VARIANTS.length]!;
  const halfU = 0.32;
  const halfV = 0.2;
  const top = 20;

  harbourBox(baker, originX, originY, [-halfU, halfU, -halfV, halfV, 0, top], color);
  // Corrugated flank.
  baker.graphics.lineStyle(1, 0x000000, 0.17);
  for (let u = -halfU + 0.05; u < halfU; u += 0.06) {
    const a = baker.at([u, halfV, top - 2], originX, originY);
    const b = baker.at([u, halfV, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  // Door end, with its locking bars.
  baker.graphics.lineStyle(1, 0x000000, 0.3);
  for (const v of [-halfV + 0.05, 0, halfV - 0.05]) {
    const a = baker.at([halfU, v, top - 2], originX, originY);
    const b = baker.at([halfU, v, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  // Corner castings.
  baker.graphics.fillStyle(HARBOUR.iron, 0.9);
  for (const [u, v] of [[-halfU, halfV], [halfU, halfV], [halfU, -halfV]] as const) {
    for (const z of [top, 0]) {
      const corner = baker.at([u, v, z], originX, originY);
      baker.graphics.fillRect(corner.x - 2, corner.y - 2, 4, 3);
    }
  }
  baker.finish(key, width, height);
}


/**
 * Livery for each container stack, as [lower-left, lower-right, upper] — the
 * shipping-line colours you would actually see in a yard.
 */
export const HARBOUR_CONTAINER_VARIANTS: ReadonlyArray<readonly [number, number, number]> = [
  [0xc75434, 0x2fa39a, 0x13303e],
  [0x13303e, 0xf6bd60, 0xc75434],
  [0x2fa39a, 0x8e99a4, 0xe4574e],
  [0xf6bd60, 0x2f5d70, 0x4f7a5a],
  [0xe4574e, 0xb9782f, 0x8e99a4],
  [0x4f7a5a, 0x13303e, 0xd7dee2],
];


/** A stack of shipping containers waiting on the wharf. */
export function bakeHarbourContainers(baker: Baker, key: string, variantIndex: number): void {
  const width = 120;
  const height = 100;
  const originX = width / 2;
  const originY = height - HARBOUR_CONTAINERS_ANCHOR_Y;
  const [lowerLeft, lowerRight, upper] =
    HARBOUR_CONTAINER_VARIANTS[variantIndex % HARBOUR_CONTAINER_VARIANTS.length]!;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    [[-0.36, -0.3, 0], [0.6, -0.3, 0], [0.6, 0.58, 0], [-0.36, 0.58, 0]],
    originX,
    originY,
  );

  const corrugate = (u0: number, u1: number, v: number, z0: number, z1: number): void => {
    baker.graphics.lineStyle(1, 0x000000, 0.16);
    for (let u = u0 + 0.06; u < u1; u += 0.07) {
      const a = baker.at([u, v, z1 - 2], originX, originY);
      const b = baker.at([u, v, z0 + 2], originX, originY);
      baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
  };
  const doorEnd = (u: number, v0: number, v1: number, z0: number, z1: number): void => {
    baker.graphics.lineStyle(1, 0x000000, 0.28);
    const mid = (v0 + v1) / 2;
    for (const v of [v0 + 0.04, mid, v1 - 0.04]) {
      const a = baker.at([u, v, z1 - 2], originX, originY);
      const b = baker.at([u, v, z0 + 2], originX, originY);
      baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
  };

  // Bottom row: two boxes side by side.
  harbourBox(baker, originX, originY, [-0.42, 0.04, -0.34, 0.34, 0, 21], lowerLeft);
  corrugate(-0.42, 0.04, 0.34, 0, 21);
  doorEnd(0.04, -0.34, 0.34, 0, 21);
  harbourBox(baker, originX, originY, [0.08, 0.5, -0.28, 0.42, 0, 21], lowerRight);
  corrugate(0.08, 0.5, 0.42, 0, 21);
  doorEnd(0.5, -0.28, 0.42, 0, 21);

  // Top box, set back a touch so the stack reads as stacked, not as one slab.
  harbourBox(baker, originX, originY, [-0.38, 0.02, -0.3, 0.3, 21, 42], upper);
  corrugate(-0.38, 0.02, 0.3, 21, 42);
  doorEnd(0.02, -0.3, 0.3, 21, 42);

  // Corner castings pick out the frames.
  baker.graphics.fillStyle(HARBOUR.iron, 0.9);
  for (const [u, v, z] of [
    [-0.38, 0.3, 42], [0.02, 0.3, 42], [-0.38, 0.3, 21], [0.02, 0.3, 21],
    [0.5, 0.42, 21], [0.08, 0.42, 21],
  ] as const) {
    const corner = baker.at([u, v, z], originX, originY);
    baker.graphics.fillRect(corner.x - 2, corner.y - 1, 4, 3);
  }

  baker.finish(key, width, height);
}


/** Paint schemes for the cargo piles, one per berth. */
export const HARBOUR_CARGO_VARIANTS: ReadonlyArray<{
  tallCrate: number;
  flatCrate: number;
  barrel: number;
  band: number;
}> = [
  // Bare timber and rusted iron drums.
  { tallCrate: 0xb5834f, flatCrate: 0xd3a26c, barrel: 0xc75434, band: 0xb9782f },
  // Whitewashed crates, sea-green drums.
  { tallCrate: 0xcbbb95, flatCrate: 0xe6dcbd, barrel: 0x2fa39a, band: 0xdde5e9 },
  // Painted navy crates, amber drums.
  { tallCrate: 0x2f5d70, flatCrate: 0x437f95, barrel: 0xf6bd60, band: 0x13303e },
  // Chandler's green, oxblood drums.
  { tallCrate: 0x4f7a5a, flatCrate: 0x74a07c, barrel: 0x8e3b3b, band: 0xe3d1a6 },
];


/** Loose quayside cargo: crates, a barrel pair and a coil of rope. */
export function bakeHarbourCargo(baker: Baker, key: string, variantIndex: number): void {
  const width = 112;
  const height = 84;
  const originX = width / 2;
  const originY = height - HARBOUR_CARGO_ANCHOR_Y;
  const variant =
    HARBOUR_CARGO_VARIANTS[variantIndex % HARBOUR_CARGO_VARIANTS.length]!;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.22,
    [[-0.42, -0.3, 0], [0.5, -0.3, 0], [0.5, 0.5, 0], [-0.42, 0.5, 0]],
    originX,
    originY,
  );

  // Crates, the taller one behind.
  harbourBox(baker, originX, originY, [-0.4, -0.06, -0.26, 0.1, 0, 20], variant.tallCrate);
  harbourBox(baker, originX, originY, [-0.32, -0.02, 0.12, 0.44, 0, 14], variant.flatCrate);
  baker.graphics.lineStyle(1.5, shade(variant.tallCrate, -34), 0.9);
  for (const [bounds, top] of [
    [[-0.4, -0.06, 0.1, 20], 20] as const,
    [[-0.32, -0.02, 0.44, 14], 14] as const,
  ]) {
    const [u0, u1, v, z] = bounds;
    const a = baker.at([u0, v, z - 3], originX, originY);
    const b = baker.at([u1, v, z - 3], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
    const c = baker.at([u0, v, 4], originX, originY);
    const d = baker.at([u1, v, 4], originX, originY);
    baker.graphics.lineBetween(c.x, c.y, d.x, d.y);
    const e = baker.at([(u0 + u1) / 2, v, top], originX, originY);
    const f = baker.at([(u0 + u1) / 2, v, 0], originX, originY);
    baker.graphics.lineBetween(e.x, e.y, f.x, f.y);
  }

  // Barrels.
  for (const [u, v] of [[0.16, -0.06], [0.34, 0.24]] as const) {
    const top = baker.at([u, v, 17], originX, originY);
    const bottom = baker.at([u, v, 0], originX, originY);
    baker.graphics.fillStyle(variant.barrel, 1);
    baker.graphics.fillRect(top.x - 7, top.y, 14, bottom.y - top.y);
    baker.graphics.fillStyle(shade(variant.barrel, -22), 1);
    baker.graphics.fillRect(top.x + 3, top.y, 4, bottom.y - top.y);
    baker.graphics.fillStyle(variant.band, 1);
    baker.graphics.fillRect(top.x - 7, top.y + 5, 14, 2);
    baker.graphics.fillRect(top.x - 7, top.y + 11, 14, 2);
    baker.graphics.fillStyle(shade(variant.barrel, 22), 1);
    baker.graphics.fillEllipse(top.x, top.y, 14, 6);
  }

  // Coil of rope.
  const coil = baker.at([-0.22, 0.42, 0], originX, originY);
  baker.graphics.lineStyle(2, HARBOUR.rope, 1);
  baker.graphics.strokeEllipse(coil.x, coil.y - 2, 17, 8);
  baker.graphics.strokeEllipse(coil.x, coil.y - 4, 11, 5);

  baker.finish(key, width, height);
}
