import { describe, expect, it } from "vitest";
import { shouldRevealSite, type RevealRules, type RevealView } from "./reveal";

/** A 1000x600 view centred on the origin corner, zoomed in far enough to read. */
const view: RevealView = {
  x: 0,
  y: 0,
  right: 1_000,
  bottom: 600,
  zoom: 1,
};

const rules: RevealRules = {
  margin: 100,
  legibleZoom: 0.75,
  now: 100_000,
  lastCameraInputAt: Number.NEGATIVE_INFINITY,
  yieldMs: 8_000,
};

describe("construction reveal", () => {
  it("leaves a site alone when it is already framed and legible", () => {
    expect(shouldRevealSite({ x: 500, y: 300 }, view, rules)).toBe(false);
  });

  it("goes and gets a site that is off screen", () => {
    expect(shouldRevealSite({ x: 4_000, y: 300 }, view, rules)).toBe(true);
  });

  it("counts a site inside the margin as not framed", () => {
    // On screen by pixels, but tight against the edge with no room for a crane.
    expect(shouldRevealSite({ x: 50, y: 300 }, view, rules)).toBe(true);
    expect(shouldRevealSite({ x: 500, y: 560 }, view, rules)).toBe(true);
  });

  it("zooms in on a framed site when the world is too far out to read", () => {
    const farOut = { ...view, zoom: 0.3 };
    expect(shouldRevealSite({ x: 500, y: 300 }, farOut, rules)).toBe(true);
  });

  it("treats the legible zoom as the bar, not a range", () => {
    const atBar = { ...view, zoom: 0.75 };
    const under = { ...view, zoom: 0.749 };
    expect(shouldRevealSite({ x: 500, y: 300 }, atBar, rules)).toBe(false);
    expect(shouldRevealSite({ x: 500, y: 300 }, under, rules)).toBe(true);
  });

  it("yields to a player who just moved the camera", () => {
    const justTouched: RevealRules = { ...rules, lastCameraInputAt: 95_000 };
    // Off screen and illegible, and it still does not move.
    expect(
      shouldRevealSite({ x: 4_000, y: 300 }, { ...view, zoom: 0.3 }, justTouched),
    ).toBe(false);
  });

  it("takes the camera back once the yield window has passed", () => {
    const settled: RevealRules = { ...rules, lastCameraInputAt: 91_999 };
    expect(shouldRevealSite({ x: 4_000, y: 300 }, view, settled)).toBe(true);
  });
});
