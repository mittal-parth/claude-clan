import { Baker, fillFace, diamond, HALF_W, HALF_H, strokeFace, TILE_WIDTH, TILE_HEIGHT } from "./core";
import { propShadow, PROP_ORIGIN_Y, PROP_HEIGHT } from "./props";

export const HIGHLIGHT_KEY = "tile:highlight";

export const SELECT_KEY = "tile:select";

/** Ring marking a building added by the PR city's diff. */
export const ADDED_MARKER_KEY = "fx:added";

/** Stands in for a building deleted by the PR, at its plot in main. */
export const RUBBLE_KEY = "fx:rubble";

export const CLOUD_KEY = "fx:cloud";

export const SMOKE_KEY = "fx:smoke";

export const SPARKLE_KEY = "fx:sparkle";


export function bakeHighlight(
  baker: Baker,
  key: string,
  color: number,
  alpha: number,
): void {
  fillFace(baker, color, alpha * 0.4, diamond(0.46), HALF_W, HALF_H);
  strokeFace(baker, color, alpha, 2, diamond(0.46), HALF_W, HALF_H);
  baker.finish(key, TILE_WIDTH, TILE_HEIGHT);
}


export function bakeRubble(baker: Baker): void {
  propShadow(baker, 0.22);
  const base = baker.at([0, 0, 0], HALF_W, PROP_ORIGIN_Y);
  baker.graphics.fillStyle(0x8a7c6a, 1);
  baker.graphics.fillTriangle(
    base.x - 13,
    base.y,
    base.x + 5,
    base.y,
    base.x - 5,
    base.y - 11,
  );
  baker.graphics.fillStyle(0x6f6455, 1);
  baker.graphics.fillTriangle(
    base.x - 3,
    base.y,
    base.x + 15,
    base.y,
    base.x + 7,
    base.y - 9,
  );
  baker.graphics.fillStyle(0xa89a86, 1);
  baker.graphics.fillRect(base.x - 9, base.y - 5, 6, 5);

  baker.finish(RUBBLE_KEY, TILE_WIDTH, PROP_HEIGHT);
}


// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export function bakeCloud(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.82);
  for (const [x, y, radius] of [
    [40, 32, 22],
    [66, 28, 26],
    [96, 34, 20],
    [122, 32, 16],
  ] as const) {
    baker.graphics.fillCircle(x, y, radius);
  }
  baker.graphics.fillStyle(0xffffff, 0.95);
  baker.graphics.fillCircle(72, 24, 20);
  baker.finish(CLOUD_KEY, 160, 64);
}


export function bakeSmoke(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.5);
  baker.graphics.fillCircle(12, 12, 10);
  baker.graphics.fillStyle(0xffffff, 0.85);
  baker.graphics.fillCircle(12, 12, 6);
  baker.finish(SMOKE_KEY, 24, 24);
}


export function bakeSparkle(baker: Baker): void {
  baker.graphics.fillStyle(0xffffff, 0.75);
  baker.graphics.fillRect(0, 3, 14, 2);
  baker.graphics.fillRect(4, 0, 6, 2);
  baker.finish(SPARKLE_KEY, 16, 8);
}
