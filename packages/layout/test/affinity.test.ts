import type { ImportEdge, SourceFile, WorldMap } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { layoutWorld, type DistrictRect } from "../src/index.js";

const baseFile: Omit<SourceFile, "path" | "directory" | "loc"> = {
  language: "TypeScript",
  bytes: 100,
  churn: 0,
  authors: 1,
};

function file(path: string, directory: string, loc: number): SourceFile {
  return { ...baseFile, path, directory, loc };
}

/**
 * 20 sibling folders, "dir-a".."dir-t", each with exactly MIN_DISTRICT_FILES
 * (4) files, so every one survives collapsing as its own district with
 * identical weight. Fine-grained enough that shifting the top-level split by
 * one folder only moves the balance by 5%, inside the 8% tolerance the
 * affinity search is allowed to spend -- the same granularity
 * blocks.test.ts's unit tests establish is needed for the preference to have
 * any splits to choose among at all.
 */
function twentyFolders(): SourceFile[] {
  const files: SourceFile[] = [];
  for (let index = 0; index < 20; index += 1) {
    const folder = `dir-${String.fromCharCode(97 + index)}`;
    for (let fileIndex = 0; fileIndex < 4; fileIndex += 1) {
      files.push(file(`${folder}/f${fileIndex}.ts`, folder, 20 + fileIndex));
    }
  }
  return files;
}

function adjacent(a: DistrictRect, b: DistrictRect): boolean {
  const touchesVertically =
    (a.x + a.width === b.x || b.x + b.width === a.x) &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  const touchesHorizontally =
    (a.y + a.height === b.y || b.y + b.height === a.y) &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width;
  return touchesVertically || touchesHorizontally;
}

function world(files: SourceFile[], imports: ImportEdge[] = []): WorldMap {
  return {
    repoPath: "/fixture/affinity",
    revision: "commit-a",
    files,
    imports,
    externalDependencies: [],
  };
}

describe("import-affinity district ordering", () => {
  it("tiles the field exactly whether or not import edges are given", () => {
    const withoutImports = layoutWorld(world(twentyFolders()));
    const rects = withoutImports.snapshot.districts;
    const totalArea = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const { size } = withoutImports.snapshot;
    expect(totalArea).toBeCloseTo((size.width - 1) * (size.height - 1), 6);
  });

  it("pulls two heavily-coupled districts toward each other when they would otherwise land apart", () => {
    const files = twentyFolders();
    // "dir-j" and "dir-k" are adjacent in the alphabetical (and therefore
    // weight-tied) sort order, sitting right where a balanced 20-way split
    // falls -- the one boundary the affinity search can actually move.
    const imports: ImportEdge[] = [];
    for (const source of files.filter((f) => f.directory === "dir-j")) {
      for (const target of files.filter((f) => f.directory === "dir-k")) {
        imports.push({ source: source.path, target: target.path, circular: false });
      }
    }

    const withoutImports = layoutWorld(world(files));
    const withImports = layoutWorld(world(files, imports));

    const districtsWithout = new Map(
      withoutImports.snapshot.districts.map((d) => [d.path, d]),
    );
    const districtsWith = new Map(withImports.snapshot.districts.map((d) => [d.path, d]));

    const jWithout = districtsWithout.get("dir-j")!;
    const kWithout = districtsWithout.get("dir-k")!;
    const jWith = districtsWith.get("dir-j")!;
    const kWith = districtsWith.get("dir-k")!;
    expect(jWithout).toBeDefined();
    expect(kWithout).toBeDefined();

    // Establishes this fixture actually exercises the interesting case --
    // the two districts start out apart -- before checking that coupling
    // changes it.
    expect(adjacent(jWithout, kWithout)).toBe(false);
    expect(adjacent(jWith, kWith)).toBe(true);
  });

  it("never sites a file outside the field when import edges reference unknown paths", () => {
    const files = twentyFolders();
    const imports: ImportEdge[] = [
      { source: "dir-a/f0.ts", target: "does/not/exist.ts", circular: false },
      { source: "does/not/exist.ts", target: "dir-t/f0.ts", circular: false },
    ];

    const { snapshot } = layoutWorld(world(files, imports));
    for (const building of snapshot.buildings) {
      expect(building.plot.x).toBeLessThan(snapshot.size.width);
      expect(building.plot.y).toBeLessThan(snapshot.size.height);
    }
  });

  it("produces the same layout on repeated runs of the same repository", () => {
    const files = twentyFolders();
    const imports: ImportEdge[] = [
      { source: "dir-j/f0.ts", target: "dir-k/f0.ts", circular: false },
    ];

    const first = layoutWorld(world(files, imports));
    const second = layoutWorld(world(files, imports));
    expect(second.snapshot.districts).toEqual(first.snapshot.districts);
  });
});
