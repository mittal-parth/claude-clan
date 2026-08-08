import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scanRepository,
  type ImportResolver,
} from "../src/index.js";

const fixturePath = resolve(import.meta.dirname, "../../../fixtures/repos/tiny-app");

const fixtureResolver: ImportResolver = {
  async resolve() {
    return [
      {
        source: "src/index.ts",
        target: "src/math.ts",
        circular: false,
      },
    ];
  },
};

describe("scanRepository", () => {
  it("maps tracked source metrics, imports, and manifest dependencies", async () => {
    const world = await scanRepository(fixturePath, {
      importResolver: fixtureResolver,
    });

    expect(world.files.map((file) => file.path)).toEqual([
      "package.json",
      "src/index.ts",
      "src/math.ts",
    ]);
    expect(world.files.find((file) => file.path === "src/math.ts")).toMatchObject(
      {
        directory: "src",
        language: "TypeScript",
        loc: 4,
      },
    );
    expect(world.imports).toEqual([
      {
        source: "src/index.ts",
        target: "src/math.ts",
        circular: false,
      },
    ]);
    expect(world.externalDependencies).toEqual([
      {
        name: "typescript",
        kind: "development",
        manifest: "package.json",
      },
      { name: "zod", kind: "runtime", manifest: "package.json" },
    ]);
  });
});
