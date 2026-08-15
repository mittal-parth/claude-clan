import createIgnore from "ignore";

export const UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 20_000;
export const UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const UPLOAD_BATCH_BYTES = 6 * 1024 * 1024;

/**
 * A default-deny list applied before and regardless of .gitignore.
 * Negations in .gitignore (e.g. !node_modules) cannot re-admit anything here.
 */
export const ALWAYS_IGNORED: readonly string[] = [
  // Everything — secrets, VCS internals, OS noise, logs
  ".git/",
  ".hg/",
  ".svn/",
  ".sudocity/",
  ".DS_Store",
  "Thumbs.db",
  "*.log",
  ".env*",

  // JS/TS — package managers, build outputs, caches
  "node_modules/",
  "bower_components/",
  ".pnpm-store/",
  ".yarn/cache/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".astro/",
  ".angular/",
  ".output/",
  ".turbo/",
  ".parcel-cache/",
  ".vite/",
  ".cache/",
  "coverage/",

  // Python — virtual environments, bytecode, test caches
  "venv/",
  ".venv/",
  "__pycache__/",
  "*.pyc",
  "*.egg-info/",
  "site-packages/",
  ".tox/",
  ".mypy_cache/",
  ".pytest_cache/",
  ".ruff_cache/",

  // Rust / Go / JVM — build artifacts, dependencies
  "target/",
  "vendor/",
  ".gradle/",
  "*.class",
  "*.jar",

  // Ruby / PHP / .NET — gems, vendor, build outputs
  ".bundle/",
  "vendor/bundle/",
  "bin/",
  "obj/",

  // Apple / mobile — Xcode derivatives, pods, Flutter caches
  ".build/",
  "DerivedData/",
  "Pods/",
  "Carthage/",
  ".dart_tool/",
  ".pub-cache/",

  // Other — framework build artifacts, cloud tools
  "_build/",
  "deps/",
  "Library/",
  "Temp/",
  ".terraform/",
  ".serverless/",

  // Bulk binaries — media, archives, databases that blow upload caps
  "*.zip",
  "*.tar",
  "*.gz",
  "*.7z",
  "*.rar",
  "*.dmg",
  "*.iso",
  "*.mp4",
  "*.mov",
  "*.avi",
  "*.mp3",
  "*.wav",
  "*.psd",
  "*.sketch",
  "*.sqlite",
  "*.db",
];

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Sanitises an incoming relative path for upload.
 * Rejects traversal (..), absolute paths, backslashes, NUL bytes,
 * control characters, and Windows reserved names.
 * Returns a clean relative path with forward slashes or undefined if invalid.
 */
export function sanitiseUploadPath(rel: string): string | undefined {
  if (!rel || typeof rel !== "string") {
    return undefined;
  }

  // Reject backslashes, NUL bytes, and control characters (0-31, 127)
  if (rel.includes("\\") || /[\0\x00-\x1f\x7f]/u.test(rel)) {
    return undefined;
  }

  // Reject absolute paths or Windows drive letters
  if (rel.startsWith("/") || /^[a-zA-Z]:/u.test(rel)) {
    return undefined;
  }

  const segments = rel.split("/");
  const cleanSegments: string[] = [];

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }

    // Check Windows reserved names (e.g. "CON", "aux.txt", "NUL.tar.gz")
    const baseName = segment.split(".")[0]?.toUpperCase() ?? "";
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      return undefined;
    }

    cleanSegments.push(rawSegment);
  }

  if (cleanSegments.length === 0) {
    return undefined;
  }

  return cleanSegments.join("/");
}

interface GitignoreScope {
  dirRelPath: string; // e.g. "" or "packages/foo"
  matcher: ReturnType<typeof createIgnore>;
}

export interface UploadFilter {
  addGitignore(dirRelPath: string, contents: string): void;
  shouldSkip(relPath: string, isDirectory: boolean): boolean;
}

export function createUploadFilter(): UploadFilter {
  const alwaysIgnoredMatcher = createIgnore().add([...ALWAYS_IGNORED]);
  const scopes: GitignoreScope[] = [];

  function normalizeDirPath(dirRelPath: string): string {
    const clean = dirRelPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
    return clean === "." ? "" : clean;
  }

  return {
    addGitignore(dirRelPath: string, contents: string): void {
      const normalized = normalizeDirPath(dirRelPath);
      const matcher = createIgnore().add(contents);
      scopes.push({ dirRelPath: normalized, matcher });
      // Keep scopes sorted shallowest to deepest so parent gitignores run before child overrides
      scopes.sort((a, b) => a.dirRelPath.length - b.dirRelPath.length);
    },

    shouldSkip(relPath: string, isDirectory: boolean): boolean {
      const cleanPath = relPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
      const testPath = isDirectory ? `${cleanPath}/` : cleanPath;

      // 1. ALWAYS_IGNORED wins unconditionally
      if (alwaysIgnoredMatcher.ignores(testPath)) {
        return true;
      }

      // 2. Hierarchical gitignores
      let ignored = false;
      for (const scope of scopes) {
        let subPath: string;
        if (scope.dirRelPath === "") {
          subPath = testPath;
        } else if (cleanPath === scope.dirRelPath) {
          subPath = isDirectory ? "./" : ".";
        } else if (cleanPath.startsWith(`${scope.dirRelPath}/`)) {
          const relativePart = cleanPath.slice(scope.dirRelPath.length + 1);
          subPath = isDirectory ? `${relativePart}/` : relativePart;
        } else {
          continue;
        }

        const testResult = scope.matcher.test(subPath);
        if (testResult.ignored) {
          ignored = true;
        } else if (testResult.unignored) {
          ignored = false;
        }
      }

      return ignored;
    },
  };
}
