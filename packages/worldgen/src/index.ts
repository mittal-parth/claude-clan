import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  ExternalDependency,
  ImportEdge,
  SourceFile,
  WorldMap,
} from "@sudo-city/protocol";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import createIgnore from "ignore";

const execFileAsync = promisify(execFile);
const sourceExtensions = new Set([
  ".c",
  ".cpp",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);

const languages: Record<string, string> = {
  ".c": "C",
  ".cpp": "C++",
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".json": "JSON",
  ".md": "Markdown",
  ".py": "Python",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".yaml": "YAML",
  ".yml": "YAML",
};

interface ChurnMetric {
  authors: Set<string>;
  churn: number;
  lastTouchedAt?: string;
}

export interface ImportResolver {
  resolve(repoPath: string, files: string[]): Promise<ImportEdge[]>;
}

export interface ScanOptions {
  importResolver?: ImportResolver;
}

export class DependencyCruiserImportResolver implements ImportResolver {
  async resolve(repoPath: string, files: string[]): Promise<ImportEdge[]> {
    const candidates = files
      .filter((file) => /\.(?:[cm]?[jt]sx?)$/u.test(file))
      .map((file) => resolve(repoPath, file));

    if (candidates.length === 0) {
      return [];
    }

    const result = await cruise(candidates, {
      doNotFollow: { path: "node_modules" },
      exclude: { path: "(?:^|/)node_modules/" },
      tsPreCompilationDeps: "specify",
    });
    if (typeof result.output === "string") {
      return [];
    }

    return this.toEdges(repoPath, result.output, new Set(files));
  }

  private toEdges(
    repoPath: string,
    result: ICruiseResult,
    knownFiles: Set<string>,
  ): ImportEdge[] {
    const edges: ImportEdge[] = [];
    for (const module of result.modules) {
      const source = normalizePath(relative(repoPath, module.source));
      if (!knownFiles.has(source)) {
        continue;
      }
      for (const dependency of module.dependencies) {
        const target = normalizePath(relative(repoPath, dependency.resolved));
        if (knownFiles.has(target)) {
          edges.push({
            source,
            target,
            circular: dependency.circular,
          });
        }
      }
    }
    return edges;
  }
}

export async function scanRepository(
  repoPath: string,
  options: ScanOptions = {},
): Promise<WorldMap> {
  const absoluteRepoPath = resolve(repoPath);
  const files = await listRepositoryFiles(absoluteRepoPath);
  const churn = await readChurn(absoluteRepoPath);
  const importResolver =
    options.importResolver ?? new DependencyCruiserImportResolver();

  const [sourceFiles, imports, externalDependencies, revision] =
    await Promise.all([
      readSourceFiles(absoluteRepoPath, files, churn),
      importResolver.resolve(absoluteRepoPath, files),
      readExternalDependencies(absoluteRepoPath, files),
      readRevision(absoluteRepoPath),
    ]);

  return {
    repoPath: absoluteRepoPath,
    revision,
    files: sourceFiles,
    imports,
    externalDependencies,
  };
}

async function listRepositoryFiles(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repoPath, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map(normalizePath)
      .sort();
  } catch {
    return walkFallback(repoPath);
  }
}

async function walkFallback(repoPath: string): Promise<string[]> {
  const matcher = createIgnore().add([".git/", "node_modules/", ".sudocity/"]);
  try {
    matcher.add(await readFile(join(repoPath, ".gitignore"), "utf8"));
  } catch {
    // A fallback scan does not require a .gitignore.
  }

  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = normalizePath(relative(repoPath, absolutePath));
      if (matcher.ignores(path + (entry.isDirectory() ? "/" : ""))) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  await walk(repoPath);
  return files.sort();
}

async function readSourceFiles(
  repoPath: string,
  files: string[],
  churnByPath: Map<string, ChurnMetric>,
): Promise<SourceFile[]> {
  const sourceFiles = await Promise.all(
    files.map(async (path): Promise<SourceFile | undefined> => {
      const extension = extname(path).toLowerCase();
      if (!sourceExtensions.has(extension)) {
        return undefined;
      }

      const absolutePath = join(repoPath, path);
      const [content, fileStat] = await Promise.all([
        readFile(absolutePath),
        stat(absolutePath),
      ]);
      const text = content.includes(0) ? "" : content.toString("utf8");
      const metric = churnByPath.get(path);
      return {
        path,
        directory: normalizePath(dirname(path)) === "." ? "" : dirname(path),
        language: languages[extension] ?? "Text",
        loc: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
        bytes: fileStat.size,
        churn: metric?.churn ?? 0,
        authors: metric?.authors.size ?? 0,
        ...(metric?.lastTouchedAt
          ? { lastTouchedAt: metric.lastTouchedAt }
          : {}),
      };
    }),
  );
  return sourceFiles.filter(
    (file): file is SourceFile => file !== undefined,
  );
}

async function readChurn(repoPath: string): Promise<Map<string, ChurnMetric>> {
  const metrics = new Map<string, ChurnMetric>();
  let currentDate: string | undefined;
  let currentAuthor: string | undefined;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--format=commit:%aI%x09%aN", "--numstat", "--no-renames", "--"],
      { cwd: repoPath, maxBuffer: 128 * 1024 * 1024 },
    );
    for (const line of stdout.split(/\r?\n/u)) {
      if (line.startsWith("commit:")) {
        [currentDate, currentAuthor] = line.slice(7).split("\t");
        continue;
      }
      const [addedText, deletedText, rawPath] = line.split("\t");
      if (!rawPath || !currentAuthor) {
        continue;
      }
      const path = normalizePath(rawPath);
      const existing = metrics.get(path) ?? {
        authors: new Set<string>(),
        churn: 0,
      };
      existing.authors.add(currentAuthor);
      existing.churn += parseNumstat(addedText) + parseNumstat(deletedText);
      existing.lastTouchedAt ??= currentDate;
      metrics.set(path, existing);
    }
  } catch {
    return metrics;
  }
  return metrics;
}

function parseNumstat(value: string | undefined): number {
  if (!value || value === "-") {
    return 0;
  }
  return Number.parseInt(value, 10) || 0;
}

async function readExternalDependencies(
  repoPath: string,
  files: string[],
): Promise<ExternalDependency[]> {
  const dependencies: ExternalDependency[] = [];
  for (const manifest of files.filter((file) => file.endsWith("package.json"))) {
    try {
      const packageJson = JSON.parse(
        await readFile(join(repoPath, manifest), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of Object.keys(packageJson.dependencies ?? {})) {
        dependencies.push({ name, kind: "runtime", manifest });
      }
      for (const name of Object.keys(packageJson.devDependencies ?? {})) {
        dependencies.push({ name, kind: "development", manifest });
      }
    } catch {
      // Malformed manifests remain visible as files but contribute no harbors.
    }
  }
  return dependencies.sort((left, right) =>
    `${left.manifest}:${left.name}`.localeCompare(
      `${right.manifest}:${right.name}`,
    ),
  );
}

async function readRevision(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
    });
    return stdout.trim();
  } catch {
    return "working-tree";
  }
}

function normalizePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
