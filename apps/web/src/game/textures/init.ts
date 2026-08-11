import Phaser, { Scene } from "phaser";
import { TERRAIN_ATLAS_KEY, bakeTerrainAtlas } from "./terrain";
import { NAVY_COMMAND_KEY, bakeNavyPier, bakeNavyCommand, bakeNavyHangar, bakeNavyBarracks, bakeNavyRadar, NAVY_RADAR_DISH_KEYS, bakeNavyRadarDish, bakeNavyFence, bakeNavyFloodlight, bakeNavyFlag, bakeNavyCrate, bakeNavyBollard, bakeNavyQuay, bakeNavySign } from "./navy/base";
import { createBaker } from "./core";
import { bakeHighlight, HIGHLIGHT_KEY, SELECT_KEY, ADDED_MARKER_KEY, bakeRubble, bakeCloud, bakeSmoke, bakeSparkle } from "./effects";
import { bakeTree, bakePine, bakeBush, bakeRock, bakeFountain, bakeLamp } from "./props";
import { CAR_KEYS, bakeCar, WOODEN_SHIP_KEYS, bakeWoodenShip } from "./vehicles";
import { bakeIssueShop } from "./buildings";
import { bakeAirportApron, bakeAirportTaxiway, AIRPORT_TAXIWAY_VERTICAL_KEY, AIRPORT_TAXIWAY_JUNCTION_KEY, bakeAirportRunwayTile, bakeAirportRunwayThreshold } from "./airport/runway";
import { bakeAirportTerminal, bakeAirportTower } from "./airport/terminal";
import { bakeAirportWindsock } from "./airport/props";
import { bakeAirplane, bakeAirplaneShadow } from "./airport/aircraft";
import { bakeHarbourQuay, bakeHarbourPier, bakeHarbourWarehouse, bakeHarbourBollard, bakeHarbourSign, bakeHarbourLighthouse, bakeHarbourLamp, bakeHarbourMarker } from "./harbour/base";
import { bakeHarbourCrane, HARBOUR_CRANE_JIB_KEYS, bakeHarbourCraneJib, bakeHarbourCraneTrolley, bakeHarbourCraneSpreader } from "./harbour/crane";
import { HARBOUR_CONTAINER_KEYS, bakeHarbourContainer, HARBOUR_CONTAINERS_KEYS, bakeHarbourContainers, HARBOUR_CARGO_KEYS, bakeHarbourCargo } from "./harbour/cargo";
import { HARBOUR_SHIP_KEYS, bakeHarbourContainerShip } from "./harbour/ship";
import { BATTLESHIP_KEYS, bakeNavyBattleship } from "./navy/battleship";
import { bakeNavyMissile, bakeNavyTank, bakeNavyGun, bakeNavyFuelTank } from "./navy/vehicles";
import { bakeNavyHelipad, bakeNavyHelicopter, NAVY_ROTOR_KEYS, bakeNavyRotor } from "./navy/aircraft";
import { bakeCrane, bakeHook, bakeCable } from "./crane";
import { bakeScaffold, bakeDiffScaffold } from "./scaffold";

/**
 * Bakes every terrain tile, prop and effect sprite. Call once, in create().
 *
 * Textures live on the Game's TextureManager, not the Scene, so they are
 * shared across every scene in the game -- baking is genuinely a one-time
 * cost. Without this guard, a second scene's create() would remove and
 * regenerate the same texture keys out from under the first scene's still-
 * live sprites, which reference their Texture by key.
 */
export function bakeTerrainTextures(scene: Phaser.Scene): void {
  if (
    scene.textures.exists(TERRAIN_ATLAS_KEY) &&
    scene.textures.exists(NAVY_COMMAND_KEY)
  ) {
    return;
  }

  const baker = createBaker(scene);

  bakeTerrainAtlas(scene, baker);
  baker.graphics.clear();

  bakeHighlight(baker, HIGHLIGHT_KEY, 0xffffff, 0.28);
  bakeHighlight(baker, SELECT_KEY, 0xffd166, 0.5);
  bakeHighlight(baker, ADDED_MARKER_KEY, 0xffb454, 0.65);
  bakeRubble(baker);

  bakeTree(baker);
  bakePine(baker);
  bakeBush(baker);
  bakeRock(baker);
  bakeFountain(baker);
  bakeLamp(baker);

  bakeCloud(baker);
  bakeSmoke(baker);
  bakeSparkle(baker);
  CAR_KEYS.forEach((key, index) => bakeCar(baker, key, index));
  WOODEN_SHIP_KEYS.forEach((key, index) => bakeWoodenShip(baker, key, index));
  bakeIssueShop(baker);
  bakeAirportApron(baker);
  bakeAirportTaxiway(baker, AIRPORT_TAXIWAY_VERTICAL_KEY, false);
  bakeAirportTaxiway(baker, AIRPORT_TAXIWAY_JUNCTION_KEY, true);
  bakeAirportRunwayTile(baker);
  bakeAirportRunwayThreshold(baker);
  bakeAirportTerminal(baker);
  bakeAirportTower(baker);
  bakeAirportWindsock(baker);
  bakeAirplane(baker);
  bakeAirplaneShadow(baker);
  bakeHarbourQuay(baker);
  bakeHarbourPier(baker);
  bakeHarbourWarehouse(baker);
  bakeHarbourCrane(baker);
  HARBOUR_CRANE_JIB_KEYS.forEach((key, index) =>
    bakeHarbourCraneJib(baker, key, index),
  );
  bakeHarbourCraneTrolley(baker);
  bakeHarbourCraneSpreader(baker);
  HARBOUR_CONTAINER_KEYS.forEach((key, index) =>
    bakeHarbourContainer(baker, key, index),
  );
  HARBOUR_SHIP_KEYS.forEach((key, index) =>
    bakeHarbourContainerShip(baker, key, index),
  );
  HARBOUR_CONTAINERS_KEYS.forEach((key, index) =>
    bakeHarbourContainers(baker, key, index),
  );
  HARBOUR_CARGO_KEYS.forEach((key, index) => bakeHarbourCargo(baker, key, index));
  bakeHarbourBollard(baker);
  bakeHarbourSign(baker);
  bakeHarbourLighthouse(baker);
  bakeHarbourLamp(baker);
  bakeHarbourMarker(baker);

  BATTLESHIP_KEYS.forEach((key, index) => bakeNavyBattleship(baker, key, index));
  bakeNavyPier(baker);
  bakeNavyCommand(baker);
  bakeNavyHangar(baker);
  bakeNavyBarracks(baker);
  bakeNavyRadar(baker);
  NAVY_RADAR_DISH_KEYS.forEach((key, index) => bakeNavyRadarDish(baker, key, index));
  bakeNavyMissile(baker);
  bakeNavyTank(baker);
  bakeNavyGun(baker);
  bakeNavyFuelTank(baker);
  bakeNavyHelipad(baker);
  bakeNavyHelicopter(baker);
  NAVY_ROTOR_KEYS.forEach((key, index) => bakeNavyRotor(baker, key, index));
  bakeNavyFence(baker);
  bakeNavyFloodlight(baker);
  bakeNavyFlag(baker);
  bakeNavyCrate(baker);
  bakeNavyBollard(baker);
  bakeNavyQuay(baker);
  bakeNavySign(baker);
  bakeCrane(baker);
  bakeHook(baker);
  bakeCable(baker);
  bakeScaffold(baker);
  bakeDiffScaffold(baker);

  baker.destroy();
}
