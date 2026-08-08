import type { SourceFile, WorldMap } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { fieldSizeFor, layoutWorld } from "../src/index.js";

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
    const side = fieldSizeFor(map.files.length);

    expect(layoutWorld(map).snapshot.size).toEqual({
      width: side,
      height: side,
    });
    expect(
      layoutWorld(map, { width: 32, height: 24 }).snapshot.size,
    ).toEqual({ width: 32, height: 24 });
  });

  it("publishes one district per directory, covering the field exactly", () => {
    const side = fieldSizeFor(map.files.length);
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
    ).toBeCloseTo(side * side, 6);
    for (const district of districts) {
      expect(district.x + district.width).toBeLessThanOrEqual(side + 1e-9);
      expect(district.y + district.height).toBeLessThanOrEqual(side + 1e-9);
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

  it("keeps every plot inside the published field", () => {
    const { size, buildings } = layoutWorld(map).snapshot;

    for (const building of buildings) {
      expect(building.plot.x).toBeLessThan(size.width);
      expect(building.plot.y).toBeLessThan(size.height);
    }
  });

  it("keeps plots inside the field when many small districts fragment it", () => {
    // The shape that broke it: lots of directories, each holding a few files,
    // so districts are too small to seat their own files and overflow.
    const files: SourceFile[] = [];
    for (let directory = 0; directory < 30; directory += 1) {
      for (let index = 0; index < 3; index += 1) {
        files.push(
          file(`pkg${directory}/file${index}.ts`, `pkg${directory}`, 20 + index),
        );
      }
    }
    const { size, buildings } = layoutWorld(world("fragmented", files)).snapshot;

    expect(buildings).toHaveLength(90);
    const escaped = buildings.filter(
      (building) =>
        building.plot.x >= size.width || building.plot.y >= size.height,
    );
    expect(escaped).toEqual([]);
  });

  it("reallocates persisted plots that fall outside a shrunken field", () => {
    const stranded = layoutWorld(map, {
      previousPlots: { "src/index.ts": { x: 500, y: 500 } },
    });

    expect(stranded.plots["src/index.ts"]).not.toEqual({ x: 500, y: 500 });
    expect(stranded.plots["src/index.ts"]?.x).toBeLessThan(
      stranded.snapshot.size.width,
    );
  });

  it("scales the field to the repository", () => {
    expect(fieldSizeFor(1)).toBe(12);
    expect(fieldSizeFor(85)).toBeLessThan(32);
    expect(fieldSizeFor(2_000)).toBeGreaterThan(fieldSizeFor(200));
    // Even sizes keep district origins aligned with the odd-lane plot grid.
    for (const count of [1, 9, 85, 400, 2_000]) {
      expect(fieldSizeFor(count) % 2).toBe(0);
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

describe("PR-city geometry pinning", () => {
  const main = world("main-sha", [
    file("src/index.ts", "src", 10),
    file("src/math.ts", "src", 6),
    file("test/math.test.ts", "test", 8),
  ]);

  it("reshuffles districts when weights change and geometry isn't pinned", () => {
    // The flaw this option exists to prevent: squarify reweights every
    // rectangle from LOC, so one file growing a lot can reorder districts
    // entirely, even though only one file changed.
    const before = layoutWorld(main);
    const grown = world("pr-sha", [
      ...main.files.filter((source) => source.path !== "src/index.ts"),
      file("src/index.ts", "src", 2_000),
    ]);
    const after = layoutWorld(grown);

    expect(after.snapshot.districts).not.toEqual(before.snapshot.districts);
  });

  it("keeps districts and field size identical to main when pinned, even though a file's LOC changed", () => {
    const baseline = layoutWorld(main, {
      generatedAt: "2026-08-08T00:00:00.000Z",
    });
    const grown = world("pr-sha", [
      ...main.files.filter((source) => source.path !== "src/index.ts"),
      file("src/index.ts", "src", 2_000),
    ]);

    const pr = layoutWorld(grown, {
      generatedAt: "2026-08-09T00:00:00.000Z",
      width: baseline.snapshot.size.width,
      height: baseline.snapshot.size.height,
      districts: baseline.snapshot.districts,
      previousPlots: baseline.plots,
    });

    expect(pr.snapshot.districts).toEqual(baseline.snapshot.districts);
    expect(pr.snapshot.size).toEqual(baseline.snapshot.size);
    // The unchanged file keeps its exact coordinates from main.
    expect(pr.plots["src/math.ts"]).toEqual(baseline.plots["src/math.ts"]);
    expect(pr.plots["test/math.test.ts"]).toEqual(
      baseline.plots["test/math.test.ts"],
    );
  });

  it("still places a file whose directory doesn't exist in the pinned districts", () => {
    const baseline = layoutWorld(main);
    const withNewDirectory = world("pr-sha", [
      ...main.files,
      file("docs/new.md", "docs", 4),
    ]);

    const pr = layoutWorld(withNewDirectory, {
      width: baseline.snapshot.size.width,
      height: baseline.snapshot.size.height,
      districts: baseline.snapshot.districts,
      previousPlots: baseline.plots,
    });

    const plot = pr.plots["docs/new.md"];
    expect(plot).toBeDefined();
    expect(plot?.x).toBeLessThan(pr.snapshot.size.width);
    expect(plot?.y).toBeLessThan(pr.snapshot.size.height);
  });
});
