import { Baker } from "../core";
import Phaser from "phaser";
import { AIRPORT } from "../airport/terminal";

/** Compact commuter aircraft plus a separate shadow for real altitude cues. */
export const AIRPLANE_KEY = "fx:airplane";

export const AIRPLANE_SHADOW_KEY = "fx:airplane-shadow";


/** Compact twin-prop commuter aircraft, authored nose-first along grid +x. */
export function bakeAirplane(baker: Baker): void {
  const width = 128;
  const height = 96;
  const originX = width / 2;
  const originY = height / 2;
  const point = (forward: number, side: number, lift = 0): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(
      originX + forward * 0.89 - side * 0.46,
      originY + forward * 0.46 + side * 0.89 - lift,
    );
  const polygon = (
    color: number,
    points: ReadonlyArray<readonly [number, number]>,
    alpha = 1,
  ): void => {
    baker.graphics.fillStyle(color, alpha);
    baker.graphics.fillPoints(points.map(([forward, side]) => point(forward, side)), true);
  };

  // High wing and tailplane first, then the fuselage gives a clean silhouette.
  polygon(0xc3d6da, [[10, -6], [-5, -10], [-18, -42], [-26, -43], [-16, -7], [-16, 7], [-26, 43], [-18, 42], [-5, 10], [10, 6]]);
  polygon(0x8faeb7, [[-4, -10], [-18, -42], [-26, -43], [-19, -28], [0, -7], [0, 7], [-19, 28], [-26, 43], [-18, 42], [-4, 10]]);
  polygon(0xb8cdd2, [[-28, -5], [-38, -22], [-44, -21], [-40, -4], [-40, 4], [-44, 21], [-38, 22], [-28, 5]]);
  polygon(AIRPORT.white, [[46, 0], [39, -6], [15, -7], [-34, -7], [-43, -3], [-43, 3], [-34, 7], [15, 7], [39, 6]]);
  polygon(0xd4e3e3, [[39, -6], [15, -7], [-34, -7], [-43, -3], [-34, 0], [15, 0]]);

  // Navy belly, gold cheatline and tail livery.
  polygon(0x163b52, [[29, -7], [8, -8], [-31, -7], [-38, -4], [-31, -2], [8, -3], [29, -2]]);
  polygon(AIRPORT.gold, [[18, -8], [8, -8], [-28, -7], [-33, -5], [-28, -4], [8, -5], [18, -5]]);
  polygon(0x173e56, [[-29, -5], [-40, -4], [-44, 0], [-40, 4], [-29, 5], [-23, 0]]);

  // Cockpit and four passenger windows stay legible at the small in-world scale.
  const cockpit = point(38, 0, 1);
  baker.graphics.fillStyle(AIRPORT.glass, 1);
  baker.graphics.fillCircle(cockpit.x, cockpit.y, 4.5);
  for (let forward = 20; forward >= -17; forward -= 10) {
    const window = point(forward, -6.8, 1);
    baker.graphics.fillStyle(AIRPORT.glassLight, 1);
    baker.graphics.fillCircle(window.x, window.y, 1.8);
  }

  // Engine nacelles and translucent propeller discs identify it as a small flight.
  for (const side of [-23, 23]) {
    const engine = point(-2, side, 1);
    baker.graphics.fillStyle(AIRPORT.ink, 1);
    baker.graphics.fillCircle(engine.x, engine.y, 5.5);
    const prop = point(5, side, 1);
    baker.graphics.fillStyle(AIRPORT.glassLight, 0.32);
    baker.graphics.fillCircle(prop.x, prop.y, 8);
    baker.graphics.lineStyle(1, AIRPORT.white, 0.72);
    baker.graphics.lineBetween(prop.x - 7, prop.y, prop.x + 7, prop.y);
    baker.graphics.lineBetween(prop.x, prop.y - 7, prop.x, prop.y + 7);
  }

  const port = point(-19, -43, 2);
  const starboard = point(-19, 43, 2);
  baker.graphics.fillStyle(AIRPORT.red, 1);
  baker.graphics.fillCircle(port.x, port.y, 2.4);
  baker.graphics.fillStyle(AIRPORT.green, 1);
  baker.graphics.fillCircle(starboard.x, starboard.y, 2.4);
  baker.finish(AIRPLANE_KEY, width, height);
}


export function bakeAirplaneShadow(baker: Baker): void {
  const width = 104;
  const height = 62;
  const originX = width / 2;
  const originY = height / 2;
  const point = (forward: number, side: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(
      originX + forward * 0.89 - side * 0.46,
      originY + forward * 0.46 + side * 0.89,
    );
  baker.graphics.fillStyle(0x071116, 0.3);
  baker.graphics.fillPoints(
    [[38, 0], [27, -8], [-27, -10], [-38, -4], [-38, 4], [-27, 10], [27, 8]].map(
      ([forward, side]) => point(forward!, side!),
    ),
    true,
  );
  baker.finish(AIRPLANE_SHADOW_KEY, width, height);
}
