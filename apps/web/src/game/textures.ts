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
export const SCAFFOLD_KEY = "fx:scaffold";
/** Stands in for a building deleted by the PR, at its plot in main. */
export const RUBBLE_KEY = "fx:rubble";
export const CLOUD_KEY = "fx:cloud";
export const SMOKE_KEY = "fx:smoke";
export const SPARKLE_KEY = "fx:sparkle";
export const CAR_KEYS = ["fx:car:0", "fx:car:1", "fx:car:2", "fx:car:3"] as const;

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
  bakeHighlight(baker, SCAFFOLD_KEY, 0xffb454, 0.65);
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
  const shadedWall = shade(palette.wall, -16);

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
  fillFace(baker, roofColor, 1, diamond(half, top), HALF_W, originY);
  strokeFace(
    baker,
    shade(roofColor, -28),
    0.9,
    1,
    diamond(half, top),
    HALF_W,
    originY,
  );
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
        palette.window,
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
        shade(palette.window, -18),
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
    shade(palette.roof, -20),
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
    palette.roof,
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
    shade(palette.wall, -8),
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
    shade(palette.roof, 12),
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
  drawBox(baker, originY, half, 0, body, palette, shade(palette.roof, -10));
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

  drawBox(baker, originY, half, 0, shoulder, palette, shade(palette.roof, -12));
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
  drawBox(baker, originY, half, 0, body * 0.6, palette, shade(palette.roof, -6));

  // Storage tank alongside it.
  const tankBase = body * 0.6;
  const tankTop = body + 18;
  fillFace(
    baker,
    palette.roof,
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
    shade(palette.roof, -20),
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
