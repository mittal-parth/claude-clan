import { BLOCK, capitolFits, type SourceFile, type WorldMap } from "@sudo-city/protocol";
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
  // Each of "src" and "test" carries enough files to survive collapsing into
  // its parent (MIN_DISTRICT_FILES is 4), and README.md at the repository
  // root gives "" its own district too -- a node with files of its own is
  // always published, however few, regardless of the collapsing threshold.
  const map = world("commit-a", [
    file("src/index.ts", "src", 10),
    file("src/math.ts", "src", 6),
    file("src/util.ts", "src", 5),
    file("src/types.ts", "src", 3),
    file("test/index.test.ts", "test", 8),
    file("test/math.test.ts", "test", 4),
    file("test/util.test.ts", "test", 4),
    file("test/types.test.ts", "test", 2),
    file("README.md", "", 4),
  ]);

  it("publishes the world size the plots were allocated against", () => {
    const side = fieldSizeFor(map.files.length, 3);

    expect(layoutWorld(map).snapshot.size).toEqual({
      width: side,
      height: side,
    });
    expect(
      layoutWorld(map, { width: 32, height: 24 }).snapshot.size,
    ).toEqual({ width: 32, height: 24 });
  });

  it("publishes one district per surviving folder, covering the field exactly", () => {
    const { districts, size } = layoutWorld(map).snapshot;

    expect(districts.map((district) => district.path).sort()).toEqual([
      "",
      "src",
      "test",
    ]);
    // Every district is block-aligned and the set tiles the block grid with
    // no gaps and no overlaps.
    for (const district of districts) {
      expect(district.x % BLOCK).toBe(0);
      expect(district.y % BLOCK).toBe(0);
      expect(district.width % BLOCK).toBe(0);
      expect(district.height % BLOCK).toBe(0);
    }
    const totalArea = districts.reduce(
      (total, district) => total + district.width * district.height,
      0,
    );
    expect(totalArea).toBe((size.width - 1) * (size.height - 1));
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
      expect(building.plot.x).toBeGreaterThanOrEqual(district.x);
      expect(building.plot.x).toBeLessThan(district.x + district.width);
      expect(building.plot.y).toBeGreaterThanOrEqual(district.y);
      expect(building.plot.y).toBeLessThan(district.y + district.height);
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
    // A one-file repository still gets a field the capitol fits in; below that
    // floor the city renders with no monument at all.
    expect(capitolFits({ width: fieldSizeFor(1), height: fieldSizeFor(1) })).toBe(
      true,
    );
    expect(fieldSizeFor(1)).toBeLessThan(fieldSizeFor(2_000));
    expect(fieldSizeFor(85)).toBeLessThan(32);
    expect(fieldSizeFor(2_000)).toBeGreaterThan(fieldSizeFor(200));
    // The field always tiles the lattice exactly: its side is one more than a
    // whole number of blocks, whatever the repository's size.
    for (const count of [1, 9, 85, 400, 2_000]) {
      expect((fieldSizeFor(count) - 1) % BLOCK).toBe(0);
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
    file("src/a.ts", "src", 10),
    file("src/b.ts", "src", 6),
    file("src/c.ts", "src", 8),
    file("src/d.ts", "src", 4),
    file("test/a.test.ts", "test", 10),
    file("test/b.test.ts", "test", 6),
    file("test/c.test.ts", "test", 8),
    file("test/d.test.ts", "test", 4),
  ]);

  it("reshuffles districts when weights change and geometry isn't pinned", () => {
    // The flaw this option exists to prevent: the block allocator reweights
    // every rectangle from each folder's file count, so a folder gaining
    // several files can reorder district geometry entirely.
    const before = layoutWorld(main);
    const grown = world("pr-sha", [
      ...main.files,
      file("src/e.ts", "src", 5),
      file("src/f.ts", "src", 5),
      file("src/g.ts", "src", 5),
      file("src/h.ts", "src", 5),
      file("src/i.ts", "src", 5),
      file("src/j.ts", "src", 5),
    ]);
    const after = layoutWorld(grown);

    expect(after.snapshot.districts).not.toEqual(before.snapshot.districts);
  });

  it("keeps districts and field size identical to main when pinned, even though the file count changed", () => {
    const baseline = layoutWorld(main, {
      generatedAt: "2026-08-08T00:00:00.000Z",
    });
    const grown = world("pr-sha", [
      ...main.files,
      file("src/e.ts", "src", 2_000),
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
    // Every unchanged file keeps its exact coordinates from main.
    for (const source of main.files) {
      expect(pr.plots[source.path]).toEqual(baseline.plots[source.path]);
    }
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
