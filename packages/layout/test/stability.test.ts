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
