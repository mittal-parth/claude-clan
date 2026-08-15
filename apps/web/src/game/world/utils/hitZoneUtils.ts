import Phaser from "phaser";
import { projection } from "../core/worldConstants";
import type { ScreenPoint } from "../core/worldMath";

/**
 * Converts a world point to the screen pixel it renders at -- not the
 * naive `(x - scrollX) * zoom`, which only happens to be correct at zoom
 * 1. Phaser zooms the camera around its viewport centre (`midPoint`, which
 * already factors in scroll, zoom and viewport size), not its origin, so
 * that shortcut drifts further up-left the more the camera is zoomed or
 * panned away from world (0, 0). Every HTML overlay that follows a world
 * position -- hover labels included -- needs this instead.
 */
export function worldToScreen(
  camera: Phaser.Cameras.Scene2D.Camera,
  x: number,
  y: number,
): ScreenPoint {
  const mid = camera.midPoint;
  return {
    x: camera.x + camera.width / 2 + (x - mid.x) * camera.zoomX,
    y: camera.y + camera.height / 2 + (y - mid.y) * camera.zoomY,
  };
}

/**
 * One invisible interactive zone covering a landmark's whole reserved
 * ground rectangle, lifted `liftPx` clear of its top edge to cover the
 * tallest structure standing on it. Replaces hanging pixel-perfect hit
 * areas off dozens of separate props -- those have real transparent gaps
 * between them, so the cursor crossing one fired pointerout then
 * pointerover on the same tick and read as the whole landmark blinking.
 * One continuous hit area has no gaps to cross.
 *
 * Safe to cover the full rectangle rather than pixel-testing it, unlike a
 * single prop's texture: the layout allocator reserves this ground
 * exclusively for the landmark (see "Reserving ground for a landmark" in
 * CLAUDE.md), so nothing else is ever drawn inside it to be swallowed.
 */
export function createFootprintHitZone(
  scene: Phaser.Scene,
  centreX: number,
  centreY: number,
  halfU: number,
  halfV: number,
  liftPx: number,
  depth: number,
): Phaser.GameObjects.Zone {
  const corner = (du: number, dv: number) =>
    projection.project(centreX + du, centreY + dv);
  const corners = [
    corner(-halfU, -halfV),
    corner(halfU, -halfV),
    corner(halfU, halfV),
    corner(-halfU, halfV),
  ];
  const top = corners.reduce((a, b) => (b.y < a.y ? b : a));
  const bottom = corners.reduce((a, b) => (b.y > a.y ? b : a));
  const left = corners.reduce((a, b) => (b.x < a.x ? b : a));
  const right = corners.reduce((a, b) => (b.x > a.x ? b : a));
  // The diamond's own outline, unioned with a copy of itself shifted
  // `liftPx` up: same left/right/bottom, but the top two edges come from
  // the shifted copy so the hit area covers the mast/roof above the slab.
  const points = [
    { x: top.x, y: top.y - liftPx },
    { x: right.x, y: right.y - liftPx },
    right,
    bottom,
    left,
    { x: left.x, y: left.y - liftPx },
  ];
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const zone = scene.add
    .zone(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY))
    .setOrigin(0, 0)
    .setDepth(depth);
  const polygon = new Phaser.Geom.Polygon(
    points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
  );
  zone.setInteractive({
    hitArea: polygon,
    hitAreaCallback: Phaser.Geom.Polygon.Contains,
    useHandCursor: true,
  });
  return zone;
}
