import { HARBOUR_QUAY_HALF_U, HARBOUR_QUAY_HALF_V } from "../../layouts/harbour";
import { TILE_HEIGHT, Baker, fillFace, shade, HALF_W, HALF_H, Point3, strokeFace, diamond, TILE_ANCHOR_Y } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import Phaser from "phaser";

// ---------------------------------------------------------------------------
// Harbour
// ---------------------------------------------------------------------------

/**
 * Harbour palette. Deliberately warmer and saltier than the airport's cool
 * concrete/glass kit -- weathered stone, tarred timber and painted iron -- but
 * it shares the same amber accent so the two landmarks read as one city.
 */
export const HARBOUR = {
  stone: 0xa79d8a,
  stoneLight: 0xcac0aa,
  stoneDark: 0x746c5d,
  stoneEdge: 0x4c473c,
  wet: 0x3d5560,
  moss: 0x4c7358,
  deck: 0xb5834f,
  deckLight: 0xd3a26c,
  deckDark: 0x7d5730,
  pile: 0x5a3f26,
  pileDark: 0x33241a,
  foam: 0xe4f5f8,
  steel: 0xdde5e9,
  steelDark: 0x7f8f97,
  navy: 0x13303e,
  rust: 0xc75434,
  teal: 0x2fa39a,
  amber: 0xf6bd60,
  amberDark: 0xb9782f,
  white: 0xf7f5ee,
  red: 0xe4574e,
  glass: 0x9fe3ee,
  glassDark: 0x2c6f86,
  rope: 0xe3d1a6,
  iron: 0x2b3339,
} as const;


/** Letters the harbour needs; the airport's glyph set spells only "CCX". */
export const HARBOUR_GLYPHS: Record<string, readonly string[]> = {
  P: ["111", "101", "111", "100", "100"],
  O: ["111", "101", "101", "101", "111"],
  R: ["111", "101", "111", "110", "101"],
  T: ["111", "010", "010", "010", "010"],
  N: ["101", "111", "111", "111", "101"],
  A: ["010", "101", "111", "101", "101"],
  V: ["101", "101", "101", "101", "010"],
  Y: ["101", "101", "010", "010", "010"],
};


/**
 * Cohesive landmark kit for the east-coast harbour, the seaward counterpart to
 * the southwest airport. Pieces that stand ON the wharf are lifted by
 * HARBOUR_QUAY_DECK so they read as sitting on the stone, not floating beside
 * it; each ANCHOR_Y is the pixel gap the texture reserves below its tile
 * centre, exactly like AIRPORT_TERMINAL_ANCHOR_Y.
 */
export const HARBOUR_QUAY_KEY = "fx:harbour-quay";

/** Height of the wharf deck above the waterline, in pixels. */
export const HARBOUR_QUAY_DECK = 14;

/**
 * Derived from the slab's own extents so the wharf can be resized in
 * harbour.ts alone: the gap the texture reserves below its centre tile is
 * whatever the near half of the diamond needs, plus a little margin.
 */
export const HARBOUR_QUAY_ANCHOR_Y =
  (HARBOUR_QUAY_HALF_U + HARBOUR_QUAY_HALF_V) * (TILE_HEIGHT / 2) + 12;

export const HARBOUR_PIER_KEY = "fx:harbour-pier";

export const HARBOUR_PIER_ANCHOR_Y = 40;

/** Pier planking sits slightly lower than the stone wharf it joins. */
export const HARBOUR_PIER_DECK = 11;

export const HARBOUR_WAREHOUSE_KEY = "fx:harbour-warehouse";

export const HARBOUR_WAREHOUSE_ANCHOR_Y = 40;

export const HARBOUR_BOLLARD_KEY = "fx:harbour-bollard";

/** The harbour's name board, standing at the seaward corner of the wharf. */
export const HARBOUR_SIGN_KEY = "fx:harbour-sign";

export const HARBOUR_SIGN_ANCHOR_Y = 26;

export const HARBOUR_LIGHTHOUSE_KEY = "fx:harbour-lighthouse";

export const HARBOUR_LIGHTHOUSE_ANCHOR_Y = 30;

/** Pixels above the lighthouse's tile point where the lantern glow belongs. */
export const HARBOUR_LIGHTHOUSE_LAMP_Y = 130;

export const HARBOUR_LAMP_KEY = "fx:harbour-lamp";

/** Pixels above a lamp's tile point where its glow belongs. */
export const HARBOUR_LAMP_GLOW_Y = 41;

export const HARBOUR_MARKER_KEY = "fx:harbour-marker";

/** Pixels above the channel marker's tile point where its light belongs. */
export const HARBOUR_MARKER_LAMP_Y = 38;


export function drawHarbourLabel(
  baker: Baker,
  value: string,
  x: number,
  y: number,
  color: number,
  scale = 2,
): void {
  const letters = [...value];
  const width = letters.length * 4 * scale - scale;
  baker.graphics.fillStyle(color, 1);
  letters.forEach((letter, letterIndex) => {
    const rows = HARBOUR_GLYPHS[letter] ?? HARBOUR_GLYPHS.O!;
    rows.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === "1") {
          baker.graphics.fillRect(
            Math.round(x - width / 2 + letterIndex * 4 * scale + columnIndex * scale),
            Math.round(y + rowIndex * scale),
            scale,
            scale,
          );
        }
      });
    });
  });
}


/**
 * An axis-aligned crate/container/hull box in grid space. Same lighting
 * convention as drawBox -- the grid +v face is lit, +u is in shade -- but it
 * takes explicit bounds instead of a symmetric half-footprint, so a stack can
 * be assembled from boxes of different sizes.
 */
export function harbourBox(
  baker: Baker,
  originX: number,
  originY: number,
  bounds: readonly [number, number, number, number, number, number],
  color: number,
): void {
  const [u0, u1, v0, v1, z0, z1] = bounds;
  fillFace(
    baker,
    color,
    1,
    [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(color, -24),
    1,
    [[u1, v1, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(color, 14),
    1,
    [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]],
    originX,
    originY,
  );
}


/** A vertical post between two heights, drawn in screen space so it stays crisp. */
export function harbourPost(
  baker: Baker,
  originX: number,
  originY: number,
  u: number,
  v: number,
  z0: number,
  z1: number,
  thickness: number,
  color: number,
): void {
  const top = baker.at([u, v, z1], originX, originY);
  const bottom = baker.at([u, v, z0], originX, originY);
  baker.graphics.fillStyle(color, 1);
  baker.graphics.fillRect(top.x - thickness / 2, top.y, thickness, bottom.y - top.y);
  // A lit sliver down the sun-facing edge stops posts reading as flat bars.
  baker.graphics.fillStyle(shade(color, 20), 1);
  baker.graphics.fillRect(top.x - thickness / 2, top.y, 1, bottom.y - top.y);
}


/**
 * The stone wharf: a raised slab whose seaward walls stand in the water. Baked
 * as one texture -- like the airport apron -- because a quay drawn per tile
 * would show a seam down every course of masonry.
 */
export function bakeHarbourQuay(baker: Baker): void {
  const halfU = HARBOUR_QUAY_HALF_U;
  const halfV = HARBOUR_QUAY_HALF_V;
  const deck = HARBOUR_QUAY_DECK;
  // Sized from the slab rather than hardcoded, so the wharf can be lengthened
  // in harbour.ts without the texture clipping its own masonry.
  const spanX = (halfU + halfV) * HALF_W;
  const spanY = (halfU + halfV) * HALF_H;
  const width = Math.ceil(spanX * 2) + 16;
  const height = Math.ceil(spanY * 2) + deck + 24;
  const originX = width / 2;
  const originY = height - HARBOUR_QUAY_ANCHOR_Y;

  // Shadow thrown onto the water and sand the wharf stands in.
  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.26,
    [
      [-halfU + 0.12, -halfV + 0.16, 0],
      [halfU + 0.12, -halfV + 0.16, 0],
      [halfU + 0.12, halfV + 0.16, 0],
      [-halfU + 0.12, halfV + 0.16, 0],
    ],
    originX,
    originY,
  );

  // Sea walls.
  fillFace(
    baker,
    HARBOUR.stone,
    1,
    [[-halfU, halfV, deck], [halfU, halfV, deck], [halfU, halfV, 0], [-halfU, halfV, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(HARBOUR.stone, -26),
    1,
    [[halfU, halfV, deck], [halfU, -halfV, deck], [halfU, -halfV, 0], [halfU, halfV, 0]],
    originX,
    originY,
  );

  // Dressed masonry: two courses of horizontal beds with staggered perpends.
  baker.graphics.lineStyle(1, HARBOUR.stoneEdge, 0.45);
  for (const z of [4.6, 9.2]) {
    const litA = baker.at([-halfU, halfV, z], originX, originY);
    const litB = baker.at([halfU, halfV, z], originX, originY);
    baker.graphics.lineBetween(litA.x, litA.y, litB.x, litB.y);
    const shadeA = baker.at([halfU, halfV, z], originX, originY);
    const shadeB = baker.at([halfU, -halfV, z], originX, originY);
    baker.graphics.lineBetween(shadeA.x, shadeA.y, shadeB.x, shadeB.y);
  }
  for (let index = 0; -halfU + 0.36 * (index + 1) < halfU; index += 1) {
    const u = -halfU + 0.36 * (index + 1);
    const stagger = index % 2 === 0 ? 0 : 4.6;
    const top = baker.at([u, halfV, 9.2 + (stagger === 0 ? 4.8 : 0)], originX, originY);
    const bottom = baker.at([u, halfV, stagger], originX, originY);
    baker.graphics.lineBetween(top.x, top.y, bottom.x, bottom.y);
  }
  for (let index = 0; halfV - 0.4 * (index + 1) > -halfV; index += 1) {
    const v = halfV - 0.4 * (index + 1);
    const top = baker.at([halfU, v, index % 2 === 0 ? deck : 9.2], originX, originY);
    const bottom = baker.at([halfU, v, index % 2 === 0 ? 4.6 : 0], originX, originY);
    baker.graphics.lineBetween(top.x, top.y, bottom.x, bottom.y);
  }

  // Tide line: wet stone below, a rim of weed, then foam where it meets water.
  fillFace(
    baker,
    HARBOUR.wet,
    0.5,
    [[-halfU, halfV, 4.2], [halfU, halfV, 4.2], [halfU, halfV, 0], [-halfU, halfV, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    HARBOUR.wet,
    0.5,
    [[halfU, halfV, 4.2], [halfU, -halfV, 4.2], [halfU, -halfV, 0], [halfU, halfV, 0]],
    originX,
    originY,
  );
  baker.graphics.lineStyle(2, HARBOUR.moss, 0.55);
  const weedA = baker.at([-halfU, halfV, 4.4], originX, originY);
  const weedB = baker.at([halfU, halfV, 4.4], originX, originY);
  const weedC = baker.at([halfU, -halfV, 4.4], originX, originY);
  baker.graphics.lineBetween(weedA.x, weedA.y, weedB.x, weedB.y);
  baker.graphics.lineBetween(weedB.x, weedB.y, weedC.x, weedC.y);

  baker.graphics.fillStyle(HARBOUR.foam, 0.5);
  for (let u = -halfU + 0.28; u < halfU; u += 0.3) {
    const point = baker.at([u, halfV, 0], originX, originY);
    baker.graphics.fillEllipse(point.x, point.y + 1, 12, 3.6);
  }
  for (let v = halfV - 0.34; v > -halfV; v -= 0.42) {
    const point = baker.at([halfU, v, 0], originX, originY);
    baker.graphics.fillEllipse(point.x, point.y + 1, 12, 3.6);
  }

  // Tyre fenders hung over both seaward walls.
  const fender = (u: number, v: number, z: number): void => {
    const point = baker.at([u, v, z], originX, originY);
    baker.graphics.fillStyle(HARBOUR.iron, 1);
    baker.graphics.fillEllipse(point.x, point.y, 11, 12);
    baker.graphics.fillStyle(shade(HARBOUR.iron, 26), 1);
    baker.graphics.fillEllipse(point.x - 1, point.y - 1, 5, 5.5);
    baker.graphics.lineStyle(1, HARBOUR.rope, 0.85);
    baker.graphics.lineBetween(point.x, point.y - 6, point.x, point.y - 11);
  };
  for (let u = -halfU + 0.55; u < halfU - 0.3; u += 0.8) fender(u, halfV, 6.5);
  for (let v = halfV - 0.55; v > -halfV + 0.3; v -= 0.9) fender(halfU, v, 6.5);

  // Deck: paved stone with joints, a worn service lane and painted edges.
  const slab: Point3[] = [
    [-halfU, -halfV, deck],
    [halfU, -halfV, deck],
    [halfU, halfV, deck],
    [-halfU, halfV, deck],
  ];
  fillFace(baker, HARBOUR.stoneLight, 1, slab, originX, originY);
  fillFace(
    baker,
    shade(HARBOUR.stoneLight, -7),
    1,
    [
      [-halfU + 0.5, -halfV + 0.34, deck + 0.1],
      [halfU - 0.28, -halfV + 0.34, deck + 0.1],
      [halfU - 0.28, halfV - 0.42, deck + 0.1],
      [-halfU + 0.5, halfV - 0.42, deck + 0.1],
    ],
    originX,
    originY,
  );

  baker.graphics.lineStyle(1, HARBOUR.stoneDark, 0.4);
  for (let u = -halfU + 0.42; u < halfU; u += 0.42) {
    const from = baker.at([u, -halfV, deck + 0.2], originX, originY);
    const to = baker.at([u, halfV, deck + 0.2], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }
  for (let v = -halfV + 0.4; v < halfV; v += 0.4) {
    const from = baker.at([-halfU, v, deck + 0.2], originX, originY);
    const to = baker.at([halfU, v, deck + 0.2], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }

  // Painted quayside edge: amber warning line inboard of both sea walls, with
  // white hatching where cargo is craned over the side.
  baker.graphics.lineStyle(3, HARBOUR.amber, 0.92);
  const edge = [
    baker.at([-halfU + 0.1, halfV - 0.16, deck + 1], originX, originY),
    baker.at([halfU - 0.14, halfV - 0.16, deck + 1], originX, originY),
    baker.at([halfU - 0.14, -halfV + 0.1, deck + 1], originX, originY),
  ];
  baker.graphics.strokePoints(edge, false);
  baker.graphics.lineStyle(2, HARBOUR.white, 0.55);
  for (let index = 0; index < 6; index += 1) {
    const v = halfV - 0.34 - index * 0.34;
    const a = baker.at([halfU - 0.5, v, deck + 1], originX, originY);
    const b = baker.at([halfU - 0.2, v - 0.2, deck + 1], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  strokeFace(baker, HARBOUR.stoneDark, 0.85, 2, slab, originX, originY);
  baker.finish(HARBOUR_QUAY_KEY, width, height);
}


/**
 * One tile of timber pier: planked deck on driven piles, with a sagging rope
 * rail whose ends meet at the tile boundary so a run of tiles reads as a
 * single continuous handrail.
 */
export function bakeHarbourPier(baker: Baker): void {
  const width = 120;
  const height = 112;
  const originX = width / 2;
  const originY = height - HARBOUR_PIER_ANCHOR_Y;
  const half = 0.5;
  const deck = HARBOUR_PIER_DECK;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    [
      [-half + 0.1, -half + 0.14, 0],
      [half + 0.1, -half + 0.14, 0],
      [half + 0.1, half + 0.14, 0],
      [-half + 0.1, half + 0.14, 0],
    ],
    originX,
    originY,
  );

  // Piles, with foam where each breaks the surface.
  for (const [u, v] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as const) {
    harbourPost(baker, originX, originY, u, v, -9, deck, 6, HARBOUR.pile);
    const waterline = baker.at([u, v, 0], originX, originY);
    baker.graphics.fillStyle(HARBOUR.pileDark, 0.85);
    baker.graphics.fillRect(waterline.x - 3, waterline.y - 5, 6, 5);
    baker.graphics.fillStyle(HARBOUR.foam, 0.42);
    baker.graphics.fillEllipse(waterline.x, waterline.y, 15, 5);
  }
  // Cross-bracing between the pile heads.
  baker.graphics.lineStyle(2, HARBOUR.pileDark, 0.9);
  const braceA = baker.at([-0.36, 0.36, deck - 4], originX, originY);
  const braceB = baker.at([0.36, 0.36, deck - 4], originX, originY);
  const braceC = baker.at([0.36, -0.36, deck - 4], originX, originY);
  baker.graphics.lineBetween(braceA.x, braceA.y, braceB.x, braceB.y);
  baker.graphics.lineBetween(braceB.x, braceB.y, braceC.x, braceC.y);

  // Planking runs seaward, so the seams lie across the tile in v.
  fillFace(baker, HARBOUR.deckDark, 1, diamond(half, deck), originX, originY);
  const planks = 6;
  for (let index = 0; index < planks; index += 1) {
    const v0 = -half + (index * (half * 2)) / planks;
    const v1 = v0 + (half * 2) / planks - 0.015;
    fillFace(
      baker,
      index % 2 === 0 ? HARBOUR.deck : HARBOUR.deckLight,
      1,
      [[-half, v0, deck + 1], [half, v0, deck + 1], [half, v1, deck + 1], [-half, v1, deck + 1]],
      originX,
      originY,
    );
  }
  // Nail heads along the bearer line.
  baker.graphics.fillStyle(HARBOUR.pileDark, 0.55);
  for (let index = 0; index < planks; index += 1) {
    const v = -half + 0.08 + (index * (half * 2)) / planks;
    for (const u of [-0.34, 0.34]) {
      const nail = baker.at([u, v, deck + 2], originX, originY);
      baker.graphics.fillRect(nail.x - 1, nail.y - 1, 2, 2);
    }
  }

  // Fascia beams along both visible edges give the deck real thickness.
  fillFace(
    baker,
    HARBOUR.deckDark,
    1,
    [[-half, half, deck + 1], [half, half, deck + 1], [half, half, deck - 4], [-half, half, deck - 4]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(HARBOUR.deckDark, -20),
    1,
    [[half, half, deck + 1], [half, -half, deck + 1], [half, -half, deck - 4], [half, half, deck - 4]],
    originX,
    originY,
  );

  // Rope rail. Endpoints sit at the tile edge at the same height, so adjoining
  // tiles' ropes join without a step; only the middle sags.
  for (const v of [-0.45, 0.45] as const) {
    harbourPost(baker, originX, originY, 0, v, deck, deck + 15, 3, HARBOUR.pile);
    const cap = baker.at([0, v, deck + 15], originX, originY);
    baker.graphics.fillStyle(HARBOUR.amber, 0.9);
    baker.graphics.fillRect(cap.x - 2.5, cap.y - 2, 5, 2);
    baker.graphics.lineStyle(2, HARBOUR.rope, 0.95);
    baker.graphics.strokePoints(
      [
        baker.at([-half, v, deck + 14], originX, originY),
        baker.at([0, v, deck + 10.5], originX, originY),
        baker.at([half, v, deck + 14], originX, originY),
      ],
      false,
    );
  }

  baker.finish(HARBOUR_PIER_KEY, width, height);
}


/**
 * Harbour master's shed: whitewashed stone under a navy pitched roof, with a
 * loading hoist over the quayside doors and a painted PORT sign.
 */
export function bakeHarbourWarehouse(baker: Baker): void {
  const width = 176;
  const height = 150;
  const originX = width / 2;
  const originY = height - HARBOUR_WAREHOUSE_ANCHOR_Y;
  const half = 0.66;
  const body = 46;
  const ridge = body + 26;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    [
      [-half + 0.1, -half + 0.12, 0],
      [half + 0.1, -half + 0.12, 0],
      [half + 0.1, half + 0.12, 0],
      [-half + 0.1, half + 0.12, 0],
    ],
    originX,
    originY,
  );

  harbourBox(baker, originX, originY, [-half, half, -half, half, 0, body], HARBOUR.stoneLight);
  // Stone plinth, so the shed sits on the wharf rather than on top of it.
  fillFace(
    baker,
    HARBOUR.stoneDark,
    1,
    [[-half, half, 7], [half, half, 7], [half, half, 0], [-half, half, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(HARBOUR.stoneDark, -18),
    1,
    [[half, half, 7], [half, -half, 7], [half, -half, 0], [half, half, 0]],
    originX,
    originY,
  );

  // Pitched roof: ridge runs along u, so the lit slope faces grid +v and the
  // gable end faces the water.
  fillFace(
    baker,
    HARBOUR.navy,
    1,
    [[-half - 0.09, 0, ridge], [half + 0.09, 0, ridge], [half + 0.09, half + 0.09, body - 2], [-half - 0.09, half + 0.09, body - 2]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(HARBOUR.navy, -22),
    1,
    [[half + 0.09, 0, ridge], [half + 0.09, half + 0.09, body - 2], [half + 0.09, -half - 0.09, body - 2]],
    originX,
    originY,
  );
  // Ridge cap and rafter lines.
  baker.graphics.lineStyle(2, shade(HARBOUR.navy, 26), 0.75);
  const ridgeA = baker.at([-half - 0.09, 0, ridge], originX, originY);
  const ridgeB = baker.at([half + 0.09, 0, ridge], originX, originY);
  baker.graphics.lineBetween(ridgeA.x, ridgeA.y, ridgeB.x, ridgeB.y);
  baker.graphics.lineStyle(1, shade(HARBOUR.navy, -34), 0.5);
  for (let u = -half; u <= half; u += 0.22) {
    const top = baker.at([u, 0, ridge], originX, originY);
    const eave = baker.at([u, half + 0.09, body - 2], originX, originY);
    baker.graphics.lineBetween(top.x, top.y, eave.x, eave.y);
  }

  // Gable: loading doors, hoist beam and pulley over the quay.
  const gableU = half + 0.01;
  fillFace(
    baker,
    HARBOUR.deckDark,
    1,
    [[gableU, 0.28, 34], [gableU, -0.28, 34], [gableU, -0.28, 7], [gableU, 0.28, 7]],
    originX,
    originY,
  );
  baker.graphics.lineStyle(1, shade(HARBOUR.deckDark, 28), 0.8);
  for (const v of [0.14, 0, -0.14]) {
    const a = baker.at([gableU, v, 34], originX, originY);
    const b = baker.at([gableU, v, 7], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  const hoistRoot = baker.at([gableU, 0, body + 8], originX, originY);
  const hoistTip = baker.at([gableU + 0.34, 0, body + 8], originX, originY);
  baker.graphics.lineStyle(4, HARBOUR.pile, 1);
  baker.graphics.lineBetween(hoistRoot.x, hoistRoot.y, hoistTip.x, hoistTip.y);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillCircle(hoistTip.x, hoistTip.y + 3, 3);
  baker.graphics.lineStyle(1, HARBOUR.rope, 0.9);
  baker.graphics.lineBetween(hoistTip.x, hoistTip.y + 5, hoistTip.x, hoistTip.y + 22);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(hoistTip.x - 3, hoistTip.y + 22, 6, 4);

  // Lit windows along the lit wall.
  for (const u of [-0.42, -0.06, 0.3]) {
    fillFace(
      baker,
      HARBOUR.amber,
      0.92,
      [[u - 0.11, half + 0.01, 34], [u + 0.11, half + 0.01, 34], [u + 0.11, half + 0.01, 20], [u - 0.11, half + 0.01, 20]],
      originX,
      originY,
    );
    strokeFace(
      baker,
      HARBOUR.navy,
      0.8,
      1,
      [[u - 0.11, half + 0.01, 34], [u + 0.11, half + 0.01, 34], [u + 0.11, half + 0.01, 20], [u - 0.11, half + 0.01, 20]],
      originX,
      originY,
    );
  }
  baker.finish(HARBOUR_WAREHOUSE_KEY, width, height);
}


/** Cast-iron mooring bollard with a rope eye dropped over it. */
export function bakeHarbourBollard(baker: Baker): void {
  const width = 48;
  const height = 56;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);

  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.24);
  baker.graphics.fillEllipse(base.x + 2, base.y + 1, 18, 7);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillEllipse(base.x, base.y - 1, 16, 6);
  baker.graphics.fillRect(base.x - 5, base.y - 15, 10, 14);
  baker.graphics.fillStyle(shade(HARBOUR.iron, 24), 1);
  baker.graphics.fillRect(base.x - 5, base.y - 15, 3, 14);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillEllipse(base.x, base.y - 17, 14, 6);
  baker.graphics.fillStyle(shade(HARBOUR.iron, 30), 1);
  baker.graphics.fillEllipse(base.x - 1, base.y - 18, 8, 3);
  // Rope eye and a tail running off toward the water.
  baker.graphics.lineStyle(2, HARBOUR.rope, 1);
  baker.graphics.strokeEllipse(base.x, base.y - 12, 15, 7);
  baker.graphics.lineBetween(base.x + 7, base.y - 10, base.x + 17, base.y - 3);

  baker.finish(HARBOUR_BOLLARD_KEY, width, height);
}


/**
 * The harbour's name board on its own posts. Lifted off the warehouse wall so
 * it can stand at the wharf's seaward corner, where it faces the water and
 * anything sailing in. The board itself is drawn flat in screen space -- the
 * same trick the airport terminal's CCX plaque uses -- so the lettering stays
 * crisp instead of being sheared by the isometric skew.
 */
export function bakeHarbourSign(baker: Baker): void {
  const width = 120;
  const height = 96;
  const originX = width / 2;
  const originY = height - HARBOUR_SIGN_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);
  const boardTop = base.y - 66;
  const boardHeight = 30;
  const boardHalf = 45;

  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.24);
  baker.graphics.fillEllipse(base.x + 3, base.y + 1, 74, 12);

  // Posts, with a cast foot at each base.
  for (const offset of [-34, 34]) {
    baker.graphics.fillStyle(HARBOUR.iron, 1);
    baker.graphics.fillRect(base.x + offset - 3, boardTop + 12, 6, base.y - boardTop - 12);
    baker.graphics.fillStyle(shade(HARBOUR.iron, 26), 1);
    baker.graphics.fillRect(base.x + offset - 3, boardTop + 12, 1.5, base.y - boardTop - 12);
    baker.graphics.fillStyle(HARBOUR.iron, 1);
    baker.graphics.fillEllipse(base.x + offset, base.y - 1, 13, 5);
  }

  // Board: navy ground, amber border and lettering, with a highlight along the
  // top edge so it does not read as a flat rectangle.
  baker.graphics.fillStyle(HARBOUR.iron, 0.5);
  baker.graphics.fillRoundedRect(
    base.x - boardHalf + 2,
    boardTop + 3,
    boardHalf * 2,
    boardHeight,
    3,
  );
  baker.graphics.fillStyle(HARBOUR.navy, 1);
  baker.graphics.fillRoundedRect(
    base.x - boardHalf,
    boardTop,
    boardHalf * 2,
    boardHeight,
    3,
  );
  baker.graphics.lineStyle(2, HARBOUR.amber, 0.9);
  baker.graphics.strokeRoundedRect(
    base.x - boardHalf + 3,
    boardTop + 3,
    boardHalf * 2 - 6,
    boardHeight - 6,
    2,
  );
  baker.graphics.fillStyle(shade(HARBOUR.navy, 30), 0.7);
  baker.graphics.fillRect(base.x - boardHalf + 4, boardTop + 1.5, boardHalf * 2 - 8, 1.5);

  drawHarbourLabel(baker, "PORT", base.x, boardTop + 8, HARBOUR.amber, 3);

  // Finials, and a lamp hood over the board.
  for (const offset of [-34, 34]) {
    baker.graphics.fillStyle(HARBOUR.amber, 1);
    baker.graphics.fillCircle(base.x + offset, boardTop + 9, 3);
  }
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(base.x - 10, boardTop - 7, 20, 4);
  baker.graphics.fillStyle(HARBOUR.amber, 0.55);
  baker.graphics.fillTriangle(
    base.x - 10,
    boardTop - 3,
    base.x + 10,
    boardTop - 3,
    base.x,
    boardTop + 6,
  );

  baker.finish(HARBOUR_SIGN_KEY, width, height);
}


/**
 * The harbour's signature silhouette: a tapered, banded lighthouse with a
 * glazed lantern room and gallery. The lamp glow itself is a tweened arc added
 * by the scene at HARBOUR_LIGHTHOUSE_LAMP_Y, exactly like the airport beacon.
 */
export function bakeHarbourLighthouse(baker: Baker): void {
  const width = 112;
  const height = 200;
  const originX = width / 2;
  const originY = height - HARBOUR_LIGHTHOUSE_ANCHOR_Y;
  const plinth = 16;
  const shaftTop = 112;
  const galleryTop = 122;
  const lanternTop = 146;
  const baseHalf = 0.34;
  const tipHalf = 0.2;

  // It stands off the wharf in open water, so it brings its own ground: a
  // rock islet ringed with foam.
  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(HARBOUR.foam, 0.4);
  baker.graphics.fillEllipse(waterline.x, waterline.y + 2, 76, 26);
  baker.graphics.fillStyle(HARBOUR.foam, 0.55);
  baker.graphics.fillEllipse(waterline.x, waterline.y + 1, 62, 20);
  fillFace(baker, TERRAIN_COLORS.shadow, 0.24, diamond(0.5), originX, originY);
  fillFace(baker, HARBOUR.stoneDark, 1, diamond(0.52, 5), originX, originY);
  fillFace(
    baker,
    HARBOUR.stone,
    1,
    [[-0.52, 0.52, 5], [0.52, 0.52, 5], [0.52, 0.52, 0], [-0.52, 0.52, 0]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(HARBOUR.stone, -26),
    1,
    [[0.52, 0.52, 5], [0.52, -0.52, 5], [0.52, -0.52, 0], [0.52, 0.52, 0]],
    originX,
    originY,
  );
  // Boulders piled against the plinth break the islet's silhouette.
  for (const [u, v, radius] of [
    [-0.46, 0.2, 7],
    [-0.1, 0.5, 8],
    [0.34, 0.44, 6],
    [0.5, -0.16, 7],
    [0.16, -0.48, 5],
  ] as const) {
    const rock = baker.at([u, v, 4], originX, originY);
    baker.graphics.fillStyle(HARBOUR.stoneDark, 1);
    baker.graphics.fillEllipse(rock.x, rock.y, radius * 2, radius * 1.5);
    baker.graphics.fillStyle(HARBOUR.stone, 1);
    baker.graphics.fillEllipse(rock.x - 1, rock.y - 2, radius * 1.3, radius);
  }

  // Rough stone plinth.
  harbourBox(
    baker,
    originX,
    originY,
    [-0.42, 0.42, -0.42, 0.42, 0, plinth],
    HARBOUR.stone,
  );
  baker.graphics.lineStyle(1, HARBOUR.stoneEdge, 0.45);
  for (const u of [-0.2, 0.06, 0.3]) {
    const a = baker.at([u, 0.42, plinth - 2], originX, originY);
    const b = baker.at([u, 0.42, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Tapered shaft: two trapezoid faces, lit toward grid +v.
  const shaft = (color: number, side: "lit" | "shade", z0: number, z1: number): void => {
    const t0 = baseHalf + ((tipHalf - baseHalf) * (z0 - plinth)) / (shaftTop - plinth);
    const t1 = baseHalf + ((tipHalf - baseHalf) * (z1 - plinth)) / (shaftTop - plinth);
    const points: Point3[] =
      side === "lit"
        ? [[-t1, t1, z1], [t1, t1, z1], [t0, t0, z0], [-t0, t0, z0]]
        : [[t1, t1, z1], [t1, -t1, z1], [t0, -t0, z0], [t0, t0, z0]];
    fillFace(baker, color, 1, points, originX, originY);
  };
  // White with two red bands, painted as horizontal slices of the taper.
  const bands: ReadonlyArray<readonly [number, number, number]> = [
    [plinth, 40, HARBOUR.white],
    [40, 58, HARBOUR.red],
    [58, 84, HARBOUR.white],
    [84, 100, HARBOUR.red],
    [100, shaftTop, HARBOUR.white],
  ];
  for (const [z0, z1, color] of bands) {
    shaft(color, "lit", z0, z1);
    shaft(shade(color, -24), "shade", z0, z1);
  }
  // A narrow window slit up the lit face.
  baker.graphics.fillStyle(HARBOUR.glassDark, 0.9);
  for (const z of [50, 76]) {
    const slit = baker.at([0, 0.3, z], originX, originY);
    baker.graphics.fillRect(slit.x - 2, slit.y - 7, 4, 8);
  }

  // Gallery: corbelled deck with a railing.
  harbourBox(
    baker,
    originX,
    originY,
    [-0.31, 0.31, -0.31, 0.31, shaftTop, shaftTop + 5],
    HARBOUR.iron,
  );
  for (const [u, v] of [[-0.29, 0.29], [0, 0.31], [0.29, 0.29], [0.31, 0], [0.29, -0.29]] as const) {
    harbourPost(baker, originX, originY, u, v, shaftTop + 5, galleryTop, 2, HARBOUR.iron);
  }
  baker.graphics.lineStyle(1.5, HARBOUR.iron, 1);
  baker.graphics.strokePoints(
    [
      baker.at([-0.29, 0.29, galleryTop], originX, originY),
      baker.at([0.29, 0.29, galleryTop], originX, originY),
      baker.at([0.29, -0.29, galleryTop], originX, originY),
    ],
    false,
  );

  // Lantern room.
  harbourBox(
    baker,
    originX,
    originY,
    [-0.21, 0.21, -0.21, 0.21, galleryTop, lanternTop],
    HARBOUR.glass,
  );
  fillFace(
    baker,
    HARBOUR.amber,
    0.55,
    [[-0.16, 0.16, lanternTop - 5], [0.16, 0.16, lanternTop - 5], [0.16, 0.16, galleryTop + 5], [-0.16, 0.16, galleryTop + 5]],
    originX,
    originY,
  );
  // Astragal bars.
  baker.graphics.lineStyle(1.5, HARBOUR.iron, 0.95);
  for (const u of [-0.21, -0.07, 0.07, 0.21]) {
    const a = baker.at([u, 0.21, lanternTop], originX, originY);
    const b = baker.at([u, 0.21, galleryTop], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  for (const v of [0.21, 0.07, -0.07, -0.21]) {
    const a = baker.at([0.21, v, lanternTop], originX, originY);
    const b = baker.at([0.21, v, galleryTop], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Dome and finial.
  const domeBase = baker.at([0, 0, lanternTop], originX, originY);
  baker.graphics.fillStyle(HARBOUR.navy, 1);
  baker.graphics.fillTriangle(
    domeBase.x - 15,
    domeBase.y + 1,
    domeBase.x + 15,
    domeBase.y + 1,
    domeBase.x,
    domeBase.y - 17,
  );
  baker.graphics.fillStyle(shade(HARBOUR.navy, 28), 1);
  baker.graphics.fillTriangle(
    domeBase.x - 15,
    domeBase.y + 1,
    domeBase.x - 2,
    domeBase.y + 1,
    domeBase.x,
    domeBase.y - 17,
  );
  baker.graphics.fillStyle(HARBOUR.amber, 1);
  baker.graphics.fillRect(domeBase.x - 1, domeBase.y - 24, 2, 8);
  baker.graphics.fillCircle(domeBase.x, domeBase.y - 25, 2.5);

  baker.finish(HARBOUR_LIGHTHOUSE_KEY, width, height);
}


/** Quayside lamp: iron column, curved arm and a lit amber lantern. */
export function bakeHarbourLamp(baker: Baker): void {
  const width = 72;
  const height = 76;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);

  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.22);
  baker.graphics.fillEllipse(base.x + 3, base.y + 1, 16, 6);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillEllipse(base.x, base.y - 1, 13, 5);
  baker.graphics.fillRect(base.x - 2, base.y - 38, 4, 37);
  baker.graphics.fillStyle(shade(HARBOUR.iron, 26), 1);
  baker.graphics.fillRect(base.x - 2, base.y - 38, 1.5, 37);
  // Curved arm out over the quay edge.
  baker.graphics.lineStyle(3, HARBOUR.iron, 1);
  baker.graphics.strokePoints(
    [
      new Phaser.Math.Vector2(base.x, base.y - 36),
      new Phaser.Math.Vector2(base.x + 5, base.y - 42),
      new Phaser.Math.Vector2(base.x + 12, base.y - 43),
    ],
    false,
  );
  // Lantern.
  const lamp = new Phaser.Math.Vector2(base.x + 12, base.y - 41);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillTriangle(lamp.x - 6, lamp.y, lamp.x + 6, lamp.y, lamp.x, lamp.y - 6);
  baker.graphics.fillStyle(HARBOUR.amber, 1);
  baker.graphics.fillTriangle(lamp.x - 5, lamp.y + 8, lamp.x + 5, lamp.y + 8, lamp.x, lamp.y);
  baker.graphics.fillStyle(HARBOUR.white, 0.8);
  baker.graphics.fillCircle(lamp.x, lamp.y + 4, 2);

  baker.finish(HARBOUR_LAMP_KEY, width, height);
}


/** Green channel marker standing off the pier head. */
export function bakeHarbourMarker(baker: Baker): void {
  const width = 56;
  const height = 76;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);

  baker.graphics.fillStyle(HARBOUR.foam, 0.4);
  baker.graphics.fillEllipse(base.x, base.y, 22, 8);
  baker.graphics.fillStyle(HARBOUR.pile, 1);
  baker.graphics.fillRect(base.x - 3, base.y - 30, 6, 32);
  baker.graphics.fillStyle(shade(HARBOUR.pile, 22), 1);
  baker.graphics.fillRect(base.x - 3, base.y - 30, 1.5, 32);
  // Green cone topmark over a white collar.
  baker.graphics.fillStyle(HARBOUR.white, 1);
  baker.graphics.fillRect(base.x - 4, base.y - 24, 8, 5);
  baker.graphics.fillStyle(0x3fbf7f, 1);
  baker.graphics.fillTriangle(base.x - 7, base.y - 30, base.x + 7, base.y - 30, base.x, base.y - 42);
  baker.graphics.fillStyle(shade(0x3fbf7f, 22), 1);
  baker.graphics.fillTriangle(base.x - 7, base.y - 30, base.x - 1, base.y - 30, base.x, base.y - 42);

  baker.finish(HARBOUR_MARKER_KEY, width, height);
}
