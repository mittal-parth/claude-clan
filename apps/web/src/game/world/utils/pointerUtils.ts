import type Phaser from "phaser";

/**
 * True when the DOM event behind this pointer actually happened on the game
 * canvas rather than on an HTML element floating above it.
 *
 * Phaser's `input.windowEvents` (on by default) attaches `mousedown` and
 * `mouseup` to the window *specifically* for events whose target is not the
 * canvas, so that a drag released off-canvas still ends. The cost is that
 * every click on our HTML layer is also fed through world hit-testing: the
 * login card sits over the middle of the demo city, so pressing "LOGIN WITH
 * GITHUB" landed on the capitol's hit area underneath and opened the issue
 * shop behind the card. The same goes for any HUD button or dialog that
 * happens to overlap a landmark, and for the plain building selection the
 * camera controller does on release.
 *
 * Every world click handler must therefore ask where the press came from.
 * Drag *teardown* must not -- that is the case window events exist for.
 */
export function isCanvasPointer(pointer: Phaser.Input.Pointer): boolean {
  const target = pointer.event?.target;
  // No target at all (synthetic pointers, touch events replayed by Phaser)
  // is treated as canvas input; only a real element that is demonstrably
  // something else is rejected.
  return !target || target === pointer.manager.canvas;
}
