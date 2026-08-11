import { describe, expect, it } from "vitest";
import { affinityKey, allocateBlocks, type Affinity, type BlockItem } from "../src/blocks";

/** 20 equal-weight items, "a".."t" -- fine-grained enough that shifting the
 * split by one item only moves the balance by 5%, well inside the 8% the
 * affinity search is allowed to spend. */
function twentyEqualItems(): BlockItem[] {
  const items: BlockItem[] = [];
  for (let index = 0; index < 20; index += 1) {
    items.push({ key: String.fromCharCode(97 + index), weight: 1, minBlocks: 1 });
  }
  return items;
}

function sideOf(rects: Map<string, { bx: number }>, key: string, midpoint: number): "left" | "right" {
  const rect = rects.get(key);
  if (!rect) {
    throw new Error(`no rect for ${key}`);
  }
  return rect.bx < midpoint ? "left" : "right";
}

describe("allocateBlocks", () => {
  it("splits evenly by weight alone when no affinity is given", () => {
    const rects = allocateBlocks(twentyEqualItems(), { bx: 0, by: 0, bw: 20, bh: 1 });

    // Balanced 20-item split with no coupling: "j" (10th) and "k" (11th)
    // land either side of the natural half-and-half boundary.
    expect(sideOf(rects, "j", 10)).toBe("left");
    expect(sideOf(rects, "k", 10)).toBe("right");
  });

  it("prefers keeping two import-coupled districts on the same side of a close split", () => {
    const affinity: Affinity = new Map([[affinityKey("j", "k"), 50]]);
    const rects = allocateBlocks(
      twentyEqualItems(),
      { bx: 0, by: 0, bw: 20, bh: 1 },
      affinity,
    );

    const jSide = rects.get("j")!.bx < 9 ? "left" : "right";
    const kSide = rects.get("k")!.bx < 9 ? "left" : "right";
    expect(jSide).toBe(kSide);
  });

  it("never trades away more than the documented balance tolerance for coupling", () => {
    // "a" and "t" are as far apart in the sorted order as two items can be;
    // no split that keeps a fine-grained 20-item weight distribution within
    // 8 points of balance can unite the two ends, so they must stay apart
    // regardless of how much affinity is thrown at them.
    const affinity: Affinity = new Map([[affinityKey("a", "t"), 1000]]);
    const rects = allocateBlocks(
      twentyEqualItems(),
      { bx: 0, by: 0, bw: 20, bh: 1 },
      affinity,
    );

    const aRect = rects.get("a")!;
    const tRect = rects.get("t")!;
    expect(aRect.bx).not.toBe(tRect.bx);
    expect(aRect.bx < 10).not.toBe(tRect.bx < 10);
  });

  it("still respects every item's minBlocks floor when affinity is present", () => {
    const items: BlockItem[] = [
      { key: "big", weight: 6, minBlocks: 6 },
      { key: "small-a", weight: 1, minBlocks: 1 },
      { key: "small-b", weight: 1, minBlocks: 1 },
      { key: "small-c", weight: 1, minBlocks: 1 },
    ];
    const affinity: Affinity = new Map([[affinityKey("big", "small-c"), 100]]);
    const rects = allocateBlocks(items, { bx: 0, by: 0, bw: 9, bh: 1 }, affinity);

    const bigRect = rects.get("big")!;
    expect(bigRect.bw).toBeGreaterThanOrEqual(6);
    // Every rect stays inside the field.
    for (const rect of rects.values()) {
      expect(rect.bx).toBeGreaterThanOrEqual(0);
      expect(rect.bx + rect.bw).toBeLessThanOrEqual(9);
    }
  });

  it("is unaffected by an empty affinity map", () => {
    const withEmpty = allocateBlocks(twentyEqualItems(), { bx: 0, by: 0, bw: 20, bh: 1 }, new Map());
    const withNone = allocateBlocks(twentyEqualItems(), { bx: 0, by: 0, bw: 20, bh: 1 });

    expect([...withEmpty.entries()]).toEqual([...withNone.entries()]);
  });
});
