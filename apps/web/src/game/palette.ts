/**
 * Bright, sunlit city palette — deliberately not the HUD's dark tokens. The
 * canvas is the game world; the 8-bit chrome around it stays dark and frames it.
 *
 * A building's language is not just a roof colour. The accent, material and
 * little pixel glyph are repeated in the sprite and the HUD so a repository
 * can be scanned at a glance and understood without opening every file.
 * Every language the scanner recognises (packages/worldgen/src/index.ts) must
 * have an entry here; palette.test.ts enforces that.
 */

export type BuildingMaterial =
  | "brick"
  | "concrete"
  | "glass"
  | "metal"
  | "neon"
  | "paper"
  | "painted"
  | "wood";

export interface BuildingPalette {
  /** Main body of the building, in full sun. */
  wall: number;
  /** Roof plane — the dominant colour when looking down the isometric axis. */
  roof: number;
  /** Door frames, awnings, string courses, antenna masts. */
  trim: number;
  /** Lit glazing. */
  window: number;
  /** Saturated signature colour used for rails, badges and HUD swatches. */
  accent: number;
  /** Dark edge for the signature colour, keeping pixel details readable. */
  accentDark: number;
  /** Ink colour for the small roof glyph. */
  ink: number;
  /** Short file-type mark shown in the HUD and encoded into the sprite. */
  mark: string;
  /** Pixel rows for the roof glyph; `1` cells are painted into the badge. */
  glyph: readonly string[];
  /** Material treatment that gives related file types different silhouettes/details. */
  material: BuildingMaterial;
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
  accent: 0x738292,
  accentDark: 0x3d4955,
  ink: 0x17222e,
  mark: "FILE",
  glyph: ["111", "101", "111"],
  material: "concrete",
};

const PALETTES: Record<string, BuildingPalette> = {
  C: {
    wall: 0xe9e6df,
    roof: 0x6b7b99,
    trim: 0x44526b,
    window: 0xc7dcf5,
    accent: 0x8aa4d1,
    accentDark: 0x2f3e5b,
    ink: 0x142033,
    mark: "C",
    glyph: ["111", "100", "100", "111"],
    material: "concrete",
  },
  "C++": {
    wall: 0xe4ecf5,
    roof: 0x00599c,
    trim: 0x00396a,
    window: 0xa8d8ff,
    accent: 0x2f8dd0,
    accentDark: 0x00396a,
    ink: 0xe7f4ff,
    mark: "++",
    glyph: ["101", "111", "101"],
    material: "metal",
  },
  CSS: {
    wall: 0xe6ebfb,
    roof: 0x2965f1,
    trim: 0x1743aa,
    window: 0xb9d0ff,
    accent: 0x6e92ff,
    accentDark: 0x1743aa,
    ink: 0xf4f7ff,
    mark: "#",
    glyph: ["101", "111", "101", "111", "101"],
    material: "neon",
  },
  Go: {
    wall: 0xdff4fa,
    roof: 0x00add8,
    trim: 0x007d9c,
    window: 0xb7ecfb,
    accent: 0x48d8f0,
    accentDark: 0x007d9c,
    ink: 0x073b4c,
    mark: "GO",
    glyph: ["111", "101", "111"],
    material: "glass",
  },
  HTML: {
    wall: 0xfae7df,
    roof: 0xe34c26,
    trim: 0xa8331a,
    window: 0xffd2be,
    accent: 0xff7755,
    accentDark: 0xa8331a,
    ink: 0x4a180f,
    mark: "<>",
    glyph: ["1001", "0110", "1001"],
    material: "brick",
  },
  Java: {
    wall: 0xf7e9d9,
    roof: 0xe76f00,
    trim: 0xa14c00,
    window: 0xffd9a8,
    accent: 0xffaa45,
    accentDark: 0xa14c00,
    ink: 0x4d2200,
    mark: "J",
    glyph: ["111", "010", "110"],
    material: "concrete",
  },
  JavaScript: {
    wall: 0xfbf3d5,
    roof: 0xf0db4f,
    trim: 0xc0a021,
    window: 0xfff8c8,
    accent: 0xf7e27a,
    accentDark: 0x8b7200,
    ink: 0x332900,
    mark: "JS",
    glyph: ["111", "100", "111", "001", "111"],
    material: "neon",
  },
  JSON: {
    wall: 0xeceff1,
    roof: 0x8b98a5,
    trim: 0x5d6975,
    window: 0xcfd8de,
    accent: 0xb4c1cd,
    accentDark: 0x5d6975,
    ink: 0x202a33,
    mark: "{}",
    glyph: ["011", "001", "010", "100", "110"],
    material: "metal",
  },
  Markdown: {
    wall: 0xf3efe3,
    roof: 0x7d9099,
    trim: 0x53646c,
    window: 0xd6e4ea,
    accent: 0xaab8bf,
    accentDark: 0x53646c,
    ink: 0x1e2a2f,
    mark: "MD",
    glyph: ["10001", "11011", "10101"],
    material: "paper",
  },
  Python: {
    wall: 0xe7f0f7,
    roof: 0x4b8bbe,
    trim: 0x2f5f88,
    window: 0xffd43b,
    accent: 0x70a5d8,
    accentDark: 0x2f5f88,
    ink: 0x112a3d,
    mark: "PY",
    glyph: ["111", "101", "111"],
    material: "painted",
  },
  Rust: {
    wall: 0xf6e7dc,
    roof: 0xd2611e,
    trim: 0x8c3a12,
    window: 0xffd9b0,
    accent: 0xf08a4b,
    accentDark: 0x8c3a12,
    ink: 0x401b08,
    mark: "RS",
    glyph: ["111", "100", "111"],
    material: "metal",
  },
  SCSS: {
    wall: 0xfae6ef,
    roof: 0xcd6799,
    trim: 0x93406b,
    window: 0xffcfe4,
    accent: 0xe58db4,
    accentDark: 0x93406b,
    ink: 0x481c35,
    mark: "S",
    glyph: ["111", "100", "111"],
    material: "neon",
  },
  Shell: {
    wall: 0xe6f4de,
    roof: 0x4eaa25,
    trim: 0x2f6f14,
    window: 0xcdf0b8,
    accent: 0x79d34f,
    accentDark: 0x2f6f14,
    ink: 0x122b09,
    mark: "$",
    glyph: ["100", "010", "001"],
    material: "metal",
  },
  SQL: {
    wall: 0xf7ecdb,
    roof: 0xe38c00,
    trim: 0x9c5f00,
    window: 0xffe0a3,
    accent: 0xffbd3d,
    accentDark: 0x9c5f00,
    ink: 0x432700,
    mark: "DB",
    glyph: ["111", "010", "010"],
    material: "metal",
  },
  TypeScript: {
    wall: 0xe8edf5,
    roof: 0x3178c6,
    trim: 0x1e4f88,
    window: 0x9ad5ff,
    accent: 0x58a6e8,
    accentDark: 0x1e4f88,
    ink: 0x0e2a4a,
    mark: "TS",
    glyph: ["111", "010", "010"],
    material: "glass",
  },
  Vue: {
    wall: 0xe3f6ec,
    roof: 0x41b883,
    trim: 0x2b7f5b,
    window: 0xb8f0d5,
    accent: 0x76d7aa,
    accentDark: 0x2b7f5b,
    ink: 0x123d2b,
    mark: "V",
    glyph: ["101", "101", "010"],
    material: "glass",
  },
  YAML: {
    wall: 0xf2f0dd,
    roof: 0xb5a642,
    trim: 0x7c7025,
    window: 0xe8e3af,
    accent: 0xd5c85d,
    accentDark: 0x7c7025,
    ink: 0x302d0b,
    mark: "Y",
    glyph: ["101", "010", "010"],
    material: "paper",
  },
};

export function paletteFor(language: string): BuildingPalette {
  return PALETTES[language] ?? FALLBACK;
}

export function hasPalette(language: string): boolean {
  return language in PALETTES;
}

/** Convert a Phaser integer colour into a CSS colour for the HUD. */
export function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
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
