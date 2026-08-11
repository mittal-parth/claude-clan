import { TILE_WIDTH, TILE_HEIGHT, Baker, shade, Point3, fillFace } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { HARBOUR, harbourPost } from "../harbour/base";

/**
 * The feeder ship that carries one container between cities, baked on both of
 * the headings she sails: lying along grid -v (alongside the quay) and, after
 * her turn, along grid +u. Two authored hulls rather than one rotated sprite,
 * because rotating an isometric hull reads as a sprite spinning on the spot.
 */
/**
 * Headings around a full circle, not just the outbound quarter: she runs in
 * from the sea on the reciprocal of the course she left on, and turns herself
 * end-for-end in the basin afterwards, so every bearing gets used.
 */
export const SHIP_HEADING_FRAMES = 24;

export const HARBOUR_SHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:harbour-ship:${index}`,
);

/** Frame 0 lies alongside the quay, bow up-coast: her ready-to-leave pose. */
export const HARBOUR_SHIP_KEY = HARBOUR_SHIP_KEYS[0]!;

export const HARBOUR_SHIP_ANCHOR_Y = 76;


/** Where the bay is authored, in tiles from the hull's centre. */
export const SHIP_BAY_U = 0;

export const SHIP_BAY_V = -0.2;

export const SHIP_BAY_Z = 26;


/**
 * Screen offset from the ship's tile point to the middle of her cargo bay --
 * where a carried container sits. One per heading frame, because yawing the
 * hull swings the bay around the mast with it.
 */
export const HARBOUR_SHIP_BAY_OFFSETS = HARBOUR_SHIP_KEYS.map((_unused, index) => {
  const angle = shipHeadingAngle(index);
  const u = SHIP_BAY_U * Math.cos(angle) - SHIP_BAY_V * Math.sin(angle);
  const v = SHIP_BAY_U * Math.sin(angle) + SHIP_BAY_V * Math.cos(angle);
  return {
    x: (u - v) * (TILE_WIDTH / 2),
    y: (u + v) * (TILE_HEIGHT / 2) - SHIP_BAY_Z,
  };
});


/** Yaw of a heading frame, as a fraction of a full turn from frame 0. */
export function shipHeadingAngle(index: number): number {
  return (index / SHIP_HEADING_FRAMES) * Math.PI * 2;
}


/**
 * The feeder ship: a small single-bay container vessel, authored lying along
 * grid v so it berths parallel to the quay wall, bow toward -v.
 *
 * The hull is drawn as one wrapped polygon rather than a box, which is what
 * gives it a real sheer line, a fined bow and a rounded transom instead of the
 * shoebox a harbourBox would produce.
 */
export function bakeHarbourContainerShip(source: Baker, key: string, frame: number): void {
  // Square and shared by every heading: as the hull yaws from lying across the
  // view to pointing along it, it trades width for height, so one canvas sized
  // to the widest sweep keeps a single anchor valid for all of them.
  const width = 256;
  const height = 256;
  const originX = width / 2;
  const originY = height - HARBOUR_SHIP_ANCHOR_Y;
  const deck = 22;

  /**
   * Each heading is the same drawing read through a yaw of the grid: rotating
   * (u, v) about the hull's centre swings her bow from -v round to +u, while
   * leaving z -- and so the whole superstructure's height -- untouched.
   * Wrapping `at` turns every polygon, box, post and rail the drawing puts
   * down, so nothing below has to know which way she is heading.
   */
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
    navy: 0x1c4a63,
    navyDark: 0x123448,
    boot: 0x8e3b3b,
    deck: 0x6c7a84,
    deckDark: 0x4c565e,
  };

  /**
   * Starboard sheer line, bow to stern. The hull side is this run of points
   * at deck height, returned along the same run at the waterline.
   */
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -1.7],
    [0.2, -1.36],
    [0.34, -0.92],
    [0.38, -0.2],
    [0.38, 1.16],
    [0.2, 1.42],
  ];

  /**
   * The full deck outline: down the starboard sheer, round the transom, and
   * back up the mirrored port side. Every heading is baked, so both sides come
   * into view at some point in her turn -- there is no such thing as a face
   * that is always hidden, and the hull is plated all the way round.
   */
  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    // Drop the last mirrored point: it is the stem again, and would close the
    // loop with a zero-length edge.
    ...[...sheer]
      .reverse()
      .map(([u, v]) => [-u, v] as const)
      .slice(0, -1),
  ];

  /** A face's outward normal, turned with the hull. */
  const turned = (nu: number, nv: number): { u: number; v: number } => {
    const length = Math.hypot(nu, nv) || 1;
    return {
      u: (nu * cos - nv * sin) / length,
      v: (nu * sin + nv * cos) / length,
    };
  };
  /**
   * Lighting is fixed to the world, not to the hull: the sun stays upper-left
   * while she turns under it, so a plate is lit by where it ends up pointing.
   */
  const facing = (nu: number, nv: number, color: number): number => {
    const normal = turned(nu, nv);
    return shade(color, Math.round(9 * normal.v - 28 * normal.u));
  };
  /** Whether a face has come round to the viewer's side at this heading. */
  const showsFace = (nu: number, nv: number): boolean => {
    const normal = turned(nu, nv);
    return normal.u + normal.v > 0.02;
  };

  /** A closed box plated on all four sides, painted for its heading. */
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
    // Furthest face first, so whichever plate has come round to the front is
    // the one left showing.
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

  // Wake and shadow on the water.
  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.2);
  baker.graphics.fillEllipse(waterline.x + 6, waterline.y + 6, 150, 46);

  // Hull plating: drop every edge of the outline to the waterline, then band
  // the boot topping along the same run. Plates on her far side land inside
  // the silhouette and are covered by the weather deck drawn over them.
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
  // Sheer stripe picks the hull's curve out against the water.
  baker.graphics.lineStyle(1.5, shade(hull.navy, 26), 0.7);
  baker.graphics.strokePoints(
    outline.map(([u, v]) => baker.at([u, v, deck - 3], originX, originY)),
    true,
  );

  // Weather deck.
  fillFace(
    baker,
    hull.deck,
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Cargo bay: raised coaming with a dark cell and yellow guide angles. This
  // is the slot a carried container drops into.
  solidBox([-0.32, 0.32, -0.78, 0.38, deck, deck + 5], hull.deckDark);
  fillFace(
    baker,
    0x121c22,
    1,
    [
      [-0.27, -0.73, deck + 4],
      [0.27, -0.73, deck + 4],
      [0.27, 0.33, deck + 4],
      [-0.27, 0.33, deck + 4],
    ],
    originX,
    originY,
  );
  baker.graphics.lineStyle(2, HARBOUR.amber, 0.85);
  for (const v of [-0.73, 0.33]) {
    const a = baker.at([-0.27, v, deck + 5], originX, originY);
    const b = baker.at([0.27, v, deck + 5], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Forecastle break, windlass and anchor pocket.
  solidBox([-0.2, 0.2, -1.5, -1.02, deck, deck + 6], hull.deck);
  const windlass = baker.at([0, -1.24, deck + 6], originX, originY);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(windlass.x - 6, windlass.y - 5, 12, 5);
  if (showsFace(1, 0)) {
    const anchor = baker.at([0.36, -1.02, deck - 8], originX, originY);
    baker.graphics.fillStyle(hull.navyDark, 1);
    baker.graphics.fillEllipse(anchor.x, anchor.y, 8, 6);
  }

  // Foremast with a crosstree and a masthead light.
  harbourPost(baker, originX, originY, 0, -0.95, deck + 4, deck + 46, 3, HARBOUR.steel);
  const crosstree = baker.at([0, -0.95, deck + 36], originX, originY);
  baker.graphics.lineStyle(2, HARBOUR.steelDark, 1);
  baker.graphics.lineBetween(crosstree.x - 9, crosstree.y, crosstree.x + 9, crosstree.y);
  const mastLight = baker.at([0, -0.95, deck + 46], originX, originY);
  baker.graphics.fillStyle(HARBOUR.white, 1);
  baker.graphics.fillCircle(mastLight.x, mastLight.y - 2, 2.4);

  // Accommodation block aft: three tiers stepped back, wheelhouse on top with
  // wrap-around glazing and bridge wings.
  solidBox([-0.3, 0.3, 0.56, 1.12, deck, deck + 30], HARBOUR.white);
  solidBox([-0.26, 0.26, 0.62, 1.06, deck + 30, deck + 44], HARBOUR.white);
  // Window bands and glazing sit on her after face; skip them when she has
  // turned it away, or they would be painted over the near side instead.
  if (showsFace(0, 1)) {
    for (const z of [deck + 9, deck + 20]) {
      fillFace(
        baker,
        HARBOUR.glassDark,
        1,
        [[-0.28, 1.13, z + 5], [0.28, 1.13, z + 5], [0.28, 1.13, z], [-0.28, 1.13, z]],
        originX,
        originY,
      );
    }
  }
  // Wheelhouse.
  solidBox([-0.3, 0.3, 0.66, 1.0, deck + 44, deck + 58], HARBOUR.white);
  if (showsFace(0, 1)) {
    fillFace(
      baker,
      HARBOUR.glass,
      1,
      [
        [-0.3, 1.01, deck + 56],
        [0.3, 1.01, deck + 56],
        [0.3, 1.01, deck + 47],
        [-0.3, 1.01, deck + 47],
      ],
      originX,
      originY,
    );
    baker.graphics.lineStyle(1, HARBOUR.navy, 0.55);
    for (const u of [-0.15, 0, 0.15]) {
      const a = baker.at([u, 1.02, deck + 56], originX, originY);
      const b = baker.at([u, 1.02, deck + 47], originX, originY);
      baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
  }
  // Bridge wings overhanging both sides.
  fillFace(
    baker,
    HARBOUR.white,
    1,
    [
      [-0.42, 0.96, deck + 46],
      [0.42, 0.96, deck + 46],
      [0.42, 0.86, deck + 46],
      [-0.42, 0.86, deck + 46],
    ],
    originX,
    originY,
  );

  // Funnel: navy with the harbour's amber band and a black cap.
  solidBox([-0.14, 0.14, 0.74, 0.96, deck + 58, deck + 76], HARBOUR.navy);
  if (showsFace(0, 1)) {
    fillFace(
      baker,
      HARBOUR.amber,
      1,
      [
        [-0.14, 0.97, deck + 71],
        [0.14, 0.97, deck + 71],
        [0.14, 0.97, deck + 64],
        [-0.14, 0.97, deck + 64],
      ],
      originX,
      originY,
    );
  }
  fillFace(baker, HARBOUR.iron, 1, [
    [-0.16, 0.72, deck + 77],
    [0.16, 0.72, deck + 77],
    [0.16, 0.98, deck + 77],
    [-0.16, 0.98, deck + 77],
  ], originX, originY);

  // Guard rails down the open deck, and the running lights.
  baker.graphics.lineStyle(1, HARBOUR.steel, 0.7);
  const railTop = outline.map(([u, v]) => baker.at([u, v, deck + 9], originX, originY));
  baker.graphics.strokePoints(railTop, true);
  for (const [u, v] of outline) {
    const post = baker.at([u, v, deck], originX, originY);
    const head = baker.at([u, v, deck + 9], originX, originY);
    baker.graphics.lineBetween(post.x, post.y, head.x, head.y);
  }
  if (showsFace(1, 0)) {
    const starboardLight = baker.at([0.34, 0.7, deck + 46], originX, originY);
    baker.graphics.fillStyle(0x6ee7b7, 1);
    baker.graphics.fillCircle(starboardLight.x, starboardLight.y, 2.2);
  }

  // Bow wave.
  baker.graphics.fillStyle(HARBOUR.foam, 0.7);
  const bow = baker.at([0, -1.7, 0], originX, originY);
  baker.graphics.fillEllipse(bow.x, bow.y + 1, 26, 9);

  baker.finish(key, width, height);
}
