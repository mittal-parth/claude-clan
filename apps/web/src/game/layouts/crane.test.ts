import { describe, expect, it } from "vitest";
import {
  CRANE_CABLE_OFFSET,
  CRANE_FOOT_X,
  CRANE_FOOT_Y,
  CRANE_HEIGHT,
  CRANE_JIB_REACH,
  CRANE_JIB_Y,
  CRANE_TAIL_REACH,
  CRANE_TROLLEY_REACH,
  CRANE_WIDTH,
  counterJibPoint,
  jibPoint,
} from "./crane";

describe("crane geometry", () => {
  it("hangs the cable from a point that is actually on the jib", () => {
    // The bug this guards: the cable was positioned from the plot centre while
    // the mast sits offset inside the texture, so it hung in mid-air past the
    // end of the arm.
    const trolley = jibPoint(CRANE_TROLLEY_REACH);

    // Convert the sprite-anchor offset back into texture space.
    const textureX = CRANE_CABLE_OFFSET.x + CRANE_WIDTH / 2;
    const textureY = CRANE_CABLE_OFFSET.y + CRANE_HEIGHT;

    expect(textureX).toBeCloseTo(trolley.x, 10);
    expect(textureY).toBeCloseTo(trolley.y + 4, 10);
  });

  it("keeps the trolley inboard of the jib tip", () => {
    expect(CRANE_TROLLEY_REACH).toBeGreaterThan(0);
    expect(CRANE_TROLLEY_REACH).toBeLessThan(CRANE_JIB_REACH);
  });

  it("fits the whole crane inside its texture", () => {
    // The other bug: the jib rose out through the top of the texture and was
    // silently clipped.
    const tip = jibPoint(CRANE_JIB_REACH);
    const tail = counterJibPoint(CRANE_TAIL_REACH);

    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tail.x).toBeLessThanOrEqual(CRANE_WIDTH);
    expect(tail.y).toBeLessThanOrEqual(CRANE_HEIGHT);
    expect(CRANE_FOOT_X).toBeLessThan(CRANE_WIDTH);
    expect(CRANE_FOOT_Y).toBeLessThanOrEqual(CRANE_HEIGHT);
  });

  it("leaves room above the jib for the A-frame", () => {
    expect(CRANE_JIB_Y - 26).toBeGreaterThan(0);
  });

  it("runs the jib along the isometric axis, two across for one up", () => {
    const near = jibPoint(20);
    const far = jibPoint(60);

    // Reaching out means going left and up, so both deltas share a sign.
    expect(far.x).toBeLessThan(near.x);
    expect(far.y).toBeLessThan(near.y);
    expect((near.x - far.x) / (near.y - far.y)).toBeCloseTo(2, 10);
  });

  it("mirrors the counter-jib on the opposite side of the mast", () => {
    const out = jibPoint(40);
    const back = counterJibPoint(40);

    expect(CRANE_FOOT_X - out.x).toBe(back.x - CRANE_FOOT_X);
    expect(CRANE_JIB_Y - out.y).toBe(back.y - CRANE_JIB_Y);
  });

  it("stands the mast tall enough to clear a tower block", () => {
    // Tallest baked building body is 182px plus its crown; the jib has to be
    // above that or the crane reads as standing inside the building.
    expect(CRANE_FOOT_Y - CRANE_JIB_Y).toBeGreaterThan(120);
  });
});
