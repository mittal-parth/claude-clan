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

function floorMod(value: number, modulus: number): number {
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
  return floorMod(x, BLOCK) === 0 || floorMod(y, BLOCK) === 0;
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
  const ox = floorMod(x, BLOCK);
  const oy = floorMod(y, BLOCK);
  return ox % 2 === 1 && oy % 2 === 1 && !(ox === 3 && oy === 3);
}

/** True for the 3x3 core of a block: offsets 2..4 in both axes. */
export function isCourtyardCell(x: number, y: number): boolean {
  const ox = floorMod(x, BLOCK);
  const oy = floorMod(y, BLOCK);
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
