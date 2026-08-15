import { Baker, TILE_ANCHOR_Y, fillFace, diamond, HALF_W, shade, TILE_WIDTH, Point3 } from "./core";
import { TERRAIN_COLORS } from "../math/palette";
import { SHIP_HEADING_FRAMES, shipHeadingAngle } from "./harbour/ship";
import { harbourPost } from "./harbour/base";

export const CAR_KEYS = ["fx:car:0", "fx:car:1", "fx:car:2", "fx:car:3"] as const;


export const CAR_COLORS = [0xe4572e, 0x2e86ab, 0xf6f5ae, 0x4a4e69] as const;


export const CAR_TEXTURE_HEIGHT = 44;


export function bakeCar(baker: Baker, key: string, index: number): void {
  const color = CAR_COLORS[index] as number;
  // Tile-anchored like every other sprite: origin (0.5, 1) at the tile's
  // bottom corner, so the drawing origin sits TILE_ANCHOR_Y above the bottom.
  const originY = CAR_TEXTURE_HEIGHT - TILE_ANCHOR_Y;
  fillFace(baker, TERRAIN_COLORS.shadow, 0.25, diamond(0.1), HALF_W, originY);
  fillFace(baker, color, 1, [
    [-0.1, -0.06, 7],
    [0.1, -0.06, 7],
    [0.1, 0.06, 7],
    [-0.1, 0.06, 7],
  ], HALF_W, originY);
  fillFace(baker, shade(color, -22), 1, [
    [0.1, -0.06, 7],
    [0.1, 0.06, 7],
    [0.1, 0.06, 0],
    [0.1, -0.06, 0],
  ], HALF_W, originY);
  fillFace(baker, shade(color, -10), 1, [
    [-0.1, 0.06, 7],
    [0.1, 0.06, 7],
    [0.1, 0.06, 0],
    [-0.1, 0.06, 0],
  ], HALF_W, originY);

  baker.finish(key, TILE_WIDTH, CAR_TEXTURE_HEIGHT);
}


/**
 * A small wooden sailboat, baked across the same 24 headings as the harbour
 * fleet. Purely decorative: it plays no part in PR or issue travel, and just
 * tacks a slow loop through open water around the island for atmosphere.
 */
export const WOODEN_SHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:wooden-ship:${index}`,
);

export const WOODEN_SHIP_KEY = WOODEN_SHIP_KEYS[0]!;

export const WOODEN_SHIP_ANCHOR_Y = 42;


export const WOODEN_SHIP_CANVAS = 140;


/**
 * A small single-mast sailboat, authored bow toward -v like every other
 * heading-baked hull, and turned the same way: rotating (u, v) about her
 * centre swings the bow round while z -- so mast and sail height -- is left
 * alone. See bakeHarbourContainerShip for why this is baked per heading
 * rather than done with setRotation.
 */
export function bakeWoodenShip(source: Baker, key: string, frame: number): void {
  const width = WOODEN_SHIP_CANVAS;
  const height = WOODEN_SHIP_CANVAS;
  const originX = width / 2;
  const originY = height - WOODEN_SHIP_ANCHOR_Y;
  const deck = 8;

  const angle = shipHeadingAngle(frame);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [
                point[0] * cos - point[1] * sin,
                point[0] * sin + point[1] * cos,
                point[2],
              ],
              ox,
              oy,
            ),
        };

  const hullColor = 0x8a5a34;
  const bootColor = shade(hullColor, -30);
  const sailColor = 0xf3ead8;

  /** A face's outward normal, turned with the hull -- lighting stays fixed to the world. */
  const facing = (nu: number, nv: number, color: number): number => {
    const length = Math.hypot(nu, nv) || 1;
    const u = (nu * cos - nv * sin) / length;
    const v = (nu * sin + nv * cos) / length;
    return shade(color, Math.round(10 * v - 30 * u));
  };

  // Starboard sheer, bow to stern; mirrored below for a closed hull with a
  // small flat transom rather than a pointed stern.
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -0.55],
    [0.12, -0.35],
    [0.15, -0.05],
    [0.15, 0.22],
    [0.1, 0.4],
  ];
  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    ...[...sheer].reverse().map(([u, v]) => [-u, v] as const).slice(0, -1),
  ];

  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(0xffffff, 0.22);
  baker.graphics.fillEllipse(waterline.x + 4, waterline.y + 3, 46, 12);

  // Hull plating: drop every edge of the outline to the waterline, then a
  // darker boot-topping band along the same run.
  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hullColor),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, bootColor),
      1,
      [[u0, v0, 3], [u1, v1, 3], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }

  // Weather deck.
  fillFace(
    baker,
    shade(hullColor, 16),
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Mast: always a straight vertical screen line at any heading, since z
  // never shifts a projected point's x.
  harbourPost(baker, originX, originY, 0, -0.05, deck, deck + 46, 2, 0x4a3220);

  // Sail, one belly to either side of the mast so the silhouette reads at
  // every heading without needing to know which side faces the viewer.
  fillFace(
    baker,
    sailColor,
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [0.22, -0.14, deck + 27]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(sailColor, -14),
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [-0.22, -0.14, deck + 27]],
    originX,
    originY,
  );

  // Pennant at the masthead.
  fillFace(
    baker,
    0xd94f4f,
    1,
    [[0, -0.05, deck + 46], [0, -0.05, deck + 40], [0.09, -0.09, deck + 43]],
    originX,
    originY,
  );

  baker.finish(key, width, height);
}
