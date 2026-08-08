import { describe, expect, it } from "vitest";
import { chance, hashCoords, hashText, mod, pickIndex, unitFloat } from "./hash";

describe("deterministic hashing", () => {
  it("returns the same value for the same inputs", () => {
    expect(hashCoords(12, -7, 3)).toBe(hashCoords(12, -7, 3));
    expect(hashText("apps/web/src/App.tsx")).toBe(hashText("apps/web/src/App.tsx"));
  });

  it("separates neighbouring cells and salts", () => {
    expect(hashCoords(4, 4)).not.toBe(hashCoords(5, 4));
    expect(hashCoords(4, 4)).not.toBe(hashCoords(4, 5));
    expect(hashCoords(4, 5)).not.toBe(hashCoords(5, 4));
    expect(hashCoords(4, 4, 1)).not.toBe(hashCoords(4, 4, 2));
  });

  it("produces unsigned 32-bit values for negative coordinates", () => {
    for (let x = -30; x <= 30; x += 7) {
      for (let y = -30; y <= 30; y += 7) {
        const hashed = hashCoords(x, y);
        expect(Number.isInteger(hashed)).toBe(true);
        expect(hashed).toBeGreaterThanOrEqual(0);
        expect(hashed).toBeLessThan(0x1_0000_0000);
      }
    }
  });

  it("spreads unitFloat across [0, 1) rather than clustering", () => {
    const buckets = new Array<number>(10).fill(0);
    for (let x = 0; x < 100; x += 1) {
      for (let y = 0; y < 100; y += 1) {
        const value = unitFloat(hashCoords(x, y));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        const bucket = Math.floor(value * 10);
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      }
    }
    // A degenerate hash would pile everything into one or two buckets.
    for (const bucket of buckets) {
      expect(bucket).toBeGreaterThan(700);
      expect(bucket).toBeLessThan(1300);
    }
  });

  it("keeps pickIndex inside the array", () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const index = pickIndex(hashCoords(seed, seed), 3);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });

  it("honours the requested probability", () => {
    let hits = 0;
    for (let x = 0; x < 200; x += 1) {
      for (let y = 0; y < 200; y += 1) {
        if (chance(hashCoords(x, y, 9), 0.25)) {
          hits += 1;
        }
      }
    }
    expect(hits / 40_000).toBeCloseTo(0.25, 1);
  });

  it("returns a positive remainder for negative operands", () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-4, 4)).toBe(0);
    expect(mod(5, 4)).toBe(1);
  });
});
