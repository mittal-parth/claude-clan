import type { SourceFile, WorldMap } from "@sudo-city/protocol";
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
  return {
    repoPath: "/fixture/tiny-app",
    revision,
    files,
    imports: [],
    externalDependencies: [],
  };
}

describe("stable plot allocation", () => {
  it("never moves existing buildings when a later revision adds files", () => {
    const commitA = world("commit-a", [
      file("src/index.ts", "src", 10),
      file("src/math.ts", "src", 6),
      file("test/math.test.ts", "test", 8),
    ]);
    const first = layoutWorld(commitA, {
      generatedAt: "2026-08-08T00:00:00.000Z",
    });

    const commitB = world("commit-b", [
      ...commitA.files.map((source) => ({ ...source })),
      file("src/http.ts", "src", 120),
      file("docs/architecture.md", "docs", 40),
    ]);
    const second = layoutWorld(commitB, {
      generatedAt: "2026-08-09T00:00:00.000Z",
      previousPlots: first.plots,
    });

    expect(
      Object.fromEntries(
        commitA.files.map((source) => [
          source.path,
          second.plots[source.path],
        ]),
      ),
    ).toEqual(first.plots);
    expect(new Set(Object.values(second.plots).map((plot) => `${plot.x}:${plot.y}`)).size)
      .toBe(commitB.files.length);
  });
});

describe("snapshot geometry", () => {
  const map = world("commit-a", [
    file("src/index.ts", "src", 10),
    file("src/math.ts", "src", 6),
    file("test/math.test.ts", "test", 8),
    file("README.md", "", 4),
  ]);

  it("publishes the world size the plots were allocated against", () => {
    expect(layoutWorld(map).snapshot.size).toEqual({ width: 64, height: 64 });
    expect(
      layoutWorld(map, { width: 32, height: 24 }).snapshot.size,
    ).toEqual({ width: 32, height: 24 });
  });

  it("publishes one district per directory, covering the field exactly", () => {
    const { districts } = layoutWorld(map).snapshot;

    expect(districts.map((district) => district.path).sort()).toEqual([
      "",
      "src",
      "test",
    ]);
    expect(
      districts.reduce(
        (total, district) => total + district.width * district.height,
        0,
      ),
    ).toBeCloseTo(64 * 64, 6);
    for (const district of districts) {
      expect(district.x + district.width).toBeLessThanOrEqual(64 + 1e-9);
      expect(district.y + district.height).toBeLessThanOrEqual(64 + 1e-9);
    }
  });

  it("keeps every building inside its own district rectangle", () => {
    const { districts, buildings } = layoutWorld(map).snapshot;
    const byPath = new Map(
      districts.map((district) => [district.path, district]),
    );

    for (const building of buildings) {
      // Buildings carry "/" for the repo root; the district keeps "".
      const district = byPath.get(
        building.district === "/" ? "" : building.district,
      );
      if (!district) {
        throw new Error(`no district for ${building.path}`);
      }
      expect(building.plot.x).toBeGreaterThanOrEqual(Math.floor(district.x));
      expect(building.plot.x).toBeLessThanOrEqual(
        Math.ceil(district.x + district.width),
      );
      expect(building.plot.y).toBeGreaterThanOrEqual(Math.floor(district.y));
      expect(building.plot.y).toBeLessThanOrEqual(
        Math.ceil(district.y + district.height),
      );
    }
  });

  it("does not move district rectangles when a later revision keeps the same weights", () => {
    const first = layoutWorld(map, { generatedAt: "2026-08-08T00:00:00.000Z" });
    const second = layoutWorld(world("commit-b", map.files), {
      generatedAt: "2026-08-09T00:00:00.000Z",
      previousPlots: first.plots,
    });

    expect(second.snapshot.districts).toEqual(first.snapshot.districts);
  });
});
