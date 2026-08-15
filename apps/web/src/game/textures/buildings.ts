import { Archetype, TERRAIN_COLORS, BuildingPalette, paletteFor, bodyHeightFor } from "../math/palette";
import { TILE_HEIGHT, Baker, TILE_WIDTH, shade, fillFace, diamond, strokeFace, HALF_W, Point3, HALF_H, TILE_ANCHOR_Y, createBaker } from "./core";
import { FOOTPRINT } from "./terrain";
import type { BuildingFacing } from "../layouts/terrain";
import Phaser, { Scene } from "phaser";

/**
 * Only "house" and "townhouse" actually vary their bake by facing (a door,
 * an awning) -- office, tower and utility have no wall-mounted street detail
 * to reorient, so their key stays facing-independent and the bake cache
 * isn't doubled for archetypes where the second half would be identical.
 */
const FACING_VARIES: ReadonlySet<Archetype> = new Set(["house", "townhouse"]);

export function buildingTextureKey(
  archetype: Archetype,
  tier: number,
  language: string,
  facing: BuildingFacing = "v",
): string {
  const suffix = FACING_VARIES.has(archetype) ? `:${facing}` : "";
  return `bld:${archetype}:${tier}:${language}${suffix}`;
}


/** A clickable marketplace building where the mayor can pick an issue to fix. */
export const ISSUE_SHOP_KEY = "fx:issue-shop";

/** Half-footprint of the issue shop, in tiles -- it spans a 2x2 block so it reads as a landmark beside the harbour rather than another house. */
export const ISSUE_SHOP_HALF = 1;

/**
 * Screen-space offset from the issue shop's footprint centre (u=v=0) down to
 * its south, nearest-viewer vertex. Double TILE_ANCHOR_Y because the
 * footprint spans two tiles in each direction instead of one.
 */
export const ISSUE_SHOP_ANCHOR_Y = ISSUE_SHOP_HALF * TILE_HEIGHT;


/**
 * The issue marketplace, a 2x2-tile landmark drawn with the same lit/shaded
 * wall + roof technique as ordinary buildings (see drawBox), just scaled to
 * a bigger footprint and topped with a GitHub mark instead of a language
 * glyph. It isn't part of the archetype/palette pipeline -- like the ship,
 * it's a one-off prop -- so its wall/window drawing is written out here
 * rather than shared with bakeBuilding, which hardcodes a single-tile origin.
 */
export function bakeIssueShop(baker: Baker): void {
  const half = ISSUE_SHOP_HALF;
  const width = TILE_WIDTH * 2;
  const originX = width / 2;

  const wall = 0x6e4a94;
  const wallShadow = shade(wall, -26);
  const roof = 0x2f2047;
  const roofShadow = shade(roof, -18);
  const roofLight = shade(roof, 22);
  const trim = 0xffd166;
  const windowGlow = 0xf3e6ff;
  const windowShadow = shade(windowGlow, -30);

  const body = 150;
  const crown = 26;
  const plinthTop = body + crown;
  const badgeZ = plinthTop + 8;
  const height = 260;
  const originY = height - ISSUE_SHOP_ANCHOR_Y;

  // Ground contact shadow, inset from the walls -- a footprint this large
  // needs no overhang to read as grounded.
  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.22,
    [
      [-0.87, -0.87, 0],
      [0.97, -0.87, 0],
      [0.97, 0.97, 0],
      [-0.87, 0.97, 0],
    ],
    originX,
    originY,
  );

  // Lit wall (screen-left, grid +v) and shaded wall (screen-right, grid +u).
  fillFace(
    baker,
    wall,
    1,
    [
      [-half, half, body],
      [half, half, body],
      [half, half, 0],
      [-half, half, 0],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    wallShadow,
    1,
    [
      [half, half, body],
      [half, -half, body],
      [half, -half, 0],
      [half, half, 0],
    ],
    originX,
    originY,
  );

  // A wide glass frontage across both visible walls.
  const rows = 4;
  const columns = 7;
  const rowStep = body / (rows + 1);
  const columnStep = (half * 2 * 0.86) / (columns + 1);
  const start = -half * 0.86;
  const size = Math.min(rowStep * 0.5, 9);
  for (let row = 1; row <= rows; row += 1) {
    const z = rowStep * row;
    for (let column = 1; column <= columns; column += 1) {
      const offset = start + columnStep * column;
      fillFace(
        baker,
        windowGlow,
        0.92,
        [
          [offset - 0.06, half, z + size / 2],
          [offset + 0.06, half, z + size / 2],
          [offset + 0.06, half, z - size / 2],
          [offset - 0.06, half, z - size / 2],
        ],
        originX,
        originY,
      );
      fillFace(
        baker,
        windowShadow,
        0.92,
        [
          [half, offset - 0.06, z + size / 2],
          [half, offset + 0.06, z + size / 2],
          [half, offset + 0.06, z - size / 2],
          [half, offset - 0.06, z - size / 2],
        ],
        originX,
        originY,
      );
    }
  }

  // Gold ground-floor rail, echoing the ticket-shop signage of the old sign.
  fillFace(
    baker,
    trim,
    1,
    [
      [-half, half, 18],
      [half, half, 18],
      [half, half, 6],
      [-half, half, 6],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(trim, -22),
    1,
    [
      [half, half, 18],
      [half, -half, 18],
      [half, -half, 6],
      [half, half, 6],
    ],
    originX,
    originY,
  );

  // Flat parapet roof.
  fillFace(baker, roof, 1, diamond(half, body), originX, originY);
  strokeFace(baker, roofShadow, 0.9, 1, diamond(half, body), originX, originY);
  fillFace(baker, roofLight, 0.22, diamond(half * 0.7, body + 1), originX, originY);

  // A short plinth lifts the GitHub mark clear of the roofline.
  fillFace(
    baker,
    roofLight,
    1,
    [
      [-0.22, 0.22, plinthTop],
      [0.22, 0.22, plinthTop],
      [0.22, 0.22, body],
      [-0.22, 0.22, body],
    ],
    originX,
    originY,
  );
  fillFace(
    baker,
    roofShadow,
    1,
    [
      [0.22, 0.22, plinthTop],
      [0.22, -0.22, plinthTop],
      [0.22, -0.22, body],
      [0.22, 0.22, body],
    ],
    originX,
    originY,
  );
  fillFace(baker, roof, 1, diamond(0.22, plinthTop), originX, originY);

  drawGithubBadge(baker, originX, originY, badgeZ);

  baker.finish(ISSUE_SHOP_KEY, width, height);
}


/**
 * GitHub's mark, stamped on a plaque above the roofline the same way
 * drawLanguageBadge stamps a language glyph -- flat pixel art in screen
 * space so it stays crisp and legible at the isometric skew.
 */
export const GITHUB_MARK: readonly string[] = [
  "..1...1..",
  ".11.1.11.",
  "111111111",
  "111111111",
  "11.111.11",
  "111111111",
  ".1111111.",
  "..11111..",
];


export function drawGithubBadge(
  baker: Baker,
  originX: number,
  originY: number,
  badgeZ: number,
): void {
  fillFace(baker, 0x0d1117, 1, diamond(0.42, badgeZ), originX, originY);
  fillFace(baker, 0xffffff, 1, diamond(0.36, badgeZ + 1), originX, originY);

  const rows = GITHUB_MARK.length;
  const columns = Math.max(1, ...GITHUB_MARK.map((row) => row.length));
  const pixelSize = 3;
  const center = baker.at([0, 0, badgeZ + 5], originX, originY);
  baker.graphics.fillStyle(0x0d1117, 1);
  for (let row = 0; row < rows; row += 1) {
    const glyphRow = GITHUB_MARK[row] ?? "";
    for (let column = 0; column < columns; column += 1) {
      if (glyphRow[column] !== "1") {
        continue;
      }
      baker.graphics.fillRect(
        Math.round(center.x - (columns * pixelSize) / 2 + column * pixelSize),
        Math.round(center.y - (rows * pixelSize) / 2 + row * pixelSize),
        pixelSize,
        pixelSize,
      );
    }
  }
}


export const buildingCache = new Map<string, BakedBuilding>();


/** Extra height above the body: pitched roofs, setbacks, antennae, tanks. */
export function crownHeightFor(archetype: Archetype, tier: number): number {
  switch (archetype) {
    case "house":
      return 20;
    case "townhouse":
      return 12;
    case "office":
      return 10;
    case "tower":
      return 26 + tier * 4;
    case "utility":
      return 30;
    default:
      return 0;
  }
}


export function badgeHeightFor(archetype: Archetype, body: number): number {
  switch (archetype) {
    case "house":
      return body + 20;
    case "townhouse":
      return body + 8;
    case "office":
      return body + 10;
    case "tower":
      return body + 5;
    case "utility":
      return body + 18;
    default: {
      const exhaustive: never = archetype;
      return body + exhaustive;
    }
  }
}


/** A small, front-facing pixel badge makes a colour-readable building identifiable when zoomed out. */
export function drawLanguageBadge(
  baker: Baker,
  originY: number,
  archetype: Archetype,
  body: number,
  palette: BuildingPalette,
): void {
  const badgeZ = badgeHeightFor(archetype, body);
  const half = archetype === "tower" ? 0.14 : 0.16;
  const outlineHalf = half + 0.045;

  fillFace(
    baker,
    palette.accentDark,
    1,
    diamond(outlineHalf, badgeZ),
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    palette.accent,
    1,
    diamond(half, badgeZ + 1),
    HALF_W,
    originY,
  );

  const rows = palette.glyph.length;
  const columns = Math.max(
    1,
    ...palette.glyph.map((row) => row.length),
  );
  const pixelSize = 2;
  const center = baker.at([0, 0, badgeZ + 3], HALF_W, originY);
  baker.graphics.fillStyle(palette.ink, 1);
  for (let row = 0; row < rows; row += 1) {
    const glyphRow = palette.glyph[row] ?? "";
    for (let column = 0; column < columns; column += 1) {
      if (glyphRow[column] !== "1") {
        continue;
      }
      baker.graphics.fillRect(
        Math.round(center.x - (columns * pixelSize) / 2 + column * pixelSize),
        Math.round(center.y - (rows * pixelSize) / 2 + row * pixelSize),
        pixelSize,
        pixelSize,
      );
    }
  }
}


/**
 * The canvas only ever reserves TILE_ANCHOR_Y worth of room below the tile
 * point (see bakeBuilding: originY = height - TILE_ANCHOR_Y), so the
 * shadow's own near corner -- the one that reaches furthest down-screen --
 * must keep (u + v) at or under 1 tile. FOOTPRINT + 0.04 diamond offset by
 * 0.08 put that corner at 0.42 + 0.04 + 0.08 = 0.54 per axis, (u + v) = 1.08:
 * two extra pixels below the canvas, clipped off in every building bake.
 */
const SHADOW_OFFSET = 0.03;

export function drawShadow(baker: Baker, originY: number): void {
  // Cast down-right, away from the upper-left sun.
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillPoints(
    diamond(FOOTPRINT + 0.04).map((point) =>
      baker.at(
        [point[0] + SHADOW_OFFSET, point[1] + SHADOW_OFFSET, 0],
        HALF_W,
        originY,
      ),
    ),
    true,
  );
}


/**
 * The two visible walls plus the roof slab. Sun sits upper-left, so the wall
 * facing screen-left (grid +v) is lit and the screen-right wall (grid +u) is
 * in shade.
 */
export function drawBox(
  baker: Baker,
  originY: number,
  half: number,
  base: number,
  top: number,
  palette: BuildingPalette,
  roofColor = palette.roof,
): void {
  const litWall = palette.wall;
  const shadedWall = palette.wallShadow;

  fillFace(
    baker,
    litWall,
    1,
    [
      [-half, half, top],
      [half, half, top],
      [half, half, base],
      [-half, half, base],
    ],
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    shadedWall,
    1,
    [
      [half, half, top],
      [half, -half, top],
      [half, -half, base],
      [half, half, base],
    ],
    HALF_W,
    originY,
  );
  drawFacadeDetails(baker, originY, half, base, top, palette);

  fillFace(baker, roofColor, 1, diamond(half, top), HALF_W, originY);
  strokeFace(
    baker,
    roofColor === palette.roof ? palette.roofShadow : shade(roofColor, -28),
    0.9,
    1,
    diamond(half, top),
    HALF_W,
    originY,
  );
  drawRoofMaterialDetails(baker, originY, half, top, palette);
}


export function wallStrip(
  baker: Baker,
  originY: number,
  half: number,
  z: number,
  height: number,
  color: number,
  alpha: number,
  side: "lit" | "shade",
  from = -half,
  to = half,
): void {
  const points: Point3[] =
    side === "lit"
      ? [
          [from, half, z + height],
          [to, half, z + height],
          [to, half, z],
          [from, half, z],
        ]
      : [
          [half, from, z + height],
          [half, to, z + height],
          [half, to, z],
          [half, from, z],
        ];
  fillFace(baker, color, alpha, points, HALF_W, originY);
}


/** The saturated rail and material marks are the visual fingerprint of a file type. */
export function drawFacadeDetails(
  baker: Baker,
  originY: number,
  half: number,
  base: number,
  top: number,
  palette: BuildingPalette,
): void {
  const span = Math.max(1, top - base);
  const railBase = base + Math.min(8, Math.max(3, span * 0.18));
  const railHeight = Math.min(4, Math.max(2, span * 0.08));
  wallStrip(baker, originY, half, railBase, railHeight, palette.accent, 0.96, "lit");
  wallStrip(
    baker,
    originY,
    half,
    railBase,
    railHeight,
    palette.accentDark,
    0.96,
    "shade",
  );
  wallStrip(
    baker,
    originY,
    half,
    top - Math.min(3, Math.max(1, span * 0.06)),
    Math.min(2, Math.max(1, span * 0.04)),
    palette.wallLight,
    0.46,
    "lit",
  );

  switch (palette.material) {
    case "brick":
    case "wood":
      for (let row = 1; row <= 2; row += 1) {
        wallStrip(
          baker,
          originY,
          half,
          base + (span * row) / 3,
          1,
          palette.wallShadow,
          0.4,
          "lit",
        );
        wallStrip(
          baker,
          originY,
          half,
          base + (span * row) / 3,
          1,
          shade(palette.wallShadow, -12),
          0.4,
          "shade",
        );
      }
      break;
    case "glass":
      for (const offset of [-half * 0.45, 0, half * 0.45]) {
        wallStrip(
          baker,
          originY,
          half,
          base + span * 0.3,
          span * 0.52,
          palette.accent,
          0.22,
          "lit",
          offset - 0.025,
          offset + 0.025,
        );
      }
      break;
    case "metal":
      for (const offset of [-half * 0.48, half * 0.48]) {
        wallStrip(
          baker,
          originY,
          half,
          base + span * 0.22,
          span * 0.62,
          palette.trim,
          0.3,
          "shade",
          offset - 0.025,
          offset + 0.025,
        );
      }
      break;
    case "neon":
      wallStrip(
        baker,
        originY,
        half,
        top - Math.min(7, span * 0.18),
        2,
        palette.accent,
        0.8,
        "lit",
      );
      break;
    case "concrete":
    case "paper":
    case "painted":
      wallStrip(
        baker,
        originY,
        half,
        base + span * 0.72,
        1,
        palette.trim,
        0.24,
        "lit",
      );
      break;
    default: {
      const exhaustive: never = palette.material;
      throw new Error(`Unhandled building material: ${exhaustive}`);
    }
  }
}


export function drawRoofMaterialDetails(
  baker: Baker,
  originY: number,
  half: number,
  top: number,
  palette: BuildingPalette,
): void {
  switch (palette.material) {
    case "glass":
      strokeFace(baker, palette.accent, 0.55, 1, diamond(half * 0.72, top + 1), HALF_W, originY);
      break;
    case "metal":
      strokeFace(baker, palette.trim, 0.55, 1, diamond(half * 0.78, top + 1), HALF_W, originY);
      break;
    case "neon":
      strokeFace(baker, palette.accent, 0.95, 2, diamond(half * 0.88, top + 1), HALF_W, originY);
      break;
    case "brick":
    case "concrete":
    case "paper":
    case "painted":
    case "wood":
      fillFace(baker, palette.roofLight, 0.2, diamond(half * 0.62, top + 1), HALF_W, originY);
      break;
    default: {
      const exhaustive: never = palette.material;
      throw new Error(`Unhandled building material: ${exhaustive}`);
    }
  }
}


/** Rows of lit glazing on both visible walls. */
export function drawWindows(
  baker: Baker,
  originY: number,
  half: number,
  base: number,
  top: number,
  palette: BuildingPalette,
  rows: number,
  columns: number,
): void {
  const span = top - base;
  const rowStep = span / (rows + 1);
  const columnStep = (half * 2 * 0.72) / (columns + 1);
  const start = -half * 0.72;
  const size = Math.min(rowStep * 0.5, 7);

  for (let row = 1; row <= rows; row += 1) {
    const z = base + rowStep * row;
    for (let column = 1; column <= columns; column += 1) {
      const offset = start + columnStep * column;
      // Lit wall (grid +v).
      fillFace(
        baker,
        palette.windowGlow,
        0.92,
        [
          [offset - 0.05, half, z + size / 2],
          [offset + 0.05, half, z + size / 2],
          [offset + 0.05, half, z - size / 2],
          [offset - 0.05, half, z - size / 2],
        ],
        HALF_W,
        originY,
      );
      // Shaded wall (grid +u).
      fillFace(
        baker,
        palette.windowShadow,
        0.92,
        [
          [half, offset - 0.05, z + size / 2],
          [half, offset + 0.05, z + size / 2],
          [half, offset + 0.05, z - size / 2],
          [half, offset - 0.05, z - size / 2],
        ],
        HALF_W,
        originY,
      );
    }
  }
}


export function drawHouse(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
  facing: BuildingFacing,
): void {
  const half = FOOTPRINT * 0.82;
  drawBox(baker, originY, half, 0, body, palette, palette.wall);
  drawWindows(baker, originY, half, 0, body, palette, 1, 2);
  drawDoorway(baker, originY, half, palette, facing);
  drawPitchedRoof(baker, originY, half, body, 20, palette);
}


/**
 * A doorway on whichever of the two visible walls faces the plot's own
 * street -- the detail "facing the street" actually means. Only +u and +v
 * are ever plated (see drawBox), so a plot fronting -u or -v falls back to
 * whichever facing buildingFacingAt already chose for it; there is no third
 * wall to put it on.
 */
function drawDoorway(
  baker: Baker,
  originY: number,
  half: number,
  palette: BuildingPalette,
  facing: BuildingFacing,
): void {
  const doorHalf = Math.min(half * 0.24, 0.15);
  // A fixed pixel height, not scaled from `half` -- `half` is a grid-space
  // half-width (u/v tile units), not a z-space measurement, and the
  // shortest house body (26px, tier 0) still comfortably clears a 12px door.
  const doorTop = 12;
  const doorColor = shade(palette.wallShadow, -8);

  const points: Point3[] =
    facing === "v"
      ? [
          [-doorHalf, half, doorTop],
          [doorHalf, half, doorTop],
          [doorHalf, half, 0],
          [-doorHalf, half, 0],
        ]
      : [
          [half, -doorHalf, doorTop],
          [half, doorHalf, doorTop],
          [half, doorHalf, 0],
          [half, -doorHalf, 0],
        ];
  fillFace(baker, doorColor, 1, points, HALF_W, originY);
  strokeFace(baker, palette.trim, 0.7, 1, points, HALF_W, originY);
}


/** Two sloped planes meeting at a ridge along the u axis, plus the near gable. */
export function drawPitchedRoof(
  baker: Baker,
  originY: number,
  half: number,
  top: number,
  pitch: number,
  palette: BuildingPalette,
): void {
  const eave = half + 0.05;
  const ridge = top + pitch;

  // Far plane first — painter's order, the ridge occludes it.
  fillFace(
    baker,
    palette.roofShadow,
    1,
    [
      [-eave, -eave, top],
      [eave, -eave, top],
      [eave, 0, ridge],
      [-eave, 0, ridge],
    ],
    HALF_W,
    originY,
  );
  // Near plane, catching the light.
  fillFace(
    baker,
    palette.roofLight,
    1,
    [
      [-eave, 0, ridge],
      [eave, 0, ridge],
      [eave, eave, top],
      [-eave, eave, top],
    ],
    HALF_W,
    originY,
  );
  // Gable on the visible +u side.
  fillFace(
    baker,
    palette.wallShadow,
    1,
    [
      [eave, -eave, top],
      [eave, 0, ridge],
      [eave, eave, top],
    ],
    HALF_W,
    originY,
  );
  // Chimney.
  fillFace(
    baker,
    palette.trim,
    1,
    [
      [half * 0.4, half * 0.3, ridge + 8],
      [half * 0.6, half * 0.3, ridge + 8],
      [half * 0.6, half * 0.3, top + 4],
      [half * 0.4, half * 0.3, top + 4],
    ],
    HALF_W,
    originY,
  );
}


export function drawTownhouse(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
  facing: BuildingFacing,
): void {
  const half = FOOTPRINT * 0.9;
  drawBox(baker, originY, half, 0, body, palette, palette.roof);
  drawWindows(baker, originY, half, 10, body - 6, palette, 2, 2);

  // Shopfront awning across whichever wall faces the street.
  const awning: Point3[] =
    facing === "v"
      ? [
          [-half, half, 16],
          [half, half, 16],
          [half, half, 8],
          [-half, half, 8],
        ]
      : [
          [half, -half, 16],
          [half, half, 16],
          [half, half, 8],
          [half, -half, 8],
        ];
  fillFace(baker, palette.trim, 1, awning, HALF_W, originY);
  // Parapet.
  fillFace(
    baker,
    palette.roofLight,
    1,
    diamond(half * 0.86, body + 8),
    HALF_W,
    originY,
  );
}


export function drawOffice(
  baker: Baker,
  originY: number,
  body: number,
  tier: number,
  palette: BuildingPalette,
): void {
  const half = FOOTPRINT;
  drawBox(baker, originY, half, 0, body, palette, palette.roofShadow);
  drawWindows(baker, originY, half, 8, body - 6, palette, 3 + tier, 3);

  // Rooftop plant.
  fillFace(
    baker,
    shade(palette.trim, 18),
    1,
    diamond(half * 0.34, body + 10),
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    palette.trim,
    1,
    [
      [-half * 0.34, half * 0.34, body + 10],
      [half * 0.34, half * 0.34, body + 10],
      [half * 0.34, half * 0.34, body],
      [-half * 0.34, half * 0.34, body],
    ],
    HALF_W,
    originY,
  );
}


export function drawTower(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
): void {
  const half = FOOTPRINT;
  const setback = half * 0.62;
  const shoulder = body * 0.72;

  drawBox(baker, originY, half, 0, shoulder, palette, palette.roofShadow);
  drawWindows(baker, originY, half, 10, shoulder - 6, palette, 5, 3);

  drawBox(baker, originY, setback, shoulder, body, palette, palette.roof);
  drawWindows(baker, originY, setback, shoulder + 6, body - 6, palette, 3, 2);

  // Mast.
  const mastTop = body + 24;
  fillFace(
    baker,
    palette.trim,
    1,
    [
      [-0.02, 0.02, mastTop],
      [0.02, 0.02, mastTop],
      [0.02, 0.02, body],
      [-0.02, 0.02, body],
    ],
    HALF_W,
    originY,
  );
  const beaconAt = baker.at([0, 0, mastTop], HALF_W, originY);
  baker.graphics.fillStyle(0xff5a5f, 1);
  baker.graphics.fillCircle(beaconAt.x, beaconAt.y, 3);
}


/**
 * Where the chimney mouth sits relative to the sprite's anchor, which sits at
 * the tile's bottom corner because every sprite uses origin (0.5, 1).
 */
export function utilityStackAnchor(body: number): { x: number; y: number } {
  const u = FOOTPRINT * 0.55;
  const v = FOOTPRINT * -0.05;
  return {
    x: (u - v) * HALF_W,
    y: (u + v) * HALF_H - (body + 30) - TILE_ANCHOR_Y,
  };
}


export function drawUtility(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
): void {
  const half = FOOTPRINT;
  // Low warehouse shed.
  drawBox(baker, originY, half, 0, body * 0.6, palette, palette.roofShadow);

  // Storage tank alongside it.
  const tankBase = body * 0.6;
  const tankTop = body + 18;
  fillFace(
    baker,
    palette.roofLight,
    1,
    [
      [-half * 0.5, half * 0.5, tankTop],
      [half * 0.1, half * 0.5, tankTop],
      [half * 0.1, half * 0.5, tankBase],
      [-half * 0.5, half * 0.5, tankBase],
    ],
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    palette.roofShadow,
    1,
    [
      [half * 0.1, half * 0.5, tankTop],
      [half * 0.1, -half * 0.2, tankTop],
      [half * 0.1, -half * 0.2, tankBase],
      [half * 0.1, half * 0.5, tankBase],
    ],
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    shade(palette.roof, 14),
    1,
    [
      [-half * 0.5, -half * 0.2, tankTop],
      [half * 0.1, -half * 0.2, tankTop],
      [half * 0.1, half * 0.5, tankTop],
      [-half * 0.5, half * 0.5, tankTop],
    ],
    HALF_W,
    originY,
  );

  // Chimney the smoke emitter anchors to.
  const stackTop = body + 30;
  fillFace(
    baker,
    palette.trim,
    1,
    [
      [half * 0.4, half * 0.1, stackTop],
      [half * 0.7, half * 0.1, stackTop],
      [half * 0.7, half * 0.1, 0],
      [half * 0.4, half * 0.1, 0],
    ],
    HALF_W,
    originY,
  );
  fillFace(
    baker,
    shade(palette.trim, 16),
    1,
    [
      [half * 0.4, -half * 0.2, stackTop],
      [half * 0.7, -half * 0.2, stackTop],
      [half * 0.7, half * 0.1, stackTop],
      [half * 0.4, half * 0.1, stackTop],
    ],
    HALF_W,
    originY,
  );
}


/**
 * Bakes on first request and memoises. A polyglot repo could in principle ask
 * for archetypes x tiers x languages; in practice a repo touches a handful of
 * languages, so this settles well under a hundred textures.
 */
export function bakeBuilding(
  scene: Phaser.Scene,
  archetype: Archetype,
  tier: number,
  language: string,
  facing: BuildingFacing = "v",
): BakedBuilding {
  const key = buildingTextureKey(archetype, tier, language, facing);
  const cached = buildingCache.get(key);
  if (cached && scene.textures.exists(key)) {
    return cached;
  }

  const palette = paletteFor(language);
  const body = bodyHeightFor(archetype, tier);
  const crown = crownHeightFor(archetype, tier);
  const height = Math.ceil(body + crown + TILE_HEIGHT);
  const originY = height - TILE_ANCHOR_Y;

  const baker = createBaker(scene);
  drawShadow(baker, originY);

  switch (archetype) {
    case "house":
      drawHouse(baker, originY, body, palette, facing);
      break;
    case "townhouse":
      drawTownhouse(baker, originY, body, palette, facing);
      break;
    case "office":
      drawOffice(baker, originY, body, tier, palette);
      break;
    case "tower":
      drawTower(baker, originY, body, palette);
      break;
    case "utility":
      drawUtility(baker, originY, body, palette);
      break;
    default: {
      const exhaustive: never = archetype;
      throw new Error(`Unhandled archetype: ${String(exhaustive)}`);
    }
  }

  drawLanguageBadge(
    baker,
    originY,
    archetype,
    body,
    palette,
  );

  baker.finish(key, TILE_WIDTH, height);
  baker.destroy();

  const baked: BakedBuilding = {
    key,
    height,
    smokeAnchor:
      archetype === "utility" ? utilityStackAnchor(body) : undefined,
  };
  buildingCache.set(key, baked);
  return baked;
}


// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BakedBuilding {
  key: string;
  /** Pixel height of the texture; the scene needs it for rise animations. */
  height: number;
  /** Offset from the sprite's anchor to the chimney top, for smoke emitters. */
  smokeAnchor?: { x: number; y: number };
}
