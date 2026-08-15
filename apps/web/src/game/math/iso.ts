/**
 * Tile dimensions live here rather than in textures/core.ts because they are
 * projection geometry, not a drawing detail, and the pure modules that reason
 * about screen-space placement must not pull Phaser in through the texture
 * bakery.
 */
export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;
export const HALF_TILE_WIDTH = TILE_WIDTH / 2;
export const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

/**
 * Sprites are positioned at the tile's bottom corner with origin (0.5, 1), so
 * every baked texture reserves this much room below the tile centre.
 */
export const TILE_ANCHOR_Y = HALF_TILE_HEIGHT;

export interface IsoPoint {
  x: number;
  y: number;
}

export interface IsoProjection {
  project(gridX: number, gridY: number, elevation?: number): IsoPoint;
  unproject(screenX: number, screenY: number): IsoPoint;
  depth(gridX: number, gridY: number, elevation?: number): number;
}

export function createIsoProjection(
  tileWidth: number,
  tileHeight: number,
): IsoProjection {
  const halfWidth = tileWidth / 2;
  const halfHeight = tileHeight / 2;

  return {
    project(gridX, gridY, elevation = 0) {
      return {
        x: (gridX - gridY) * halfWidth,
        y: (gridX + gridY) * halfHeight - elevation,
      };
    },
    unproject(screenX, screenY) {
      return {
        x: screenX / tileWidth + screenY / tileHeight,
        y: screenY / tileHeight - screenX / tileWidth,
      };
    },
    depth(gridX, gridY, elevation = 0) {
      return (gridX + gridY) * 10_000 + elevation;
    },
  };
}
