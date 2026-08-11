import { Baker, fillFace, diamond } from "./core";
import { CRANE_JIB_Y, CRANE_FOOT_X, CRANE_FOOT_Y, CRANE_JIB_REACH, CRANE_TAIL_REACH, CRANE_TROLLEY_REACH, CRANE_HEIGHT, CRANE_WIDTH } from "../layouts/crane";
import { paletteFor, TERRAIN_COLORS } from "../math/palette";


export const CRANE_KEY = "fx:crane";

export const HOOK_KEY = "fx:hook";

export const CABLE_KEY = "fx:cable";


// ---------------------------------------------------------------------------
// Construction site
// ---------------------------------------------------------------------------

export const CRANE_COLORS = {
  steel: 0xf2b134,
  steelShade: 0xc08a1e,
  lattice: 0x8a6314,
  cab: 0x3f4b5b,
  weight: 0x6b7280,
  cable: 0x2f3742,
} as const;


/**
 * A tower crane. The jib runs along the grid's -x axis so it reads as part of
 * the isometric scene rather than a flat overlay, reaching out over the plot
 * beside the mast.
 */
export function bakeCrane(baker: Baker): void {
  const graphics = baker.graphics;
  const jibY = CRANE_JIB_Y;

  // Ground pad.
  fillFace(baker, TERRAIN_COLORS.shadow, 0.22, diamond(0.3), CRANE_FOOT_X, CRANE_FOOT_Y);
  fillFace(baker, 0xb8b0a0, 1, diamond(0.24), CRANE_FOOT_X, CRANE_FOOT_Y);

  // Mast: two rails with cross bracing between them.
  const mastLeft = CRANE_FOOT_X - 7;
  const mastRight = CRANE_FOOT_X + 7;
  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillRect(mastLeft, jibY, 4, CRANE_FOOT_Y - jibY);
  graphics.fillStyle(CRANE_COLORS.steelShade, 1);
  graphics.fillRect(mastRight - 4, jibY, 4, CRANE_FOOT_Y - jibY);

  graphics.lineStyle(2, CRANE_COLORS.lattice, 0.9);
  for (let y = jibY + 6; y < CRANE_FOOT_Y - 6; y += 16) {
    graphics.lineBetween(mastLeft + 3, y, mastRight - 3, y + 8);
    graphics.lineBetween(mastRight - 3, y, mastLeft + 3, y + 8);
  }

  // Jib and counter-jib follow the iso axis: 2 across for every 1 down.
  const jibReach = CRANE_JIB_REACH;
  const jibRise = jibReach / 2;
  const tailReach = CRANE_TAIL_REACH;

  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillTriangle(
    CRANE_FOOT_X - 6,
    jibY,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise + 7,
  );
  graphics.fillTriangle(
    CRANE_FOOT_X - 6,
    jibY,
    CRANE_FOOT_X - 6,
    jibY + 7,
    CRANE_FOOT_X - jibReach,
    jibY - jibRise + 7,
  );
  // Counter-jib.
  graphics.fillStyle(CRANE_COLORS.steelShade, 1);
  graphics.fillTriangle(
    CRANE_FOOT_X + 6,
    jibY,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2 + 7,
  );
  graphics.fillTriangle(
    CRANE_FOOT_X + 6,
    jibY,
    CRANE_FOOT_X + 6,
    jibY + 7,
    CRANE_FOOT_X + tailReach,
    jibY + tailReach / 2 + 7,
  );

  // Jib bracing.
  graphics.lineStyle(1, CRANE_COLORS.lattice, 0.8);
  for (let step = 12; step < jibReach; step += 16) {
    const x = CRANE_FOOT_X - step;
    const y = jibY - step / 2;
    graphics.lineBetween(x, y + 1, x - 8, y + 3);
  }

  // Trolley, where the cable drops from.
  graphics.fillStyle(CRANE_COLORS.cab, 1);
  graphics.fillRect(
    CRANE_FOOT_X - CRANE_TROLLEY_REACH - 4,
    jibY - CRANE_TROLLEY_REACH / 2,
    10,
    5,
  );

  // Counterweight.
  graphics.fillStyle(CRANE_COLORS.weight, 1);
  graphics.fillRect(
    CRANE_FOOT_X + tailReach - 14,
    jibY + tailReach / 2 - 2,
    18,
    14,
  );

  // Operator cab at the slewing ring.
  graphics.fillStyle(CRANE_COLORS.cab, 1);
  graphics.fillRect(CRANE_FOOT_X - 9, jibY + 6, 16, 13);
  graphics.fillStyle(0x9fd8f5, 0.9);
  graphics.fillRect(CRANE_FOOT_X - 6, jibY + 9, 9, 6);

  // A-frame above the slewing ring, with the pendant lines to each jib tip.
  graphics.lineStyle(2, CRANE_COLORS.steel, 1);
  graphics.lineBetween(CRANE_FOOT_X, jibY, CRANE_FOOT_X, jibY - 26);
  graphics.lineStyle(1, CRANE_COLORS.cable, 0.9);
  graphics.lineBetween(
    CRANE_FOOT_X,
    jibY - 26,
    CRANE_FOOT_X - jibReach + 6,
    jibY - jibRise + 2,
  );
  graphics.lineBetween(
    CRANE_FOOT_X,
    jibY - 26,
    CRANE_FOOT_X + tailReach - 4,
    jibY + tailReach / 2,
  );

  baker.finish(CRANE_KEY, CRANE_WIDTH, CRANE_HEIGHT);
}


/** The load block. Anchored at its top so the cable can hang it. */
export function bakeHook(baker: Baker): void {
  const graphics = baker.graphics;
  graphics.fillStyle(CRANE_COLORS.weight, 1);
  graphics.fillRect(3, 0, 12, 7);
  graphics.fillStyle(CRANE_COLORS.steel, 1);
  graphics.fillRect(6, 7, 6, 5);
  graphics.lineStyle(2, CRANE_COLORS.cable, 1);
  graphics.strokeCircle(9, 16, 4);
  baker.finish(HOOK_KEY, 18, 22);
}


/** One pixel of cable, stretched between the jib and the hook. */
export function bakeCable(baker: Baker): void {
  baker.graphics.fillStyle(CRANE_COLORS.cable, 1);
  baker.graphics.fillRect(0, 0, 2, 2);
  baker.finish(CABLE_KEY, 2, 2);
}
