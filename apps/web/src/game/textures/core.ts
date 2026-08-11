import Phaser, { Scene } from "phaser";

export const TILE_WIDTH = 96;

export const TILE_HEIGHT = 48;

export const HALF_W = TILE_WIDTH / 2;

export const HALF_H = TILE_HEIGHT / 2;


/**
 * Sprites are positioned at the tile's bottom corner with origin (0.5, 1), so
 * every baked texture reserves this much room below the tile centre.
 */
export const TILE_ANCHOR_Y = HALF_H;


/** [u, v, height] — u/v in tile units from the tile centre, height in pixels up. */
export type Point3 = readonly [number, number, number];


/** A point on the ground plane, in the same tile units as Point3's u/v. */
export type Corner = readonly [number, number];


export function shade(color: number, amount: number): number {
  const value = Phaser.Display.Color.IntegerToColor(color);
  return amount >= 0 ? value.lighten(amount).color : value.darken(-amount).color;
}


export function createBaker(scene: Phaser.Scene) {
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);

  return {
    graphics,
    /** Projects a grid-space point into the texture's pixel space. */
    at(point: Point3, originX: number, originY: number): Phaser.Math.Vector2 {
      return new Phaser.Math.Vector2(
        originX + (point[0] - point[1]) * HALF_W,
        originY + (point[0] + point[1]) * HALF_H - point[2],
      );
    },
    finish(key: string, width: number, height: number): void {
      if (scene.textures.exists(key)) {
        scene.textures.remove(key);
      }
      graphics.generateTexture(key, width, height);
      graphics.clear();
    },
    /** Bakes what has been drawn so far without clearing — used by the atlas. */
    flush(key: string, width: number, height: number): void {
      if (scene.textures.exists(key)) {
        scene.textures.remove(key);
      }
      graphics.generateTexture(key, width, height);
    },
    destroy(): void {
      graphics.destroy();
    },
  };
}


export type Baker = ReturnType<typeof createBaker>;


export function fillFace(
  baker: Baker,
  color: number,
  alpha: number,
  points: readonly Point3[],
  originX: number,
  originY: number,
): void {
  baker.graphics.fillStyle(color, alpha);
  baker.graphics.fillPoints(
    points.map((point) => baker.at(point, originX, originY)),
    true,
  );
}


export function strokeFace(
  baker: Baker,
  color: number,
  alpha: number,
  width: number,
  points: readonly Point3[],
  originX: number,
  originY: number,
): void {
  baker.graphics.lineStyle(width, color, alpha);
  baker.graphics.strokePoints(
    points.map((point) => baker.at(point, originX, originY)),
    true,
  );
}


export const diamond = (half: number, height = 0): Point3[] => [
  [-half, -half, height],
  [half, -half, height],
  [half, half, height],
  [-half, half, height],
];
