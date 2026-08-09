import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  scanRepository,
  type ImportResolver,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
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

  it("skips tracked files deleted from the working tree", async () => {
    const scratchRoot = resolve(import.meta.dirname, "../.scratch");
    await mkdir(scratchRoot, { recursive: true });
    const repoPath = await mkdtemp(join(scratchRoot, "scan-"));
    try {
      await mkdir(join(repoPath, "src"), { recursive: true });
      await writeFile(join(repoPath, "README.md"), "# hello\n");
      await writeFile(join(repoPath, "src/index.ts"), "export {};\n");
      await execFileAsync("git", ["init"], { cwd: repoPath });
      await execFileAsync("git", ["add", "."], { cwd: repoPath });
      await rm(join(repoPath, "README.md"));

      const world = await scanRepository(repoPath, {
        importResolver: fixtureResolver,
      });

      expect(world.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
