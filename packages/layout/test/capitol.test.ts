import {
  capitolDistrict,
  capitolFits,
  inCapitolDistrict,
  type SourceFile,
  type WorldMap,
} from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { layoutWorld } from "../src/index.js";

const baseFile: Omit<SourceFile, "path" | "directory" | "loc"> = {
  language: "TypeScript",
  bytes: 100,
  churn: 0,
  authors: 1,
};

/**
 * Enough files that the field is comfortably larger than the reserve, and
 * enough of them in one directory that its district covers the centre — which
 * is exactly where the allocator would otherwise place them.
 */
function crowdedWorld(count: number): WorldMap {
  return {
    repoPath: "/fixture/crowded",
    revision: "commit-a",
    files: Array.from({ length: count }, (_unused, index) => ({
      ...baseFile,
      path: `src/module-${index}.ts`,
      directory: "src",
      loc: 20 + index,
    })),
    imports: [],
    externalDependencies: [],
  };
}

describe("the capitol reserve in plot allocation", () => {
  it("never hands a file a plot inside the mall", () => {
    const { snapshot } = layoutWorld(crowdedWorld(400));
    const mall = capitolDistrict(snapshot.size);

    expect(capitolFits(snapshot.size)).toBe(true);
    for (const building of snapshot.buildings) {
      expect(inCapitolDistrict(mall, building.plot.x, building.plot.y)).toBe(
        false,
      );
    }
  });

  it("still places every file exactly once", () => {
    const { snapshot } = layoutWorld(crowdedWorld(400));
    const keys = snapshot.buildings.map(
      (building) => `${building.plot.x}:${building.plot.y}`,
    );

    expect(snapshot.buildings).toHaveLength(400);
    expect(new Set(keys).size).toBe(400);
  });

  it("reallocates a plot persisted from before the mall existed", () => {
    const world = crowdedWorld(400);
    const size = layoutWorld(world).snapshot.size;
    const mall = capitolDistrict(size);

    // A plot right on the rotunda, as a stale snapshot would carry.
    const stranded = { x: mall.centerX, y: mall.centerY };
    const { snapshot } = layoutWorld(world, {
      previousPlots: { "src/module-0.ts": stranded },
    });

    const moved = snapshot.buildings.find(
      (building) => building.path === "src/module-0.ts",
    );
    expect(moved?.plot).not.toEqual(stranded);
    expect(inCapitolDistrict(mall, moved!.plot.x, moved!.plot.y)).toBe(false);
  });

  it("reserves nothing in a field too small to spare the block", () => {
    const { snapshot } = layoutWorld(crowdedWorld(3));

    expect(capitolFits(snapshot.size)).toBe(false);
    expect(snapshot.buildings).toHaveLength(3);
  });
});
