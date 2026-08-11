/**
 * The city's global block lattice.
 *
 * Before this, every district invented its own street phase from its own
 * fractional origin: two neighbouring districts whose origins differed by an
 * odd amount put their lanes one tile apart (a twin road), and the overflow
 * allocator used a third, unrelated lattice that sometimes targeted the very
 * cells a district's own lane math had put a street on -- a building would
 * win that fight and the street tile would vanish. One shared lattice, used by
 * the allocator, the terrain pass and the renderer alike, makes both failures
 * unrepresentable: there is only ever one place a road can be.
 */

/** Always returns a value in [0, modulus), unlike JS's own remainder operator. */
export function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Tiles per block, its two edge lanes included. */
export const BLOCK = 6;

/** Plot cells per block: the eight ring positions. */
export const PLOTS_PER_BLOCK = 8;

/**
 * Every third lane is at least a "street", never merely a back "lane" -- see
 * roadClassAt in the web app's terrain module. That is what gives even a flat,
 * single-district repository (no district boundaries to promote a lane) a
 * road hierarchy instead of a grid of identical back streets.
 */
export const ARTERIAL_BLOCKS = 3;

/** True on a lattice lane: the shared street grid, independent of any district. */
export function isRoadLane(x: number, y: number): boolean {
  return mod(x, BLOCK) === 0 || mod(y, BLOCK) === 0;
}

/**
 * True on one of a block's eight ring positions -- odd/odd offsets within the
 * block, excluding the centre. Every ring position is orthogonally adjacent to
 * a lane (offset 1 and 5 sit one tile off the block's own edge lanes), which is
 * what guarantees every plot has street frontage. The block centre (3, 3) is
 * two tiles from any lane in both axes and is deliberately excluded -- it is
 * the one interior position a lattice this size cannot give frontage to, so it
 * becomes the courtyard's core instead of a landlocked building.
 */
export function isPlotCell(x: number, y: number): boolean {
  const ox = mod(x, BLOCK);
  const oy = mod(y, BLOCK);
  return ox % 2 === 1 && oy % 2 === 1 && !(ox === 3 && oy === 3);
}

/** True for the 3x3 core of a block: offsets 2..4 in both axes. */
export function isCourtyardCell(x: number, y: number): boolean {
  const ox = mod(x, BLOCK);
  const oy = mod(y, BLOCK);
  return ox >= 2 && ox <= 4 && oy >= 2 && oy <= 4;
}

/** The block index containing a tile. */
export function blockOf(x: number, y: number): { bx: number; by: number } {
  return { bx: Math.floor(x / BLOCK), by: Math.floor(y / BLOCK) };
}

/** Whole blocks that fit across a span of this many tiles. */
export function blocksAcross(span: number): number {
  return Math.floor((span - 1) / BLOCK);
}

/**
 * The eight ring offsets within a block, in allocation order: the four corners
 * clockwise, then the four mid-edges clockwise. Filling corners first is what
 * gives a half-occupied block a solid core with a soft edge instead of a
 * building scattered at random across its frontage.
 */
export const RING_ORDER: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [5, 1],
  [5, 5],
  [1, 5],
  [3, 1],
  [5, 3],
  [3, 5],
  [1, 3],
];

/**
 * Nudges a proposed centre coordinate so that a fixed-size ring around it
 * never sits exactly one tile parallel to a lattice lane -- the shape a twin
 * road takes. A ring edge is safe when it lands *on* a lane (residue 0, which
 * welds the two into one road) or at least two tiles clear of one (residue
 * 2..4); residue 1 or BLOCK-1 is the one-tile gap that reads as a doubled
 * road running beside the real street.
 *
 * This is deliberately independent of the reserve's own size: it works for
 * any fixed half-extent, symmetric or not, so a landmark's footprint never
 * has to grow to a whole number of blocks just to stay off this trap -- only
 * its centre has to move, and only by a tile or two.
 */
export function nearestLatticeSafeCentre(
  ideal: number,
  halfBefore: number,
  halfAfter: number,
): number {
  const isSafeEdge = (edge: number): boolean => {
    const residue = mod(edge, BLOCK);
    return residue !== 1 && residue !== BLOCK - 1;
  };
  const isSafe = (candidate: number): boolean =>
    isSafeEdge(candidate - halfBefore) && isSafeEdge(candidate + halfAfter);

  if (isSafe(ideal)) {
    return ideal;
  }
  for (let delta = 1; delta <= BLOCK; delta += 1) {
    if (isSafe(ideal - delta)) {
      return ideal - delta;
    }
    if (isSafe(ideal + delta)) {
      return ideal + delta;
    }
  }
  // Unreachable: BLOCK candidates cover every residue class at least once.
  return ideal;
}
