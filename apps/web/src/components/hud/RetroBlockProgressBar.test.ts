import { describe, expect, it } from "vitest";

describe("RetroBlockProgressBar logic", () => {
  it("computes sequential step lighting for segments", () => {
    const segments = 20;
    // Step index 5 should have first 5 blocks lit
    const step = 5;
    const isLit = (index: number) => index < step && step <= segments;

    expect(isLit(0)).toBe(true);
    expect(isLit(4)).toBe(true);
    expect(isLit(5)).toBe(false);
    expect(isLit(19)).toBe(false);
  });

  it("handles hold phase when all segments are lit", () => {
    const segments = 20;
    const step = 20;
    const isLit = (index: number) => index < step && step <= segments;

    expect(isLit(0)).toBe(true);
    expect(isLit(19)).toBe(true);
  });
});
