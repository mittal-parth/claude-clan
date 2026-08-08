import { describe, expect, it } from "vitest";

import { METER_SEGMENTS, filledSegments } from "./meter";

describe("filledSegments", () => {
  it("lights nothing at zero and everything at full", () => {
    expect(filledSegments(0)).toBe(0);
    expect(filledSegments(100)).toBe(METER_SEGMENTS);
  });

  it("rounds to the nearest cell", () => {
    expect(filledSegments(50)).toBe(10);
    expect(filledSegments(52)).toBe(10);
    expect(filledSegments(53)).toBe(11);
    expect(filledSegments(2.4)).toBe(0);
    expect(filledSegments(2.6)).toBe(1);
  });

  it("clamps a reading that ran past its budget", () => {
    expect(filledSegments(140)).toBe(METER_SEGMENTS);
    expect(filledSegments(1_000)).toBe(METER_SEGMENTS);
  });

  it("lights nothing for a negative or unusable reading", () => {
    expect(filledSegments(-5)).toBe(0);
    expect(filledSegments(Number.NaN)).toBe(0);
    expect(filledSegments(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("honours a custom segment count", () => {
    expect(filledSegments(50, 10)).toBe(5);
    expect(filledSegments(100, 10)).toBe(10);
    expect(filledSegments(999, 10)).toBe(10);
  });
});
