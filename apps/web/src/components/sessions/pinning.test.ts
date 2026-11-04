import { describe, expect, it } from "vitest";
import { nextPinned, PIN_THRESHOLD_PX } from "./pinning";

const at = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("nextPinned", () => {
  it("stays pinned when content grows by more than the threshold under a stationary viewport", () => {
    // Bottom was 600; a big paragraph arrives before the catch-up scroll fires.
    const grown = at(600, 1000 + PIN_THRESHOLD_PX * 4);
    expect(nextPinned(true, grown, 600)).toBe(true);
  });

  it("unpins when the user scrolls up away from the bottom", () => {
    expect(nextPinned(true, at(300), 600)).toBe(false);
  });

  it("does not re-pin while the user is reading above the bottom", () => {
    expect(nextPinned(false, at(320), 300)).toBe(false);
  });

  it("re-pins once the user scrolls back to the bottom", () => {
    expect(nextPinned(false, at(600), 500)).toBe(true);
  });

  it("stays pinned when the content shrinks and the browser clamps scrollTop", () => {
    expect(nextPinned(true, at(500, 900), 600)).toBe(true);
  });
});
