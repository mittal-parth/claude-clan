import { TILE_WIDTH, Baker, TILE_ANCHOR_Y, shade, Corner } from "./core";
import Phaser from "phaser";

export const SCAFFOLD_KEY = "fx:scaffold";


/** Height of the baked scaffold, which is scaled to the building it wraps. */
export const SCAFFOLD_HEIGHT = 120;


/**
 * Heavier steel scaffolding, wrapped around every building a PR touches so a
 * diff reads as a site under construction rather than only as a tint.
 */
export const DIFF_SCAFFOLD_KEY = "fx:diff-scaffold";

export const DIFF_SCAFFOLD_HEIGHT = 140;

/** Wider than a tile: the cage stands clear of the walls it wraps. */
export const DIFF_SCAFFOLD_WIDTH = TILE_WIDTH + 8;


/**
 * Scaffold poles standing on the plot's four corners with ledgers between them.
 * Baked at a fixed height and scaled to whatever building it wraps, which
 * stretches the ledger spacing but leaves the poles vertical.
 */
export function bakeScaffold(baker: Baker): void {
  const graphics = baker.graphics;
  const originY = SCAFFOLD_HEIGHT - TILE_ANCHOR_Y;
  const half = 0.47;
  const pole = 0xd8b061;
  const corners: Array<[number, number]> = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];

  // Ledgers first so the poles read in front of them.
  graphics.lineStyle(2, pole, 0.85);
  for (let level = 0; level <= 3; level += 1) {
    const height = (level / 3) * (SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 6);
    const ring = corners.map(([u, v]) =>
      baker.at([u, v, height], TILE_WIDTH / 2, originY),
    );
    graphics.strokePoints(ring, true);
  }

  graphics.fillStyle(pole, 1);
  for (const [u, v] of corners) {
    const foot = baker.at([u, v, 0], TILE_WIDTH / 2, originY);
    const head = baker.at(
      [u, v, SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 6],
      TILE_WIDTH / 2,
      originY,
    );
    graphics.fillRect(foot.x - 1, head.y, 3, foot.y - head.y);
  }

  baker.finish(SCAFFOLD_KEY, TILE_WIDTH, SCAFFOLD_HEIGHT);
}


/**
 * The diff scaffold: the tube-and-clamp cage that goes up around a building
 * under construction. Standards on the plot corners and at the middle of each
 * bay, a ledger and toe board at every lift, cross-bracing between lifts and
 * a sheet of netting behind it all.
 *
 * Only the two faces that point at the camera are drawn -- the back two are
 * behind the building and would only show through it as noise.
 *
 * Baked in near-white steel so the scene can tint one texture per change kind;
 * the tint multiplies, so anything already coloured here would drag the result
 * off-hue.
 */
export function bakeDiffScaffold(baker: Baker): void {
  const graphics = baker.graphics;
  const originY = DIFF_SCAFFOLD_HEIGHT - TILE_ANCHOR_Y;
  const steel = 0xdfe7ee;
  const shade = 0x9fadbb;
  const lifts = 4;
  /** Standards per face: corners plus one in the middle. */
  const bays = 2;
  /** Leaves room for the standards to stand proud of the top lift. */
  const top = DIFF_SCAFFOLD_HEIGHT - TILE_ANCHOR_Y - 10;
  const overshoot = 6;

  // Half a tile out from the centre, so the cage clears the walls it wraps.
  const half = 0.5;
  const east: Corner = [half, -half];
  const south: Corner = [half, half];
  const west: Corner = [-half, half];
  const faces: Array<[Corner, Corner]> = [
    [west, south],
    [south, east],
  ];

  const at = (corner: Corner, height: number): Phaser.Math.Vector2 =>
    baker.at(
      [corner[0], corner[1], height],
      DIFF_SCAFFOLD_WIDTH / 2,
      originY,
    );
  const along = (a: Corner, b: Corner, t: number): Corner => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const liftHeight = (lift: number): number => (lift / lifts) * top;

  // Netting behind the frame.
  graphics.fillStyle(shade, 0.14);
  for (const [a, b] of faces) {
    graphics.fillPoints(
      [at(a, 0), at(b, 0), at(b, top), at(a, top)],
      true,
    );
  }

  // Cross-bracing, one diagonal per bay per lift, alternating direction the
  // way real bracing zig-zags up a face.
  graphics.lineStyle(1, steel, 0.45);
  for (const [a, b] of faces) {
    for (let lift = 0; lift < lifts; lift += 1) {
      for (let bay = 0; bay < bays; bay += 1) {
        const left = along(a, b, bay / bays);
        const right = along(a, b, (bay + 1) / bays);
        const rising = (lift + bay) % 2 === 0;
        const foot = at(rising ? left : right, liftHeight(lift));
        const head = at(rising ? right : left, liftHeight(lift + 1));
        graphics.lineBetween(foot.x, foot.y, head.x, head.y);
      }
    }
  }

  // Ledgers, each with a toe board hanging under it.
  for (const [a, b] of faces) {
    for (let lift = 0; lift <= lifts; lift += 1) {
      const height = liftHeight(lift);
      const from = at(a, height);
      const to = at(b, height);
      graphics.fillStyle(shade, 0.5);
      graphics.fillPoints(
        [
          from,
          to,
          new Phaser.Math.Vector2(to.x, to.y + 3),
          new Phaser.Math.Vector2(from.x, from.y + 3),
        ],
        true,
      );
      graphics.lineStyle(2, steel, 0.9);
      graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  // Standards last, so they read in front of everything they carry.
  for (const [a, b] of faces) {
    for (let post = 0; post <= bays; post += 1) {
      const corner = along(a, b, post / bays);
      const width = post === 0 || post === bays ? 3 : 2;
      const foot = at(corner, 0);
      const head = at(corner, top + overshoot);
      graphics.fillStyle(shade, 1);
      graphics.fillRect(foot.x - width / 2, head.y, width, foot.y - head.y);
      graphics.fillStyle(steel, 1);
      graphics.fillRect(
        foot.x - width / 2,
        head.y,
        Math.max(1, width - 1),
        foot.y - head.y,
      );
    }
  }

  baker.finish(DIFF_SCAFFOLD_KEY, DIFF_SCAFFOLD_WIDTH, DIFF_SCAFFOLD_HEIGHT);
}
