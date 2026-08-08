/**
 * Decoration: traffic, clouds, water sparkle and factory smoke.
 *
 * All of it is capped and all of it is optional — ambient life must never be
 * the reason the scene stutters, and it is disabled entirely under
 * prefers-reduced-motion.
 */

import Phaser from "phaser";
import { hashCoords, pickIndex } from "./hash";
import type { IsoProjection } from "./iso";
import type { TerrainCell, TerrainGrid } from "./terrain";
import {
  CAR_KEYS,
  CLOUD_KEY,
  SMOKE_KEY,
  SPARKLE_KEY,
  TILE_ANCHOR_Y,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "./textures";
import {
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
} from "./terrain";

const MAX_CARS = 20;
const MAX_CLOUDS = 7;
const MAX_SPARKLES = 40;
const MAX_SMOKE_EMITTERS = 24;

/** Milliseconds a car takes to cross one tile. */
const CAR_TILE_MS = 900;

export interface AmbientDepths {
  ground: number;
  sky: number;
}

interface Car {
  sprite: Phaser.GameObjects.Sprite;
  cell: TerrainCell;
  from?: TerrainCell;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class AmbientLife {
  private cars: Car[] = [];
  private clouds: Phaser.GameObjects.Sprite[] = [];
  private sparkles: Phaser.GameObjects.Sprite[] = [];
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private terrain?: TerrainGrid;
  private enabled = false;
  private readonly reducedMotion = prefersReducedMotion();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly projection: IsoProjection,
    private readonly depths: AmbientDepths,
  ) {}

  rebuild(terrain: TerrainGrid, withinBudget: boolean): void {
    this.clear();
    this.terrain = terrain;
    this.enabled = withinBudget && !this.reducedMotion;
    if (!this.enabled) {
      return;
    }

    this.spawnCars(terrain);
    this.spawnClouds(terrain);
    this.spawnSparkles(terrain);
  }

  /** Hooks a capped smoke plume onto a utility building's chimney. */
  attachSmoke(
    sprite: Phaser.GameObjects.Sprite,
    anchor?: { x: number; y: number },
  ): void {
    if (!anchor || !this.enabled || this.emitters.length >= MAX_SMOKE_EMITTERS) {
      return;
    }

    const emitter = this.scene.add.particles(
      sprite.x + anchor.x,
      sprite.y + anchor.y,
      SMOKE_KEY,
      {
        speedY: { min: -22, max: -12 },
        speedX: { min: -6, max: 10 },
        lifespan: 2600,
        quantity: 1,
        frequency: 620,
        scale: { start: 0.5, end: 1.5 },
        alpha: { start: 0.5, end: 0 },
      },
    );
    emitter.setDepth(sprite.depth + 1);
    this.emitters.push(emitter);
  }

  clear(): void {
    for (const car of this.cars) {
      this.scene.tweens.killTweensOf(car.sprite);
      car.sprite.destroy();
    }
    for (const cloud of this.clouds) {
      this.scene.tweens.killTweensOf(cloud);
      cloud.destroy();
    }
    for (const sparkle of this.sparkles) {
      this.scene.tweens.killTweensOf(sparkle);
      sparkle.destroy();
    }
    for (const emitter of this.emitters) {
      emitter.destroy();
    }
    this.cars = [];
    this.clouds = [];
    this.sparkles = [];
    this.emitters = [];
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------

  private spawnCars(terrain: TerrainGrid): void {
    // Only junctions and straights carry traffic; a dead-end stub would trap
    // a car into shuffling back and forth on one tile.
    const drivable = terrain.roads.filter((road) => connections(road).length >= 2);
    if (drivable.length === 0) {
      return;
    }

    const count = Math.min(MAX_CARS, Math.floor(drivable.length / 8));
    for (let index = 0; index < count; index += 1) {
      const cell = drivable[
        pickIndex(hashCoords(index, index * 7, 0xca4), drivable.length)
      ] as TerrainCell;
      const point = this.projection.project(cell.x, cell.y);
      const sprite = this.scene.add
        .sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          CAR_KEYS[index % CAR_KEYS.length] as string,
        )
        .setOrigin(0.5, 1)
        .setDepth(this.projection.depth(cell.x, cell.y));

      const car: Car = { sprite, cell };
      this.cars.push(car);
      // Stagger departures so they do not all move in lockstep.
      this.scene.time.delayedCall(index * 180, () => this.driveOn(car));
    }
  }

  private driveOn(car: Car): void {
    const terrain = this.terrain;
    if (!terrain || !this.enabled || !car.sprite.active) {
      return;
    }

    const options = connections(car.cell)
      .map(([dx, dy]) => terrain.cellAt(car.cell.x + dx, car.cell.y + dy))
      .filter((cell): cell is TerrainCell => cell?.kind === "road");
    if (options.length === 0) {
      return;
    }

    // Prefer not to double back, but allow it at a genuine dead end.
    const forward = options.filter(
      (cell) => !(cell.x === car.from?.x && cell.y === car.from?.y),
    );
    const choices = forward.length > 0 ? forward : options;
    const next = choices[
      Math.floor(Math.random() * choices.length)
    ] as TerrainCell;

    const point = this.projection.project(next.x, next.y);
    car.from = car.cell;
    car.cell = next;

    this.scene.tweens.add({
      targets: car.sprite,
      x: point.x,
      y: point.y + TILE_ANCHOR_Y,
      duration: CAR_TILE_MS,
      ease: "Linear",
      onComplete: () => {
        car.sprite.setDepth(this.projection.depth(next.x, next.y));
        this.driveOn(car);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Sky and water
  // -------------------------------------------------------------------------

  private spawnClouds(terrain: TerrainGrid): void {
    const { minX, minY, maxX, maxY } = terrain.bounds;
    const left = this.projection.project(minX, maxY).x;
    const right = this.projection.project(maxX, minY).x;
    const top = this.projection.project(minX, minY).y;
    const bottom = this.projection.project(maxX, maxY).y;

    for (let index = 0; index < MAX_CLOUDS; index += 1) {
      const seed = hashCoords(index, 0, 0xc10d);
      const y = top + ((seed % 1000) / 1000) * (bottom - top);
      const scale = 1.4 + ((seed >>> 10) % 100) / 90;
      const duration = 90_000 + ((seed >>> 4) % 40_000);
      const startX = left + ((seed >>> 16) % 1000) / 1000 * (right - left);

      // Barely there on purpose: an opaque cloud at sky depth washes out the
      // whole city the moment you zoom in.
      const cloud = this.scene.add
        .sprite(startX, y, CLOUD_KEY)
        .setDepth(this.depths.sky)
        .setScale(scale)
        .setAlpha(0.16);
      this.clouds.push(cloud);

      // A shadow crossing the ground below sells the height.
      const shadow = this.scene.add
        .sprite(startX + 60, y + 140, CLOUD_KEY)
        .setDepth(this.depths.ground + 1)
        .setScale(scale, scale * 0.5)
        .setTint(0x1f4d16)
        .setAlpha(0.07);
      this.clouds.push(shadow);

      for (const [target, offsetX, offsetY] of [
        [cloud, 0, 0],
        [shadow, 60, 140],
      ] as const) {
        this.scene.tweens.add({
          targets: target,
          x: { from: left - 300 + offsetX, to: right + 300 + offsetX },
          y: y + offsetY,
          duration,
          repeat: -1,
          delay: -((startX - left) / (right - left)) * duration,
          ease: "Linear",
        });
      }
    }
  }

  private spawnSparkles(terrain: TerrainGrid): void {
    const water = terrain.cells.filter((cell) => cell.kind === "water");
    if (water.length === 0) {
      return;
    }

    for (let index = 0; index < MAX_SPARKLES; index += 1) {
      const cell = water[
        pickIndex(hashCoords(index, index * 13, 0x5a4c), water.length)
      ] as TerrainCell;
      const point = this.projection.project(cell.x, cell.y);
      const sparkle = this.scene.add
        .sprite(
          point.x + ((index % 5) - 2) * 8,
          point.y + TILE_HEIGHT / 4,
          SPARKLE_KEY,
        )
        .setDepth(this.depths.ground + 1)
        .setAlpha(0);
      this.sparkles.push(sparkle);

      this.scene.tweens.add({
        targets: sparkle,
        alpha: { from: 0, to: 0.8 },
        duration: 900 + (index % 7) * 220,
        yoyo: true,
        repeat: -1,
        delay: index * 130,
        ease: "Sine.easeInOut",
      });
    }
  }
}

/** Decodes a road cell's connectivity mask into grid-space direction steps. */
function connections(cell: TerrainCell): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  if (cell.roadMask & ROAD_NORTH) {
    steps.push([0, -1]);
  }
  if (cell.roadMask & ROAD_EAST) {
    steps.push([1, 0]);
  }
  if (cell.roadMask & ROAD_SOUTH) {
    steps.push([0, 1]);
  }
  if (cell.roadMask & ROAD_WEST) {
    steps.push([-1, 0]);
  }
  return steps;
}

export const AMBIENT_LIMITS = {
  cars: MAX_CARS,
  clouds: MAX_CLOUDS,
  sparkles: MAX_SPARKLES,
  smoke: MAX_SMOKE_EMITTERS,
  tileWidth: TILE_WIDTH,
} as const;
