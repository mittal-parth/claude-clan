import { realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export type LocalPathRejection =
  | "not-absolute"
  | "not-found"
  | "not-a-directory"
  | "forbidden";

export interface LocalPathResult {
  path: string;
  isGitRepo: boolean;
}

const home = resolve(homedir());
const temporaryRoot = resolve(tmpdir());
const forbiddenExact = new Set(
  [
    "/",
    "/System",
    "/Library",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/var",
    "/private",
    "/Applications",
    "/Volumes",
    home,
    join(home, "Library"),
    join(home, ".ssh"),
    join(home, ".claude"),
    join(home, ".config"),
    join(home, ".aws"),
  ].map((value) => resolve(value)),
);

const forbiddenPrefixes = [
  "/System",
  "/Library",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/var",
  "/Applications",
  "/Volumes",
].map((value) => resolve(value));

function isForbidden(candidate: string): boolean {
  // Temporary directories are legitimate scratch projects even when macOS
  // canonicalizes them under /private/var; preserve that safe exception.
  if (candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${sep}`)) {
    return false;
  }
  if (forbiddenExact.has(candidate)) {
    return true;
  }
  if (forbiddenPrefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}${sep}`))) {
    return true;
  }
  if (home === candidate || home.startsWith(`${candidate}${sep}`)) {
    return true;
  }
  const library = join(home, "Library");
  return candidate === library || candidate.startsWith(`${library}${sep}`);
}

/** Resolves and vets a desktop path; the server does not trust renderer input. */
export async function validateLocalPath(
  input: string,
): Promise<LocalPathResult | { rejected: LocalPathRejection }> {
  if (!isAbsolute(input)) {
    return { rejected: "not-absolute" };
  }

  const lexicalPath = resolve(input);
  if (isForbidden(lexicalPath)) {
    return { rejected: "forbidden" };
  }

  const path = await realpath(lexicalPath).catch(() => undefined);
  if (!path) {
    return { rejected: "not-found" };
  }
  if (isForbidden(path)) {
    return { rejected: "forbidden" };
  }

  const info = await stat(path).catch(() => undefined);
  if (!info) {
    return { rejected: "not-found" };
  }
  if (!info.isDirectory()) {
    return { rejected: "not-a-directory" };
  }

  const isGitRepo = await stat(join(path, ".git"))
    .then(() => true)
    .catch(() => false);
  return { path, isGitRepo };
}
