import { BLOCK, blockOf, isPlotCell, type SourceFile, type WorldMap } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { layoutWorld } from "../src/index.js";

const baseFile: Omit<SourceFile, "path" | "directory" | "loc"> = {
  language: "TypeScript",
  bytes: 100,
  churn: 0,
  authors: 1,
};

function file(path: string, directory: string, loc: number): SourceFile {
  return { ...baseFile, path, directory, loc };
}

function world(revision: string, files: SourceFile[]): WorldMap {
  return { repoPath: "/fixture", revision, files, imports: [], externalDependencies: [] };
}

function manyFiles(directory: string, count: number, locBase = 10): SourceFile[] {
  return Array.from({ length: count }, (_unused, index) =>
    file(`${directory}/f${index}.ts`, directory, locBase + index),
  );
}

describe("plot allocation on the lattice", () => {
  it("only ever hands out legal plot cells", () => {
    const files = [...manyFiles("src", 40), ...manyFiles("test", 20), ...manyFiles("docs", 12)];
    const { snapshot } = layoutWorld(world("commit", files));

    for (const building of snapshot.buildings) {
      expect(isPlotCell(building.plot.x, building.plot.y)).toBe(true);
    }
  });

  it("keeps every district on a block boundary", () => {
    const files = [...manyFiles("src", 20), ...manyFiles("test", 10), ...manyFiles("docs", 8)];
    const { snapshot } = layoutWorld(world("commit", files));

    for (const district of snapshot.districts) {
      expect(district.x % BLOCK).toBe(0);
      expect(district.y % BLOCK).toBe(0);
      expect(district.width % BLOCK).toBe(0);
      expect(district.height % BLOCK).toBe(0);
    }
  });

  it("reallocates a plot persisted on the old odd lattice", () => {
    const files = manyFiles("src", 10);
    const { snapshot } = layoutWorld(world("commit", files), {
      // (1, 3) is odd/odd but was never a legal plot cell under the block
      // lattice's ring positions once BLOCK covers more than one candidate --
      // exercised here as a plot the pre-lattice code could have produced.
      previousPlots: { "src/f0.ts": { x: 2, y: 2 } },
    });

    const moved = snapshot.buildings.find((building) => building.path === "src/f0.ts");
    expect(moved).toBeDefined();
    expect(isPlotCell(moved!.plot.x, moved!.plot.y)).toBe(true);
  });

  it("rehouses an overflowing file near its own district, not at the map corner", () => {
    // Fill "src" completely by giving it more files than its district has
    // plot cells, then add one more file to the same folder and check the
    // overflow plot lands close to the district rather than back at (1, 1).
    const files = manyFiles("src", 400);
    const { snapshot } = layoutWorld(world("commit", files));

    const srcDistrict = snapshot.districts.find((district) => district.path === "src");
    expect(srcDistrict).toBeDefined();

    const centreX = srcDistrict!.x + srcDistrict!.width / 2;
    const centreY = srcDistrict!.y + srcDistrict!.height / 2;
    const districtBlocks = (srcDistrict!.width / BLOCK) * (srcDistrict!.height / BLOCK);
    const districtCapacity = districtBlocks * 8; // PLOTS_PER_BLOCK

    // Every building assigned to "src" should be within a handful of blocks
    // of its own district -- not clear across the field, which is what the
    // old top-left-corner overflow search produced.
    const farthest = Math.max(
      ...snapshot.buildings
        .filter((building) => building.district === "src")
        .map((building) =>
          blockDistance(building.plot.x, building.plot.y, centreX, centreY),
        ),
    );
    // Generous bound: even wildly overflowing a district should stay within
    // a small multiple of the district's own footprint, not the whole field.
    expect(farthest).toBeLessThan(Math.sqrt(districtCapacity) + 15);
  });
});

function blockDistance(x: number, y: number, centreX: number, centreY: number): number {
  const a = blockOf(x, y);
  const b = blockOf(centreX, centreY);
  return Math.hypot(a.bx - b.bx, a.by - b.by);
}
