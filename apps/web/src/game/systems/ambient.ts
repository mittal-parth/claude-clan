/**
 * Decoration: traffic, clouds, water sparkle and factory smoke.
 *
 * All of it is capped and all of it is optional — ambient life must never be
 * the reason the scene stutters, and it is disabled entirely under
 * prefers-reduced-motion.
 */

import Phaser from "phaser";
import { hashCoords, pickIndex, unitFloat } from "../math/hash";
import type { IsoProjection } from "../math/iso";
import type { RoadClass, TerrainCell, TerrainGrid } from "../layouts/terrain";
import {
  COAST_RING,
  COUNTRYSIDE_RING,
  OUTER_RING,
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
} from "../layouts/terrain";
import { CAR_KEYS, WOODEN_SHIP_ANCHOR_Y, WOODEN_SHIP_KEYS } from "../textures/vehicles";
import { CLOUD_KEY, SMOKE_KEY, SPARKLE_KEY } from "../textures/effects";
import { TILE_ANCHOR_Y, TILE_HEIGHT, TILE_WIDTH } from "../textures/core";

const MAX_CARS = 20;
const MAX_CLOUDS = 7;
const MAX_SPARKLES = 40;
const MAX_SMOKE_EMITTERS = 24;
/** Purely decorative -- these never carry a PR or an issue anywhere. */
const MAX_WOODEN_SHIPS = 7;
/**
 * Milliseconds for the slowest ship to complete one lap; the fastest is
 * still comfortably becalmed. Ambient, not a race -- they should read as
 * barely moving on a long glance.
 */
const WOODEN_SHIP_LAP_MS = 900_000;
const WOODEN_SHIP_LAP_JITTER_MS = 300_000;
/** How far inset from each corner the turn starts, as a fraction of that leg. */
const WOODEN_SHIP_CORNER_INSET = 0.18;

/** Milliseconds a car takes to cross one tile. */
const CAR_TILE_MS = 900;

/**
 * How many copies of a road cell go into the spawn pool, by class. A road
 * with no class recorded (the airport's taxiway loop, which carries no
 * district) defaults to "street" in tileKeyFor, so it is weighted the same
 * here.
 */
const ROAD_CLASS_TRAFFIC_WEIGHT: Record<RoadClass, number> = {
  boulevard: 4,
  street: 2,
  lane: 1,
};

/** Chance a car at a junction takes the widest road on offer rather than a random one. */
const PREFER_WIDER_ROAD_CHANCE = 0.7;

const ROAD_CLASS_RANK: Record<RoadClass, number> = { lane: 0, street: 1, boulevard: 2 };

export interface AmbientDepths {
  ground: number;
  traffic: number;
  sky: number;
}

interface Car {
  sprite: Phaser.GameObjects.Sprite;
  cell: TerrainCell;
  from?: TerrainCell;
}

/** One leg of a wooden ship's lap, in grid space. */
type ShipLeg =
  | { kind: "line"; from: readonly [number, number]; to: readonly [number, number] }
  | {
      kind: "quad";
      from: readonly [number, number];
      control: readonly [number, number];
      to: readonly [number, number];
    };

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class AmbientLife {
  private cars: Car[] = [];
  private carTimers: Phaser.Time.TimerEvent[] = [];
  private traffic?: Phaser.GameObjects.Container;
  private clouds: Phaser.GameObjects.Sprite[] = [];
  private sparkles: Phaser.GameObjects.Sprite[] = [];
  private woodenShips: Phaser.GameObjects.Sprite[] = [];
  private woodenShipTweens: Phaser.Tweens.Tween[] = [];
  /**
   * Keyed by the building sprite a plume belongs to, so a demolished
   * building's smoke can be released individually via releaseSmoke rather
   * than only all-at-once in clear()/rebuild() -- without this, a demolished
   * building's plume hung in mid-air over the empty plot, and once
   * MAX_SMOKE_EMITTERS was hit no new building ever got smoke again.
   */
  private readonly smokeBySprite = new Map<
    Phaser.GameObjects.Sprite,
    Phaser.GameObjects.Particles.ParticleEmitter
  >();
  private terrain?: TerrainGrid;
  private enabled = false;
  private readonly reducedMotion = prefersReducedMotion();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly projection: IsoProjection,
    private readonly depths: AmbientDepths,
  ) {}

  rebuild(terrain: TerrainGrid): void {
    this.clear();
    this.terrain = terrain;
    // Ambient life is already capped by count, so it costs the same on a huge
    // repository as a small one; only a motion preference switches it off.
    this.enabled = !this.reducedMotion;
    if (!this.enabled) {
      return;
    }

    this.spawnCars(terrain);
    this.spawnClouds(terrain);
    this.spawnSparkles(terrain);
    this.spawnWoodenShips(terrain);
  }

  /** Hooks a capped smoke plume onto a utility building's chimney. */
  attachSmoke(
    sprite: Phaser.GameObjects.Sprite,
    anchor?: { x: number; y: number },
  ): void {
    if (
      !anchor ||
      !this.enabled ||
      this.smokeBySprite.size >= MAX_SMOKE_EMITTERS
    ) {
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
    this.smokeBySprite.set(sprite, emitter);
  }

  /**
   * Releases one building's smoke plume. Call this whenever its sprite is
   * destroyed -- demolished by the player's edits or cleared by a city
   * switch -- so the plume never outlives the building and the budget frees
   * up for new construction.
   */
  releaseSmoke(sprite: Phaser.GameObjects.Sprite): void {
    const emitter = this.smokeBySprite.get(sprite);
    if (!emitter) {
      return;
    }
    emitter.destroy();
    this.smokeBySprite.delete(sprite);
  }

  clear(): void {
    for (const car of this.cars) {
      this.scene.tweens.killTweensOf(car.sprite);
      car.sprite.destroy();
    }
    this.traffic?.removeAll(true);
    for (const timer of this.carTimers) {
      timer.remove();
    }
    for (const cloud of this.clouds) {
      this.scene.tweens.killTweensOf(cloud);
      cloud.destroy();
    }
    for (const sparkle of this.sparkles) {
      this.scene.tweens.killTweensOf(sparkle);
      sparkle.destroy();
    }
    for (const emitter of this.smokeBySprite.values()) {
      emitter.destroy();
    }
    for (const tween of this.woodenShipTweens) {
      tween.remove();
    }
    for (const ship of this.woodenShips) {
      ship.destroy();
    }
    this.cars = [];
    this.carTimers = [];
    this.clouds = [];
    this.sparkles = [];
    this.smokeBySprite.clear();
    this.woodenShips = [];
    this.woodenShipTweens = [];
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------

  /**
   * Traffic lives in its own container. A car re-depths on every hop, and on
   * the main display list that dirties tens of thousands of entries and forces
   * a full re-sort — measured at half the framerate on a large repository.
   *
   * A fixed depth below the buildings is not a compromise here: building and
   * prop sprites are anchored at their tile's bottom corner and extend upward,
   * so they only ever cover screen positions behind them. A car those sprites
   * overlap is a car they genuinely stand in front of.
   */
  private spawnCars(terrain: TerrainGrid): void {
    this.traffic ??= this.scene.add
      .container(0, 0)
      .setDepth(this.depths.traffic);
    // Only junctions and straights carry traffic; a dead-end stub would trap
    // a car into shuffling back and forth on one tile.
    const drivable = terrain.roads.filter((road) => connections(road).length >= 2);
    if (drivable.length === 0) {
      return;
    }

    // Weight the spawn pool toward the wider roads, so a glance at the city
    // shows more traffic on its main roads than its back lanes rather than
    // an even scatter that ignores the road hierarchy entirely.
    const pool: TerrainCell[] = [];
    for (const cell of drivable) {
      const weight = ROAD_CLASS_TRAFFIC_WEIGHT[cell.roadClass ?? "street"];
      for (let copy = 0; copy < weight; copy += 1) {
        pool.push(cell);
      }
    }

    const count = Math.min(MAX_CARS, Math.floor(drivable.length / 8));
    for (let index = 0; index < count; index += 1) {
      const cell = pool[
        pickIndex(hashCoords(index, index * 7, 0xca4), pool.length)
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

      this.traffic?.add(sprite);
      const car: Car = { sprite, cell };
      this.cars.push(car);
      // Stagger departures so they do not all move in lockstep.
      this.carTimers.push(
        this.scene.time.delayedCall(index * 180, () => this.driveOn(car)),
      );
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

    // At a junction with a choice of roads, usually take the widest one on
    // offer -- hash-driven on the car's own position, not Math.random, so the
    // preference is deterministic for a given approach rather than reshuffled
    // on every rebuild.
    const widestRank = Math.max(
      ...choices.map((cell) => ROAD_CLASS_RANK[cell.roadClass ?? "street"]),
    );
    const widest = choices.filter(
      (cell) => ROAD_CLASS_RANK[cell.roadClass ?? "street"] === widestRank,
    );
    const preferWidest =
      widest.length < choices.length &&
      unitFloat(hashCoords(car.cell.x, car.cell.y, 0xca5)) < PREFER_WIDER_ROAD_CHANCE;
    const pool = preferWidest ? widest : choices;
    const next = pool[Math.floor(Math.random() * pool.length)] as TerrainCell;

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

  /**
   * Wooden ships tack a slow rounded-rectangle lap through open water, well
   * past the coast, each at a different distance out so they never collide.
   * They carry nothing and are not interactive.
   */
  private spawnWoodenShips(terrain: TerrainGrid): void {
    const cityMaxX = terrain.bounds.maxX - OUTER_RING;
    const cityMaxY = terrain.bounds.maxY - OUTER_RING;
    const baseMargin = COUNTRYSIDE_RING + COAST_RING;

    for (let index = 0; index < MAX_WOODEN_SHIPS; index += 1) {
      // Spread across the ocean ring, closest ship a few tiles off the sand,
      // furthest still short of the hard camera edge.
      const margin = baseMargin + 3 + index * 1.4;
      const corners: Array<readonly [number, number]> = [
        [-margin, -margin],
        [cityMaxX + margin, -margin],
        [cityMaxX + margin, cityMaxY + margin],
        [-margin, cityMaxY + margin],
      ];
      const legs = buildShipLoop(corners);

      const seed = hashCoords(index, index * 5, 0x5417);
      const duration = WOODEN_SHIP_LAP_MS + (seed % WOODEN_SHIP_LAP_JITTER_MS);
      const startT = index / MAX_WOODEN_SHIPS;

      const start = sampleShipLoop(legs, startT);
      const point = this.projection.project(start.p[0], start.p[1]);
      const sprite = this.scene.add
        .sprite(point.x, point.y + WOODEN_SHIP_ANCHOR_Y, WOODEN_SHIP_KEYS[0]!)
        .setOrigin(0.5, 1)
        .setDepth(this.projection.depth(start.p[0], start.p[1]));
      this.woodenShips.push(sprite);

      const state = { t: startT };
      const tween = this.scene.tweens.add({
        targets: state,
        t: startT + 1,
        duration,
        repeat: -1,
        ease: "Linear",
        onUpdate: () => this.poseWoodenShip(sprite, legs, state.t % 1),
      });
      this.woodenShipTweens.push(tween);
    }
  }

  private poseWoodenShip(
    sprite: Phaser.GameObjects.Sprite,
    legs: readonly ShipLeg[],
    t: number,
  ): void {
    const { p, heading } = sampleShipLoop(legs, t);
    const point = this.projection.project(p[0], p[1]);
    sprite
      .setPosition(point.x, point.y + WOODEN_SHIP_ANCHOR_Y)
      .setDepth(this.projection.depth(p[0], p[1]));

    // Bow is authored toward -v at frame 0 (see bakeWoodenShip): a bow
    // pointing along unit heading (du, dv) needs sin(theta) = du,
    // cos(theta) = -dv.
    const count = WOODEN_SHIP_KEYS.length;
    const turns = Math.atan2(heading[0], -heading[1]) / (Math.PI * 2);
    const frame = ((Math.round(turns * count) % count) + count) % count;
    const key = WOODEN_SHIP_KEYS[frame]!;
    if (sprite.texture.key !== key) {
      sprite.setTexture(key);
    }
  }
}

/**
 * Rounds the four corners of a rectangle into a closed course: a straight
 * leg into each corner, then a quadratic bend around it (the corner point
 * itself is the control point) into the next straight leg. See the
 * isometric-animation skill on why a turn belongs in the path, not a snap.
 */
function buildShipLoop(
  corners: readonly (readonly [number, number])[],
): ShipLeg[] {
  const lerp = (
    a: readonly [number, number],
    b: readonly [number, number],
    t: number,
  ): readonly [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const entries = corners.map((corner, index) =>
    lerp(corners[(index + 3) % corners.length]!, corner, 1 - WOODEN_SHIP_CORNER_INSET),
  );
  const exits = corners.map((corner, index) =>
    lerp(corner, corners[(index + 1) % corners.length]!, WOODEN_SHIP_CORNER_INSET),
  );

  const legs: ShipLeg[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const from = exits[(index + corners.length - 1) % corners.length]!;
    legs.push({ kind: "line", from, to: entries[index]! });
    legs.push({
      kind: "quad",
      from: entries[index]!,
      control: corners[index]!,
      to: exits[index]!,
    });
  }
  return legs;
}

/** Position and unit travel direction at fraction `t` (wraps) around the loop. */
function sampleShipLoop(
  legs: readonly ShipLeg[],
  t: number,
): { p: readonly [number, number]; heading: readonly [number, number] } {
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * legs.length;
  const index = Math.min(legs.length - 1, Math.floor(scaled));
  const local = scaled - index;
  const leg = legs[index]!;

  if (leg.kind === "line") {
    const dx = leg.to[0] - leg.from[0];
    const dy = leg.to[1] - leg.from[1];
    const length = Math.hypot(dx, dy) || 1;
    return {
      p: [leg.from[0] + dx * local, leg.from[1] + dy * local],
      heading: [dx / length, dy / length],
    };
  }

  const { from, control, to } = leg;
  const u = local;
  const a = (1 - u) ** 2;
  const b = 2 * (1 - u) * u;
  const c = u ** 2;
  const p: readonly [number, number] = [
    a * from[0] + b * control[0] + c * to[0],
    a * from[1] + b * control[1] + c * to[1],
  ];
  const dx = 2 * (1 - u) * (control[0] - from[0]) + 2 * u * (to[0] - control[0]);
  const dy = 2 * (1 - u) * (control[1] - from[1]) + 2 * u * (to[1] - control[1]);
  const length = Math.hypot(dx, dy) || 1;
  return { p, heading: [dx / length, dy / length] };
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
