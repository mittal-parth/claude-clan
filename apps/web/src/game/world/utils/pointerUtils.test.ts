import { describe, expect, it } from "vitest";
import { isCanvasPointer } from "./pointerUtils";

/** Just enough of a Phaser pointer for the guard to read. */
function pointerWithTarget(
  target: unknown,
  canvas: unknown,
): Parameters<typeof isCanvasPointer>[0] {
  return {
    event: target === undefined ? undefined : ({ target } as unknown),
    manager: { canvas },
  } as unknown as Parameters<typeof isCanvasPointer>[0];
}

describe("isCanvasPointer", () => {
  const canvas = { id: "game-canvas" };

  it("accepts a press that landed on the game canvas", () => {
    expect(isCanvasPointer(pointerWithTarget(canvas, canvas))).toBe(true);
  });

  it("rejects a press that landed on HTML floating above the canvas", () => {
    // The login card's button, a HUD button, an open dialog -- Phaser's window
    // listeners feed all of these through world hit-testing.
    expect(isCanvasPointer(pointerWithTarget({ id: "login" }, canvas))).toBe(
      false,
    );
  });

  it("accepts a pointer with no DOM event behind it", () => {
    expect(isCanvasPointer(pointerWithTarget(undefined, canvas))).toBe(true);
  });
});
