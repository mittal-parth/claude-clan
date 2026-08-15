import { describe, expect, it } from "vitest";
import {
  archetypeFor,
  bodyHeightFor,
  hasPalette,
  paletteFor,
  tierFor,
  colorToCss,
} from "./palette";

/** Mirrors the language table in packages/worldgen/src/index.ts. */
const SCANNED_LANGUAGES = [
  "Assembly",
  "Astro",
  "Batch",
  "C",
  "C#",
  "C++",
  "CSS",
  "Dart",
  "Elixir",
  "F#",
  "Go",
  "GraphQL",
  "Haskell",
  "HTML",
  "Java",
  "JavaScript",
  "JSON",
  "Kotlin",
  "Lua",
  "Markdown",
  "Objective-C",
  "PHP",
  "PowerShell",
  "Protocol Buffers",
  "Python",
  "R",
  "Ruby",
  "Rust",
  "SCSS",
  "Scala",
  "Shell",
  "SQL",
  "Svelte",
  "Swift",
  "Terraform",
  "TOML",
  "TypeScript",
  "Vue",
  "XML",
  "YAML",
];

describe("language palette", () => {
  it("covers every language the scanner recognises", () => {
    const missing = SCANNED_LANGUAGES.filter((language) => !hasPalette(language));
    expect(missing).toEqual([]);
  });

  it("gives each language four distinct colours", () => {
    for (const language of SCANNED_LANGUAGES) {
      const palette = paletteFor(language);
      const colors = [palette.wall, palette.roof, palette.trim, palette.window];
      for (const color of colors) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
      expect(new Set(colors).size).toBe(4);
    }
  });

  it("gives most languages a distinct roof so districts read apart", () => {
    const roofs = SCANNED_LANGUAGES.map((language) => paletteFor(language).roof);
    expect(new Set(roofs).size).toBe(SCANNED_LANGUAGES.length);
  });

  it("gives every language a sprite and HUD signature", () => {
    for (const language of SCANNED_LANGUAGES) {
      const palette = paletteFor(language);
      expect(palette.accent).toBeGreaterThanOrEqual(0);
      expect(palette.accentDark).toBeGreaterThanOrEqual(0);
      expect(palette.mark.length).toBeGreaterThan(0);
      expect(palette.glyph.length).toBeGreaterThan(0);
      expect(palette.glyph.every((row) => /^[01]+$/u.test(row))).toBe(true);
      expect(palette.material).toMatch(
        /^(brick|concrete|glass|metal|neon|paper|painted|wood)$/u,
      );
      expect(colorToCss(palette.accent)).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });
  it("derives distinct highlight and shadow tones for each language", () => {
    for (const language of SCANNED_LANGUAGES) {
      const palette = paletteFor(language);
      const tones = [
        palette.wall,
        palette.wallLight,
        palette.wallShadow,
        palette.roof,
        palette.roofLight,
        palette.roofShadow,
        palette.window,
        palette.windowGlow,
        palette.windowShadow,
      ];
      for (const tone of tones) {
        expect(tone).toBeGreaterThanOrEqual(0);
        expect(tone).toBeLessThanOrEqual(0xffffff);
      }
      expect(palette.wallLight).not.toBe(palette.wall);
      expect(palette.wallShadow).not.toBe(palette.wall);
      expect(palette.roofLight).not.toBe(palette.roof);
      expect(palette.roofShadow).not.toBe(palette.roof);
      expect(palette.windowGlow).not.toBe(palette.window);
      expect(palette.windowShadow).not.toBe(palette.window);
    }
  });

  it("falls back rather than throwing on an unknown language", () => {
    expect(hasPalette("Brainfuck")).toBe(false);
    expect(paletteFor("Brainfuck").roof).toBeGreaterThan(0);
  });
});

describe("archetype selection", () => {
  it("steps tiers at the documented loc boundaries", () => {
    expect(tierFor(0)).toBe(0);
    expect(tierFor(39)).toBe(0);
    expect(tierFor(40)).toBe(1);
    expect(tierFor(149)).toBe(1);
    expect(tierFor(150)).toBe(2);
    expect(tierFor(399)).toBe(2);
    expect(tierFor(400)).toBe(3);
    expect(tierFor(50_000)).toBe(3);
  });

  it("scales code size to archetype", () => {
    expect(archetypeFor("TypeScript", 12)).toBe("house");
    expect(archetypeFor("TypeScript", 90)).toBe("townhouse");
    expect(archetypeFor("TypeScript", 260)).toBe("office");
    expect(archetypeFor("TypeScript", 1200)).toBe("tower");
  });

  it("renders config and docs as infrastructure at any size", () => {
    for (const language of ["JSON", "YAML", "Markdown", "Shell"]) {
      expect(archetypeFor(language, 5)).toBe("utility");
      expect(archetypeFor(language, 5000)).toBe("utility");
    }
  });

  it("renders a test folder's files as infrastructure whatever their language", () => {
    for (const districtPath of ["test", "tests", "spec", "packages/world/test", "src/__tests__"]) {
      expect(archetypeFor("TypeScript", 12, districtPath)).toBe("utility");
      expect(archetypeFor("Python", 500, districtPath)).toBe("utility");
    }
  });

  it("renders an infra folder's files as infrastructure whatever their language", () => {
    for (const districtPath of [".github", "infra", "config", "scripts", "apps/server/scripts"]) {
      expect(archetypeFor("Go", 12, districtPath)).toBe("utility");
    }
  });

  it("leaves an ordinary folder's archetype driven by tier, not by name", () => {
    expect(archetypeFor("TypeScript", 12, "src")).toBe("house");
    expect(archetypeFor("TypeScript", 1200, "apps/web/src/game")).toBe("tower");
  });

  it("is unaffected when no district is given, so existing call sites are unchanged", () => {
    expect(archetypeFor("TypeScript", 12)).toBe(archetypeFor("TypeScript", 12, "src"));
  });

  it("grows monotonically with tier for every archetype", () => {
    for (const archetype of [
      "house",
      "townhouse",
      "office",
      "tower",
      "utility",
    ] as const) {
      for (let tier = 1; tier <= 3; tier += 1) {
        expect(bodyHeightFor(archetype, tier)).toBeGreaterThan(
          bodyHeightFor(archetype, tier - 1),
        );
      }
    }
  });

  it("keeps towers taller than houses so the skyline reads size", () => {
    expect(bodyHeightFor("tower", 0)).toBeGreaterThan(bodyHeightFor("house", 3));
  });
});
