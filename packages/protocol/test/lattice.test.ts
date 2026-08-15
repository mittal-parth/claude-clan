import { describe, expect, it } from "vitest";
import {
  BLOCK,
  RING_ORDER,
  blockOf,
  blocksAcross,
  isCourtyardCell,
  isPlotCell,
  isRoadLane,
} from "../src/lattice";

describe("the lattice", () => {
  it("never puts a plot cell on a lane", () => {
    for (let x = -BLOCK * 3; x < BLOCK * 3; x += 1) {
      for (let y = -BLOCK * 3; y < BLOCK * 3; y += 1) {
        if (isPlotCell(x, y)) {
          expect(isRoadLane(x, y)).toBe(false);
        }
      }
    }
  });

  it("gives every plot cell a lane on at least one orthogonal side", () => {
    for (let x = 0; x < BLOCK * 3; x += 1) {
      for (let y = 0; y < BLOCK * 3; y += 1) {
        if (!isPlotCell(x, y)) {
          continue;
        }
        const frontage =
          isRoadLane(x + 1, y) || isRoadLane(x - 1, y) || isRoadLane(x, y + 1) || isRoadLane(x, y - 1);
        expect(frontage).toBe(true);
      }
    }
  });

  it("splits a block into 8 plots, 8 verges and 9 courtyard cells", () => {
    let plots = 0;
    let courtyard = 0;
    let lanes = 0;
    let verges = 0;
    for (let x = 0; x < BLOCK; x += 1) {
      for (let y = 0; y < BLOCK; y += 1) {
        if (isRoadLane(x, y)) {
          lanes += 1;
        } else if (isPlotCell(x, y)) {
          plots += 1;
        } else if (isCourtyardCell(x, y)) {
          courtyard += 1;
        } else {
          verges += 1;
        }
      }
    }
    expect(plots).toBe(8);
    expect(courtyard).toBe(9);
    expect(verges).toBe(8);
    // 36 cells in a block; lanes are the remainder (the north and west edge
    // lanes, 6 + 6 cells, minus their shared corner counted twice: 11).
    expect(lanes).toBe(11);
    expect(plots + courtyard + verges + lanes).toBe(BLOCK * BLOCK);
  });

  it("classifies negative coordinates the same as the equivalent positive ones", () => {
    for (let x = -BLOCK * 4; x < 0; x += 1) {
      for (let y = -BLOCK * 4; y < 0; y += 1) {
        const mirrorX = ((x % BLOCK) + BLOCK) % BLOCK;
        const mirrorY = ((y % BLOCK) + BLOCK) % BLOCK;
        expect(isRoadLane(x, y)).toBe(isRoadLane(mirrorX, mirrorY));
        expect(isPlotCell(x, y)).toBe(isPlotCell(mirrorX, mirrorY));
        expect(isCourtyardCell(x, y)).toBe(isCourtyardCell(mirrorX, mirrorY));
      }
    }
  });

  it("never doubles up two adjacent lattice lanes", () => {
    // A "twin road" is two parallel road lanes one tile apart. Fixing y to a
    // row that is not itself a lane isolates the x-driven lane crossings:
    // isRoadLane(x, y) is then true only when x % BLOCK === 0, and two
    // multiples of BLOCK can never be one tile apart for BLOCK > 1.
    const y = 1;
    for (let x = 0; x < BLOCK * 6; x += 1) {
      if (isRoadLane(x, y) && isRoadLane(x + 1, y)) {
        throw new Error(`adjacent lanes at x=${x} and x=${x + 1}`);
      }
    }
  });

  it("indexes blocks by floor division", () => {
    expect(blockOf(0, 0)).toEqual({ bx: 0, by: 0 });
    expect(blockOf(BLOCK - 1, BLOCK - 1)).toEqual({ bx: 0, by: 0 });
    expect(blockOf(BLOCK, BLOCK)).toEqual({ bx: 1, by: 1 });
    expect(blockOf(-1, -1)).toEqual({ bx: -1, by: -1 });
  });

  it("counts whole blocks across a span, with the field's own edge lane spare", () => {
    expect(blocksAcross(BLOCK + 1)).toBe(1);
    expect(blocksAcross(BLOCK * 4 + 1)).toBe(4);
    expect(blocksAcross(BLOCK * 4)).toBe(3);
  });

  it("lists exactly the block's eight ring positions, each once", () => {
    expect(RING_ORDER).toHaveLength(8);
    const unique = new Set(RING_ORDER.map(([x, y]) => `${x}:${y}`));
    expect(unique.size).toBe(8);
    for (const [x, y] of RING_ORDER) {
      expect(isPlotCell(x, y)).toBe(true);
    }
  });
});
