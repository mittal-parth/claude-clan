/**
 * Procedural texture bakery.
 *
 * Every tile, prop and building variant is drawn ONCE into a Graphics object,
 * baked to a GPU texture, and then instantiated as Sprites. The old renderer
 * kept a live Graphics per file, which is a draw call per file; sprites from a
 * baked texture batch instead.
 *
 * Terrain is baked eagerly (a fixed, small set). Buildings are baked lazily and
 * memoised by archetype:tier:language, because the cross-product is large but
 * any real repository only ever touches a handful of cells in it.
 */

import Phaser from "phaser";
import {
  CRANE_FOOT_X,
  CRANE_FOOT_Y,
  CRANE_HEIGHT,
  CRANE_JIB_REACH,
  CRANE_JIB_Y,
  CRANE_TAIL_REACH,
  CRANE_TROLLEY_REACH,
  CRANE_WIDTH,
} from "./crane";
import {
  PROP_COLORS,
  TERRAIN_COLORS,
  bodyHeightFor,
  paletteFor,
  type Archetype,
  type BuildingPalette,
} from "./palette";
import type { PropKind, TerrainKind } from "./terrain";

export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;

/**
 * Sprites are positioned at the tile's bottom corner with origin (0.5, 1), so
 * every baked texture reserves this much room below the tile centre.
 */
export const TILE_ANCHOR_Y = HALF_H;

/** Half-footprint of a building, in tiles. Leaves a gap between neighbours. */
const FOOTPRINT = 0.42;

/** Half-width of the asphalt, in tiles. */
const ROAD_HALF = 0.3;
const KERB_HALF = 0.4;

/** [u, v, height] — u/v in tile units from the tile centre, height in pixels up. */
type Point3 = readonly [number, number, number];

function shade(color: number, amount: number): number {
  const value = Phaser.Display.Color.IntegerToColor(color);
  return amount >= 0 ? value.lighten(amount).color : value.darken(-amount).color;
}

function createBaker(scene: Phaser.Scene) {
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);

  return {
    graphics,
    /** Projects a grid-space point into the texture's pixel space. */
    at(point: Point3, originX: number, originY: number): Phaser.Math.Vector2 {
      return new Phaser.Math.Vector2(
        originX + (point[0] - point[1]) * HALF_W,
        originY + (point[0] + point[1]) * HALF_H - point[2],
      );
    },
    finish(key: string, width: number, height: number): void {
      if (scene.textures.exists(key)) {
        scene.textures.remove(key);
      }
      graphics.generateTexture(key, width, height);
      graphics.clear();
    },
    /** Bakes what has been drawn so far without clearing — used by the atlas. */
    flush(key: string, width: number, height: number): void {
      if (scene.textures.exists(key)) {
        scene.textures.remove(key);
      }
      graphics.generateTexture(key, width, height);
    },
    destroy(): void {
      graphics.destroy();
    },
  };
}

type Baker = ReturnType<typeof createBaker>;

function fillFace(
  baker: Baker,
  color: number,
  alpha: number,
  points: readonly Point3[],
  originX: number,
  originY: number,
): void {
  baker.graphics.fillStyle(color, alpha);
  baker.graphics.fillPoints(
    points.map((point) => baker.at(point, originX, originY)),
    true,
  );
}

function strokeFace(
  baker: Baker,
  color: number,
  alpha: number,
  width: number,
  points: readonly Point3[],
  originX: number,
  originY: number,
): void {
  baker.graphics.lineStyle(width, color, alpha);
  baker.graphics.strokePoints(
    points.map((point) => baker.at(point, originX, originY)),
    true,
  );
}

const diamond = (half: number, height = 0): Point3[] => [
  [-half, -half, height],
  [half, -half, height],
  [half, half, height],
  [-half, half, height],
];

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainTextureKey(kind: TerrainKind, variant: number): string {
  return `tile:${kind}:${variant}`;
}

export function roadTextureKey(mask: number): string {
  return `tile:road:${mask}`;
}

export function propTextureKey(prop: PropKind): string {
  return `prop:${prop}`;
}

export const HIGHLIGHT_KEY = "tile:highlight";
export const SELECT_KEY = "tile:select";
/** Ring marking a building added by the PR city's diff. */
export const ADDED_MARKER_KEY = "fx:added";
/** Stands in for a building deleted by the PR, at its plot in main. */
export const RUBBLE_KEY = "fx:rubble";
export const CLOUD_KEY = "fx:cloud";
export const SMOKE_KEY = "fx:smoke";
export const SPARKLE_KEY = "fx:sparkle";
export const CAR_KEYS = ["fx:car:0", "fx:car:1", "fx:car:2", "fx:car:3"] as const;
export { CRANE_CABLE_OFFSET, CRANE_HEIGHT, CRANE_WIDTH } from "./crane";
export const CRANE_KEY = "fx:crane";
export const HOOK_KEY = "fx:hook";
export const CABLE_KEY = "fx:cable";
export const SCAFFOLD_KEY = "fx:scaffold";

/** Height of the baked scaffold, which is scaled to the building it wraps. */
export const SCAFFOLD_HEIGHT = 120;

/** The harbor marker for a PR city, moored offshore of the main island. */
export const SHIP_KEY = "fx:ship";

const GRASS_VARIANTS = TERRAIN_COLORS.grass.length;
const PARK_VARIANTS = 2;
const SAND_VARIANTS = 2;
const WATER_VARIANTS = 3;

export const TERRAIN_VARIANT_COUNTS: Record<TerrainKind, number> = {
  grass: GRASS_VARIANTS,
  park: PARK_VARIANTS,
  sand: SAND_VARIANTS,
  water: WATER_VARIANTS,
  ground: 1,
  road: 1,
};

/**
 * Every ground tile lives in ONE texture, so the whole terrain plane can be a
 * single batched object. A large repository lays down tens of thousands of
 * tiles; as individual Sprites that is a per-frame culling and depth-sorting
 * cost that dominates the frame budget.
 */
export const TERRAIN_ATLAS_KEY = "terrain-atlas";
const ATLAS_COLUMNS = 8;

/**
 * Bakes every terrain tile, prop and effect sprite. Call once, in create().
 *
 * Textures live on the Game's TextureManager, not the Scene, so they are
 * shared across every scene in the game -- baking is genuinely a one-time
 * cost. Without this guard, a second scene's create() would remove and
 * regenerate the same texture keys out from under the first scene's still-
 * live sprites, which reference their Texture by key.
 */
export function bakeTerrainTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TERRAIN_ATLAS_KEY)) {
    return;
  }

  const baker = createBaker(scene);

  bakeTerrainAtlas(scene, baker);
  baker.graphics.clear();

  bakeHighlight(baker, HIGHLIGHT_KEY, 0xffffff, 0.28);
  bakeHighlight(baker, SELECT_KEY, 0xffd166, 0.5);
  bakeHighlight(baker, ADDED_MARKER_KEY, 0xffb454, 0.65);
  bakeRubble(baker);

  bakeTree(baker);
  bakePine(baker);
  bakeBush(baker);
  bakeRock(baker);
  bakeFountain(baker);

  bakeCloud(baker);
  bakeSmoke(baker);
  bakeSparkle(baker);
  CAR_KEYS.forEach((key, index) => bakeCar(baker, key, index));
  bakeShip(baker);

  bakeCrane(baker);
  bakeHook(baker);
  bakeCable(baker);
  bakeScaffold(baker);

  baker.destroy();
}

function bakeTerrainAtlas(scene: Phaser.Scene, baker: Baker): void {
  const slots: Array<{ name: string; x: number; y: number }> = [];
  let index = 0;

  const place = (name: string, draw: (x: number, y: number) => void): void => {
    const x = (index % ATLAS_COLUMNS) * TILE_WIDTH;
    const y = Math.floor(index / ATLAS_COLUMNS) * TILE_HEIGHT;
    draw(x + HALF_W, y + HALF_H);
    slots.push({ name, x, y });
    index += 1;
  };

  for (let variant = 0; variant < GRASS_VARIANTS; variant += 1) {
    place(terrainTextureKey("grass", variant), (x, y) =>
      drawGroundTile(baker, x, y, TERRAIN_COLORS.grass[variant] as number, variant),
    );
  }
  for (let variant = 0; variant < PARK_VARIANTS; variant += 1) {
    place(terrainTextureKey("park", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.park : TERRAIN_COLORS.field,
        variant + 7,
      ),
    );
  }
  for (let variant = 0; variant < SAND_VARIANTS; variant += 1) {
    place(terrainTextureKey("sand", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.sand : TERRAIN_COLORS.sandShade,
        variant + 3,
      ),
    );
  }
  place(terrainTextureKey("ground", 0), (x, y) =>
    drawGroundTile(baker, x, y, TERRAIN_COLORS.ground, 11),
  );
  for (let variant = 0; variant < WATER_VARIANTS; variant += 1) {
    place(terrainTextureKey("water", variant), (x, y) =>
      drawWaterTile(baker, x, y, variant),
    );
  }
  for (let mask = 0; mask < 16; mask += 1) {
    place(roadTextureKey(mask), (x, y) => drawRoadTile(baker, x, y, mask));
  }

  const rows = Math.ceil(index / ATLAS_COLUMNS);
  baker.flush(TERRAIN_ATLAS_KEY, ATLAS_COLUMNS * TILE_WIDTH, rows * TILE_HEIGHT);

  const texture = scene.textures.get(TERRAIN_ATLAS_KEY);
  for (const slot of slots) {
    texture.add(slot.name, 0, slot.x, slot.y, TILE_WIDTH, TILE_HEIGHT);
  }
}

function drawGroundTile(
  baker: Baker,
  originX: number,
  originY: number,
  color: number,
  seed: number,
): void {
  fillFace(baker, color, 1, diamond(0.5), originX, originY);

  // A faint darker edge on the two far sides reads as a very shallow slab and
  // stops large fields looking like flat paper.
  strokeFace(baker, shade(color, -8), 0.5, 1, diamond(0.5), originX, originY);

  // Scattered blades, positioned from the variant seed so tiles differ but
  // each variant is stable.
  baker.graphics.fillStyle(shade(color, 10), 0.55);
  for (let index = 0; index < 6; index += 1) {
    const angle = ((seed * 37 + index * 61) % 360) * (Math.PI / 180);
    const radius = 0.12 + ((seed * 13 + index * 29) % 24) / 100;
    const point = baker.at(
      [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
      originX,
      originY,
    );
    baker.graphics.fillRect(point.x, point.y, 3, 2);
  }
}

function drawWaterTile(
  baker: Baker,
  originX: number,
  originY: number,
  variant: number,
): void {
  const base = variant === 2 ? TERRAIN_COLORS.waterDeep : TERRAIN_COLORS.water;
  fillFace(baker, base, 1, diamond(0.5), originX, originY);
  fillFace(baker, shade(base, -6), 0.6, diamond(0.34), originX, originY);

  if (variant !== 2) {
    baker.graphics.fillStyle(TERRAIN_COLORS.waterFoam, 0.35);
    const crest = baker.at([-0.1 + variant * 0.18, -0.05, 0], originX, originY);
    baker.graphics.fillRect(crest.x - 8, crest.y, 16, 2);
  }
}

/**
 * Roads are drawn as a centre block plus one arm per connected neighbour, all
 * in grid space, so junctions line up exactly whatever the mask.
 */
function drawRoadTile(
  baker: Baker,
  originX: number,
  originY: number,
  mask: number,
): void {
  const arms: Array<[number, Point3[]]> = [
    // North is -v, which projects up-and-right on screen.
    [1, band(-0.5, -ROAD_HALF, "v")],
    [2, band(ROAD_HALF, 0.5, "u")],
    [4, band(ROAD_HALF, 0.5, "v")],
    [8, band(-0.5, -ROAD_HALF, "u")],
  ];
  const kerbArms: Array<[number, Point3[]]> = [
    [1, band(-0.5, -KERB_HALF, "v", KERB_HALF)],
    [2, band(KERB_HALF, 0.5, "u", KERB_HALF)],
    [4, band(KERB_HALF, 0.5, "v", KERB_HALF)],
    [8, band(-0.5, -KERB_HALF, "u", KERB_HALF)],
  ];

  // Grass base, so an arm that stops mid-tile blends into the lot beside it.
  fillFace(baker, TERRAIN_COLORS.ground, 1, diamond(0.5), originX, originY);

  fillFace(baker, TERRAIN_COLORS.pavement, 1, diamond(KERB_HALF), originX, originY);
  for (const [bit, points] of kerbArms) {
    if (mask & bit) {
      fillFace(baker, TERRAIN_COLORS.pavement, 1, points, originX, originY);
    }
  }

  fillFace(baker, TERRAIN_COLORS.road, 1, diamond(ROAD_HALF), originX, originY);
  for (const [bit, points] of arms) {
    if (mask & bit) {
      fillFace(baker, TERRAIN_COLORS.road, 1, points, originX, originY);
    }
  }

  // Lane markings only on a straight run; a junction would be a mess of paint.
  const straightUV = mask === (2 | 8);
  const straightVU = mask === (1 | 4);
  if (straightUV || straightVU) {
    for (const offset of [-0.28, 0.04]) {
      const from: Point3 = straightUV ? [offset, 0, 0] : [0, offset, 0];
      const to: Point3 = straightUV ? [offset + 0.24, 0, 0] : [0, offset + 0.24, 0];
      baker.graphics.lineStyle(2, TERRAIN_COLORS.roadLine, 0.85);
      baker.graphics.lineBetween(
        baker.at(from, originX, originY).x,
        baker.at(from, originX, originY).y,
        baker.at(to, originX, originY).x,
        baker.at(to, originX, originY).y,
      );
    }
  }
}

/** A rectangular strip in grid space, running along one axis. */
function band(
  from: number,
  to: number,
  axis: "u" | "v",
  half = ROAD_HALF,
): Point3[] {
  return axis === "u"
    ? [
        [from, -half, 0],
        [to, -half, 0],
        [to, half, 0],
        [from, half, 0],
      ]
    : [
        [-half, from, 0],
        [half, from, 0],
        [half, to, 0],
        [-half, to, 0],
      ];
}

function bakeHighlight(
  baker: Baker,
  key: string,
  color: number,
  alpha: number,
): void {
  fillFace(baker, color, alpha * 0.4, diamond(0.46), HALF_W, HALF_H);
  strokeFace(baker, color, alpha, 2, diamond(0.46), HALF_W, HALF_H);
  baker.finish(key, TILE_WIDTH, TILE_HEIGHT);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const PROP_HEIGHT = 56;
const PROP_ORIGIN_Y = PROP_HEIGHT - TILE_ANCHOR_Y;

function propShadow(baker: Baker, half: number): void {
  fillFace(baker, TERRAIN_COLORS.shadow, 0.22, diamond(half), HALF_W, PROP_ORIGIN_Y);
}

function bakeTree(baker: Baker): void {
  propShadow(baker, 0.2);
  const trunk = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.trunk, 1);
  baker.graphics.fillRect(trunk.x - 3, trunk.y - 16, 6, 16);

  baker.graphics.fillStyle(PROP_COLORS.leaf, 1);
  baker.graphics.fillCircle(trunk.x, trunk.y - 26, 13);
  baker.graphics.fillStyle(PROP_COLORS.leafLight, 1);
  baker.graphics.fillCircle(trunk.x - 4, trunk.y - 30, 8);

  baker.finish(propTextureKey("tree"), TILE_WIDTH, PROP_HEIGHT);
}

function bakePine(baker: Baker): void {
  propShadow(baker, 0.18);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.trunk, 1);
  baker.graphics.fillRect(base.x - 3, base.y - 12, 5, 12);

  baker.graphics.fillStyle(PROP_COLORS.pine, 1);
  for (const [offset, width] of [
    [10, 14],
    [22, 11],
    [32, 7],
  ] as const) {
    baker.graphics.fillTriangle(
      base.x - width,
      base.y - offset,
      base.x + width,
      base.y - offset,
      base.x,
      base.y - offset - 16,
    );
  }

  baker.finish(propTextureKey("pine"), TILE_WIDTH, PROP_HEIGHT);
}

function bakeBush(baker: Baker): void {
  propShadow(baker, 0.14);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.bush, 1);
  baker.graphics.fillCircle(base.x - 5, base.y - 5, 7);
  baker.graphics.fillCircle(base.x + 5, base.y - 4, 6);
  baker.graphics.fillStyle(shade(PROP_COLORS.bush, 12), 1);
  baker.graphics.fillCircle(base.x, base.y - 9, 7);

  baker.finish(propTextureKey("bush"), TILE_WIDTH, PROP_HEIGHT);
}

function bakeRock(baker: Baker): void {
  propShadow(baker, 0.13);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.rock, 1);
  baker.graphics.fillTriangle(
    base.x - 9,
    base.y,
    base.x + 9,
    base.y,
    base.x - 1,
    base.y - 11,
  );
  baker.graphics.fillStyle(shade(PROP_COLORS.rock, 12), 1);
  baker.graphics.fillTriangle(
    base.x - 1,
    base.y - 11,
    base.x + 9,
    base.y,
    base.x + 3,
    base.y - 6,
  );

  baker.finish(propTextureKey("rock"), TILE_WIDTH, PROP_HEIGHT);
}

function bakeRubble(baker: Baker): void {
  propShadow(baker, 0.22);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(0x8a7c6a, 1);
  baker.graphics.fillTriangle(
    base.x - 13,
    base.y,
    base.x + 5,
    base.y,
    base.x - 5,
    base.y - 11,
  );
  baker.graphics.fillStyle(0x6f6455, 1);
  baker.graphics.fillTriangle(
    base.x - 3,
    base.y,
    base.x + 15,
    base.y,
    base.x + 7,
    base.y - 9,
  );
  baker.graphics.fillStyle(0xa89a86, 1);
  baker.graphics.fillRect(base.x - 9, base.y - 5, 6, 5);

  baker.finish(RUBBLE_KEY, TILE_WIDTH, PROP_HEIGHT);
}

function bakeFountain(baker: Baker): void {
  propShadow(baker, 0.24);
  fillFace(
    baker,
    PROP_COLORS.fountain,
    1,
    diamond(0.26),
    HALF_W,
    PROP_ORIGIN_Y,
  );
  fillFace(
    baker,
    PROP_COLORS.fountainWater,
    1,
    diamond(0.18),
    HALF_W,
    PROP_ORIGIN_Y,
  );
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(PROP_COLORS.fountain, 1);
  baker.graphics.fillRect(base.x - 2, base.y - 14, 4, 14);
  baker.graphics.fillStyle(PROP_COLORS.fountainWater, 0.8);
  baker.graphics.fillCircle(base.x, base.y - 17, 5);

  baker.finish(propTextureKey("fountain"), TILE_WIDTH, PROP_HEIGHT);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function bakeCloud(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.82);
  for (const [x, y, radius] of [
    [40, 32, 22],
    [66, 28, 26],
    [96, 34, 20],
    [122, 32, 16],
  ] as const) {
    baker.graphics.fillCircle(x, y, radius);
  }
  baker.graphics.fillStyle(0xffffff, 0.95);
  baker.graphics.fillCircle(72, 24, 20);
  baker.finish(CLOUD_KEY, 160, 64);
}

function bakeSmoke(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.5);
  baker.graphics.fillCircle(12, 12, 10);
  baker.graphics.fillStyle(0xffffff, 0.85);
  baker.graphics.fillCircle(12, 12, 6);
  baker.finish(SMOKE_KEY, 24, 24);
}

function bakeSparkle(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.75);
  baker.graphics.fillRect(0, 3, 14, 2);
  baker.graphics.fillRect(4, 0, 6, 2);
  baker.finish(SPARKLE_KEY, 16, 8);
}

const CAR_COLORS = [0xe4572e, 0x2e86ab, 0xf6f5ae, 0x4a4e69] as const;

const CAR_TEXTURE_HEIGHT = 44;

function bakeCar(baker: Baker, key: string, index: number): void {
  const color = CAR_COLORS[index] as number;
  // Tile-anchored like every other sprite: origin (0.5, 1) at the tile's
  // bottom corner, so the drawing origin sits TILE_ANCHOR_Y above the bottom.
  const originY = CAR_TEXTURE_HEIGHT - TILE_ANCHOR_Y;
  fillFace(baker, TERRAIN_COLORS.shadow, 0.25, diamond(0.1), HALF_W, originY);
  fillFace(baker, color, 1, [
    [-0.1, -0.06, 7],
    [0.1, -0.06, 7],
    [0.1, 0.06, 7],
    [-0.1, 0.06, 7],
  ], HALF_W, originY);
  fillFace(baker, shade(color, -22), 1, [
    [0.1, -0.06, 7],
    [0.1, 0.06, 7],
    [0.1, 0.06, 0],
    [0.1, -0.06, 0],
  ], HALF_W, originY);
  fillFace(baker, shade(color, -10), 1, [
    [-0.1, 0.06, 7],
    [0.1, 0.06, 7],
    [0.1, 0.06, 0],
    [-0.1, 0.06, 0],
  ], HALF_W, originY);

  baker.finish(key, TILE_WIDTH, CAR_TEXTURE_HEIGHT);
}

const SHIP_HEIGHT = 88;
/** Tile-anchored the same way as every prop: origin (0.5, 1) at the tile's bottom corner. */
const SHIP_ORIGIN_Y = SHIP_HEIGHT - TILE_ANCHOR_Y;

function bakeShip(baker: Baker): void {
  const base = baker.at([0, 0, 0], HALF_W, SHIP_ORIGIN_Y);

  baker.graphics.fillStyle(0xffffff, 0.3);
  baker.graphics.fillEllipse(base.x, base.y + 3, 44, 10);

  baker.graphics.fillStyle(0x8a5a34, 1);
  baker.graphics.fillTriangle(
    base.x - 22,
    base.y - 6,
    base.x + 22,
    base.y - 6,
    base.x + 15,
    base.y + 5,
  );
  baker.graphics.fillTriangle(
    base.x - 22,
    base.y - 6,
    base.x - 15,
    base.y + 5,
    base.x + 15,
    base.y + 5,
  );
  baker.graphics.fillStyle(shade(0x8a5a34, -18), 1);
  baker.graphics.fillRect(base.x - 22, base.y - 10, 44, 5);

  baker.graphics.fillStyle(0x4a3220, 1);
  baker.graphics.fillRect(base.x - 1, base.y - 48, 2, 40);

  baker.graphics.fillStyle(0xf3ead8, 1);
  baker.graphics.fillTriangle(
    base.x,
    base.y - 46,
    base.x,
    base.y - 9,
    base.x + 20,
    base.y - 11,
  );
  baker.graphics.fillStyle(shade(0xf3ead8, -12), 1);
  baker.graphics.fillTriangle(
    base.x,
    base.y - 46,
    base.x,
    base.y - 9,
    base.x - 15,
    base.y - 13,
  );

  baker.graphics.fillStyle(0xd94f4f, 1);
  baker.graphics.fillTriangle(
    base.x,
    base.y - 48,
    base.x,
    base.y - 42,
    base.x + 9,
    base.y - 45,
  );

  baker.finish(SHIP_KEY, TILE_WIDTH, SHIP_HEIGHT);
}

// ---------------------------------------------------------------------------
// Construction site
// ---------------------------------------------------------------------------

const CRANE_COLORS = {
  steel: 0xf2b134,
  steelShade: 0xc08a1e,
  lattice: 0x8a6314,
  cab: 0x3f4b5b,
  weight: 0x6b7280,
  cable: 0x2f3742,
} as const;

/**
 * A tower crane. The jib runs along the grid's -x axis so it reads as part of
 * the isometric scene rather than a flat overlay, reaching out over the plot
 * beside the mast.
 */
function bakeCrane(baker: Baker): void {
  const graphics = baker.graphics;
  const jibY = CRANE_JIB_Y;

  // Ground pad.
  fillFace(baker, TERRAIN_COLORS.shadow, 0.22, diamond(0.3), CRANE_FOOT_X, CRANE_FOOT_Y);
  fillFace(baker, 0xb8b0a0, 1, diamond(0.24), CRANE_FOOT_X, CRANE_FOOT_Y);

  // Mast: two rails with cross bracing between them.
  const mastLeft = CRANE_FOOT_X - 7;
  const mastRight = CRANE_FOOT_X + 7;
  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillRect(mastLeft, jibY, 4, CRANE_FOOT_Y - jibY);
  graphics.fillStyle(CRANE_COLORS.steelShade, 1);
  graphics.fillRect(mastRight - 4, jibY, 4, CRANE_FOOT_Y - jibY);

  graphics.lineStyle(2, CRANE_COLORS.lattice, 0.9);
  for (let y = jibY + 6; y < CRANE_FOOT_Y - 6; y += 16) {
    graphics.lineBetween(mastLeft + 3, y, mastRight - 3, y + 8);
    graphics.lineBetween(mastRight - 3, y, mastLeft + 3, y + 8);
  }

  // Jib and counter-jib follow the iso axis: 2 across for every 1 down.
  const jibReach = CRANE_JIB_REACH;
  const jibRise = jibReach / 2;
  const tailReach = CRANE_TAIL_REACH;

  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillTriangle(
    CRANE_FOOT_X - 6,
    jibY,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise + 7,
  );
  graphics.fillTriangle(
    CRANE_FOOT_X - 6,
    jibY,
    CRANE_FOOT_X - 6,
    jibY + 7,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise + 7,
  );
  // Counter-jib.
  graphics.fillStyle(CRANE_COLORS.steelShade, 1);
  graphics.fillTriangle(
    CRANE_FOOT_X + 6,
    jibY,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2 + 7,
  );
  graphics.fillTriangle(
    CRANE_FOOT_X + 6,
    jibY,
    CRANE_FOOT_X + 6,
    jibY + 7,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2 + 7,
  );

  // Jib bracing.
  graphics.lineStyle(1, CRANE_COLORS.lattice, 0.8);
  for (let step = 12; step < jibReach; step += 16) {
    const x = CRANE_FOOT_X - step;
    const y = jibY - step / 2;
    graphics.lineBetween(x, y + 1, x - 8, y + 3);
  }

  // Trolley, where the cable drops from.
  graphics.fillStyle(CRANE_COLORS.cab, 1);
  graphics.fillRect(
    CRANE_FOOT_X - CRANE_TROLLEY_REACH - 4,
    jibY - CRANE_TROLLEY_REACH / 2,
    10,
    5,
  );

  // Counterweight.
  graphics.fillStyle(CRANE_COLORS.weight, 1);
  graphics.fillRect(
    CRANE_FOOT_X + tailReach - 14,
    jibY + tailReach / 2 - 2,
    18,
    14,
  );

  // Operator cab at the slewing ring.
  graphics.fillStyle(CRANE_COLORS.cab, 1);
  graphics.fillRect(CRANE_FOOT_X - 9, jibY + 6, 16, 13);
  graphics.fillStyle(0x9fd8f5, 0.9);
  graphics.fillRect(CRANE_FOOT_X - 6, jibY + 9, 9, 6);

  // A-frame above the slewing ring, with the pendant lines to each jib tip.
  graphics.lineStyle(2, CRANE_COLORS.steel, 1);
  graphics.lineBetween(CRANE_FOOT_X, jibY, CRANE_FOOT_X, jibY - 26);
  graphics.lineStyle(1, CRANE_COLORS.cable, 0.9);
  graphics.lineBetween(
    CRANE_FOOT_X,
    jibY - 26,
    CRANE_FOOT_X - jibReach + 6,
    jibY - jibRise + 2,
  );
  graphics.lineBetween(
    CRANE_FOOT_X,
    jibY - 26,
    CRANE_FOOT_X + tailReach - 4,
    jibY + tailReach / 2,
  );

  baker.finish(CRANE_KEY, CRANE_WIDTH, CRANE_HEIGHT);
}

/** The load block. Anchored at its top so the cable can hang it. */
function bakeHook(baker: Baker): void {
  const graphics = baker.graphics;
  graphics.fillStyle(CRANE_COLORS.weight, 1);
  graphics.fillRect(3, 0, 12, 7);
  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillRect(6, 7, 6, 5);
  graphics.lineStyle(2, CRANE_COLORS.cable, 1);
  graphics.strokeCircle(9, 16, 4);
  baker.finish(HOOK_KEY, 18, 22);
}

/** One pixel of cable, stretched between the jib and the hook. */
function bakeCable(baker: Baker): void {
  baker.graphics.fillStyle(CRANE_COLORS.cable, 1);
  baker.graphics.fillRect(0, 0, 2, 2);
  baker.finish(CABLE_KEY, 2, 2);
}

/**
 * Scaffold poles standing on the plot's four corners with ledgers between them.
 * Baked at a fixed height and scaled to whatever building it wraps, which
 * stretches the ledger spacing but leaves the poles vertical.
 */
function bakeScaffold(baker: Baker): void {
  const graphics = baker.graphics;
  const originY = SCAFFOLD_HEIGHT - TILE_ANCHOR_Y;
  const half = 0.47;
  const pole = 0xd8b061;
  const corners: Array<[number, number]> = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];

  // Ledgers first so the poles read in front of them.
  graphics.lineStyle(2, pole, 0.85);
  for (let level = 0; level <= 3; level += 1) {
    const height = (level / 3) * (SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 6);
    const ring = corners.map(([u, v]) =>
      baker.at([u, v, height], TILE_WIDTH / 2, originY),
    );
    graphics.strokePoints(ring, true);
  }

  graphics.fillStyle(pole, 1);
  for (const [u, v] of corners) {
    const foot = baker.at([u, v, 0], TILE_WIDTH / 2, originY);
    const head = baker.at(
      [u, v, SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 6],
      TILE_WIDTH / 2,
      originY,
    );
    graphics.fillRect(foot.x - 1, head.y, 3, foot.y - head.y);
  }

  baker.finish(SCAFFOLD_KEY, TILE_WIDTH, SCAFFOLD_HEIGHT);
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

const buildingCache = new Map<string, BakedBuilding>();

export function buildingCacheSize(): number {
  return buildingCache.size;
}

export function clearBuildingCache(): void {
  buildingCache.clear();
}

export function buildingTextureKey(
  archetype: Archetype,
  tier: number,
  language: string,
): string {
  return `bld:${archetype}:${tier}:${language}`;
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
): BakedBuilding {
  const key = buildingTextureKey(archetype, tier, language);
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
      drawHouse(baker, originY, body, palette);
      break;
    case "townhouse":
      drawTownhouse(baker, originY, body, palette);
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

/** Extra height above the body: pitched roofs, setbacks, antennae, tanks. */
function crownHeightFor(archetype: Archetype, tier: number): number {
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

function badgeHeightFor(archetype: Archetype, body: number): number {
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
function drawLanguageBadge(
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

function drawShadow(baker: Baker, originY: number): void {
  // Cast down-right, away from the upper-left sun.
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillPoints(
    diamond(FOOTPRINT + 0.04).map((point) =>
      baker.at([point[0] + 0.08, point[1] + 0.08, 0], HALF_W, originY),
    ),
    true,
  );
}

/**
 * The two visible walls plus the roof slab. Sun sits upper-left, so the wall
 * facing screen-left (grid +v) is lit and the screen-right wall (grid +u) is
 * in shade.
 */
function drawBox(
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

function wallStrip(
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
function drawFacadeDetails(
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

function drawRoofMaterialDetails(
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
function drawWindows(
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

function drawHouse(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
): void {
  const half = FOOTPRINT * 0.82;
  drawBox(baker, originY, half, 0, body, palette, palette.wall);
  drawWindows(baker, originY, half, 0, body, palette, 1, 2);
  drawPitchedRoof(baker, originY, half, body, 20, palette);
}

/** Two sloped planes meeting at a ridge along the u axis, plus the near gable. */
function drawPitchedRoof(
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

function drawTownhouse(
  baker: Baker,
  originY: number,
  body: number,
  palette: BuildingPalette,
): void {
  const half = FOOTPRINT * 0.9;
  drawBox(baker, originY, half, 0, body, palette, palette.roof);
  drawWindows(baker, originY, half, 10, body - 6, palette, 2, 2);

  // Shopfront awning across the lit wall.
  fillFace(
    baker,
    palette.trim,
    1,
    [
      [-half, half, 16],
      [half, half, 16],
      [half, half, 8],
      [-half, half, 8],
    ],
    HALF_W,
    originY,
  );
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

function drawOffice(
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

function drawTower(
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
function utilityStackAnchor(body: number): { x: number; y: number } {
  const u = FOOTPRINT * 0.55;
  const v = FOOTPRINT * -0.05;
  return {
    x: (u - v) * HALF_W,
    y: (u + v) * HALF_H - (body + 30) - TILE_ANCHOR_Y,
  };
}

function drawUtility(
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
