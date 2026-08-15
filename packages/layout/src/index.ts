import {
  BLOCK,
  CAPITOL_RESERVE_BLOCKS,
  LAYOUT_VERSION,
  MIN_SIDE_BLOCKS,
  PLOTS_PER_BLOCK,
  RING_ORDER,
  blockOf,
  blocksAcross,
  capitolDistrict,
  capitolFits,
  isPlotCell,
  type Building,
  type DistrictRect,
  type Plot,
  type WorldMap,
  type WorldSize,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { affinityKey, allocateBlocks, type Affinity, type BlockRect } from "./blocks";
import { buildDirectoryTree, collapseTree, collectDistricts, type DistrictEntry } from "./tree";

export type { DistrictRect } from "@sudo-city/protocol";
export { affinityKey, allocateBlocks, type Affinity, type BlockItem, type BlockRect } from "./blocks";
export {
  buildDirectoryTree,
  collapseTree,
  collectDistricts,
  type DirNode,
  type DistrictEntry,
  type SourceFileLike,
} from "./tree";

export interface LayoutOptions {
  /**
   * Skip block allocation and use these rectangles verbatim. A PR city must
   * render the same island as main: buildTerrain derives every street from
   * district geometry, so recomputing districts for a PR would silently
   * reshuffle the whole city out from under plots seeded from main. Pass
   * main's own snapshot.districts (and its width/height) to keep a PR city
   * geometrically identical to main; only the occupied plots differ. Files
   * whose directory has no matching district fall through to the field-wide
   * overflow search, same as a district that's already full.
   */
  districts?: readonly DistrictRect[];
  generatedAt?: string;
  height?: number;
  previousPlots?: Readonly<Record<string, Plot>>;
  width?: number;
}

// District rectangles now travel on the snapshot so the renderer can draw
// district ground and streets; they are not duplicated here.
export interface LayoutResult {
  snapshot: WorldSnapshot;
  plots: Record<string, Plot>;
}

// ---------------------------------------------------------------------------
// Field sizing
// ---------------------------------------------------------------------------

/** Blocks are never filled to the brim; a solid wall of buildings reads worse than a town. */
const TARGET_FILL = 0.85;

/** Blocks the capitol reserve takes out of the middle of the field. */
const CAPITOL_BLOCKS = CAPITOL_RESERVE_BLOCKS;

/** Headroom over one block per district, so the recursive split always has somewhere to cut. */
const DISTRICT_SLACK = 1.15;

/** Side length of the field, in whole blocks. */
export function fieldSideBlocks(fileCount: number, districtCount: number): number {
  const forFiles = Math.ceil(Math.max(fileCount, 1) / (PLOTS_PER_BLOCK * TARGET_FILL));
  const forDistricts = Math.ceil(Math.max(districtCount, 1) * DISTRICT_SLACK);
  const blocks = Math.max(forFiles, forDistricts) + CAPITOL_BLOCKS;
  return Math.max(MIN_SIDE_BLOCKS, Math.ceil(Math.sqrt(blocks)));
}

/**
 * Field side, in tiles. districtCount defaults to 1 for callers (tests,
 * external callers) that only have a file count in hand.
 */
export function fieldSizeFor(fileCount: number, districtCount = 1): number {
  return fieldSideBlocks(fileCount, districtCount) * BLOCK + 1;
}

/**
 * The precise version fieldSideBlocks only approximates: each district needs
 * at minimum enough blocks to seat its own files, and a repository with many
 * small districts (a district floor of one block, PLOTS_PER_BLOCK capacity
 * each) needs far less slack than treating every district as if it were near
 * full. Sizing from a flat districtCount * DISTRICT_SLACK, as the public
 * fieldSideBlocks does for callers without per-district counts, over-grows
 * the field badly once a repository has dozens of small folders -- the field
 * ends up sized for districts that were never going to need the room, and the
 * city reads as mostly empty parkland around a sparse scatter of buildings.
 */
function sideBlocksForEntries(entries: readonly DistrictEntry[], fileCount: number): number {
  const forFiles = Math.ceil(Math.max(fileCount, 1) / (PLOTS_PER_BLOCK * TARGET_FILL));
  const forDistricts = entries.reduce(
    (total, entry) => total + Math.max(1, Math.ceil(entry.files.length / PLOTS_PER_BLOCK)),
    0,
  );
  // A little slack over the bare minimum so the recursive block split always
  // has somewhere to cut without underflowing (see allocateBlocks' rebalance).
  const blocks = Math.max(forFiles, Math.ceil(forDistricts * 1.1)) + CAPITOL_BLOCKS;
  return Math.max(MIN_SIDE_BLOCKS, Math.ceil(Math.sqrt(blocks)));
}

// ---------------------------------------------------------------------------
// Plot allocation
// ---------------------------------------------------------------------------

function plotKey(plot: Plot): string {
  return `${plot.x}:${plot.y}`;
}

/**
 * The plot cells of a district, ordered for allocation: blocks nearest the
 * district's own centre first (so a half-full district reads as a built core
 * with soft edges, not a random scatter), and within a block the corners
 * before the mid-edges (RING_ORDER).
 */
function districtPlotCells(district: DistrictRect, size: WorldSize): Plot[] {
  const startBlock = blockOf(district.x, district.y);
  const blocksWide = Math.round(district.width / BLOCK);
  const blocksHigh = Math.round(district.height / BLOCK);
  const centreBx = startBlock.bx + (blocksWide - 1) / 2;
  const centreBy = startBlock.by + (blocksHigh - 1) / 2;

  const blocks: Array<{ bx: number; by: number; distance: number }> = [];
  for (let dy = 0; dy < blocksHigh; dy += 1) {
    for (let dx = 0; dx < blocksWide; dx += 1) {
      const bx = startBlock.bx + dx;
      const by = startBlock.by + dy;
      blocks.push({ bx, by, distance: Math.hypot(bx - centreBx, by - centreBy) });
    }
  }
  blocks.sort((left, right) => left.distance - right.distance || left.by - right.by || left.bx - right.bx);

  const cells: Plot[] = [];
  for (const block of blocks) {
    for (const [ou, ov] of RING_ORDER) {
      const x = block.bx * BLOCK + ou;
      const y = block.by * BLOCK + ov;
      if (x >= 0 && x < size.width && y >= 0 && y < size.height) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

/**
 * Nearest free plot to a point, spiralling outward on the lattice, block-ring
 * by block-ring.
 *
 * This is the overflow path, and it matters that it stays *near*: the old
 * allocator restarted at the field's top-left corner, so a file whose folder
 * was full got rehoused on the opposite side of the city -- 118 of this
 * repo's 154 buildings were sited that way. Expanding past the field edge if
 * the whole field is exhausted keeps a genuinely full city from throwing
 * rather than degrading.
 */
function findNearestPlot(
  fromX: number,
  fromY: number,
  occupied: ReadonlySet<string>,
  size: WorldSize,
): Plot {
  const originBlock = blockOf(fromX, fromY);

  for (let radius = 0; radius < 100_000; radius += 1) {
    const blocksInRing: Array<{ bx: number; by: number }> = [];
    if (radius === 0) {
      blocksInRing.push({ bx: originBlock.bx, by: originBlock.by });
    } else {
      for (let dx = -radius; dx <= radius; dx += 1) {
        blocksInRing.push({ bx: originBlock.bx + dx, by: originBlock.by - radius });
        blocksInRing.push({ bx: originBlock.bx + dx, by: originBlock.by + radius });
      }
      for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
        blocksInRing.push({ bx: originBlock.bx - radius, by: originBlock.by + dy });
        blocksInRing.push({ bx: originBlock.bx + radius, by: originBlock.by + dy });
      }
    }
    blocksInRing.sort((left, right) => left.by - right.by || left.bx - right.bx);

    for (const block of blocksInRing) {
      for (const [ou, ov] of RING_ORDER) {
        const x = block.bx * BLOCK + ou;
        const y = block.by * BLOCK + ov;
        if (x < 0 || y < 0) {
          continue;
        }
        const key = plotKey({ x, y });
        if (!occupied.has(key)) {
          return { x, y };
        }
      }
    }
  }
  throw new Error("Unable to allocate a world plot");
}

/**
 * A file's district is the deepest published district whose path is a prefix
 * of its directory. Exact matching breaks the moment a small folder is
 * collapsed into its parent -- the file's own directory still names the
 * folder that no longer has a district of its own, so its nearest surviving
 * ancestor has to be found by walking up the path.
 */
function districtForFile(
  directory: string,
  byPath: ReadonlyMap<string, DistrictRect>,
): DistrictRect | undefined {
  if (byPath.has(directory)) {
    return byPath.get(directory);
  }
  let candidate = directory;
  while (candidate.includes("/")) {
    candidate = candidate.slice(0, candidate.lastIndexOf("/"));
    const district = byPath.get(candidate);
    if (district) {
      return district;
    }
  }
  return byPath.get("");
}

function toDistrictRects(blocks: Map<string, BlockRect>, entries: readonly DistrictEntry[]): DistrictRect[] {
  const fileCountByPath = new Map(entries.map((entry) => [entry.path, entry.files.length]));
  const rects: DistrictRect[] = [];
  for (const [path, rect] of blocks) {
    rects.push({
      path,
      x: rect.bx * BLOCK,
      y: rect.by * BLOCK,
      width: rect.bw * BLOCK,
      height: rect.bh * BLOCK,
      weight: fileCountByPath.get(path) ?? 0,
    });
  }
  return rects.sort((left, right) => left.path.localeCompare(right.path));
}

/** Marks every tile of the central capitol reserve as taken. */
function reserveCapitol(size: WorldSize, occupied: Set<string>): void {
  if (!capitolFits(size)) {
    return;
  }
  const mall = capitolDistrict(size);
  for (let y = mall.minY; y <= mall.maxY; y += 1) {
    for (let x = mall.minX; x <= mall.maxX; x += 1) {
      occupied.add(plotKey({ x, y }));
    }
  }
}

/**
 * How strongly two districts are coupled, from the repository's own import
 * graph: for every import edge whose two files land in different surviving
 * districts, that pair's weight goes up by one. Passed to allocateBlocks so
 * the treemap can prefer, among otherwise similar splits, the one that keeps
 * coupled folders on the same side -- the city then shows the dependency
 * structure, and ambient traffic between two such districts has somewhere
 * honest to go.
 */
function buildDistrictAffinity(
  world: WorldMap,
  entries: readonly DistrictEntry[],
): Affinity {
  const districtByFile = new Map<string, string>();
  for (const entry of entries) {
    for (const file of entry.files) {
      districtByFile.set(file.path, entry.path);
    }
  }

  const affinity = new Map<string, number>();
  for (const edge of world.imports) {
    const from = districtByFile.get(edge.source);
    const to = districtByFile.get(edge.target);
    if (!from || !to || from === to) {
      continue;
    }
    const key = affinityKey(from, to);
    affinity.set(key, (affinity.get(key) ?? 0) + 1);
  }
  return affinity;
}

export function layoutWorld(world: WorldMap, options: LayoutOptions = {}): LayoutResult {
  const tree = collapseTree(buildDirectoryTree(world.files));
  const entries = collectDistricts(tree);

  const sideBlocks = options.width
    ? blocksAcross(options.width)
    : sideBlocksForEntries(entries, world.files.length);
  const width = options.width ?? sideBlocks * BLOCK + 1;
  const height = options.height ?? sideBlocks * BLOCK + 1;

  const districts = options.districts
    ? [...options.districts]
    : toDistrictRects(
        allocateBlocks(
          entries.map((entry) => {
            // Weighting by blocks-needed rather than raw file count is what
            // makes two districts with the same file count come out with the
            // same block count: weighting by file count directly split area
            // proportionally to files, but the *floor* below only ever
            // reserved one block per item, so nothing stopped two 15-file
            // districts landing on either side of a split from getting 1
            // block and 2 blocks respectively -- the 1-block one then had
            // nowhere to put 7 of its own files and overflowed into its
            // neighbour's own plot cells.
            const blocksNeeded = Math.max(1, Math.ceil(entry.files.length / PLOTS_PER_BLOCK));
            return { key: entry.path, weight: blocksNeeded, minBlocks: blocksNeeded };
          }),
          { bx: 0, by: 0, bw: sideBlocks, bh: sideBlocks },
          buildDistrictAffinity(world, entries),
        ),
        entries,
      );

  const plots: Record<string, Plot> = {};
  const occupied = new Set<string>();

  // The capitol's reserve is marked taken before a single file is placed, so
  // both the district search and the overflow search step over it for free.
  // A plot allocated inside the mall would put an office block through the
  // rotunda, and the renderer has no say in where files land.
  reserveCapitol({ width, height }, occupied);

  const districtByPath = new Map(districts.map((district) => [district.path, district]));

  for (const file of world.files) {
    const persisted = options.previousPlots?.[file.path];
    if (!persisted) {
      continue;
    }
    // A plot from a larger field, or from before the lattice existed, would
    // either sit outside the city or on a lane -- isPlotCell rejects every
    // shape a legal plot cannot have. That alone is not enough, though: a
    // plot from before the districts were made hierarchical can still be a
    // structurally legal lattice cell while sitting in a totally different
    // folder's district now that the tree has been rebuilt around it -- so a
    // persisted plot is only kept when it also still falls inside the
    // district its own file resolves to today. A file whose directory
    // matches no district at all (the overflow case) has no district to be
    // outside of, so it keeps the looser, structural-only check.
    const district = districtForFile(file.directory, districtByPath);
    const withinOwnDistrict =
      !district ||
      (persisted.x >= district.x &&
        persisted.x < district.x + district.width &&
        persisted.y >= district.y &&
        persisted.y < district.y + district.height);

    if (
      persisted.x >= 0 &&
      persisted.x < width &&
      persisted.y >= 0 &&
      persisted.y < height &&
      isPlotCell(persisted.x, persisted.y) &&
      withinOwnDistrict &&
      !occupied.has(plotKey(persisted))
    ) {
      plots[file.path] = persisted;
      occupied.add(plotKey(persisted));
    }
  }

  const plotCellsByDistrict = new Map<string, Plot[]>();
  const cursorByDistrict = new Map<string, number>();

  // loc desc gives each district a skyline: the biggest files land nearest
  // its own centre, per districtPlotCells' block ordering. Ties break on path
  // so the whole allocation stays deterministic.
  const remainingFiles = [...world.files].sort((left, right) => {
    if (left.loc !== right.loc) {
      return right.loc - left.loc;
    }
    return left.path.localeCompare(right.path);
  });

  for (const file of remainingFiles) {
    if (plots[file.path]) {
      continue;
    }
    const district = districtForFile(file.directory, districtByPath);

    let plot: Plot | undefined;
    if (district) {
      if (!plotCellsByDistrict.has(district.path)) {
        plotCellsByDistrict.set(district.path, districtPlotCells(district, { width, height }));
        cursorByDistrict.set(district.path, 0);
      }
      const cells = plotCellsByDistrict.get(district.path) as Plot[];
      let cursor = cursorByDistrict.get(district.path) as number;
      while (cursor < cells.length && occupied.has(plotKey(cells[cursor] as Plot))) {
        cursor += 1;
      }
      if (cursor < cells.length) {
        plot = cells[cursor];
        cursor += 1;
      }
      cursorByDistrict.set(district.path, cursor);
    }

    if (!plot) {
      const anchor = district
        ? {
            x: Math.round(district.x + district.width / 2),
            y: Math.round(district.y + district.height / 2),
          }
        : { x: Math.round(width / 2), y: Math.round(height / 2) };
      plot = findNearestPlot(anchor.x, anchor.y, occupied, { width, height });
    }

    plots[file.path] = plot;
    occupied.add(plotKey(plot));
  }

  const buildings: Building[] = world.files.map((file) => ({
    path: file.path,
    district: file.directory || "/",
    language: file.language,
    loc: file.loc,
    plot: plots[file.path] as Plot,
  }));

  return {
    plots,
    snapshot: {
      id: `world:${world.revision}`,
      repoPath: world.repoPath,
      revision: world.revision,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      size: { width, height },
      districts,
      buildings,
      layoutVersion: LAYOUT_VERSION,
    },
  };
}
