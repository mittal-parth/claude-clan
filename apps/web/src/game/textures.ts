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
import { HARBOUR_QUAY_HALF_U, HARBOUR_QUAY_HALF_V } from "./harbour";
import { NAVY_QUAY_HALF_U, NAVY_QUAY_HALF_V } from "./navyHarbour";
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

/** A point on the ground plane, in the same tile units as Point3's u/v. */
type Corner = readonly [number, number];

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

/**
 * Heavier steel scaffolding, wrapped around every building a PR touches so a
 * diff reads as a site under construction rather than only as a tint.
 */
export const DIFF_SCAFFOLD_KEY = "fx:diff-scaffold";
export const DIFF_SCAFFOLD_HEIGHT = 140;
/** Wider than a tile: the cage stands clear of the walls it wraps. */
export const DIFF_SCAFFOLD_WIDTH = TILE_WIDTH + 8;

/** A clickable marketplace building where the mayor can pick an issue to fix. */
export const ISSUE_SHOP_KEY = "fx:issue-shop";
/** Half-footprint of the issue shop, in tiles -- it spans a 2x2 block so it reads as a landmark beside the harbour rather than another house. */
const ISSUE_SHOP_HALF = 1;
/**
 * Screen-space offset from the issue shop's footprint centre (u=v=0) down to
 * its south, nearest-viewer vertex. Double TILE_ANCHOR_Y because the
 * footprint spans two tiles in each direction instead of one.
 */
export const ISSUE_SHOP_ANCHOR_Y = ISSUE_SHOP_HALF * TILE_HEIGHT;

/** Cohesive landmark kit for the southwest repository airport. */
export const AIRPORT_TERMINAL_KEY = "fx:airport-terminal";
export const AIRPORT_TERMINAL_ANCHOR_Y = 58;
export const AIRPORT_TOWER_KEY = "fx:airport-tower";
export const AIRPORT_TOWER_ANCHOR_Y = 16;
export const AIRPORT_APRON_KEY = "fx:airport-apron";
export const AIRPORT_TAXIWAY_VERTICAL_KEY = "fx:airport-taxiway-v";
export const AIRPORT_TAXIWAY_JUNCTION_KEY = "fx:airport-taxiway-junction";
export const AIRPORT_RUNWAY_TILE_KEY = "fx:airport-runway-tile";
export const AIRPORT_RUNWAY_THRESHOLD_KEY = "fx:airport-runway-threshold";
export const AIRPORT_WINDSOCK_KEY = "fx:airport-windsock";

/** Compact commuter aircraft plus a separate shadow for real altitude cues. */
export const AIRPLANE_KEY = "fx:airplane";
export const AIRPLANE_SHADOW_KEY = "fx:airplane-shadow";

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
/**
 * The crane is baked in pieces so it can work rather than just stand there:
 * a static portal, a jib that slews about the mast, and a trolley + spreader
 * that run out along the jib and hoist. The scene drives all four.
 */
export const HARBOUR_CRANE_KEY = "fx:harbour-crane";
export const HARBOUR_CRANE_ANCHOR_Y = 36;
const CRANE_JIB_FRAMES = 7;
/**
 * The jib is baked across its slew for the same reason the ship is baked
 * across her headings: a quarter turn in the world is not a quarter turn on
 * screen, so rotating the sprite would read as a spinning picture rather than
 * an arm swinging round. Frame 0 points seaward over the ship; the last points
 * along the quay, a right angle clockwise, over the waiting container.
 */
export const HARBOUR_CRANE_JIB_KEYS = Array.from(
  { length: CRANE_JIB_FRAMES },
  (_unused, index) => `fx:harbour-crane-jib:${index}`,
);
export const HARBOUR_CRANE_JIB_KEY = HARBOUR_CRANE_JIB_KEYS[0]!;
export const HARBOUR_CRANE_TROLLEY_KEY = "fx:harbour-crane-trolley";
export const HARBOUR_CRANE_SPREADER_KEY = "fx:harbour-crane-spreader";
/** Grid offset from the crane's tile point to the mast it slews about. */
export const HARBOUR_CRANE_SLEW_U = -0.06;
/** Pixels above the crane's tile point where that mast meets the jib. */
export const HARBOUR_CRANE_SLEW_Y = 102;
/**
 * Normalised origin of the jib texture, placed exactly on the slew axis, so
 * setRotation swings the arm about the mast instead of about a corner.
 */
export const HARBOUR_CRANE_JIB_ORIGIN = { x: 0.5, y: 44 / 132 } as const;
/** How far the jib swings to reach the quay: a right angle, clockwise. */
export const HARBOUR_CRANE_SLEW_SWEEP = Math.PI / 2;
/** Where the trolley sits, in tiles out along the jib, for each job. */
export const HARBOUR_CRANE_TROLLEY_REACH = 1.55;
export const HARBOUR_CRANE_TROLLEY_PICK = 1.1;
/** Pixels above the crane's tile point where the trolley rides. */
export const HARBOUR_CRANE_TROLLEY_Y = 95;

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
 * The feeder ship that carries one container between cities, baked on both of
 * the headings she sails: lying along grid -v (alongside the quay) and, after
 * her turn, along grid +u. Two authored hulls rather than one rotated sprite,
 * because rotating an isometric hull reads as a sprite spinning on the spot.
 */
/**
 * Headings around a full circle, not just the outbound quarter: she runs in
 * from the sea on the reciprocal of the course she left on, and turns herself
 * end-for-end in the basin afterwards, so every bearing gets used.
 */
const SHIP_HEADING_FRAMES = 24;
export const HARBOUR_SHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:harbour-ship:${index}`,
);
/** Frame 0 lies alongside the quay, bow up-coast: her ready-to-leave pose. */
export const HARBOUR_SHIP_KEY = HARBOUR_SHIP_KEYS[0]!;
export const HARBOUR_SHIP_ANCHOR_Y = 76;

/** Where the bay is authored, in tiles from the hull's centre. */
const SHIP_BAY_U = 0;
const SHIP_BAY_V = -0.2;
const SHIP_BAY_Z = 26;

/**
 * Screen offset from the ship's tile point to the middle of her cargo bay --
 * where a carried container sits. One per heading frame, because yawing the
 * hull swings the bay around the mast with it.
 */
export const HARBOUR_SHIP_BAY_OFFSETS = HARBOUR_SHIP_KEYS.map((_unused, index) => {
  const angle = shipHeadingAngle(index);
  const u = SHIP_BAY_U * Math.cos(angle) - SHIP_BAY_V * Math.sin(angle);
  const v = SHIP_BAY_U * Math.sin(angle) + SHIP_BAY_V * Math.cos(angle);
  return {
    x: (u - v) * (TILE_WIDTH / 2),
    y: (u + v) * (TILE_HEIGHT / 2) - SHIP_BAY_Z,
  };
});

/** Yaw of a heading frame, as a fraction of a full turn from frame 0. */
function shipHeadingAngle(index: number): number {
  return (index / SHIP_HEADING_FRAMES) * Math.PI * 2;
}

/**
 * A small wooden sailboat, baked across the same 24 headings as the harbour
 * fleet. Purely decorative: it plays no part in PR or issue travel, and just
 * tacks a slow loop through open water around the island for atmosphere.
 */
export const WOODEN_SHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:wooden-ship:${index}`,
);
export const WOODEN_SHIP_KEY = WOODEN_SHIP_KEYS[0]!;
export const WOODEN_SHIP_ANCHOR_Y = 42;
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

export const BATTLESHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:navy-battleship:${index}`,
);
export const BATTLESHIP_KEY = BATTLESHIP_KEYS[0]!;
export const BATTLESHIP_ANCHOR_Y = 76;

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
export const NAVY_MISSILE_KEY = "fx:navy-missile";
export const NAVY_MISSILE_ANCHOR_Y = 30;
export const NAVY_TANK_KEY = "fx:navy-tank";
export const NAVY_TANK_ANCHOR_Y = 26;
export const NAVY_GUN_KEY = "fx:navy-gun";
export const NAVY_GUN_ANCHOR_Y = 28;
export const NAVY_FUEL_TANK_KEY = "fx:navy-fuel-tank";
export const NAVY_FUEL_TANK_ANCHOR_Y = 34;
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
  if (
    scene.textures.exists(TERRAIN_ATLAS_KEY) &&
    scene.textures.exists(NAVY_COMMAND_KEY)
  ) {
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
  WOODEN_SHIP_KEYS.forEach((key, index) => bakeWoodenShip(baker, key, index));
  bakeIssueShop(baker);
  bakeAirportApron(baker);
  bakeAirportTaxiway(baker, AIRPORT_TAXIWAY_VERTICAL_KEY, false);
  bakeAirportTaxiway(baker, AIRPORT_TAXIWAY_JUNCTION_KEY, true);
  bakeAirportRunwayTile(baker);
  bakeAirportRunwayThreshold(baker);
  bakeAirportTerminal(baker);
  bakeAirportTower(baker);
  bakeAirportWindsock(baker);
  bakeAirplane(baker);
  bakeAirplaneShadow(baker);
  bakeHarbourQuay(baker);
  bakeHarbourPier(baker);
  bakeHarbourWarehouse(baker);
  bakeHarbourCrane(baker);
  HARBOUR_CRANE_JIB_KEYS.forEach((key, index) =>
    bakeHarbourCraneJib(baker, key, index),
  );
  bakeHarbourCraneTrolley(baker);
  bakeHarbourCraneSpreader(baker);
  HARBOUR_CONTAINER_KEYS.forEach((key, index) =>
    bakeHarbourContainer(baker, key, index),
  );
  HARBOUR_SHIP_KEYS.forEach((key, index) =>
    bakeHarbourContainerShip(baker, key, index),
  );
  HARBOUR_CONTAINERS_KEYS.forEach((key, index) =>
    bakeHarbourContainers(baker, key, index),
  );
  HARBOUR_CARGO_KEYS.forEach((key, index) => bakeHarbourCargo(baker, key, index));
  bakeHarbourBollard(baker);
  bakeHarbourSign(baker);
  bakeHarbourLighthouse(baker);
  bakeHarbourLamp(baker);
  bakeHarbourMarker(baker);

  BATTLESHIP_KEYS.forEach((key, index) => bakeNavyBattleship(baker, key, index));
  bakeNavyPier(baker);
  bakeNavyCommand(baker);
  bakeNavyHangar(baker);
  bakeNavyBarracks(baker);
  bakeNavyRadar(baker);
  NAVY_RADAR_DISH_KEYS.forEach((key, index) => bakeNavyRadarDish(baker, key, index));
  bakeNavyMissile(baker);
  bakeNavyTank(baker);
  bakeNavyGun(baker);
  bakeNavyFuelTank(baker);
  bakeNavyHelipad(baker);
  bakeNavyHelicopter(baker);
  NAVY_ROTOR_KEYS.forEach((key, index) => bakeNavyRotor(baker, key, index));
  bakeNavyFence(baker);
  bakeNavyFloodlight(baker);
  bakeNavyFlag(baker);
  bakeNavyCrate(baker);
  bakeNavyBollard(baker);
  bakeNavyQuay(baker);
  bakeNavySign(baker);
  bakeCrane(baker);
  bakeHook(baker);
  bakeCable(baker);
  bakeScaffold(baker);
  bakeDiffScaffold(baker);

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

const WOODEN_SHIP_CANVAS = 140;

/**
 * A small single-mast sailboat, authored bow toward -v like every other
 * heading-baked hull, and turned the same way: rotating (u, v) about her
 * centre swings the bow round while z -- so mast and sail height -- is left
 * alone. See bakeHarbourContainerShip for why this is baked per heading
 * rather than done with setRotation.
 */
function bakeWoodenShip(source: Baker, key: string, frame: number): void {
  const width = WOODEN_SHIP_CANVAS;
  const height = WOODEN_SHIP_CANVAS;
  const originX = width / 2;
  const originY = height - WOODEN_SHIP_ANCHOR_Y;
  const deck = 8;

  const angle = shipHeadingAngle(frame);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [
                point[0] * cos - point[1] * sin,
                point[0] * sin + point[1] * cos,
                point[2],
              ],
              ox,
              oy,
            ),
        };

  const hullColor = 0x8a5a34;
  const bootColor = shade(hullColor, -30);
  const sailColor = 0xf3ead8;

  /** A face's outward normal, turned with the hull -- lighting stays fixed to the world. */
  const facing = (nu: number, nv: number, color: number): number => {
    const length = Math.hypot(nu, nv) || 1;
    const u = (nu * cos - nv * sin) / length;
    const v = (nu * sin + nv * cos) / length;
    return shade(color, Math.round(10 * v - 30 * u));
  };

  // Starboard sheer, bow to stern; mirrored below for a closed hull with a
  // small flat transom rather than a pointed stern.
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -0.55],
    [0.12, -0.35],
    [0.15, -0.05],
    [0.15, 0.22],
    [0.1, 0.4],
  ];
  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    ...[...sheer].reverse().map(([u, v]) => [-u, v] as const).slice(0, -1),
  ];

  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(0xffffff, 0.22);
  baker.graphics.fillEllipse(waterline.x + 4, waterline.y + 3, 46, 12);

  // Hull plating: drop every edge of the outline to the waterline, then a
  // darker boot-topping band along the same run.
  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hullColor),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, bootColor),
      1,
      [[u0, v0, 3], [u1, v1, 3], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }

  // Weather deck.
  fillFace(
    baker,
    shade(hullColor, 16),
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Mast: always a straight vertical screen line at any heading, since z
  // never shifts a projected point's x.
  harbourPost(baker, originX, originY, 0, -0.05, deck, deck + 46, 2, 0x4a3220);

  // Sail, one belly to either side of the mast so the silhouette reads at
  // every heading without needing to know which side faces the viewer.
  fillFace(
    baker,
    sailColor,
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [0.22, -0.14, deck + 27]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(sailColor, -14),
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [-0.22, -0.14, deck + 27]],
    originX,
    originY,
  );

  // Pennant at the masthead.
  fillFace(
    baker,
    0xd94f4f,
    1,
    [[0, -0.05, deck + 46], [0, -0.05, deck + 40], [0.09, -0.09, deck + 43]],
    originX,
    originY,
  );

  baker.finish(key, width, height);
}

/**
 * The issue marketplace, a 2x2-tile landmark drawn with the same lit/shaded
 * wall + roof technique as ordinary buildings (see drawBox), just scaled to
 * a bigger footprint and topped with a GitHub mark instead of a language
 * glyph. It isn't part of the archetype/palette pipeline -- like the ship,
 * it's a one-off prop -- so its wall/window drawing is written out here
 * rather than shared with bakeBuilding, which hardcodes a single-tile origin.
 */
function bakeIssueShop(baker: Baker): void {
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

/** Airport palette shared by every surface and structure. */
const AIRPORT = {
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

function drawAirportLabel(
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
function bakeAirportApron(baker: Baker): void {
  const width = 384;
  const height = 192;
  const originX = width / 2;
  const originY = height / 2;
  const halfU = 2.25;
  const halfV = 1.45;
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
  for (const u of [-1.45, -0.65, 0.15, 0.95, 1.75]) {
    const from = baker.at([u, -halfV, 1], originX, originY);
    const to = baker.at([u, halfV, 1], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }
  for (const v of [-0.72, 0.05, 0.82]) {
    const from = baker.at([-halfU, v, 1], originX, originY);
    const to = baker.at([halfU, v, 1], originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }

  // Gate stand lead-in and stop bars.
  baker.graphics.lineStyle(3, AIRPORT.gold, 0.96);
  const lead = [
    baker.at([2.1, 0.62, 2], originX, originY),
    baker.at([0.75, 0.62, 2], originX, originY),
    baker.at([0.15, 0.18, 2], originX, originY),
    baker.at([-0.6, 0.18, 2], originX, originY),
  ];
  baker.graphics.strokePoints(lead, false);
  for (const u of [-0.72, -0.54, -0.36]) {
    const a = baker.at([u, -0.2, 2], originX, originY);
    const b = baker.at([u, 0.52, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Baggage/service lane and pedestrian hatch beside the terminal doors.
  baker.graphics.lineStyle(2, AIRPORT.white, 0.58);
  for (let u = -1.9; u < 0.9; u += 0.42) {
    const a = baker.at([u, -1.12, 2], originX, originY);
    const b = baker.at([u + 0.2, -0.92, 2], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }
  baker.finish(AIRPORT_APRON_KEY, width, height);
}

function bakeAirportTaxiway(baker: Baker, key: string, junction: boolean): void {
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

function drawRunwayBase(baker: Baker, originX: number, originY: number): void {
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

function bakeAirportRunwayTile(baker: Baker): void {
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

function bakeAirportRunwayThreshold(baker: Baker): void {
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

/** Low modern terminal: stone plinth, luminous hall, canopy and solar roof. */
function bakeAirportTerminal(baker: Baker): void {
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

function bakeAirportTower(baker: Baker): void {
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

function bakeAirportWindsock(baker: Baker): void {
  const width = 72;
  const height = 92;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.22);
  baker.graphics.fillEllipse(base.x + 4, base.y + 2, 28, 8);
  baker.graphics.lineStyle(3, AIRPORT.white, 1);
  baker.graphics.lineBetween(base.x, base.y, base.x, base.y - 54);
  baker.graphics.fillStyle(AIRPORT.red, 1);
  baker.graphics.fillTriangle(base.x, base.y - 52, base.x + 35, base.y - 45, base.x, base.y - 37);
  baker.graphics.fillStyle(AIRPORT.white, 1);
  baker.graphics.fillTriangle(base.x + 12, base.y - 49, base.x + 22, base.y - 47, base.x + 12, base.y - 41);
  baker.finish(AIRPORT_WINDSOCK_KEY, width, height);
}

/** Compact twin-prop commuter aircraft, authored nose-first along grid +x. */
function bakeAirplane(baker: Baker): void {
  const width = 128;
  const height = 96;
  const originX = width / 2;
  const originY = height / 2;
  const point = (forward: number, side: number, lift = 0): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(
      originX + forward * 0.89 - side * 0.46,
      originY + forward * 0.46 + side * 0.89 - lift,
    );
  const polygon = (
    color: number,
    points: ReadonlyArray<readonly [number, number]>,
    alpha = 1,
  ): void => {
    baker.graphics.fillStyle(color, alpha);
    baker.graphics.fillPoints(points.map(([forward, side]) => point(forward, side)), true);
  };

  // High wing and tailplane first, then the fuselage gives a clean silhouette.
  polygon(0xc3d6da, [[10, -6], [-5, -10], [-18, -42], [-26, -43], [-16, -7], [-16, 7], [-26, 43], [-18, 42], [-5, 10], [10, 6]]);
  polygon(0x8faeb7, [[-4, -10], [-18, -42], [-26, -43], [-19, -28], [0, -7], [0, 7], [-19, 28], [-26, 43], [-18, 42], [-4, 10]]);
  polygon(0xb8cdd2, [[-28, -5], [-38, -22], [-44, -21], [-40, -4], [-40, 4], [-44, 21], [-38, 22], [-28, 5]]);
  polygon(AIRPORT.white, [[46, 0], [39, -6], [15, -7], [-34, -7], [-43, -3], [-43, 3], [-34, 7], [15, 7], [39, 6]]);
  polygon(0xd4e3e3, [[39, -6], [15, -7], [-34, -7], [-43, -3], [-34, 0], [15, 0]]);

  // Navy belly, gold cheatline and tail livery.
  polygon(0x163b52, [[29, -7], [8, -8], [-31, -7], [-38, -4], [-31, -2], [8, -3], [29, -2]]);
  polygon(AIRPORT.gold, [[18, -8], [8, -8], [-28, -7], [-33, -5], [-28, -4], [8, -5], [18, -5]]);
  polygon(0x173e56, [[-29, -5], [-40, -4], [-44, 0], [-40, 4], [-29, 5], [-23, 0]]);

  // Cockpit and four passenger windows stay legible at the small in-world scale.
  const cockpit = point(38, 0, 1);
  baker.graphics.fillStyle(AIRPORT.glass, 1);
  baker.graphics.fillCircle(cockpit.x, cockpit.y, 4.5);
  for (let forward = 20; forward >= -17; forward -= 10) {
    const window = point(forward, -6.8, 1);
    baker.graphics.fillStyle(AIRPORT.glassLight, 1);
    baker.graphics.fillCircle(window.x, window.y, 1.8);
  }

  // Engine nacelles and translucent propeller discs identify it as a small flight.
  for (const side of [-23, 23]) {
    const engine = point(-2, side, 1);
    baker.graphics.fillStyle(AIRPORT.ink, 1);
    baker.graphics.fillCircle(engine.x, engine.y, 5.5);
    const prop = point(5, side, 1);
    baker.graphics.fillStyle(AIRPORT.glassLight, 0.32);
    baker.graphics.fillCircle(prop.x, prop.y, 8);
    baker.graphics.lineStyle(1, AIRPORT.white, 0.72);
    baker.graphics.lineBetween(prop.x - 7, prop.y, prop.x + 7, prop.y);
    baker.graphics.lineBetween(prop.x, prop.y - 7, prop.x, prop.y + 7);
  }

  const port = point(-19, -43, 2);
  const starboard = point(-19, 43, 2);
  baker.graphics.fillStyle(AIRPORT.red, 1);
  baker.graphics.fillCircle(port.x, port.y, 2.4);
  baker.graphics.fillStyle(AIRPORT.green, 1);
  baker.graphics.fillCircle(starboard.x, starboard.y, 2.4);
  baker.finish(AIRPLANE_KEY, width, height);
}

function bakeAirplaneShadow(baker: Baker): void {
  const width = 104;
  const height = 62;
  const originX = width / 2;
  const originY = height / 2;
  const point = (forward: number, side: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(
      originX + forward * 0.89 - side * 0.46,
      originY + forward * 0.46 + side * 0.89,
    );
  baker.graphics.fillStyle(0x071116, 0.3);
  baker.graphics.fillPoints(
    [[38, 0], [27, -8], [-27, -10], [-38, -4], [-38, 4], [-27, 10], [27, 8]].map(
      ([forward, side]) => point(forward!, side!),
    ),
    true,
  );
  baker.finish(AIRPLANE_SHADOW_KEY, width, height);
}

// ---------------------------------------------------------------------------
// Harbour
// ---------------------------------------------------------------------------

/**
 * Harbour palette. Deliberately warmer and saltier than the airport's cool
 * concrete/glass kit -- weathered stone, tarred timber and painted iron -- but
 * it shares the same amber accent so the two landmarks read as one city.
 */
const HARBOUR = {
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
const HARBOUR_GLYPHS: Record<string, readonly string[]> = {
  P: ["111", "101", "111", "100", "100"],
  O: ["111", "101", "101", "101", "111"],
  R: ["111", "101", "111", "110", "101"],
  T: ["111", "010", "010", "010", "010"],
  N: ["101", "111", "111", "111", "101"],
  A: ["010", "101", "111", "101", "101"],
  V: ["101", "101", "101", "101", "010"],
  Y: ["101", "101", "010", "010", "010"],
};

function drawHarbourLabel(
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
function harbourBox(
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
function harbourPost(
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
function bakeHarbourQuay(baker: Baker): void {
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
function bakeHarbourPier(baker: Baker): void {
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
function bakeHarbourWarehouse(baker: Baker): void {
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

/**
 * Dockside portal crane. Its jib overhangs the water on the grid +u side so
 * the hook hangs where a moored ship's hold would be.
 */
function bakeHarbourCrane(baker: Baker): void {
  const width = 128;
  const height = 168;
  const originX = width / 2;
  const originY = height - HARBOUR_CRANE_ANCHOR_Y;
  const legHalf = 0.45;
  const portal = CRANE_PORTAL_Z;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.22,
    [
      [-legHalf + 0.1, -legHalf + 0.12, 0],
      [legHalf + 0.1, -legHalf + 0.12, 0],
      [legHalf + 0.1, legHalf + 0.12, 0],
      [-legHalf + 0.1, legHalf + 0.12, 0],
    ],
    originX,
    originY,
  );

  // Rail sleepers under the bogies.
  for (const v of [-legHalf, legHalf]) {
    baker.graphics.lineStyle(3, HARBOUR.steelDark, 0.9);
    const a = baker.at([-legHalf - 0.16, v, 1], originX, originY);
    const b = baker.at([legHalf + 0.16, v, 1], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Four legs, back pair first so the front pair overlaps them correctly.
  const legs: ReadonlyArray<readonly [number, number]> = [
    [-legHalf, -legHalf],
    [legHalf, -legHalf],
    [-legHalf, legHalf],
    [legHalf, legHalf],
  ];
  for (const [u, v] of legs) {
    harbourPost(baker, originX, originY, u, v, 0, portal, 6, HARBOUR.amber);
    const foot = baker.at([u, v, 0], originX, originY);
    baker.graphics.fillStyle(HARBOUR.iron, 1);
    baker.graphics.fillRect(foot.x - 5, foot.y - 5, 10, 5);
  }
  // Portal cross-bracing on the two visible faces.
  baker.graphics.lineStyle(2, HARBOUR.amberDark, 0.9);
  for (const [a, b] of [
    [[-legHalf, legHalf, 14], [legHalf, legHalf, portal - 12]],
    [[-legHalf, legHalf, portal - 12], [legHalf, legHalf, 14]],
    [[legHalf, -legHalf, 14], [legHalf, legHalf, portal - 12]],
    [[legHalf, legHalf, 14], [legHalf, -legHalf, portal - 12]],
  ] as const) {
    const from = baker.at(a as Point3, originX, originY);
    const to = baker.at(b as Point3, originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }

  // Machinery deck across the leg tops.
  harbourBox(
    baker,
    originX,
    originY,
    [-legHalf - 0.08, legHalf + 0.08, -legHalf - 0.08, legHalf + 0.08, portal, portal + 10],
    HARBOUR.steel,
  );
  harbourBox(
    baker,
    originX,
    originY,
    [-0.62, -0.06, -0.3, 0.3, portal + 10, portal + 26],
    HARBOUR.navy,
  );
  // Operator's cab, glazed toward the water.
  harbourBox(
    baker,
    originX,
    originY,
    [0.16, 0.5, 0.14, 0.46, portal + 10, portal + 24],
    HARBOUR.white,
  );
  fillFace(
    baker,
    HARBOUR.glass,
    1,
    [[0.16, 0.47, portal + 22], [0.5, 0.47, portal + 22], [0.5, 0.47, portal + 13], [0.16, 0.47, portal + 13]],
    originX,
    originY,
  );

  baker.finish(HARBOUR_CRANE_KEY, width, height);
}

const CRANE_PORTAL_Z = 76;
const CRANE_MAST_TOP = 128;
const CRANE_JIB_Z = 92;
const CRANE_JIB_TIP = 2.0;
const CRANE_COUNTER_TIP = -0.95;

/**
 * The slewing half of the crane: mast, jib, counter-jib and counterweight.
 * Baked so the slew axis -- the mast head where the jib pivots -- lands on
 * HARBOUR_CRANE_JIB_ORIGIN, which lets the scene swing the whole arm with
 * setRotation.
 */
function bakeHarbourCraneJib(source: Baker, key: string, frame: number): void {
  const width = 216;
  const height = 132;
  const portal = CRANE_PORTAL_Z;
  const jibZ = CRANE_JIB_Z;
  const jibTip = CRANE_JIB_TIP;
  const counterTip = CRANE_COUNTER_TIP;
  const mastTop = CRANE_MAST_TOP;
  // Chosen so at([SLEW_U, 0, SLEW_Y]) lands exactly on the sprite origin.
  const originX = width * HARBOUR_CRANE_JIB_ORIGIN.x - HARBOUR_CRANE_SLEW_U * HALF_W;
  const originY =
    height * HARBOUR_CRANE_JIB_ORIGIN.y - HARBOUR_CRANE_SLEW_U * HALF_H + HARBOUR_CRANE_SLEW_Y;

  /**
   * Slew is a yaw about the mast, so the arm is drawn through a rotation of
   * (u, v) around that pivot -- the point the sprite is anchored on, which is
   * therefore the one point the rotation leaves alone.
   */
  const angle = (frame / (CRANE_JIB_FRAMES - 1)) * HARBOUR_CRANE_SLEW_SWEEP;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) => {
            const du = point[0] - HARBOUR_CRANE_SLEW_U;
            const dv = point[1];
            return source.at(
              [
                HARBOUR_CRANE_SLEW_U + du * cos - dv * sin,
                du * sin + dv * cos,
                point[2],
              ],
              ox,
              oy,
            );
          },
        };

  harbourPost(baker, originX, originY, -0.06, 0, portal + 26, mastTop, 5, HARBOUR.steel);
  const jibLine = (from: Point3, to: Point3, thickness: number, color: number): void => {
    const a = baker.at(from, originX, originY);
    const b = baker.at(to, originX, originY);
    baker.graphics.lineStyle(thickness, color, 1);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  };
  jibLine([-0.06, 0, jibZ], [jibTip, 0, jibZ + 8], 6, HARBOUR.amber);
  jibLine([-0.06, 0, jibZ - 7], [jibTip, 0, jibZ + 3], 3, HARBOUR.amberDark);
  jibLine([-0.06, 0, jibZ], [counterTip, 0, jibZ - 4], 6, HARBOUR.amber);
  // Lattice web between the jib chords.
  baker.graphics.lineStyle(1, HARBOUR.amberDark, 0.85);
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const u = -0.06 + (jibTip + 0.06) * t;
    const upper = baker.at([u, 0, jibZ + 8 * t], originX, originY);
    const lower = baker.at([u, 0, jibZ - 7 + 10 * t], originX, originY);
    baker.graphics.lineBetween(upper.x, upper.y, lower.x, lower.y);
  }
  // Tie bars from the mast head.
  jibLine([-0.06, 0, mastTop], [jibTip - 0.12, 0, jibZ + 7], 2, HARBOUR.steelDark);
  jibLine([-0.06, 0, mastTop], [counterTip + 0.06, 0, jibZ - 3], 2, HARBOUR.steelDark);

  harbourBox(
    baker,
    originX,
    originY,
    [counterTip, counterTip + 0.34, -0.2, 0.2, jibZ - 22, jibZ - 5],
    HARBOUR.iron,
  );

  // Obstruction light on the mast head.
  const beaconPoint = baker.at([-0.06, 0, mastTop], originX, originY);
  baker.graphics.fillStyle(HARBOUR.red, 1);
  baker.graphics.fillCircle(beaconPoint.x, beaconPoint.y - 2, 3);

  baker.finish(key, width, height);
}

/** The trolley block that runs out along the jib. */
function bakeHarbourCraneTrolley(baker: Baker): void {
  const width = 40;
  const height = 28;
  const originX = width / 2;
  const originY = height / 2 + 4;
  harbourBox(baker, originX, originY, [-0.16, 0.16, -0.12, 0.12, 0, 9], HARBOUR.steelDark);
  const sheave = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(sheave.x - 6, sheave.y, 12, 3);
  baker.finish(HARBOUR_CRANE_TROLLEY_KEY, width, height);
}

/**
 * The spreader: the lifting beam that clamps a container's top castings. Its
 * origin is the middle of the beam, so the scene can hang it under the trolley
 * and set a container's position from the same point.
 */
function bakeHarbourCraneSpreader(baker: Baker): void {
  const width = 72;
  const height = 40;
  const originX = width / 2;
  const originY = height / 2;
  const beam = baker.at([0, 0, 0], originX, originY);

  // Headblock above the beam, where the cables land.
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(beam.x - 7, beam.y - 12, 14, 6);
  // The beam itself, drawn along the container's long axis.
  harbourBox(baker, originX, originY, [-0.3, 0.3, -0.06, 0.06, -4, 1], HARBOUR.amber);
  // Twistlock legs at each end, which drop over the container corners.
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  for (const offset of [-27, 27]) {
    baker.graphics.fillRect(beam.x + offset - 2, beam.y - 2, 4, 9);
  }
  baker.finish(HARBOUR_CRANE_SPREADER_KEY, width, height);
}

/** One container, for the crane to carry and the ship to hold. */
function bakeHarbourContainer(baker: Baker, key: string, variantIndex: number): void {
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
const HARBOUR_CONTAINER_VARIANTS: ReadonlyArray<readonly [number, number, number]> = [
  [0xc75434, 0x2fa39a, 0x13303e],
  [0x13303e, 0xf6bd60, 0xc75434],
  [0x2fa39a, 0x8e99a4, 0xe4574e],
  [0xf6bd60, 0x2f5d70, 0x4f7a5a],
  [0xe4574e, 0xb9782f, 0x8e99a4],
  [0x4f7a5a, 0x13303e, 0xd7dee2],
];

/** A stack of shipping containers waiting on the wharf. */
function bakeHarbourContainers(baker: Baker, key: string, variantIndex: number): void {
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
const HARBOUR_CARGO_VARIANTS: ReadonlyArray<{
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
function bakeHarbourCargo(baker: Baker, key: string, variantIndex: number): void {
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

/**
 * The feeder ship: a small single-bay container vessel, authored lying along
 * grid v so it berths parallel to the quay wall, bow toward -v.
 *
 * The hull is drawn as one wrapped polygon rather than a box, which is what
 * gives it a real sheer line, a fined bow and a rounded transom instead of the
 * shoebox a harbourBox would produce.
 */
function bakeHarbourContainerShip(source: Baker, key: string, frame: number): void {
  // Square and shared by every heading: as the hull yaws from lying across the
  // view to pointing along it, it trades width for height, so one canvas sized
  // to the widest sweep keeps a single anchor valid for all of them.
  const width = 256;
  const height = 256;
  const originX = width / 2;
  const originY = height - HARBOUR_SHIP_ANCHOR_Y;
  const deck = 22;

  /**
   * Each heading is the same drawing read through a yaw of the grid: rotating
   * (u, v) about the hull's centre swings her bow from -v round to +u, while
   * leaving z -- and so the whole superstructure's height -- untouched.
   * Wrapping `at` turns every polygon, box, post and rail the drawing puts
   * down, so nothing below has to know which way she is heading.
   */
  const angle = shipHeadingAngle(frame);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [
                point[0] * cos - point[1] * sin,
                point[0] * sin + point[1] * cos,
                point[2],
              ],
              ox,
              oy,
            ),
        };

  const hull = {
    navy: 0x1c4a63,
    navyDark: 0x123448,
    boot: 0x8e3b3b,
    deck: 0x6c7a84,
    deckDark: 0x4c565e,
  };

  /**
   * Starboard sheer line, bow to stern. The hull side is this run of points
   * at deck height, returned along the same run at the waterline.
   */
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -1.7],
    [0.2, -1.36],
    [0.34, -0.92],
    [0.38, -0.2],
    [0.38, 1.16],
    [0.2, 1.42],
  ];

  /**
   * The full deck outline: down the starboard sheer, round the transom, and
   * back up the mirrored port side. Every heading is baked, so both sides come
   * into view at some point in her turn -- there is no such thing as a face
   * that is always hidden, and the hull is plated all the way round.
   */
  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    // Drop the last mirrored point: it is the stem again, and would close the
    // loop with a zero-length edge.
    ...[...sheer]
      .reverse()
      .map(([u, v]) => [-u, v] as const)
      .slice(0, -1),
  ];

  /** A face's outward normal, turned with the hull. */
  const turned = (nu: number, nv: number): { u: number; v: number } => {
    const length = Math.hypot(nu, nv) || 1;
    return {
      u: (nu * cos - nv * sin) / length,
      v: (nu * sin + nv * cos) / length,
    };
  };
  /**
   * Lighting is fixed to the world, not to the hull: the sun stays upper-left
   * while she turns under it, so a plate is lit by where it ends up pointing.
   */
  const facing = (nu: number, nv: number, color: number): number => {
    const normal = turned(nu, nv);
    return shade(color, Math.round(9 * normal.v - 28 * normal.u));
  };
  /** Whether a face has come round to the viewer's side at this heading. */
  const showsFace = (nu: number, nv: number): boolean => {
    const normal = turned(nu, nv);
    return normal.u + normal.v > 0.02;
  };

  /** A closed box plated on all four sides, painted for its heading. */
  const solidBox = (
    bounds: readonly [number, number, number, number, number, number],
    color: number,
  ): void => {
    const [u0, u1, v0, v1, z0, z1] = bounds;
    const sides: ReadonlyArray<{
      normal: readonly [number, number];
      face: Point3[];
    }> = [
      { normal: [0, 1], face: [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]] },
      { normal: [1, 0], face: [[u1, v1, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0]] },
      { normal: [0, -1], face: [[u0, v0, z1], [u1, v0, z1], [u1, v0, z0], [u0, v0, z0]] },
      { normal: [-1, 0], face: [[u0, v1, z1], [u0, v0, z1], [u0, v0, z0], [u0, v1, z0]] },
    ];
    // Furthest face first, so whichever plate has come round to the front is
    // the one left showing.
    const ordered = [...sides].sort((left, right) => {
      const a = turned(left.normal[0], left.normal[1]);
      const b = turned(right.normal[0], right.normal[1]);
      return a.u + a.v - (b.u + b.v);
    });
    for (const side of ordered) {
      fillFace(baker, facing(side.normal[0], side.normal[1], color), 1, side.face, originX, originY);
    }
    fillFace(
      baker,
      shade(color, 14),
      1,
      [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]],
      originX,
      originY,
    );
  };

  // Wake and shadow on the water.
  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillEllipse(waterline.x + 6, waterline.y + 6, 150, 46);

  // Hull plating: drop every edge of the outline to the waterline, then band
  // the boot topping along the same run. Plates on her far side land inside
  // the silhouette and are covered by the weather deck drawn over them.
  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hull.navy),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, hull.boot),
      1,
      [[u0, v0, 5], [u1, v1, 5], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }
  // Sheer stripe picks the hull's curve out against the water.
  baker.graphics.lineStyle(1.5, shade(hull.navy, 26), 0.7);
  baker.graphics.strokePoints(
    outline.map(([u, v]) => baker.at([u, v, deck - 3], originX, originY)),
    true,
  );

  // Weather deck.
  fillFace(
    baker,
    hull.deck,
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Cargo bay: raised coaming with a dark cell and yellow guide angles. This
  // is the slot a carried container drops into.
  solidBox([-0.32, 0.32, -0.78, 0.38, deck, deck + 5], hull.deckDark);
  fillFace(
    baker,
    0x121c22,
    1,
    [
      [-0.27, -0.73, deck + 4],
      [0.27, -0.73, deck + 4],
      [0.27, 0.33, deck + 4],
      [-0.27, 0.33, deck + 4],
    ],
    originX,
    originY,
  );
  baker.graphics.lineStyle(2, HARBOUR.amber, 0.85);
  for (const v of [-0.73, 0.33]) {
    const a = baker.at([-0.27, v, deck + 5], originX, originY);
    const b = baker.at([0.27, v, deck + 5], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Forecastle break, windlass and anchor pocket.
  solidBox([-0.2, 0.2, -1.5, -1.02, deck, deck + 6], hull.deck);
  const windlass = baker.at([0, -1.24, deck + 6], originX, originY);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(windlass.x - 6, windlass.y - 5, 12, 5);
  if (showsFace(1, 0)) {
    const anchor = baker.at([0.36, -1.02, deck - 8], originX, originY);
    baker.graphics.fillStyle(hull.navyDark, 1);
    baker.graphics.fillEllipse(anchor.x, anchor.y, 8, 6);
  }

  // Foremast with a crosstree and a masthead light.
  harbourPost(baker, originX, originY, 0, -0.95, deck + 4, deck + 46, 3, HARBOUR.steel);
  const crosstree = baker.at([0, -0.95, deck + 36], originX, originY);
  baker.graphics.lineStyle(2, HARBOUR.steelDark, 1);
  baker.graphics.lineBetween(crosstree.x - 9, crosstree.y, crosstree.x + 9, crosstree.y);
  const mastLight = baker.at([0, -0.95, deck + 46], originX, originY);
  baker.graphics.fillStyle(HARBOUR.white, 1);
  baker.graphics.fillCircle(mastLight.x, mastLight.y - 2, 2.4);

  // Accommodation block aft: three tiers stepped back, wheelhouse on top with
  // wrap-around glazing and bridge wings.
  solidBox([-0.3, 0.3, 0.56, 1.12, deck, deck + 30], HARBOUR.white);
  solidBox([-0.26, 0.26, 0.62, 1.06, deck + 30, deck + 44], HARBOUR.white);
  // Window bands and glazing sit on her after face; skip them when she has
  // turned it away, or they would be painted over the near side instead.
  if (showsFace(0, 1)) {
    for (const z of [deck + 9, deck + 20]) {
      fillFace(
        baker,
        HARBOUR.glassDark,
        1,
        [[-0.28, 1.13, z + 5], [0.28, 1.13, z + 5], [0.28, 1.13, z], [-0.28, 1.13, z]],
        originX,
        originY,
      );
    }
  }
  // Wheelhouse.
  solidBox([-0.3, 0.3, 0.66, 1.0, deck + 44, deck + 58], HARBOUR.white);
  if (showsFace(0, 1)) {
    fillFace(
      baker,
      HARBOUR.glass,
      1,
      [
        [-0.3, 1.01, deck + 56],
        [0.3, 1.01, deck + 56],
        [0.3, 1.01, deck + 47],
        [-0.3, 1.01, deck + 47],
      ],
      originX,
      originY,
    );
    baker.graphics.lineStyle(1, HARBOUR.navy, 0.55);
    for (const u of [-0.15, 0, 0.15]) {
      const a = baker.at([u, 1.02, deck + 56], originX, originY);
      const b = baker.at([u, 1.02, deck + 47], originX, originY);
      baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
  }
  // Bridge wings overhanging both sides.
  fillFace(
    baker,
    HARBOUR.white,
    1,
    [
      [-0.42, 0.96, deck + 46],
      [0.42, 0.96, deck + 46],
      [0.42, 0.86, deck + 46],
      [-0.42, 0.86, deck + 46],
    ],
    originX,
    originY,
  );

  // Funnel: navy with the harbour's amber band and a black cap.
  solidBox([-0.14, 0.14, 0.74, 0.96, deck + 58, deck + 76], HARBOUR.navy);
  if (showsFace(0, 1)) {
    fillFace(
      baker,
      HARBOUR.amber,
      1,
      [
        [-0.14, 0.97, deck + 71],
        [0.14, 0.97, deck + 71],
        [0.14, 0.97, deck + 64],
        [-0.14, 0.97, deck + 64],
      ],
      originX,
      originY,
    );
  }
  fillFace(baker, HARBOUR.iron, 1, [
    [-0.16, 0.72, deck + 77],
    [0.16, 0.72, deck + 77],
    [0.16, 0.98, deck + 77],
    [-0.16, 0.98, deck + 77],
  ], originX, originY);

  // Guard rails down the open deck, and the running lights.
  baker.graphics.lineStyle(1, HARBOUR.steel, 0.7);
  const railTop = outline.map(([u, v]) => baker.at([u, v, deck + 9], originX, originY));
  baker.graphics.strokePoints(railTop, true);
  for (const [u, v] of outline) {
    const post = baker.at([u, v, deck], originX, originY);
    const head = baker.at([u, v, deck + 9], originX, originY);
    baker.graphics.lineBetween(post.x, post.y, head.x, head.y);
  }
  if (showsFace(1, 0)) {
    const starboardLight = baker.at([0.34, 0.7, deck + 46], originX, originY);
    baker.graphics.fillStyle(0x6ee7b7, 1);
    baker.graphics.fillCircle(starboardLight.x, starboardLight.y, 2.2);
  }

  // Bow wave.
  baker.graphics.fillStyle(HARBOUR.foam, 0.7);
  const bow = baker.at([0, -1.7, 0], originX, originY);
  baker.graphics.fillEllipse(bow.x, bow.y + 1, 26, 9);

  baker.finish(key, width, height);
}

/** Cast-iron mooring bollard with a rope eye dropped over it. */
function bakeHarbourBollard(baker: Baker): void {
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
function bakeHarbourSign(baker: Baker): void {
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
function bakeHarbourLighthouse(baker: Baker): void {
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
function bakeHarbourLamp(baker: Baker): void {
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
function bakeHarbourMarker(baker: Baker): void {
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

/**
 * GitHub's mark, stamped on a plaque above the roofline the same way
 * drawLanguageBadge stamps a language glyph -- flat pixel art in screen
 * space so it stays crisp and legible at the isometric skew.
 */
const GITHUB_MARK: readonly string[] = [
  "..1...1..",
  ".11.1.11.",
  "111111111",
  "111111111",
  "11.111.11",
  "111111111",
  ".1111111.",
  "..11111..",
];

function drawGithubBadge(
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

/**
 * The diff scaffold: the tube-and-clamp cage that goes up around a building
 * under construction. Standards on the plot corners and at the middle of each
 * bay, a ledger and toe board at every lift, cross-bracing between lifts and
 * a sheet of netting behind it all.
 *
 * Only the two faces that point at the camera are drawn -- the back two are
 * behind the building and would only show through it as noise.
 *
 * Baked in near-white steel so the scene can tint one texture per change kind;
 * the tint multiplies, so anything already coloured here would drag the result
 * off-hue.
 */
function bakeDiffScaffold(baker: Baker): void {
  const graphics = baker.graphics;
  const originY = DIFF_SCAFFOLD_HEIGHT - TILE_ANCHOR_Y;
  const steel = 0xdfe7ee;
  const shade = 0x9fadbb;
  const lifts = 4;
  /** Standards per face: corners plus one in the middle. */
  const bays = 2;
  /** Leaves room for the standards to stand proud of the top lift. */
  const top = DIFF_SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 10;
  const overshoot = 6;

  // Half a tile out from the centre, so the cage clears the walls it wraps.
  const half = 0.5;
  const east: Corner = [half, -half];
  const south: Corner = [half, half];
  const west: Corner = [-half, half];
  const faces: Array<[Corner, Corner]> = [
    [west, south],
    [south, east],
  ];

  const at = (corner: Corner, height: number): Phaser.Math.Vector2 =>
    baker.at(
      [corner[0], corner[1], height],
      DIFF_SCAFFOLD_WIDTH / 2,
      originY,
    );
  const along = (a: Corner, b: Corner, t: number): Corner => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const liftHeight = (lift: number): number => (lift / lifts) * top;

  // Netting behind the frame.
  graphics.fillStyle(shade, 0.14);
  for (const [a, b] of faces) {
    graphics.fillPoints(
      [at(a, 0), at(b, 0), at(b, top), at(a, top)],
      true,
    );
  }

  // Cross-bracing, one diagonal per bay per lift, alternating direction the
  // way real bracing zig-zags up a face.
  graphics.lineStyle(1, steel, 0.45);
  for (const [a, b] of faces) {
    for (let lift = 0; lift < lifts; lift += 1) {
      for (let bay = 0; bay < bays; bay += 1) {
        const left = along(a, b, bay / bays);
        const right = along(a, b, (bay + 1) / bays);
        const rising = (lift + bay) % 2 === 0;
        const foot = at(rising ? left : right, liftHeight(lift));
        const head = at(rising ? right : left, liftHeight(lift + 1));
        graphics.lineBetween(foot.x, foot.y, head.x, head.y);
      }
    }
  }

  // Ledgers, each with a toe board hanging under it.
  for (const [a, b] of faces) {
    for (let lift = 0; lift <= lifts; lift += 1) {
      const height = liftHeight(lift);
      const from = at(a, height);
      const to = at(b, height);
      graphics.fillStyle(shade, 0.5);
      graphics.fillPoints(
        [
          from,
          to,
          new Phaser.Math.Vector2(to.x, to.y + 3),
          new Phaser.Math.Vector2(from.x, from.y + 3),
        ],
        true,
      );
      graphics.lineStyle(2, steel, 0.9);
      graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  // Standards last, so they read in front of everything they carry.
  for (const [a, b] of faces) {
    for (let post = 0; post <= bays; post += 1) {
      const corner = along(a, b, post / bays);
      const width = post === 0 || post === bays ? 3 : 2;
      const foot = at(corner, 0);
      const head = at(corner, top + overshoot);
      graphics.fillStyle(shade, 1);
      graphics.fillRect(foot.x - width / 2, head.y, width, foot.y - head.y);
      graphics.fillStyle(steel, 1);
      graphics.fillRect(
        foot.x - width / 2,
        head.y,
        Math.max(1, width - 1),
        foot.y - head.y,
      );
    }
  }

  baker.finish(DIFF_SCAFFOLD_KEY, DIFF_SCAFFOLD_WIDTH, DIFF_SCAFFOLD_HEIGHT);
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


// ---------------------------------------------------------------------------
// Navy Harbour & Battleship
// ---------------------------------------------------------------------------

function bakeNavyBattleship(source: Baker, key: string, frame: number): void {
  const width = 256;
  const height = 256;
  const originX = width / 2;
  const originY = height - BATTLESHIP_ANCHOR_Y;
  const deck = 22;

  const angle = shipHeadingAngle(frame);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [
                point[0] * cos - point[1] * sin,
                point[0] * sin + point[1] * cos,
                point[2],
              ],
              ox,
              oy,
            ),
        };

  const hull = {
    navy: 0x2b333a,
    navyDark: 0x1f262b,
    boot: 0x992222,
    deck: 0x47515a,
    deckDark: 0x363e45,
  };

  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -2.2],
    [0.15, -1.8],
    [0.3, -1.0],
    [0.35, -0.2],
    [0.35, 1.4],
    [0.2, 1.8],
    [0, 1.8],
  ];

  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    ...[...sheer]
      .reverse()
      .map(([u, v]) => [-u, v] as const)
      .slice(1, -1),
  ];

  const turned = (nu: number, nv: number): { u: number; v: number } => {
    const length = Math.hypot(nu, nv) || 1;
    return {
      u: (nu * cos - nv * sin) / length,
      v: (nu * sin + nv * cos) / length,
    };
  };

  const facing = (nu: number, nv: number, color: number): number => {
    const normal = turned(nu, nv);
    return shade(color, Math.round(9 * normal.v - 28 * normal.u));
  };
  const showsFace = (nu: number, nv: number): boolean => {
    const normal = turned(nu, nv);
    return normal.u + normal.v > 0.02;
  };

  const solidBox = (
    bounds: readonly [number, number, number, number, number, number],
    color: number,
  ): void => {
    const [u0, u1, v0, v1, z0, z1] = bounds;
    const sides: ReadonlyArray<{
      normal: readonly [number, number];
      face: Point3[];
    }> = [
      { normal: [0, 1], face: [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]] },
      { normal: [1, 0], face: [[u1, v1, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0]] },
      { normal: [0, -1], face: [[u0, v0, z1], [u1, v0, z1], [u1, v0, z0], [u0, v0, z0]] },
      { normal: [-1, 0], face: [[u0, v1, z1], [u0, v0, z1], [u0, v0, z0], [u0, v1, z0]] },
    ];
    const ordered = [...sides].sort((left, right) => {
      const a = turned(left.normal[0], left.normal[1]);
      const b = turned(right.normal[0], right.normal[1]);
      return a.u + a.v - (b.u + b.v);
    });
    for (const side of ordered) {
      fillFace(baker, facing(side.normal[0], side.normal[1], color), 1, side.face, originX, originY);
    }
    fillFace(
      baker,
      shade(color, 14),
      1,
      [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]],
      originX,
      originY,
    );
  };

  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillEllipse(waterline.x + 6, waterline.y + 6, 170, 50);

  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hull.navy),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, hull.boot),
      1,
      [[u0, v0, 5], [u1, v1, 5], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }

  fillFace(
    baker,
    hull.deck,
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Superstructure
  solidBox([-0.25, 0.25, -0.6, 0.8, deck, deck + 12], hull.deckDark);
  solidBox([-0.2, 0.2, -0.4, 0.6, deck + 12, deck + 24], hull.deckDark);
  solidBox([-0.15, 0.15, -0.2, 0.4, deck + 24, deck + 36], hull.deckDark);

  // Bridge windows
  if (showsFace(0, -1)) {
    fillFace(
      baker,
      HARBOUR.glassDark,
      1,
      [[-0.12, -0.41, deck + 20], [0.12, -0.41, deck + 20], [0.12, -0.41, deck + 15], [-0.12, -0.41, deck + 15]],
      originX,
      originY,
    );
  }

  // Turrets (Main Guns)
  const drawTurret = (tu: number, tv: number, tz: number) => {
    solidBox([tu - 0.1, tu + 0.1, tv - 0.1, tv + 0.1, tz, tz + 6], hull.deck);
    solidBox([tu - 0.02, tu + 0.02, tv - 0.3, tv - 0.1, tz + 2, tz + 4], 0x111111);
  };
  drawTurret(0, -1.2, deck);
  drawTurret(0, -0.8, deck);
  drawTurret(0, 1.1, deck);

  // Radar/Mast
  solidBox([-0.05, 0.05, 0, 0.1, deck + 36, deck + 60], hull.navyDark);
  // Helipad
  fillFace(
    baker,
    0x333333,
    1,
    [[-0.2, 1.3, deck + 1], [0.2, 1.3, deck + 1], [0.2, 1.7, deck + 1], [-0.2, 1.7, deck + 1]],
    originX,
    originY,
  );
  // 'H'
  baker.graphics.lineStyle(2, HARBOUR.white, 0.8);
  const hPoints = [
    [[-0.05, 1.4, deck + 1], [-0.05, 1.6, deck + 1]],
    [[0.05, 1.4, deck + 1], [0.05, 1.6, deck + 1]],
    [[-0.05, 1.5, deck + 1], [0.05, 1.5, deck + 1]],
  ];
  for (const pair of hPoints) {
    const [u1, v1, z1] = pair[0] as [number, number, number];
    const [u2, v2, z2] = pair[1] as [number, number, number];
    const p1 = baker.at([u1, v1, z1], originX, originY);
    const p2 = baker.at([u2, v2, z2], originX, originY);
    baker.graphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
  }

  baker.finish(key, width, height);
}

/**
 * The naval base kit.
 *
 * Cooler and harder than the cargo harbour next door — grey concrete, olive
 * steel and glass instead of warm stone and timber — but it keeps the same
 * amber accent, which is what makes the two installations read as one port.
 */
const NAVY_BASE = {
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

function navyShadow(
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
function navyRing(radius: number, z: number, segments = 20): Point3[] {
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
function navyCylinder(
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

function navyWindow(
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

function navyScreenLine(
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
function navyDeckLine(
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

function bakeNavyPier(baker: Baker): void {
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
function bakeNavyCommand(baker: Baker): void {
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
function bakeNavyHangar(baker: Baker): void {
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
function bakeNavyBarracks(baker: Baker): void {
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
function bakeNavyRadar(baker: Baker): void {
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
function bakeNavyRadarDish(source: Baker, key: string, frame: number): void {
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

/** A tracked launcher on the quayside lip, tubes elevated out over the water. */
function bakeNavyMissile(baker: Baker): void {
  const width = 128;
  const height = 104;
  const originX = width / 2;
  const originY = height - NAVY_MISSILE_ANCHOR_Y;
  const half = 0.5;

  navyShadow(baker, originX, originY, half + 0.08, half * 0.8);

  // Hardstanding with a painted turning circle.
  fillFace(baker, NAVY_BASE.concreteDark, 1, navyRing(half + 0.02, 2), originX, originY);
  strokeFace(baker, NAVY_BASE.warning, 0.7, 2, navyRing(half - 0.08, 3), originX, originY);

  // Chassis: road wheels, hull, and outriggers planted for firing.
  for (const v of [-0.26, 0.26]) {
    for (const u of [-0.3, -0.1, 0.1, 0.3]) {
      fillFace(
        baker,
        NAVY_BASE.black,
        1,
        [[u - 0.07, v, 3], [u, v - 0.05, 3], [u + 0.07, v, 3], [u, v + 0.05, 3]],
        originX,
        originY,
      );
    }
  }
  harbourBox(baker, originX, originY, [-0.38, 0.38, -0.28, 0.28, 6, 18], NAVY_BASE.oliveDark);
  fillFace(baker, NAVY_BASE.olive, 1, [[-0.38, -0.28, 18], [0.38, -0.28, 18], [0.38, 0.28, 18], [-0.38, 0.28, 18]], originX, originY);
  for (const [u, v] of [[-0.42, 0.32], [0.42, 0.32], [-0.42, -0.32], [0.42, -0.32]] as const) {
    navyScreenLine(baker, originX, originY, [u * 0.85, v * 0.85, 10], [u, v, 1], 3, NAVY_BASE.steelDark, 1);
  }
  // Cab at the inland end.
  harbourBox(baker, originX, originY, [-0.36, -0.14, -0.22, 0.22, 18, 30], NAVY_BASE.olive);
  fillFace(
    baker,
    NAVY_BASE.glassDark,
    1,
    [[-0.36, 0.23, 28], [-0.16, 0.23, 28], [-0.16, 0.23, 21], [-0.36, 0.23, 21]],
    originX,
    originY,
  );

  // Elevated launcher: a four-tube block hinged up toward the sea (+u).
  const hinge: Point3 = [-0.06, 0, 20];
  const muzzle: Point3 = [0.46, 0, 54];
  navyScreenLine(baker, originX, originY, hinge, [0.02, 0, 30], 4, NAVY_BASE.steelDark, 1);
  for (const v of [-0.15, 0.15]) {
    for (const lift of [0, 9]) {
      const from: Point3 = [hinge[0], v, hinge[2] + lift];
      const to: Point3 = [muzzle[0], v, muzzle[2] + lift];
      navyScreenLine(baker, originX, originY, from, to, 9, NAVY_BASE.black, 1);
      navyScreenLine(baker, originX, originY, from, to, 6, NAVY_BASE.oliveDark, 1);
      navyScreenLine(baker, originX, originY, [from[0], from[1], from[2] + 1], [to[0], to[1], to[2] + 1], 2, NAVY_BASE.oliveLight, 0.8);
      const mouth = baker.at(to, originX, originY);
      baker.graphics.fillStyle(NAVY_BASE.black, 1);
      baker.graphics.fillCircle(mouth.x, mouth.y, 4);
      baker.graphics.fillStyle(NAVY_BASE.red, 1);
      baker.graphics.fillCircle(mouth.x, mouth.y, 2);
    }
  }
  // Cradle band and hazard stencil on the tube pack.
  navyScreenLine(baker, originX, originY, [0.16, -0.2, 32], [0.16, 0.2, 32], 3, NAVY_BASE.warning, 0.9);
  navyScreenLine(baker, originX, originY, [-0.4, 0.3, 8], [0.4, 0.3, 8], 2, NAVY_BASE.warning, 0.85);
  baker.finish(NAVY_MISSILE_KEY, width, height);
}

function bakeNavyTank(baker: Baker): void {
  const width = 112;
  const height = 82;
  const originX = width / 2;
  const originY = height - NAVY_TANK_ANCHOR_Y;

  navyShadow(baker, originX, originY, 0.5, 0.36);

  // The gun faces grid -v. Keep the two track lanes separated on u and make
  // their long edges run along v; screen-space ellipses would turn the wheels
  // away from the hull by the isometric projection angle.
  const drawTrack = (u: number): void => {
    const outerTrack: Point3[] = [
      [u - 0.12, -0.42, 8],
      [u + 0.12, -0.42, 8],
      [u + 0.12, 0.32, 8],
      [u + 0.06, 0.42, 8],
      [u - 0.06, 0.42, 8],
      [u - 0.12, 0.32, 8],
    ];
    fillFace(baker, NAVY_BASE.black, 1, outerTrack, originX, originY);
    fillFace(
      baker,
      NAVY_BASE.oliveDark,
      1,
      [
        [u - 0.085, -0.35, 9],
        [u + 0.085, -0.35, 9],
        [u + 0.085, 0.27, 9],
        [u + 0.04, 0.34, 9],
        [u - 0.04, 0.34, 9],
        [u - 0.085, 0.27, 9],
      ],
      originX,
      originY,
    );

    // Crossbars are perpendicular to the -v travel direction.
    for (const v of [-0.3, -0.15, 0, 0.15, 0.3]) {
      navyScreenLine(
        baker,
        originX,
        originY,
        [u - 0.105, v, 9.5],
        [u + 0.105, v, 9.5],
        2,
        NAVY_BASE.steelDark,
        0.82,
      );
    }

    // Isometric diamond wheels follow the same grid orientation instead of
    // using screen-aligned circles.
    for (const v of [-0.28, -0.14, 0, 0.14, 0.28]) {
      fillFace(
        baker,
        NAVY_BASE.black,
        1,
        [
          [u - 0.075, v, 10],
          [u, v - 0.055, 10],
          [u + 0.075, v, 10],
          [u, v + 0.055, 10],
        ],
        originX,
        originY,
      );
      fillFace(
        baker,
        NAVY_BASE.steelDark,
        0.95,
        [
          [u - 0.043, v, 10.5],
          [u, v - 0.031, 10.5],
          [u + 0.043, v, 10.5],
          [u, v + 0.031, 10.5],
        ],
        originX,
        originY,
      );
    }
  };
  drawTrack(-0.25);
  drawTrack(0.25);

  // Lower hull with a sloped glacis and raised side skirts.
  harbourBox(baker, originX, originY, [-0.46, 0.46, -0.32, 0.32, 8, 20], NAVY_BASE.oliveDark);
  fillFace(
    baker,
    NAVY_BASE.olive,
    1,
    [[-0.4, -0.28, 21], [0.4, -0.28, 21], [0.31, 0.28, 24], [-0.31, 0.28, 24]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.oliveLight,
    1,
    [[-0.31, 0.28, 24], [0.31, 0.28, 24], [0.22, 0.34, 16], [-0.22, 0.34, 16]],
    originX,
    originY,
  );
  // Side skirts and spaced reactive-armor tiles.
  for (const u of [-0.38, -0.13, 0.13, 0.38]) {
    harbourBox(baker, originX, originY, [u - 0.045, u + 0.045, 0.3, 0.38, 10, 18], NAVY_BASE.oliveLight);
  }
  for (const u of [-0.28, 0, 0.28]) {
    const plate = baker.at([u, 0.36, 19], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warning, 0.86);
    baker.graphics.fillRect(plate.x - 3, plate.y - 2, 6, 2);
  }

  // Low angular turret, commander's hatch, periscope, and long main gun.
  harbourBox(baker, originX, originY, [-0.22, 0.22, -0.16, 0.16, 22, 29], NAVY_BASE.oliveDark);
  fillFace(baker, NAVY_BASE.oliveLight, 1, diamond(0.23, 29), originX, originY);
  const turret = baker.at([0, -0.01, 30], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillEllipse(turret.x, turret.y, 19, 8);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillEllipse(turret.x + 3, turret.y + 1, 8, 4);
  // The hull still fronts toward +v, but the turret is traversed a quarter turn
  // to the left of it: on screen that swings the muzzle from down-left round to
  // down-right, which in grid terms is (u, v) -> (v, -u), i.e. out along +u.
  navyScreenLine(baker, originX, originY, [-0.02, 0, 30], [0.72, -0.05, 33], 5, NAVY_BASE.black, 1);
  navyScreenLine(baker, originX, originY, [-0.02, 0, 30], [0.72, -0.05, 33], 2, NAVY_BASE.steelDark, 1);
  navyScreenLine(baker, originX, originY, [0.22, -0.03, 30], [0.44, -0.08, 31], 2, NAVY_BASE.black, 1);
  harbourPost(baker, originX, originY, 0.12, 0.02, 29, 36, 2, NAVY_BASE.steelDark);
  const hatch = baker.at([-0.12, 0.03, 31], originX, originY);
  baker.graphics.lineStyle(1, NAVY_BASE.warning, 0.95);
  baker.graphics.strokeEllipse(hatch.x, hatch.y, 9, 5);
  // Twin headlights and a small red unit marker on the glacis.
  for (const u of [-0.28, 0.28]) {
    const lamp = baker.at([u, 0.34, 17], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillCircle(lamp.x, lamp.y, 2);
    baker.graphics.fillStyle(NAVY_BASE.white, 0.9);
    baker.graphics.fillRect(lamp.x - 1, lamp.y - 1, 2, 1);
  }
  const marker = baker.at([0.32, 0.35, 21], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillRect(marker.x - 3, marker.y - 2, 6, 3);

  baker.finish(NAVY_TANK_KEY, width, height);
}

/** A twin-barrelled mount in a revetment, laid out over the water. */
function bakeNavyGun(baker: Baker): void {
  const width = 120;
  const height = 96;
  const originX = width / 2;
  const originY = height - NAVY_GUN_ANCHOR_Y;

  navyShadow(baker, originX, originY, 0.46, 0.46);

  // Circular revetment with a painted arc of fire, then the pedestal.
  navyCylinder(baker, originX, originY, 0.44, 0, 9, NAVY_BASE.concreteDark, 16);
  strokeFace(baker, NAVY_BASE.warning, 0.75, 2, navyRing(0.32, 10), originX, originY);
  navyCylinder(baker, originX, originY, 0.19, 9, 20, NAVY_BASE.steelDark, 12);

  // Turret: an angular shield with a hatch, mounted on the pedestal.
  harbourBox(baker, originX, originY, [-0.2, 0.16, -0.2, 0.2, 20, 30], NAVY_BASE.olive);
  fillFace(
    baker,
    NAVY_BASE.oliveLight,
    1,
    [[-0.2, -0.2, 30], [0.16, -0.2, 30], [0.26, -0.1, 24], [0.26, 0.1, 24], [0.16, 0.2, 30], [-0.2, 0.2, 30]],
    originX,
    originY,
  );
  const hatch = baker.at([-0.08, 0, 31], originX, originY);
  baker.graphics.lineStyle(1, NAVY_BASE.warning, 0.9);
  baker.graphics.strokeEllipse(hatch.x, hatch.y, 11, 6);

  // Twin barrels laid out over the sea (+u), with muzzle brakes.
  for (const v of [-0.09, 0.09]) {
    const breech: Point3 = [0.14, v, 27];
    const muzzle: Point3 = [0.86, v, 34];
    navyScreenLine(baker, originX, originY, breech, muzzle, 5, NAVY_BASE.black, 1);
    navyScreenLine(baker, originX, originY, breech, [muzzle[0] - 0.1, v, muzzle[2] - 1], 3, NAVY_BASE.steelDark, 1);
    const tip = baker.at(muzzle, originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.steel, 1);
    baker.graphics.fillRect(tip.x - 5, tip.y - 3, 7, 5);
    baker.graphics.fillStyle(NAVY_BASE.black, 1);
    baker.graphics.fillRect(tip.x - 1, tip.y - 2, 3, 3);
  }

  // Ready-use ammunition boxes stacked behind the mount.
  harbourBox(baker, originX, originY, [-0.42, -0.24, 0.06, 0.3, 9, 17], NAVY_BASE.warningDark);
  harbourBox(baker, originX, originY, [-0.4, -0.26, 0.1, 0.28, 17, 24], NAVY_BASE.oliveDark);
  baker.finish(NAVY_GUN_KEY, width, height);
}

/** Bunded fuel tank with a ladder and a pipe run to the quayside manifold. */
function bakeNavyFuelTank(baker: Baker): void {
  const width = 104;
  const height = 108;
  const originX = width / 2;
  const originY = height - NAVY_FUEL_TANK_ANCHOR_Y;
  const radius = 0.32;
  const body = 46;

  navyShadow(baker, originX, originY, 0.46, 0.46);

  // Bund wall: a low containment ring the tank stands inside.
  navyCylinder(baker, originX, originY, 0.46, 0, 7, NAVY_BASE.concreteDark, 16);
  fillFace(baker, NAVY_BASE.deckDark, 1, navyRing(0.42, 7.5), originX, originY);

  navyCylinder(baker, originX, originY, radius, 4, body, NAVY_BASE.olive, 18);
  // Girth bands and the amber contents stripe.
  for (const z of [18, 32]) {
    strokeFace(baker, NAVY_BASE.oliveDark, 0.7, 2, navyRing(radius + 0.01, z), originX, originY);
  }
  strokeFace(baker, NAVY_BASE.warning, 0.85, 2, navyRing(radius + 0.01, 26), originX, originY);
  strokeFace(baker, NAVY_BASE.steelDark, 0.8, 2, navyRing(radius - 0.03, body + 1), originX, originY);

  // Domed roof cap, vent and inspection hatch.
  navyCylinder(baker, originX, originY, radius - 0.09, body, body + 5, NAVY_BASE.oliveLight, 14);
  harbourPost(baker, originX, originY, 0.06, -0.06, body + 5, body + 15, 3, NAVY_BASE.steelDark);
  const vent = baker.at([0.06, -0.06, body + 15], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(vent.x, vent.y - 1, 3);

  // Caged ladder up the near face, and the outlet pipe over the bund.
  for (let z = 8; z < body; z += 6) {
    navyScreenLine(baker, originX, originY, [radius - 0.03, 0.16, z], [radius + 0.07, 0.16, z], 1, NAVY_BASE.steel, 0.85);
  }
  navyScreenLine(baker, originX, originY, [radius + 0.02, 0.16, 8], [radius + 0.02, 0.16, body], 1, NAVY_BASE.steelDark, 0.9);
  navyScreenLine(baker, originX, originY, [0.2, 0.3, 10], [0.62, 0.42, 10], 4, NAVY_BASE.steelDark, 1);
  navyScreenLine(baker, originX, originY, [0.62, 0.42, 10], [0.62, 0.42, 2], 4, NAVY_BASE.steelDark, 1);
  const valve = baker.at([0.42, 0.36, 12], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(valve.x, valve.y, 3);

  // Flammable placard on the bund wall.
  const placard = baker.at([0.1, 0.44, 4], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillTriangle(placard.x, placard.y - 7, placard.x - 5, placard.y + 1, placard.x + 5, placard.y + 1);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillRect(placard.x - 1, placard.y - 4, 2, 3);
  baker.finish(NAVY_FUEL_TANK_KEY, width, height);
}

/** The helipad: a marked TLOF square with perimeter lights and tie-downs. */
function bakeNavyHelipad(baker: Baker): void {
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
function bakeNavyHelicopter(source: Baker): void {
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
function bakeNavyRotor(source: Baker, key: string, frame: number): void {
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

/**
 * One panel of the perimeter fence. It runs along grid v so a row of panels at
 * a constant u forms a continuous line — the old panel lay crosswise to the
 * run it was supposed to make.
 */
function bakeNavyFence(baker: Baker): void {
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
function bakeNavyFloodlight(baker: Baker): void {
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
function bakeNavyFlag(baker: Baker): void {
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
function bakeNavyCrate(baker: Baker): void {
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

function bakeNavyBollard(baker: Baker): void {
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
function bakeNavyQuay(baker: Baker): void {
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
function bakeNavySign(baker: Baker): void {
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
