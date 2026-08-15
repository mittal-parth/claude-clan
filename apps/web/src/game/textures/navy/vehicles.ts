import { Baker, fillFace, strokeFace, Point3, diamond } from "../core";
import { navyShadow, NAVY_BASE, navyRing, navyScreenLine, navyCylinder } from "../navy/base";
import { harbourBox, harbourPost } from "../harbour/base";

export const NAVY_MISSILE_KEY = "fx:navy-missile";

export const NAVY_MISSILE_ANCHOR_Y = 30;

export const NAVY_TANK_KEY = "fx:navy-tank";

export const NAVY_TANK_ANCHOR_Y = 26;

export const NAVY_GUN_KEY = "fx:navy-gun";

export const NAVY_GUN_ANCHOR_Y = 28;

export const NAVY_FUEL_TANK_KEY = "fx:navy-fuel-tank";

export const NAVY_FUEL_TANK_ANCHOR_Y = 34;


/** A tracked launcher on the quayside lip, tubes elevated out over the water. */
export function bakeNavyMissile(baker: Baker): void {
  const width = 128;
  const height = 104;
  const originX = width / 2;
  const originY = height - NAVY_MISSILE_ANCHOR_Y;
  const half = 0.5;

  navyShadow(baker, originX, originY, half + 0.08, half * 0.8);

  // Hardstanding with a painted turning circle.
  fillFace(baker, NAVY_BASE.concreteDark, 1, navyRing(half + 0.02, 2), originX, originY);
  strokeFace(baker, NAVY_BASE.warning, 0.7, 2, navyRing(half - 0.08, 3), originX, originY);

  // Chassis: road wheels, hull, and outriggers planted for firing.
  for (const v of [-0.26, 0.26]) {
    for (const u of [-0.3, -0.1, 0.1, 0.3]) {
      fillFace(
        baker,
        NAVY_BASE.black,
        1,
        [[u - 0.07, v, 3], [u, v - 0.05, 3], [u + 0.07, v, 3], [u, v + 0.05, 3]],
        originX,
        originY,
      );
    }
  }
  harbourBox(baker, originX, originY, [-0.38, 0.38, -0.28, 0.28, 6, 18], NAVY_BASE.oliveDark);
  fillFace(baker, NAVY_BASE.olive, 1, [[-0.38, -0.28, 18], [0.38, -0.28, 18], [0.38, 0.28, 18], [-0.38, 0.28, 18]], originX, originY);
  for (const [u, v] of [[-0.42, 0.32], [0.42, 0.32], [-0.42, -0.32], [0.42, -0.32]] as const) {
    navyScreenLine(baker, originX, originY, [u * 0.85, v * 0.85, 10], [u, v, 1], 3, NAVY_BASE.steelDark, 1);
  }
  // Cab at the inland end.
  harbourBox(baker, originX, originY, [-0.36, -0.14, -0.22, 0.22, 18, 30], NAVY_BASE.olive);
  fillFace(
    baker,
    NAVY_BASE.glassDark,
    1,
    [[-0.36, 0.23, 28], [-0.16, 0.23, 28], [-0.16, 0.23, 21], [-0.36, 0.23, 21]],
    originX,
    originY,
  );

  // Elevated launcher: a four-tube block hinged up toward the sea (+u).
  const hinge: Point3 = [-0.06, 0, 20];
  const muzzle: Point3 = [0.46, 0, 54];
  navyScreenLine(baker, originX, originY, hinge, [0.02, 0, 30], 4, NAVY_BASE.steelDark, 1);
  for (const v of [-0.15, 0.15]) {
    for (const lift of [0, 9]) {
      const from: Point3 = [hinge[0], v, hinge[2] + lift];
      const to: Point3 = [muzzle[0], v, muzzle[2] + lift];
      navyScreenLine(baker, originX, originY, from, to, 9, NAVY_BASE.black, 1);
      navyScreenLine(baker, originX, originY, from, to, 6, NAVY_BASE.oliveDark, 1);
      navyScreenLine(baker, originX, originY, [from[0], from[1], from[2] + 1], [to[0], to[1], to[2] + 1], 2, NAVY_BASE.oliveLight, 0.8);
      const mouth = baker.at(to, originX, originY);
      baker.graphics.fillStyle(NAVY_BASE.black, 1);
      baker.graphics.fillCircle(mouth.x, mouth.y, 4);
      baker.graphics.fillStyle(NAVY_BASE.red, 1);
      baker.graphics.fillCircle(mouth.x, mouth.y, 2);
    }
  }
  // Cradle band and hazard stencil on the tube pack.
  navyScreenLine(baker, originX, originY, [0.16, -0.2, 32], [0.16, 0.2, 32], 3, NAVY_BASE.warning, 0.9);
  navyScreenLine(baker, originX, originY, [-0.4, 0.3, 8], [0.4, 0.3, 8], 2, NAVY_BASE.warning, 0.85);
  baker.finish(NAVY_MISSILE_KEY, width, height);
}


export function bakeNavyTank(baker: Baker): void {
  const width = 112;
  const height = 82;
  const originX = width / 2;
  const originY = height - NAVY_TANK_ANCHOR_Y;

  navyShadow(baker, originX, originY, 0.5, 0.36);

  // The gun faces grid -v. Keep the two track lanes separated on u and make
  // their long edges run along v; screen-space ellipses would turn the wheels
  // away from the hull by the isometric projection angle.
  const drawTrack = (u: number): void => {
    const outerTrack: Point3[] = [
      [u - 0.12, -0.42, 8],
      [u + 0.12, -0.42, 8],
      [u + 0.12, 0.32, 8],
      [u + 0.06, 0.42, 8],
      [u - 0.06, 0.42, 8],
      [u - 0.12, 0.32, 8],
    ];
    fillFace(baker, NAVY_BASE.black, 1, outerTrack, originX, originY);
    fillFace(
      baker,
      NAVY_BASE.oliveDark,
      1,
      [
        [u - 0.085, -0.35, 9],
        [u + 0.085, -0.35, 9],
        [u + 0.085, 0.27, 9],
        [u + 0.04, 0.34, 9],
        [u - 0.04, 0.34, 9],
        [u - 0.085, 0.27, 9],
      ],
      originX,
      originY,
    );

    // Crossbars are perpendicular to the -v travel direction.
    for (const v of [-0.3, -0.15, 0, 0.15, 0.3]) {
      navyScreenLine(
        baker,
        originX,
        originY,
        [u - 0.105, v, 9.5],
        [u + 0.105, v, 9.5],
        2,
        NAVY_BASE.steelDark,
        0.82,
      );
    }

    // Isometric diamond wheels follow the same grid orientation instead of
    // using screen-aligned circles.
    for (const v of [-0.28, -0.14, 0, 0.14, 0.28]) {
      fillFace(
        baker,
        NAVY_BASE.black,
        1,
        [
          [u - 0.075, v, 10],
          [u, v - 0.055, 10],
          [u + 0.075, v, 10],
          [u, v + 0.055, 10],
        ],
        originX,
        originY,
      );
      fillFace(
        baker,
        NAVY_BASE.steelDark,
        0.95,
        [
          [u - 0.043, v, 10.5],
          [u, v - 0.031, 10.5],
          [u + 0.043, v, 10.5],
          [u, v + 0.031, 10.5],
        ],
        originX,
        originY,
      );
    }
  };
  drawTrack(-0.25);
  drawTrack(0.25);

  // Lower hull with a sloped glacis and raised side skirts.
  harbourBox(baker, originX, originY, [-0.46, 0.46, -0.32, 0.32, 8, 20], NAVY_BASE.oliveDark);
  fillFace(
    baker,
    NAVY_BASE.olive,
    1,
    [[-0.4, -0.28, 21], [0.4, -0.28, 21], [0.31, 0.28, 24], [-0.31, 0.28, 24]],
    originX,
    originY,
  );
  fillFace(
    baker,
    NAVY_BASE.oliveLight,
    1,
    [[-0.31, 0.28, 24], [0.31, 0.28, 24], [0.22, 0.34, 16], [-0.22, 0.34, 16]],
    originX,
    originY,
  );
  // Side skirts and spaced reactive-armor tiles.
  for (const u of [-0.38, -0.13, 0.13, 0.38]) {
    harbourBox(baker, originX, originY, [u - 0.045, u + 0.045, 0.3, 0.38, 10, 18], NAVY_BASE.oliveLight);
  }
  for (const u of [-0.28, 0, 0.28]) {
    const plate = baker.at([u, 0.36, 19], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warning, 0.86);
    baker.graphics.fillRect(plate.x - 3, plate.y - 2, 6, 2);
  }

  // Low angular turret, commander's hatch, periscope, and long main gun.
  harbourBox(baker, originX, originY, [-0.22, 0.22, -0.16, 0.16, 22, 29], NAVY_BASE.oliveDark);
  fillFace(baker, NAVY_BASE.oliveLight, 1, diamond(0.23, 29), originX, originY);
  const turret = baker.at([0, -0.01, 30], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.steelDark, 1);
  baker.graphics.fillEllipse(turret.x, turret.y, 19, 8);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillEllipse(turret.x + 3, turret.y + 1, 8, 4);
  // The hull still fronts toward +v, but the turret is traversed a quarter turn
  // to the left of it: on screen that swings the muzzle from down-left round to
  // down-right, which in grid terms is (u, v) -> (v, -u), i.e. out along +u.
  navyScreenLine(baker, originX, originY, [-0.02, 0, 30], [0.72, -0.05, 33], 5, NAVY_BASE.black, 1);
  navyScreenLine(baker, originX, originY, [-0.02, 0, 30], [0.72, -0.05, 33], 2, NAVY_BASE.steelDark, 1);
  navyScreenLine(baker, originX, originY, [0.22, -0.03, 30], [0.44, -0.08, 31], 2, NAVY_BASE.black, 1);
  harbourPost(baker, originX, originY, 0.12, 0.02, 29, 36, 2, NAVY_BASE.steelDark);
  const hatch = baker.at([-0.12, 0.03, 31], originX, originY);
  baker.graphics.lineStyle(1, NAVY_BASE.warning, 0.95);
  baker.graphics.strokeEllipse(hatch.x, hatch.y, 9, 5);
  // Twin headlights and a small red unit marker on the glacis.
  for (const u of [-0.28, 0.28]) {
    const lamp = baker.at([u, 0.34, 17], originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.warning, 1);
    baker.graphics.fillCircle(lamp.x, lamp.y, 2);
    baker.graphics.fillStyle(NAVY_BASE.white, 0.9);
    baker.graphics.fillRect(lamp.x - 1, lamp.y - 1, 2, 1);
  }
  const marker = baker.at([0.32, 0.35, 21], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillRect(marker.x - 3, marker.y - 2, 6, 3);

  baker.finish(NAVY_TANK_KEY, width, height);
}


/** A twin-barrelled mount in a revetment, laid out over the water. */
export function bakeNavyGun(baker: Baker): void {
  const width = 120;
  const height = 96;
  const originX = width / 2;
  const originY = height - NAVY_GUN_ANCHOR_Y;

  navyShadow(baker, originX, originY, 0.46, 0.46);

  // Circular revetment with a painted arc of fire, then the pedestal.
  navyCylinder(baker, originX, originY, 0.44, 0, 9, NAVY_BASE.concreteDark, 16);
  strokeFace(baker, NAVY_BASE.warning, 0.75, 2, navyRing(0.32, 10), originX, originY);
  navyCylinder(baker, originX, originY, 0.19, 9, 20, NAVY_BASE.steelDark, 12);

  // Turret: an angular shield with a hatch, mounted on the pedestal.
  harbourBox(baker, originX, originY, [-0.2, 0.16, -0.2, 0.2, 20, 30], NAVY_BASE.olive);
  fillFace(
    baker,
    NAVY_BASE.oliveLight,
    1,
    [[-0.2, -0.2, 30], [0.16, -0.2, 30], [0.26, -0.1, 24], [0.26, 0.1, 24], [0.16, 0.2, 30], [-0.2, 0.2, 30]],
    originX,
    originY,
  );
  const hatch = baker.at([-0.08, 0, 31], originX, originY);
  baker.graphics.lineStyle(1, NAVY_BASE.warning, 0.9);
  baker.graphics.strokeEllipse(hatch.x, hatch.y, 11, 6);

  // Twin barrels laid out over the sea (+u), with muzzle brakes.
  for (const v of [-0.09, 0.09]) {
    const breech: Point3 = [0.14, v, 27];
    const muzzle: Point3 = [0.86, v, 34];
    navyScreenLine(baker, originX, originY, breech, muzzle, 5, NAVY_BASE.black, 1);
    navyScreenLine(baker, originX, originY, breech, [muzzle[0] - 0.1, v, muzzle[2] - 1], 3, NAVY_BASE.steelDark, 1);
    const tip = baker.at(muzzle, originX, originY);
    baker.graphics.fillStyle(NAVY_BASE.steel, 1);
    baker.graphics.fillRect(tip.x - 5, tip.y - 3, 7, 5);
    baker.graphics.fillStyle(NAVY_BASE.black, 1);
    baker.graphics.fillRect(tip.x - 1, tip.y - 2, 3, 3);
  }

  // Ready-use ammunition boxes stacked behind the mount.
  harbourBox(baker, originX, originY, [-0.42, -0.24, 0.06, 0.3, 9, 17], NAVY_BASE.warningDark);
  harbourBox(baker, originX, originY, [-0.4, -0.26, 0.1, 0.28, 17, 24], NAVY_BASE.oliveDark);
  baker.finish(NAVY_GUN_KEY, width, height);
}


/** Bunded fuel tank with a ladder and a pipe run to the quayside manifold. */
export function bakeNavyFuelTank(baker: Baker): void {
  const width = 104;
  const height = 108;
  const originX = width / 2;
  const originY = height - NAVY_FUEL_TANK_ANCHOR_Y;
  const radius = 0.32;
  const body = 46;

  navyShadow(baker, originX, originY, 0.46, 0.46);

  // Bund wall: a low containment ring the tank stands inside.
  navyCylinder(baker, originX, originY, 0.46, 0, 7, NAVY_BASE.concreteDark, 16);
  fillFace(baker, NAVY_BASE.deckDark, 1, navyRing(0.42, 7.5), originX, originY);

  navyCylinder(baker, originX, originY, radius, 4, body, NAVY_BASE.olive, 18);
  // Girth bands and the amber contents stripe.
  for (const z of [18, 32]) {
    strokeFace(baker, NAVY_BASE.oliveDark, 0.7, 2, navyRing(radius + 0.01, z), originX, originY);
  }
  strokeFace(baker, NAVY_BASE.warning, 0.85, 2, navyRing(radius + 0.01, 26), originX, originY);
  strokeFace(baker, NAVY_BASE.steelDark, 0.8, 2, navyRing(radius - 0.03, body + 1), originX, originY);

  // Domed roof cap, vent and inspection hatch.
  navyCylinder(baker, originX, originY, radius - 0.09, body, body + 5, NAVY_BASE.oliveLight, 14);
  harbourPost(baker, originX, originY, 0.06, -0.06, body + 5, body + 15, 3, NAVY_BASE.steelDark);
  const vent = baker.at([0.06, -0.06, body + 15], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(vent.x, vent.y - 1, 3);

  // Caged ladder up the near face, and the outlet pipe over the bund.
  for (let z = 8; z < body; z += 6) {
    navyScreenLine(baker, originX, originY, [radius - 0.03, 0.16, z], [radius + 0.07, 0.16, z], 1, NAVY_BASE.steel, 0.85);
  }
  navyScreenLine(baker, originX, originY, [radius + 0.02, 0.16, 8], [radius + 0.02, 0.16, body], 1, NAVY_BASE.steelDark, 0.9);
  navyScreenLine(baker, originX, originY, [0.2, 0.3, 10], [0.62, 0.42, 10], 4, NAVY_BASE.steelDark, 1);
  navyScreenLine(baker, originX, originY, [0.62, 0.42, 10], [0.62, 0.42, 2], 4, NAVY_BASE.steelDark, 1);
  const valve = baker.at([0.42, 0.36, 12], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.red, 1);
  baker.graphics.fillCircle(valve.x, valve.y, 3);

  // Flammable placard on the bund wall.
  const placard = baker.at([0.1, 0.44, 4], originX, originY);
  baker.graphics.fillStyle(NAVY_BASE.warning, 1);
  baker.graphics.fillTriangle(placard.x, placard.y - 7, placard.x - 5, placard.y + 1, placard.x + 5, placard.y + 1);
  baker.graphics.fillStyle(NAVY_BASE.black, 1);
  baker.graphics.fillRect(placard.x - 1, placard.y - 4, 2, 3);
  baker.finish(NAVY_FUEL_TANK_KEY, width, height);
}
