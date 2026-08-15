import Phaser from "phaser";
import type { Building, WorldSnapshot } from "@sudo-city/protocol";
import { archetypeFor, tierFor } from "../../math/palette";
import { hashText, pickIndex } from "../../math/hash";
import { AIRCRAFT_ART_HEADING, SHORE_BAND } from "./worldConstants";
import { TILE_WIDTH, TILE_HEIGHT } from "../../textures/core";
import {
  roadTextureKey,
  terrainTextureKey,
  TERRAIN_VARIANT_COUNTS,
} from "../../textures/terrain";
import type { TerrainCell, TerrainGrid } from "../../layouts/terrain";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface AircraftTweenOptions {
  groundAt: (progress: number) => ScreenPoint;
  altitudeAt?: (progress: number) => number;
  scaleAt?: (progress: number) => number;
  alphaAt?: (progress: number) => number;
  rotationAt?: (progress: number) => number;
  duration: number;
  ease: string;
  onProgress?: (progress: number, point: ScreenPoint, altitude: number) => void;
}

export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function linePath(
  from: ScreenPoint,
  to: ScreenPoint,
): (progress: number) => ScreenPoint {
  return (progress) => ({
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  });
}

export function cubicPath(
  from: ScreenPoint,
  controlA: ScreenPoint,
  controlB: ScreenPoint,
  to: ScreenPoint,
): (progress: number) => ScreenPoint {
  return (progress) => {
    const inverse = 1 - progress;
    return {
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * progress * controlA.x +
        3 * inverse * progress ** 2 * controlB.x +
        progress ** 3 * to.x,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * progress * controlA.y +
        3 * inverse * progress ** 2 * controlB.y +
        progress ** 3 * to.y,
    };
  };
}

export function aircraftRotation(from: ScreenPoint, to: ScreenPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - AIRCRAFT_ART_HEADING;
}

/**
 * World-space heading a baked-frame hull should face while sailing along a
 * screen-space tangent, so its heading tracks the curve it is actually
 * tracing at every point along a turn instead of snapping between two fixed
 * bearings partway through. Frame 0's bow points along grid -v (see
 * `bakeHarbourContainerShip`), which a yaw of theta rotates to
 * `(sin(theta), -cos(theta))` -- this is that mapping inverted.
 */
export function headingFromTangent(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const du = dx / TILE_WIDTH + dy / TILE_HEIGHT;
  const dv = dy / TILE_HEIGHT - dx / TILE_WIDTH;
  return Math.atan2(du, -dv);
}

/** Returns a random point just beyond one edge of the screen-fixed viewport. */
export function randomCloudEdge(
  camera: Phaser.Cameras.Scene2D.Camera,
  padding: number,
): { x: number; y: number } {
  switch (Phaser.Math.Between(0, 3)) {
    case 0:
      return { x: -padding, y: Phaser.Math.Between(-padding, camera.height + padding) };
    case 1:
      return {
        x: camera.width + padding,
        y: Phaser.Math.Between(-padding, camera.height + padding),
      };
    case 2:
      return { x: Phaser.Math.Between(-padding, camera.width + padding), y: -padding };
    default:
      return {
        x: Phaser.Math.Between(-padding, camera.width + padding),
        y: camera.height + padding,
      };
  }
}

/**
 * True when a water cell is close enough to land that its tile is worth
 * drawing. Open ocean is indistinguishable from the flat background.
 */
export function nearShore(terrain: TerrainGrid, cell: TerrainCell): boolean {
  for (let dy = -SHORE_BAND; dy <= SHORE_BAND; dy += 1) {
    for (let dx = -SHORE_BAND; dx <= SHORE_BAND; dx += 1) {
      const kind = terrain.cellAt(cell.x + dx, cell.y + dy)?.kind;
      if (kind && kind !== "water") {
        return true;
      }
    }
  }
  return false;
}

export function tileKeyFor(cell: TerrainCell): string {
  if (cell.kind === "road") {
    return roadTextureKey(cell.roadMask, cell.roadClass ?? "street");
  }
  const variants = TERRAIN_VARIANT_COUNTS[cell.kind];
  return terrainTextureKey(cell.kind, Math.min(cell.variant, variants - 1));
}

/** Terrain depends on the field size, the districts and which plots are taken. */
export function terrainChanged(
  before: WorldSnapshot,
  after: WorldSnapshot,
): boolean {
  if (
    before.size.width !== after.size.width ||
    before.size.height !== after.size.height ||
    before.districts.length !== after.districts.length ||
    before.buildings.length !== after.buildings.length
  ) {
    return true;
  }
  return (
    plotFingerprint(before) !== plotFingerprint(after) ||
    JSON.stringify(before.districts) !== JSON.stringify(after.districts)
  );
}

export function plotFingerprint(snapshot: WorldSnapshot): number {
  let fingerprint = 0;
  for (const building of snapshot.buildings) {
    fingerprint ^= hashText(`${building.plot.x}:${building.plot.y}`);
  }
  return fingerprint;
}

/** True when the two revisions would bake to the same sprite in the same place. */
export function sameStructure(before: Building, after: Building): boolean {
  return (
    before.plot.x === after.plot.x &&
    before.plot.y === after.plot.y &&
    before.language === after.language &&
    before.district === after.district &&
    tierFor(before.loc) === tierFor(after.loc) &&
    archetypeFor(before.language, before.loc, before.district) ===
      archetypeFor(after.language, after.loc, after.district)
  );
}

/**
 * Wheel deltas in "doublings of zoom".
 */
export function wheelSteps(
  pointer: Phaser.Input.Pointer,
  deltaY: number,
): number {
  const event = pointer.event as WheelEvent | undefined;
  const unit =
    event?.deltaMode === 1 ? 16 : event?.deltaMode === 2 ? 100 : 1;
  return (deltaY * unit) / 500;
}

/** Deterministic variant choice for anything keyed by identity rather than cell. */
export function variantFor(identity: string, count: number): number {
  return pickIndex(hashText(identity), count);
}
