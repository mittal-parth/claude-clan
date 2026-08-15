import { describe, expect, it, vi } from "vitest";
import {
  walkDirectoryEntry,
  type SimpleDirectoryEntry,
  type SimpleDirectoryReader,
  type SimpleEntry,
  type SimpleFileEntry,
} from "./walk";

function createFileEntry(name: string, content: string): SimpleFileEntry {
  const blob = new Blob([content], { type: "text/plain" });
  const fileObj = new File([blob], name);
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(fileObj),
  };
}

function createDirectoryEntry(name: string, children: SimpleEntry[]): SimpleDirectoryEntry {
  let read = false;
  const createReaderMock = vi.fn((): SimpleDirectoryReader => ({
    readEntries: (success) => {
      if (!read) {
        read = true;
        success(children);
      } else {
        success([]);
      }
    },
  }));

  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: createReaderMock,
  };
}

describe("walkDirectoryEntry", () => {
  it("never calls createReader on a pruned directory like node_modules", async () => {
    const nodeModulesChildren = [
      createFileEntry("package.json", "{}"),
      createFileEntry("index.js", "console.log(1)"),
    ];
    const nodeModulesDir = createDirectoryEntry("node_modules", nodeModulesChildren);

    const rootDir = createDirectoryEntry("my-project", [
      createFileEntry("index.ts", "console.log('hi');"),
      createFileEntry("package.json", '{"name":"my-project"}'),
      nodeModulesDir,
    ]);

    const result = await walkDirectoryEntry(rootDir);

    // Assert files survived
    expect(result.files.map((f) => f.path)).toEqual(["index.ts", "package.json"]);
    expect(result.skippedFiles).toBeGreaterThan(0);

    // CRITICAL PROPERTY: createReader was never called on node_modules!
    expect(nodeModulesDir.createReader).not.toHaveBeenCalled();
  });

  it("respects .gitignore read dynamically at directory level", async () => {
    const rootDir = createDirectoryEntry("repo", [
      createFileEntry(".gitignore", "*.secret\nignored_dir/\n"),
      createFileEntry("app.ts", "console.log('app')"),
      createFileEntry("key.secret", "secret-key"),
      createDirectoryEntry("ignored_dir", [
        createFileEntry("deep.ts", "123"),
      ]),
    ]);

    const result = await walkDirectoryEntry(rootDir);
    expect(result.files.map((f) => f.path)).toEqual([".gitignore", "app.ts"]);
  });
});
