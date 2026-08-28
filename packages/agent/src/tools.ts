import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  TOOL_INPUT_PREVIEW_LIMIT,
  TOOL_RESULT_PREVIEW_LIMIT,
} from "@sudo-city/protocol";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalisePath(path: string): string {
  return path.split(/[\\/]/u).join("/");
}

/**
 * Checks whether a given path stays strictly inside baseDir (preventing directory traversal).
 */
export function isInsideDirectory(baseDir: string, targetPath: string): boolean {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(baseDir, targetPath);
  const rel = relative(resolvedBase, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Extracts candidate file/directory paths from tool input arguments.
 */
export function extractTargetPaths(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const paths: string[] = [];
  for (const key of ["file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }
  return paths;
}

/**
 * A tool target is kept repository-relative because the renderer indexes
 * buildings by repository path. Passing the SDK's absolute path made a
 * perfectly valid tool call fail to find its construction site.
 */
export function toolTarget(
  input: unknown,
  cwd: string,
): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  for (const key of ["file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string") {
      return normalisePath(isAbsolute(value) ? relative(cwd, value) : value);
    }
  }
  for (const key of ["command", "pattern"]) {
    const value = input[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/**
 * Tool arguments cross the wire for the modal's disclosure panel. A Write
 * input can contain an entire large file, so bound every string before it can
 * dwarf the rest of the transcript.
 */
export function previewInput(
  input: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    preview[key] =
      typeof value === "string" && value.length > TOOL_INPUT_PREVIEW_LIMIT
        ? `${value.slice(0, TOOL_INPUT_PREVIEW_LIMIT)}…`
        : value;
  }
  return preview;
}

export function truncate(
  value: string,
  limit: number = TOOL_RESULT_PREVIEW_LIMIT,
): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function previewResult(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (value === undefined) {
    return undefined;
  }
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

export function promptWithContext(
  prompt: string,
  contextPaths: readonly string[],
): string {
  if (contextPaths.length === 0) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Read these repository files before acting; they were attached as context for this order:",
    ...contextPaths.map((path) => `- ${path}`),
  ].join("\n");
}

/** Kept as an alias for callers that still use the American spelling. */
export const normalizePath = normalisePath;
