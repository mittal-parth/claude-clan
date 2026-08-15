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
