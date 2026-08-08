/**
 * Bright, sunlit city palette — deliberately not the HUD's dark tokens. The
 * canvas is the game world; the 8-bit chrome around it stays dark and frames it.
 *
 * Every language the scanner recognises (packages/worldgen/src/index.ts) must
 * have an entry here, otherwise buildings fall back to grey and the city reads
 * as a debug view. palette.test.ts enforces that.
 */

export interface BuildingPalette {
  /** Main body of the building, in full sun. */
  wall: number;
  /** Roof plane — the dominant colour when looking down the isometric axis. */
  roof: number;
  /** Door frames, awnings, string courses, antenna masts. */
  trim: number;
  /** Lit glazing. */
  window: number;
}

export const TERRAIN_COLORS = {
  grass: [0x5bbf3e, 0x54b638, 0x63c748],
  grassShade: 0x3f9a2a,
  field: 0x8dc63f,
  park: 0x49ab33,
  sand: 0xe8d9a8,
  sandShade: 0xd3c08a,
  water: 0x2e9fe0,
  waterDeep: 0x1f7fbd,
  waterFoam: 0x9fd8f5,
  road: 0x9aa3ab,
  roadShade: 0x848d95,
  roadLine: 0xf4f1e4,
  pavement: 0xd8d3c4,
  ground: 0x6cc04a,
  shadow: 0x1f4d16,
} as const;

export const PROP_COLORS = {
  trunk: 0x7a5230,
  leaf: 0x2f8f3c,
  leafLight: 0x46ad4e,
  pine: 0x1f6f3a,
  bush: 0x3d9b45,
  rock: 0x9c9c93,
  fountain: 0xd9d5c8,
  fountainWater: 0x54b7ea,
} as const;

const FALLBACK: BuildingPalette = {
  wall: 0xe6e2d6,
  roof: 0x9aa5b1,
  trim: 0x6f7a86,
  window: 0xbfe2ff,
};

const PALETTES: Record<string, BuildingPalette> = {
  C: { wall: 0xe9e6df, roof: 0x6b7b99, trim: 0x44526b, window: 0xc7dcf5 },
  "C++": { wall: 0xe4ecf5, roof: 0x00599c, trim: 0x00396a, window: 0xa8d8ff },
  CSS: { wall: 0xe6ebfb, roof: 0x2965f1, trim: 0x1743aa, window: 0xb9d0ff },
  Go: { wall: 0xdff4fa, roof: 0x00add8, trim: 0x007d9c, window: 0xb7ecfb },
  HTML: { wall: 0xfae7df, roof: 0xe34c26, trim: 0xa8331a, window: 0xffd2be },
  Java: { wall: 0xf7e9d9, roof: 0xe76f00, trim: 0xa14c00, window: 0xffd9a8 },
  JavaScript: { wall: 0xfbf3d5, roof: 0xf0db4f, trim: 0xc0a021, window: 0xfff8c8 },
  JSON: { wall: 0xeceff1, roof: 0x8b98a5, trim: 0x5d6975, window: 0xcfd8de },
  Markdown: { wall: 0xf3efe3, roof: 0x7d9099, trim: 0x53646c, window: 0xd6e4ea },
  Python: { wall: 0xe7f0f7, roof: 0x4b8bbe, trim: 0x2f5f88, window: 0xffd43b },
  Rust: { wall: 0xf6e7dc, roof: 0xd2611e, trim: 0x8c3a12, window: 0xffd9b0 },
  SCSS: { wall: 0xfae6ef, roof: 0xcd6799, trim: 0x93406b, window: 0xffcfe4 },
  Shell: { wall: 0xe6f4de, roof: 0x4eaa25, trim: 0x2f6f14, window: 0xcdf0b8 },
  SQL: { wall: 0xf7ecdb, roof: 0xe38c00, trim: 0x9c5f00, window: 0xffe0a3 },
  TypeScript: { wall: 0xe8edf5, roof: 0x3178c6, trim: 0x1e4f88, window: 0x9ad5ff },
  Vue: { wall: 0xe3f6ec, roof: 0x41b883, trim: 0x2b7f5b, window: 0xb8f0d5 },
  YAML: { wall: 0xf2f0dd, roof: 0xb5a642, trim: 0x7c7025, window: 0xe8e3af },
};

export function paletteFor(language: string): BuildingPalette {
  return PALETTES[language] ?? FALLBACK;
}

export function hasPalette(language: string): boolean {
  return language in PALETTES;
}

export type Archetype = "house" | "townhouse" | "office" | "tower" | "utility";

/**
 * Config and docs read as infrastructure rather than housing, so they become
 * water towers, silos and warehouses — the industrial texture in the reference.
 */
const UTILITY_LANGUAGES = new Set(["JSON", "YAML", "Markdown", "Shell"]);

export const TIER_THRESHOLDS = [40, 150, 400] as const;

/** 0..3, driving footprint and height within an archetype. */
export function tierFor(loc: number): number {
  if (loc < TIER_THRESHOLDS[0]) {
    return 0;
  }
  if (loc < TIER_THRESHOLDS[1]) {
    return 1;
  }
  if (loc < TIER_THRESHOLDS[2]) {
    return 2;
  }
  return 3;
}

export function archetypeFor(language: string, loc: number): Archetype {
  if (UTILITY_LANGUAGES.has(language)) {
    return "utility";
  }
  const order: Archetype[] = ["house", "townhouse", "office", "tower"];
  return order[tierFor(loc)] as Archetype;
}

/** Pixel height of the building body, before the roof is added. */
export function bodyHeightFor(archetype: Archetype, tier: number): number {
  const heights: Record<Archetype, number[]> = {
    house: [26, 32, 38, 44],
    townhouse: [38, 48, 58, 68],
    office: [56, 74, 92, 110],
    tower: [86, 116, 148, 182],
    utility: [34, 46, 60, 76],
  };
  return heights[archetype][tier] as number;
}
