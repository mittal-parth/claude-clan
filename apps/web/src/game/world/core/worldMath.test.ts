import { describe, expect, it, vi } from "vitest";

// worldMath.ts also carries Phaser-dependent helpers (camera/pointer math),
// so importing it drags in real phaser -- which needs a DOM this plain node
// test doesn't have. headingFromTangent itself touches none of that.
vi.mock("phaser", () => ({ default: {} }));

import { headingFromTangent } from "./worldMath";
import { TILE_HEIGHT, TILE_WIDTH } from "../../textures/core";
import {
  YAW_ALONGSIDE_IN,
  YAW_INBOUND,
  YAW_OUTBOUND,
  YAW_SEAWARD,
} from "./worldConstants";

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

describe("headingFromTangent", () => {
  // Same "ahead"/"seaward" vectors the harbour and navy courses are built
  // from -- the fixed yaws a departing/arriving ship used to snap between.
  const ahead = { x: TILE_WIDTH / 2, y: -TILE_HEIGHT / 2 };
  const seaward = { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };

  it("matches the outbound heading along the fairway leg", () => {
    expect(normalizeAngle(headingFromTangent(ahead.x, ahead.y))).toBeCloseTo(
      normalizeAngle(YAW_OUTBOUND),
    );
  });

  it("matches the seaward heading along the open-sea leg", () => {
    expect(
      normalizeAngle(headingFromTangent(seaward.x, seaward.y)),
    ).toBeCloseTo(normalizeAngle(YAW_SEAWARD));
  });

  it("matches the alongside heading on the reverse fairway leg", () => {
    expect(
      normalizeAngle(headingFromTangent(-ahead.x, -ahead.y)),
    ).toBeCloseTo(normalizeAngle(YAW_ALONGSIDE_IN));
  });

  it("matches the inbound heading on the reverse open-sea leg", () => {
    expect(
      normalizeAngle(headingFromTangent(-seaward.x, -seaward.y)),
    ).toBeCloseTo(normalizeAngle(YAW_INBOUND));
  });
});
