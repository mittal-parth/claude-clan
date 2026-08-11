import { SHIP_HEADING_FRAMES, shipHeadingAngle } from "../harbour/ship";
import { Baker, shade, Point3, fillFace } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { HARBOUR } from "../harbour/base";

export const BATTLESHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:navy-battleship:${index}`,
);

export const BATTLESHIP_KEY = BATTLESHIP_KEYS[0]!;

export const BATTLESHIP_ANCHOR_Y = 76;



// ---------------------------------------------------------------------------
// Navy Harbour & Battleship
// ---------------------------------------------------------------------------

export function bakeNavyBattleship(source: Baker, key: string, frame: number): void {
  const width = 256;
  const height = 256;
  const originX = width / 2;
  const originY = height - BATTLESHIP_ANCHOR_Y;
  const deck = 22;

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

  const hull = {
    navy: 0x2b333a,
    navyDark: 0x1f262b,
    boot: 0x992222,
    deck: 0x47515a,
    deckDark: 0x363e45,
  };

  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -2.2],
    [0.15, -1.8],
    [0.3, -1.0],
    [0.35, -0.2],
    [0.35, 1.4],
    [0.2, 1.8],
    [0, 1.8],
  ];

  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    ...[...sheer]
      .reverse()
      .map(([u, v]) => [-u, v] as const)
      .slice(1, -1),
  ];

  const turned = (nu: number, nv: number): { u: number; v: number } => {
    const length = Math.hypot(nu, nv) || 1;
    return {
      u: (nu * cos - nv * sin) / length,
      v: (nu * sin + nv * cos) / length,
    };
  };

  const facing = (nu: number, nv: number, color: number): number => {
    const normal = turned(nu, nv);
    return shade(color, Math.round(9 * normal.v - 28 * normal.u));
  };
  const showsFace = (nu: number, nv: number): boolean => {
    const normal = turned(nu, nv);
    return normal.u + normal.v > 0.02;
  };

  const solidBox = (
    bounds: readonly [number, number, number, number, number, number],
    color: number,
  ): void => {
    const [u0, u1, v0, v1, z0, z1] = bounds;
    const sides: ReadonlyArray<{
      normal: readonly [number, number];
      face: Point3[];
    }> = [
      { normal: [0, 1], face: [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]] },
      { normal: [1, 0], face: [[u1, v1, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0]] },
      { normal: [0, -1], face: [[u0, v0, z1], [u1, v0, z1], [u1, v0, z0], [u0, v0, z0]] },
      { normal: [-1, 0], face: [[u0, v1, z1], [u0, v0, z1], [u0, v0, z0], [u0, v1, z0]] },
    ];
    const ordered = [...sides].sort((left, right) => {
      const a = turned(left.normal[0], left.normal[1]);
      const b = turned(right.normal[0], right.normal[1]);
      return a.u + a.v - (b.u + b.v);
    });
    for (const side of ordered) {
      fillFace(baker, facing(side.normal[0], side.normal[1], color), 1, side.face, originX, originY);
    }
    fillFace(
      baker,
      shade(color, 14),
      1,
      [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]],
      originX,
      originY,
    );
  };

  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillEllipse(waterline.x + 6, waterline.y + 6, 170, 50);

  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hull.navy),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, hull.boot),
      1,
      [[u0, v0, 5], [u1, v1, 5], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }

  fillFace(
    baker,
    hull.deck,
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Superstructure
  solidBox([-0.25, 0.25, -0.6, 0.8, deck, deck + 12], hull.deckDark);
  solidBox([-0.2, 0.2, -0.4, 0.6, deck + 12, deck + 24], hull.deckDark);
  solidBox([-0.15, 0.15, -0.2, 0.4, deck + 24, deck + 36], hull.deckDark);

  // Bridge windows
  if (showsFace(0, -1)) {
    fillFace(
      baker,
      HARBOUR.glassDark,
      1,
      [[-0.12, -0.41, deck + 20], [0.12, -0.41, deck + 20], [0.12, -0.41, deck + 15], [-0.12, -0.41, deck + 15]],
      originX,
      originY,
    );
  }

  // Turrets (Main Guns)
  const drawTurret = (tu: number, tv: number, tz: number) => {
    solidBox([tu - 0.1, tu + 0.1, tv - 0.1, tv + 0.1, tz, tz + 6], hull.deck);
    solidBox([tu - 0.02, tu + 0.02, tv - 0.3, tv - 0.1, tz + 2, tz + 4], 0x111111);
  };
  drawTurret(0, -1.2, deck);
  drawTurret(0, -0.8, deck);
  drawTurret(0, 1.1, deck);

  // Radar/Mast
  solidBox([-0.05, 0.05, 0, 0.1, deck + 36, deck + 60], hull.navyDark);
  // Helipad
  fillFace(
    baker,
    0x333333,
    1,
    [[-0.2, 1.3, deck + 1], [0.2, 1.3, deck + 1], [0.2, 1.7, deck + 1], [-0.2, 1.7, deck + 1]],
    originX,
    originY,
  );
  // 'H'
  baker.graphics.lineStyle(2, HARBOUR.white, 0.8);
  const hPoints = [
    [[-0.05, 1.4, deck + 1], [-0.05, 1.6, deck + 1]],
    [[0.05, 1.4, deck + 1], [0.05, 1.6, deck + 1]],
    [[-0.05, 1.5, deck + 1], [0.05, 1.5, deck + 1]],
  ];
  for (const pair of hPoints) {
    const [u1, v1, z1] = pair[0] as [number, number, number];
    const [u2, v2, z2] = pair[1] as [number, number, number];
    const p1 = baker.at([u1, v1, z1], originX, originY);
    const p2 = baker.at([u2, v2, z2], originX, originY);
    baker.graphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
  }

  baker.finish(key, width, height);
}
