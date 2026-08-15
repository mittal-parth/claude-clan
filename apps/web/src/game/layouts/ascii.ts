/**
 * Renders the city field as text so a layout change can be *looked at*.
 *
 * Reading the code found none of the layout defects this replaced: the road
 * checkerboard, the twin lanes and the one-tile road fragments were all
 * obvious the first time the field was printed and invisible in every unit
 * assertion written before it. Pure, no Phaser import, so it runs in a plain
 * node test alongside terrain.ts.
 */

import type { WorldSnapshot } from "@sudo-city/protocol";
import type { TerrainGrid } from "./terrain";

const GLYPH: Record<string, string> = {
  road: "#",
  plaza: "+",
  park: ",",
  ground: ".",
  grass: '"',
  sand: "~",
  water: " ",
};

/** Renders only the published field, 0 <= x < width, 0 <= y < height. */
export function renderAscii(grid: TerrainGrid, snapshot: WorldSnapshot): string {
  const { width, height } = snapshot.size;
  const plots = new Set(
    snapshot.buildings.map((building) => `${building.plot.x}:${building.plot.y}`),
  );

  const rulerDigits = (x: number): string => (x % 10 === 0 ? String((x / 10) % 10) : " ");
  const rows: string[] = [
    "    " + Array.from({ length: width }, (_unused, x) => rulerDigits(x)).join(""),
  ];

  for (let y = 0; y < height; y += 1) {
    let row = String(y).padStart(3, " ") + " ";
    for (let x = 0; x < width; x += 1) {
      if (plots.has(`${x}:${y}`)) {
        row += "B";
        continue;
      }
      const cell = grid.cellAt(x, y);
      row += GLYPH[cell?.kind ?? "grass"] ?? "?";
    }
    rows.push(row);
  }

  return rows.join("\n");
}
