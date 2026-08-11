import { Baker, fillFace, Point3, HALF_W, HALF_H } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { HARBOUR, harbourPost, harbourBox } from "../harbour/base";

/**
 * The crane is baked in pieces so it can work rather than just stand there:
 * a static portal, a jib that slews about the mast, and a trolley + spreader
 * that run out along the jib and hoist. The scene drives all four.
 */
export const HARBOUR_CRANE_KEY = "fx:harbour-crane";

export const HARBOUR_CRANE_ANCHOR_Y = 36;

export const CRANE_JIB_FRAMES = 7;

/**
 * The jib is baked across its slew for the same reason the ship is baked
 * across her headings: a quarter turn in the world is not a quarter turn on
 * screen, so rotating the sprite would read as a spinning picture rather than
 * an arm swinging round. Frame 0 points seaward over the ship; the last points
 * along the quay, a right angle clockwise, over the waiting container.
 */
export const HARBOUR_CRANE_JIB_KEYS = Array.from(
  { length: CRANE_JIB_FRAMES },
  (_unused, index) => `fx:harbour-crane-jib:${index}`,
);

export const HARBOUR_CRANE_JIB_KEY = HARBOUR_CRANE_JIB_KEYS[0]!;

export const HARBOUR_CRANE_TROLLEY_KEY = "fx:harbour-crane-trolley";

export const HARBOUR_CRANE_SPREADER_KEY = "fx:harbour-crane-spreader";

/** Grid offset from the crane's tile point to the mast it slews about. */
export const HARBOUR_CRANE_SLEW_U = -0.06;

/** Pixels above the crane's tile point where that mast meets the jib. */
export const HARBOUR_CRANE_SLEW_Y = 102;

/**
 * Normalised origin of the jib texture, placed exactly on the slew axis, so
 * setRotation swings the arm about the mast instead of about a corner.
 */
export const HARBOUR_CRANE_JIB_ORIGIN = { x: 0.5, y: 44 / 132 } as const;

/** How far the jib swings to reach the quay: a right angle, clockwise. */
export const HARBOUR_CRANE_SLEW_SWEEP = Math.PI / 2;

/** Where the trolley sits, in tiles out along the jib, for each job. */
export const HARBOUR_CRANE_TROLLEY_REACH = 1.55;

export const HARBOUR_CRANE_TROLLEY_PICK = 1.1;

/** Pixels above the crane's tile point where the trolley rides. */
export const HARBOUR_CRANE_TROLLEY_Y = 95;


/**
 * Dockside portal crane. Its jib overhangs the water on the grid +u side so
 * the hook hangs where a moored ship's hold would be.
 */
export function bakeHarbourCrane(baker: Baker): void {
  const width = 128;
  const height = 168;
  const originX = width / 2;
  const originY = height - HARBOUR_CRANE_ANCHOR_Y;
  const legHalf = 0.45;
  const portal = CRANE_PORTAL_Z;

  fillFace(
    baker,
    TERRAIN_COLORS.shadow,
    0.22,
    [
      [-legHalf + 0.1, -legHalf + 0.12, 0],
      [legHalf + 0.1, -legHalf + 0.12, 0],
      [legHalf + 0.1, legHalf + 0.12, 0],
      [-legHalf + 0.1, legHalf + 0.12, 0],
    ],
    originX,
    originY,
  );

  // Rail sleepers under the bogies.
  for (const v of [-legHalf, legHalf]) {
    baker.graphics.lineStyle(3, HARBOUR.steelDark, 0.9);
    const a = baker.at([-legHalf - 0.16, v, 1], originX, originY);
    const b = baker.at([legHalf + 0.16, v, 1], originX, originY);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  }

  // Four legs, back pair first so the front pair overlaps them correctly.
  const legs: ReadonlyArray<readonly [number, number]> = [
    [-legHalf, -legHalf],
    [legHalf, -legHalf],
    [-legHalf, legHalf],
    [legHalf, legHalf],
  ];
  for (const [u, v] of legs) {
    harbourPost(baker, originX, originY, u, v, 0, portal, 6, HARBOUR.amber);
    const foot = baker.at([u, v, 0], originX, originY);
    baker.graphics.fillStyle(HARBOUR.iron, 1);
    baker.graphics.fillRect(foot.x - 5, foot.y - 5, 10, 5);
  }
  // Portal cross-bracing on the two visible faces.
  baker.graphics.lineStyle(2, HARBOUR.amberDark, 0.9);
  for (const [a, b] of [
    [[-legHalf, legHalf, 14], [legHalf, legHalf, portal - 12]],
    [[-legHalf, legHalf, portal - 12], [legHalf, legHalf, 14]],
    [[legHalf, -legHalf, 14], [legHalf, legHalf, portal - 12]],
    [[legHalf, legHalf, 14], [legHalf, -legHalf, portal - 12]],
  ] as const) {
    const from = baker.at(a as Point3, originX, originY);
    const to = baker.at(b as Point3, originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }

  // Machinery deck across the leg tops.
  harbourBox(
    baker,
    originX,
    originY,
    [-legHalf - 0.08, legHalf + 0.08, -legHalf - 0.08, legHalf + 0.08, portal, portal + 10],
    HARBOUR.steel,
  );
  harbourBox(
    baker,
    originX,
    originY,
    [-0.62, -0.06, -0.3, 0.3, portal + 10, portal + 26],
    HARBOUR.navy,
  );
  // Operator's cab, glazed toward the water.
  harbourBox(
    baker,
    originX,
    originY,
    [0.16, 0.5, 0.14, 0.46, portal + 10, portal + 24],
    HARBOUR.white,
  );
  fillFace(
    baker,
    HARBOUR.glass,
    1,
    [[0.16, 0.47, portal + 22], [0.5, 0.47, portal + 22], [0.5, 0.47, portal + 13], [0.16, 0.47, portal + 13]],
    originX,
    originY,
  );

  baker.finish(HARBOUR_CRANE_KEY, width, height);
}


export const CRANE_PORTAL_Z = 76;

export const CRANE_MAST_TOP = 128;

export const CRANE_JIB_Z = 92;

export const CRANE_JIB_TIP = 2.0;

export const CRANE_COUNTER_TIP = -0.95;


/**
 * The slewing half of the crane: mast, jib, counter-jib and counterweight.
 * Baked so the slew axis -- the mast head where the jib pivots -- lands on
 * HARBOUR_CRANE_JIB_ORIGIN, which lets the scene swing the whole arm with
 * setRotation.
 */
export function bakeHarbourCraneJib(source: Baker, key: string, frame: number): void {
  const width = 216;
  const height = 132;
  const portal = CRANE_PORTAL_Z;
  const jibZ = CRANE_JIB_Z;
  const jibTip = CRANE_JIB_TIP;
  const counterTip = CRANE_COUNTER_TIP;
  const mastTop = CRANE_MAST_TOP;
  // Chosen so at([SLEW_U, 0, SLEW_Y]) lands exactly on the sprite origin.
  const originX = width * HARBOUR_CRANE_JIB_ORIGIN.x - HARBOUR_CRANE_SLEW_U * HALF_W;
  const originY =
    height * HARBOUR_CRANE_JIB_ORIGIN.y - HARBOUR_CRANE_SLEW_U * HALF_H + HARBOUR_CRANE_SLEW_Y;

  /**
   * Slew is a yaw about the mast, so the arm is drawn through a rotation of
   * (u, v) around that pivot -- the point the sprite is anchored on, which is
   * therefore the one point the rotation leaves alone.
   */
  const angle = (frame / (CRANE_JIB_FRAMES - 1)) * HARBOUR_CRANE_SLEW_SWEEP;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) => {
            const du = point[0] - HARBOUR_CRANE_SLEW_U;
            const dv = point[1];
            return source.at(
              [
                HARBOUR_CRANE_SLEW_U + du * cos - dv * sin,
                du * sin + dv * cos,
                point[2],
              ],
              ox,
              oy,
            );
          },
        };

  harbourPost(baker, originX, originY, -0.06, 0, portal + 26, mastTop, 5, HARBOUR.steel);
  const jibLine = (from: Point3, to: Point3, thickness: number, color: number): void => {
    const a = baker.at(from, originX, originY);
    const b = baker.at(to, originX, originY);
    baker.graphics.lineStyle(thickness, color, 1);
    baker.graphics.lineBetween(a.x, a.y, b.x, b.y);
  };
  jibLine([-0.06, 0, jibZ], [jibTip, 0, jibZ + 8], 6, HARBOUR.amber);
  jibLine([-0.06, 0, jibZ - 7], [jibTip, 0, jibZ + 3], 3, HARBOUR.amberDark);
  jibLine([-0.06, 0, jibZ], [counterTip, 0, jibZ - 4], 6, HARBOUR.amber);
  // Lattice web between the jib chords.
  baker.graphics.lineStyle(1, HARBOUR.amberDark, 0.85);
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const u = -0.06 + (jibTip + 0.06) * t;
    const upper = baker.at([u, 0, jibZ + 8 * t], originX, originY);
    const lower = baker.at([u, 0, jibZ - 7 + 10 * t], originX, originY);
    baker.graphics.lineBetween(upper.x, upper.y, lower.x, lower.y);
  }
  // Tie bars from the mast head.
  jibLine([-0.06, 0, mastTop], [jibTip - 0.12, 0, jibZ + 7], 2, HARBOUR.steelDark);
  jibLine([-0.06, 0, mastTop], [counterTip + 0.06, 0, jibZ - 3], 2, HARBOUR.steelDark);

  harbourBox(
    baker,
    originX,
    originY,
    [counterTip, counterTip + 0.34, -0.2, 0.2, jibZ - 22, jibZ - 5],
    HARBOUR.iron,
  );

  // Obstruction light on the mast head.
  const beaconPoint = baker.at([-0.06, 0, mastTop], originX, originY);
  baker.graphics.fillStyle(HARBOUR.red, 1);
  baker.graphics.fillCircle(beaconPoint.x, beaconPoint.y - 2, 3);

  baker.finish(key, width, height);
}


/** The trolley block that runs out along the jib. */
export function bakeHarbourCraneTrolley(baker: Baker): void {
  const width = 40;
  const height = 28;
  const originX = width / 2;
  const originY = height / 2 + 4;
  harbourBox(baker, originX, originY, [-0.16, 0.16, -0.12, 0.12, 0, 9], HARBOUR.steelDark);
  const sheave = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(sheave.x - 6, sheave.y, 12, 3);
  baker.finish(HARBOUR_CRANE_TROLLEY_KEY, width, height);
}


/**
 * The spreader: the lifting beam that clamps a container's top castings. Its
 * origin is the middle of the beam, so the scene can hang it under the trolley
 * and set a container's position from the same point.
 */
export function bakeHarbourCraneSpreader(baker: Baker): void {
  const width = 72;
  const height = 40;
  const originX = width / 2;
  const originY = height / 2;
  const beam = baker.at([0, 0, 0], originX, originY);

  // Headblock above the beam, where the cables land.
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  baker.graphics.fillRect(beam.x - 7, beam.y - 12, 14, 6);
  // The beam itself, drawn along the container's long axis.
  harbourBox(baker, originX, originY, [-0.3, 0.3, -0.06, 0.06, -4, 1], HARBOUR.amber);
  // Twistlock legs at each end, which drop over the container corners.
  baker.graphics.fillStyle(HARBOUR.iron, 1);
  for (const offset of [-27, 27]) {
    baker.graphics.fillRect(beam.x + offset - 2, beam.y - 2, 4, 9);
  }
  baker.finish(HARBOUR_CRANE_SPREADER_KEY, width, height);
}
