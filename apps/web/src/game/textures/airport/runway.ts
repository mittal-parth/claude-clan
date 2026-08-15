import { Baker, HALF_H, HALF_W, Point3, fillFace, strokeFace, diamond } from "../core";
import { AIRPORT } from "../airport/terminal";
import {
  AIRPORT_APRON_HALF_U,
  AIRPORT_APRON_HALF_V,
  AIRPORT_TERMINAL_HALF_U,
  AIRPORT_TERMINAL_HALF_V,
  createAirportLayout,
} from "../../layouts/airport";
import { TERRAIN_COLORS } from "../../math/palette";

export const AIRPORT_APRON_KEY = "fx:airport-apron";

export const AIRPORT_TAXIWAY_VERTICAL_KEY = "fx:airport-taxiway-v";

export const AIRPORT_TAXIWAY_JUNCTION_KEY = "fx:airport-taxiway-junction";

export const AIRPORT_RUNWAY_TILE_KEY = "fx:airport-runway-tile";

export const AIRPORT_RUNWAY_THRESHOLD_KEY = "fx:airport-runway-threshold";


export function drawAirportLabel(
  baker: Baker,
  value: string,
  x: number,
  y: number,
  scale = 2,
): void {
  const glyphs: Record<string, readonly string[]> = {
    C: ["111", "100", "100", "100", "111"],
    X: ["101", "101", "010", "101", "101"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "9": ["111", "101", "111", "001", "111"],
  };
  const letters = [...value];
  const width = letters.length * 4 * scale - scale;
  baker.graphics.fillStyle(AIRPORT.gold, 1);
  letters.forEach((letter, letterIndex) => {
    const rows = glyphs[letter] ?? glyphs.C!;
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


/** A broad concrete apron makes the terminal, stand and taxi route one campus. */
export function bakeAirportApron(baker: Baker): void {
  // Every marking below is placed by asking the layout where things actually
  // are, rather than by restating tuned offsets that drift the moment the
  // campus moves. The apron and everything on it are all pinned to the field's
  // height, so those terms cancel and any city size gives the same answers.
  const layout = createAirportLayout(24, 24);
  const relU = (x: number): number => x - layout.apron.x;
  const relV = (y: number): number => y - layout.apron.y;
  const standU = relU(layout.gate.x);
  const standV = relV(layout.gate.y);
  const entryU = relU(layout.runwayEntry.x);
  const frontageV = relV(layout.terminal.y + AIRPORT_TERMINAL_HALF_V);

  const halfU = AIRPORT_APRON_HALF_U;
  const halfV = AIRPORT_APRON_HALF_V;
  const width = Math.ceil((halfU + halfV) * HALF_W * 2) + 16;
  const height = Math.ceil((halfU + halfV) * HALF_H * 2) + 16;
  const originX = width / 2;
  const originY = height / 2;
  const slab: Point3[] = [
    [-halfU, -halfV, 0],
    [halfU, -halfV, 0],
    [halfU, halfV, 0],
    [-halfU, halfV, 0],
  ];

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.24,
    slab.map(([u, v]) => [u + 0.08, v + 0.12, 0] as Point3),
    originX,
    originY,
  );
  fillFace(baker, AIRPORT.concrete, 1, slab, originX, originY);
  strokeFace(baker, AIRPORT.concreteDark, 0.9, 2, slab, originX, originY);

  // Expansion joints make the large slab read as poured concrete rather than
  // a single flat polygon.
  baker.graphics.lineStyle(1, AIRPORT.concreteDark, 0.42);
  for (let u = -halfU + 0.75; u < halfU; u += 0.8) {
    const from = baker.at([u, -halfV, 1], originX, originY);
    const to = baker.at([u, halfV, 1], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }
  for (const v of [-0.72, 0.05, 0.82]) {
    const from = baker.at([-halfU, v, 1], originX, originY);
    const to = baker.at([halfU, v, 1], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }

  // Gate stand lead-in: off the taxiway entry, curving in to the stand.
  baker.graphics.lineStyle(3, AIRPORT.gold, 0.96);
  const lead = [
    baker.at([entryU, halfV, 2], originX, originY),
    baker.at([entryU, standV + 0.43, 2], originX, originY),
    baker.at([entryU - 0.5, standV + 0.1, 2], originX, originY),
    baker.at([standU, standV, 2], originX, originY),
  ];
  baker.graphics.strokePoints(lead, false);
  for (const u of [standU - 0.18, standU, standU + 0.18]) {
    const a = baker.at([u, standV - 0.38, 2], originX, originY);
    const b = baker.at([u, standV + 0.34, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Baggage/service lane hatched along the terminal kerb. Drawn at the
  // frontage rather than behind it — set back into the footprint it is simply
  // covered by the building and does nothing at all.
  baker.graphics.lineStyle(2, AIRPORT.white, 0.58);
  const kerbFrom = relU(layout.terminal.x) - AIRPORT_TERMINAL_HALF_U + 0.2;
  const kerbTo = relU(layout.terminal.x) + AIRPORT_TERMINAL_HALF_U - 0.4;
  for (let u = kerbFrom; u < kerbTo; u += 0.42) {
    const a = baker.at([u, frontageV + 0.05, 2], originX, originY);
    const b = baker.at([u + 0.2, frontageV + 0.25, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  baker.finish(AIRPORT_APRON_KEY, width, height);
}


export function bakeAirportTaxiway(baker: Baker, key: string, junction: boolean): void {
  const width = 120;
  const height = 64;
  const originX = width / 2;
  const originY = height / 2;
  // Taxiway slabs that sit on the terminal apron use the same poured-concrete
  // palette as the surrounding tarmac. Only the dedicated runway textures use
  // dark asphalt; this avoids a lone runway-black diamond on the grey apron.
  fillFace(baker, AIRPORT.concrete, 1, diamond(0.5), originX, originY);
  strokeFace(
    baker,
    AIRPORT.concreteDark,
    0.72,
    1,
    diamond(0.46),
    originX,
    originY,
  );

  baker.graphics.lineStyle(3, AIRPORT.gold, 1);
  const v1 = baker.at([0, -0.5, 2], originX, originY);
  const v2 = baker.at([0, 0.5, 2], originX, originY);
  baker.graphics.lineBetween(v1.x, v1.y, v2.x, v2.y);
  if (junction) {
    const u1 = baker.at([-0.5, 0, 2], originX, originY);
    const u2 = baker.at([0.5, 0, 2], originX, originY);
    baker.graphics.lineBetween(u1.x, u1.y, u2.x, u2.y);
  }

  for (const [u, v] of [[-0.34, -0.34], [0.34, 0.34]] as const) {
    const lamp = baker.at([u, v, 3], originX, originY);
    baker.graphics.fillStyle(0x70d6ff, 1);
    baker.graphics.fillCircle(lamp.x, lamp.y, 2);
  }
  baker.finish(key, width, height);
}


export function drawRunwayBase(baker: Baker, originX: number, originY: number): void {
  const slab: Point3[] = [
    [-0.52, -0.76, 0],
    [0.52, -0.76, 0],
    [0.52, 0.76, 0],
    [-0.52, 0.76, 0],
  ];
  fillFace(baker, AIRPORT.asphaltEdge, 1, slab, originX, originY);
  fillFace(
    baker,
    AIRPORT.asphalt,
    1,
    [
      [-0.52, -0.68, 1],
      [0.52, -0.68, 1],
      [0.52, 0.68, 1],
      [-0.52, 0.68, 1],
    ],
    originX,
    originY,
  );

  baker.graphics.lineStyle(2, AIRPORT.white, 0.88);
  for (const v of [-0.61, 0.61]) {
    const a = baker.at([-0.52, v, 2], originX, originY);
    const b = baker.at([0.52, v, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  // Subtle rubber/wear patches keep repeated slabs from reading like pristine tiles.
  baker.graphics.lineStyle(2, AIRPORT.asphaltWear, 0.42);
  const wearA = baker.at([-0.38, -0.16, 2], originX, originY);
  const wearB = baker.at([0.3, -0.16, 2], originX, originY);
  baker.graphics.lineBetween(wearA.x, wearA.y, wearB.x, wearB.y);
}


export function bakeAirportRunwayTile(baker: Baker): void {
  const width = 144;
  const height = 72;
  const originX = width / 2;
  const originY = height / 2;
  drawRunwayBase(baker, originX, originY);

  fillFace(
    baker,
    AIRPORT.white,
    0.96,
    [
      [-0.29, -0.045, 3],
      [0.29, -0.045, 3],
      [0.29, 0.045, 3],
      [-0.29, 0.045, 3],
    ],
    originX,
    originY,
  );
  for (const v of [-0.72, 0.72]) {
    const lamp = baker.at([0, v, 3], originX, originY);
    baker.graphics.fillStyle(0x8de7f7, 1);
    baker.graphics.fillCircle(lamp.x, lamp.y, 2.2);
  }
  baker.finish(AIRPORT_RUNWAY_TILE_KEY, width, height);
}


export function bakeAirportRunwayThreshold(baker: Baker): void {
  const width = 144;
  const height = 72;
  const originX = width / 2;
  const originY = height / 2;
  drawRunwayBase(baker, originX, originY);

  for (const v of [-0.45, -0.27, -0.09, 0.09, 0.27, 0.45]) {
    fillFace(
      baker,
      AIRPORT.white,
      0.96,
      [
        [-0.42, v - 0.045, 3],
        [0.28, v - 0.045, 3],
        [0.28, v + 0.045, 3],
        [-0.42, v + 0.045, 3],
      ],
      originX,
      originY,
    );
  }
  for (const v of [-0.72, 0.72]) {
    const lamp = baker.at([0, v, 3], originX, originY);
    baker.graphics.fillStyle(v < 0 ? AIRPORT.red : AIRPORT.green, 1);
    baker.graphics.fillCircle(lamp.x, lamp.y, 2.5);
  }
  baker.finish(AIRPORT_RUNWAY_THRESHOLD_KEY, width, height);
}
