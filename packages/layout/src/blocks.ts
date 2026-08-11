/**
 * The integer block treemap districts are allocated with.
 *
 * Replaces squarify deliberately: squarify's rows are defined in continuous
 * area, and rounding each row to whole blocks after the fact is what produced
 * fractional district edges -- which is what put every district on its own
 * street phase in the first place. Cutting the longer edge of the remaining
 * rectangle in two, recursively, keeps the rectangles squarish without ever
 * producing a fractional boundary.
 */

export interface BlockRect {
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export interface BlockItem {
  key: string;
  /** Used to split area proportionally -- ordinarily the item's own minBlocks. */
  weight: number;
  /**
   * Blocks this item must receive, however the proportional split falls.
   * Defaults to 1. Without a real per-item floor, a district weighted the
   * same as its neighbour can still be shortchanged: the recursive 50/50
   * split rounds to whole blocks at every level, and two equally-weighted
   * leaves can come out of that with a different block count. One of them
   * then doesn't have room for its own files and overflows into a
   * neighbouring district's own plot cells -- which is exactly the bug this
   * guards against, not a hypothetical one.
   */
  minBlocks?: number;
}

interface ResolvedItem extends BlockItem {
  minBlocks: number;
}

/** Splits a block rectangle among weighted items, in whole blocks. */
export function allocateBlocks(items: readonly BlockItem[], rect: BlockRect): Map<string, BlockRect> {
  const resolved: ResolvedItem[] = items.map((item) => ({
    ...item,
    minBlocks: Math.max(1, item.minBlocks ?? 1),
  }));
  const result = new Map<string, BlockRect>();
  allocate(resolved, rect, result);
  return result;
}

function allocate(items: readonly ResolvedItem[], rect: BlockRect, result: Map<string, BlockRect>): void {
  if (items.length === 0) {
    return;
  }
  if (items.length === 1) {
    result.set((items[0] as ResolvedItem).key, rect);
    return;
  }

  const sorted = [...items].sort(
    (left, right) => right.weight - left.weight || left.key.localeCompare(right.key),
  );
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);

  // Split into two groups whose weights are as near half-and-half as possible.
  let running = 0;
  let bestIndex = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    running += (sorted[index - 1] as ResolvedItem).weight;
    const diff = Math.abs(running / total - 0.5);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }

  let groupA = sorted.slice(0, bestIndex);
  let groupB = sorted.slice(bestIndex);

  const horizontal = rect.bw >= rect.bh; // cut across the longer edge
  const along = horizontal ? rect.bw : rect.bh;
  const across = horizontal ? rect.bh : rect.bw;

  const minBlocksSum = (group: readonly ResolvedItem[]): number =>
    group.reduce((sum, item) => sum + item.minBlocks, 0);

  // The floor a group needs along the cut axis: enough rows of "across" depth
  // to seat every one of its items' own minBlocks, not merely one block per
  // item. This is what actually reserves each item's required area, rather
  // than the item *count* the field happens to be split into.
  let minA = Math.ceil(minBlocksSum(groupA) / across);
  let minB = Math.ceil(minBlocksSum(groupB) / across);

  // On a very deep, very uneven tree the 50/50 weight split can still leave
  // one side without enough room for its items' combined floor; rebalance by
  // moving the smallest-weight item across until both sides fit. This is a
  // correctness guard for deep trees, not a tuning knob.
  while (minA + minB > along && groupA.length > 1 && groupB.length > 1) {
    if (groupA.length >= groupB.length) {
      const moved = groupA[groupA.length - 1] as ResolvedItem;
      groupA = groupA.slice(0, -1);
      groupB = [...groupB, moved];
    } else {
      const moved = groupB[groupB.length - 1] as ResolvedItem;
      groupB = groupB.slice(0, -1);
      groupA = [...groupA, moved];
    }
    minA = Math.ceil(minBlocksSum(groupA) / across);
    minB = Math.ceil(minBlocksSum(groupB) / across);
  }
  if (minA + minB > along) {
    throw new Error(
      `Unable to allocate ${sorted.length} districts into a ${rect.bw}x${rect.bh} block field`,
    );
  }

  const weightA = groupA.reduce((sum, item) => sum + item.weight, 0);
  const rawCut = Math.round((along * weightA) / total);
  const cut = Math.min(along - minB, Math.max(minA, rawCut));

  const rectA: BlockRect = horizontal
    ? { bx: rect.bx, by: rect.by, bw: cut, bh: rect.bh }
    : { bx: rect.bx, by: rect.by, bw: rect.bw, bh: cut };
  const rectB: BlockRect = horizontal
    ? { bx: rect.bx + cut, by: rect.by, bw: rect.bw - cut, bh: rect.bh }
    : { bx: rect.bx, by: rect.by + cut, bw: rect.bw, bh: rect.bh - cut };

  allocate(groupA, rectA, result);
  allocate(groupB, rectB, result);
}
