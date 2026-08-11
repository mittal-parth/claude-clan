import { describe, expect, it } from "vitest";
import {
  buildDirectoryTree,
  collapseTree,
  collectDistricts,
  MIN_DISTRICT_FILES,
  MAX_DISTRICT_DEPTH,
  type SourceFileLike,
} from "../src/tree";

function file(path: string): SourceFileLike {
  const slash = path.lastIndexOf("/");
  return { path, directory: slash === -1 ? "" : path.slice(0, slash), loc: 10 };
}

describe("the directory tree", () => {
  it("sites every file in exactly one district", () => {
    const files = [
      file("apps/web/src/game/terrain.ts"),
      file("apps/web/src/game/capitol.ts"),
      file("apps/web/src/components/Foo.tsx"),
      file("apps/web/src/components/Bar.tsx"),
      file("apps/server/src/index.ts"),
      file("apps/server/src/routes.ts"),
      file("apps/server/src/db.ts"),
      file("apps/server/src/config.ts"),
      file("README.md"),
      file("package.json"),
      file("small/one.ts"),
      file("small/two.ts"),
    ];
    const tree = collapseTree(buildDirectoryTree(files));
    const entries = collectDistricts(tree);

    const seen = new Set<string>();
    for (const entry of entries) {
      for (const entryFile of entry.files) {
        expect(seen.has(entryFile.path)).toBe(false);
        seen.add(entryFile.path);
      }
    }
    expect(seen.size).toBe(files.length);
  });

  it("keeps a folder's subfolders inside the folder's own rectangle", () => {
    // A pass-through chain -- apps -> apps/web -> apps/web/src -- fuses into
    // one district; its two children (game, components) each have enough
    // files to survive on their own and must remain nested under it.
    const files = [
      file("apps/web/src/game/a.ts"),
      file("apps/web/src/game/b.ts"),
      file("apps/web/src/game/c.ts"),
      file("apps/web/src/game/d.ts"),
      file("apps/web/src/components/a.ts"),
      file("apps/web/src/components/b.ts"),
      file("apps/web/src/components/c.ts"),
      file("apps/web/src/components/d.ts"),
    ];
    const tree = collapseTree(buildDirectoryTree(files));
    const entries = collectDistricts(tree);
    const paths = entries.map((entry) => entry.path).sort();

    expect(paths).toEqual(["apps/web/src/components", "apps/web/src/game"]);
    for (const path of paths) {
      expect(path.startsWith("apps/web/src/")).toBe(true);
    }
  });

  it("absorbs a folder too small to be a district into its parent", () => {
    const files = [
      file("src/a.ts"),
      file("src/b.ts"),
      file("src/c.ts"),
      file("src/d.ts"),
      file("src/tiny/only.ts"),
    ];
    expect(1).toBeLessThan(MIN_DISTRICT_FILES);
    const tree = collapseTree(buildDirectoryTree(files));
    const entries = collectDistricts(tree);

    expect(entries.map((entry) => entry.path)).toEqual(["src"]);
    const srcEntry = entries[0];
    expect(srcEntry?.files.map((f) => f.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/tiny/only.ts",
    ]);
  });

  it("fuses a chain of single-child folders into one district", () => {
    const files = [
      file("a/b/c/d/one.ts"),
      file("a/b/c/d/two.ts"),
      file("a/b/c/d/three.ts"),
      file("a/b/c/d/four.ts"),
    ];
    const tree = collapseTree(buildDirectoryTree(files));
    const entries = collectDistricts(tree);

    // Every intermediate folder has exactly one child and no files of its
    // own, so the whole chain fuses down to the deepest node -- capped by
    // MAX_DISTRICT_DEPTH.
    expect(entries).toHaveLength(1);
    expect((entries[0]?.path.split("/").length ?? 0)).toBeLessThanOrEqual(MAX_DISTRICT_DEPTH + 1);
  });

  it("caps district depth", () => {
    const files: SourceFileLike[] = [];
    for (let index = 0; index < 6; index += 1) {
      files.push(file(`a/b/c/d/e/f/g/file${index}.ts`));
    }
    const tree = collapseTree(buildDirectoryTree(files));
    const entries = collectDistricts(tree);

    for (const entry of entries) {
      const depth = entry.path === "" ? 0 : entry.path.split("/").length;
      expect(depth).toBeLessThanOrEqual(MAX_DISTRICT_DEPTH);
    }
  });

  it("is deterministic for the same repository", () => {
    const files = [
      file("b/two.ts"),
      file("a/one.ts"),
      file("a/two.ts"),
      file("a/three.ts"),
      file("a/four.ts"),
      file("b/one.ts"),
      file("b/three.ts"),
      file("b/four.ts"),
    ];
    const first = collectDistricts(collapseTree(buildDirectoryTree(files)));
    const second = collectDistricts(collapseTree(buildDirectoryTree([...files].reverse())));

    expect(first.map((entry) => entry.path)).toEqual(second.map((entry) => entry.path));
  });
});
