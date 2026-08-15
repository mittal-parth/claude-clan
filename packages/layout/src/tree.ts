/**
 * The directory tree districts are built from.
 *
 * Districts used to be a flat list keyed on the full directory path, so
 * "apps/web/src", "apps/web/src/game" and "apps/web/src/components" were three
 * unrelated rectangles that squarify scattered by weight -- a folder's
 * subfolders had no reason to end up anywhere near it. Building the real tree
 * first, and collapsing the folders too small to earn a block of their own,
 * is what keeps a folder's contents together.
 */

export interface SourceFileLike {
  path: string;
  directory: string;
  loc: number;
}

export interface DirNode {
  /** "" for the repository root. */
  path: string;
  /** Files sited in this node itself -- after collapsing, may include a descendant's. */
  files: SourceFileLike[];
  children: DirNode[];
  /** Files in this node's whole subtree. */
  fileCount: number;
  depth: number;
}

/** A folder must hold at least this many files to earn its own district. */
export const MIN_DISTRICT_FILES = 4;

/** Beyond this many path segments, a folder merges into its parent regardless of size. */
export const MAX_DISTRICT_DEPTH = 4;

/**
 * Builds the tree from scratch, one node per path segment, and rolls up
 * fileCount from the leaves. Deterministic: children are sorted by path, so
 * two runs over the same file list produce byte-identical trees.
 */
export function buildDirectoryTree(files: readonly SourceFileLike[]): DirNode {
  const root: DirNode = { path: "", files: [], children: [], fileCount: 0, depth: 0 };
  const byPath = new Map<string, DirNode>([["", root]]);

  const nodeFor = (path: string): DirNode => {
    const existing = byPath.get(path);
    if (existing) {
      return existing;
    }
    const lastSlash = path.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : path.slice(0, lastSlash);
    const parent = nodeFor(parentPath);
    const node: DirNode = { path, files: [], children: [], fileCount: 0, depth: parent.depth + 1 };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const file of files) {
    nodeFor(file.directory).files.push(file);
  }

  for (const node of byPath.values()) {
    node.children.sort((left, right) => left.path.localeCompare(right.path));
  }

  const rollUp = (node: DirNode): number => {
    node.fileCount = node.files.length + node.children.reduce((total, child) => total + rollUp(child), 0);
    return node.fileCount;
  };
  rollUp(root);

  return root;
}

function collectFiles(node: DirNode): SourceFileLike[] {
  const files = [...node.files];
  for (const child of node.children) {
    files.push(...collectFiles(child));
  }
  return files;
}

/**
 * Collapses the tree so districts track a repository's real structure rather
 * than its path depth: a folder too small to be worth a block is absorbed
 * into its parent, and a chain of single-child folders (apps -> apps/web ->
 * apps/web/src) becomes one district rather than three slivers.
 *
 * Post-order, so a child is fully resolved -- and may already have absorbed
 * its own children -- before its parent decides whether to absorb it in turn.
 */
export function collapseTree(node: DirNode): DirNode {
  const collapsedChildren: DirNode[] = [];
  for (const child of node.children) {
    const resolved = collapseTree(child);
    const tooSmall = resolved.fileCount < MIN_DISTRICT_FILES;
    const tooDeep = resolved.depth > MAX_DISTRICT_DEPTH && node.path !== "";
    if (tooSmall || tooDeep) {
      // Absorbed: every file in the child's whole subtree becomes this node's own.
      node.files.push(...collectFiles(resolved));
      continue;
    }
    collapsedChildren.push(resolved);
  }
  node.children = collapsedChildren;

  // A pass-through folder -- exactly one surviving child, nothing of its own --
  // is replaced by that child, so "apps/web/src" doesn't sit behind two empty
  // districts named "apps" and "apps/web". The root is exempt: it always
  // publishes a district for files that live at the repository's own top level.
  if (node.path !== "" && node.files.length === 0 && node.children.length === 1) {
    return node.children[0] as DirNode;
  }

  return node;
}

export interface DistrictEntry {
  path: string;
  files: SourceFileLike[];
}

/**
 * One entry per surviving district, in a deterministic (path-sorted) order.
 * A node contributes an entry when it holds files of its own, or when it has
 * no children (a leaf with zero files only happens for an empty repository,
 * and even then it publishes the root so the field still has one district).
 */
export function collectDistricts(root: DirNode): DistrictEntry[] {
  const entries: DistrictEntry[] = [];
  const visit = (node: DirNode): void => {
    if (node.files.length > 0 || node.children.length === 0) {
      entries.push({ path: node.path, files: node.files });
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
