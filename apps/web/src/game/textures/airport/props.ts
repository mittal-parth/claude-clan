import { Baker, TILE_ANCHOR_Y } from "../core";
import { TERRAIN_COLORS } from "../../math/palette";
import { AIRPORT } from "../airport/terminal";

export const AIRPORT_WINDSOCK_KEY = "fx:airport-windsock";


export function bakeAirportWindsock(baker: Baker): void {
  const width = 72;
  const height = 92;
  const originX = width / 2;
  const originY = height - TILE_ANCHOR_Y;
  const base = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(TERRAIN_COLORS.shadow, 0.22);
  baker.graphics.fillEllipse(base.x + 4, base.y + 2, 28, 8);
  baker.graphics.lineStyle(3, AIRPORT.white, 1);
  baker.graphics.lineBetween(base.x, base.y, base.x, base.y - 54);
  baker.graphics.fillStyle(AIRPORT.red, 1);
  baker.graphics.fillTriangle(base.x, base.y - 52, base.x + 35, base.y - 45, base.x, base.y - 37);
  baker.graphics.fillStyle(AIRPORT.white, 1);
  baker.graphics.fillTriangle(base.x + 12, base.y - 49, base.x + 22, base.y - 47, base.x + 12, base.y - 41);
  baker.finish(AIRPORT_WINDSOCK_KEY, width, height);
}
