import Phaser from "phaser";
import type { WorldSnapshot } from "@sudo-city/protocol";
import { playUiClickSound } from "@/lib/play-ui-click";
import {
  AIRCRAFT_GROUND_LIFT,
  AIRCRAFT_GROUND_SCALE,
  projection,
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  SKY_DEPTH,
  WHITEOUT_HOLD_MS,
} from "../../core/worldConstants";
import {
  aircraftRotation,
  cubicPath,
  lerp,
  linePath,
  type AircraftTweenOptions,
  type ScreenPoint,
} from "../../core/worldMath";
import { worldToScreen } from "../../utils/hitZoneUtils";
import { isCanvasPointer } from "../../utils/pointerUtils";
import {
  AIRPORT_TERMINAL_HALF_U,
  AIRPORT_TERMINAL_HALF_V,
  airportLayoutKey,
  connectAirportToRoad,
  createAirportLayout,
  runwayExitPoint,
  type AirportLayout,
  type AirportPoint,
} from "../../../layouts/airport";
import {
  AIRPORT_TERMINAL_ANCHOR_Y,
  AIRPORT_TERMINAL_KEY,
  AIRPORT_TOWER_ANCHOR_Y,
  AIRPORT_TOWER_KEY,
} from "../../../textures/airport/terminal";
import {
  AIRPORT_APRON_KEY,
  AIRPORT_RUNWAY_THRESHOLD_KEY,
  AIRPORT_RUNWAY_TILE_KEY,
  AIRPORT_TAXIWAY_JUNCTION_KEY,
  AIRPORT_TAXIWAY_VERTICAL_KEY,
} from "../../../textures/airport/runway";
import { AIRPORT_WINDSOCK_KEY } from "../../../textures/airport/props";
import {
  AIRPLANE_KEY,
  AIRPLANE_SHADOW_KEY,
} from "../../../textures/airport/aircraft";
import { TERRAIN_ATLAS_KEY, roadTextureKey } from "../../../textures/terrain";
import { TILE_ANCHOR_Y, TILE_WIDTH } from "../../../textures/core";
import { SMOKE_KEY } from "../../../textures/effects";
import type { TerrainCell } from "../../../layouts/terrain";
import type { AmbientLife } from "../../../systems/ambient";
import type { ShipHoverInfo } from "../../../WorldScene";
import type { WorldTransitionManager } from "../../effects/WorldTransitionManager";
import { prefersReducedMotion } from "../../../systems/ambient";

export class WorldAirportManager {
  private airportTerminal?: Phaser.GameObjects.Sprite;
  private airportTower?: Phaser.GameObjects.Sprite;
  private airportSurfaceSprites: Phaser.GameObjects.Sprite[] = [];
  private airportDecorationSprites: Phaser.GameObjects.Sprite[] = [];
  private airportLayoutSignature?: string;

  private parkedAirplane?: Phaser.GameObjects.Sprite;
  private parkedAirplaneShadow?: Phaser.GameObjects.Sprite;
  private activeFlight?: Phaser.GameObjects.Sprite;
  private activeFlightShadow?: Phaser.GameObjects.Sprite;
  private flightEffects = new Set<Phaser.GameObjects.Sprite>();
  private airportBeacon?: Phaser.GameObjects.Arc;

  private airportHoverListener?: (info?: ShipHoverInfo) => void;
  private airportClickListener?: () => void;

  constructor(
    private scene: Phaser.Scene,
    private isTravelTransitionActive: () => boolean,
    private isSkipRequested: () => boolean,
  ) {}

  setAirportHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.airportHoverListener = listener;
  }

  clearHover(): void {
    this.airportHoverListener?.(undefined);
  }

  setAirportClickListener(listener?: () => void): void {
    this.airportClickListener = listener;
  }

  /**
   * The runway is placed from the field's own size — it runs along
   * `height + 2.4`, off the island's southwest shore — so a layout is only
   * meaningful for the city it was derived from.
   *
   * There is deliberately no default size. A fallback field here is invisible
   * at the call site and silently puts the whole campus somewhere no city
   * ever was; callers that might not have a snapshot say so explicitly.
   */
  airportLayout(snapshot: WorldSnapshot): AirportLayout {
    return createAirportLayout(snapshot.size.width, snapshot.size.height);
  }

  private parkedAircraftRotation(airport: AirportLayout): number {
    const gate = projection.project(airport.gate.x, airport.gate.y);
    const standApproach = projection.project(
      airport.gate.x + 0.2,
      airport.gate.y + 0.52,
    );
    return aircraftRotation(standApproach, gate);
  }

  layoutAirport(snapshot?: WorldSnapshot, terrainRoads: TerrainCell[] = []): void {
    if (!snapshot) {
      this.clearAirportStatic();
      return;
    }
    const airport = this.airportLayout(snapshot);
    const accessRoad = connectAirportToRoad(
      airport.accessRoadStart,
      terrainRoads,
    );
    const signature = `${airportLayoutKey(airport)}:${accessRoad
      .map((cell) => `${cell.x},${cell.y}`)
      .join(";")}`;
    if (signature === this.airportLayoutSignature && this.airportTerminal) {
      return;
    }
    this.clearAirportStatic();
    this.airportLayoutSignature = signature;

    const addSurface = (
      point: AirportPoint,
      key: string,
      depthOffset = 2,
    ): Phaser.GameObjects.Sprite => {
      const projected = projection.project(point.x, point.y);
      const sprite = this.scene.add
        .sprite(projected.x, projected.y, key)
        .setOrigin(0.5, 0.5)
        .setDepth(projection.depth(point.x, point.y) + depthOffset)
        .setInteractive({ pixelPerfect: true, useHandCursor: true });
      this.bindAirportInteractions(sprite);
      this.airportSurfaceSprites.push(sprite);
      return sprite;
    };

    addSurface(airport.apron, AIRPORT_APRON_KEY, 3);
    airport.taxiway.forEach((tile) => {
      addSurface(
        tile,
        tile.kind === "junction"
          ? AIRPORT_TAXIWAY_JUNCTION_KEY
          : AIRPORT_TAXIWAY_VERTICAL_KEY,
        4,
      );
    });

    for (let index = 0; index < airport.runwayLength; index += 1) {
      addSurface(
        { x: airport.runwayStart.x + index, y: airport.runwayStart.y },
        index === 0 || index === airport.runwayLength - 1
          ? AIRPORT_RUNWAY_THRESHOLD_KEY
          : AIRPORT_RUNWAY_TILE_KEY,
        5,
      );
    }

    const connectedRoadCells = new Set(
      [...accessRoad, ...terrainRoads].map(
        (cell) => `${Math.round(cell.x)}:${Math.round(cell.y)}`,
      ),
    );
    accessRoad.forEach((cell, index) => {
      const hasRoad = (x: number, y: number): boolean =>
        connectedRoadCells.has(`${x}:${y}`);
      let mask =
        (hasRoad(cell.x, cell.y - 1) ? ROAD_NORTH : 0) |
        (hasRoad(cell.x + 1, cell.y) ? ROAD_EAST : 0) |
        (hasRoad(cell.x, cell.y + 1) ? ROAD_SOUTH : 0) |
        (hasRoad(cell.x - 1, cell.y) ? ROAD_WEST : 0);
      if (index === 0) mask |= ROAD_SOUTH;
      const point = projection.project(cell.x, cell.y);
      const road = this.scene.add
        .sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          TERRAIN_ATLAS_KEY,
          roadTextureKey(mask, "street"),
        )
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(cell.x, cell.y) + 4)
        .setInteractive({ useHandCursor: true });
      this.bindAirportInteractions(road);
      this.airportSurfaceSprites.push(road);
    });

    const terminalPoint = projection.project(airport.terminal.x, airport.terminal.y);
    this.airportTerminal = this.scene.add
      .sprite(
        terminalPoint.x,
        terminalPoint.y + AIRPORT_TERMINAL_ANCHOR_Y,
        AIRPORT_TERMINAL_KEY,
      )
      .setOrigin(0.5, 1)
      // A multi-tile sprite gets one sort key, taken from the front of its
      // footprint: keyed on the centre, an aircraft parked at the stand sinks
      // behind five tiles of facade.
      .setDepth(
        projection.depth(
          airport.terminal.x + AIRPORT_TERMINAL_HALF_U,
          airport.terminal.y + AIRPORT_TERMINAL_HALF_V,
        ) + 12,
      )
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.airportTerminal);

    const towerPoint = projection.project(airport.tower.x, airport.tower.y);
    this.airportTower = this.scene.add
      .sprite(
        towerPoint.x,
        towerPoint.y + AIRPORT_TOWER_ANCHOR_Y,
        AIRPORT_TOWER_KEY,
      )
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(airport.tower.x + 0.5, airport.tower.y + 0.5) + 14)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.airportTower);

    // Anchored to the stand, not the apron centre: the apron grew with the
    // terminal, and an apron-relative offset walked the windsock into the
    // parked aircraft's wing.
    const windsockGrid = { x: airport.gate.x + 1.73, y: airport.gate.y + 0.38 };
    const windsockPoint = projection.project(windsockGrid.x, windsockGrid.y);
    const windsock = this.scene.add
      .sprite(windsockPoint.x, windsockPoint.y + TILE_ANCHOR_Y, AIRPORT_WINDSOCK_KEY)
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(windsockGrid.x, windsockGrid.y) + 18)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(windsock);
    this.airportDecorationSprites.push(windsock);

    const gatePoint = projection.project(airport.gate.x, airport.gate.y);
    const parkedRotation = this.parkedAircraftRotation(airport);
    this.parkedAirplaneShadow = this.scene.add
      .sprite(gatePoint.x + 4, gatePoint.y + 4, AIRPLANE_SHADOW_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setRotation(parkedRotation)
      .setDepth(projection.depth(airport.gate.x, airport.gate.y) + 96);
    this.parkedAirplane = this.scene.add
      .sprite(gatePoint.x, gatePoint.y - AIRCRAFT_GROUND_LIFT, AIRPLANE_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setRotation(parkedRotation)
      .setDepth(projection.depth(airport.gate.x, airport.gate.y) + 100)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.parkedAirplane);

    this.airportBeacon = this.scene.add
      .circle(towerPoint.x, towerPoint.y - 217, 3.5, 0xff5d6c, 0.25)
      .setDepth(SKY_DEPTH - 2)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: this.airportBeacon,
      alpha: 1,
      scale: 2,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private bindAirportInteractions(sprite: Phaser.GameObjects.Sprite): void {
    sprite.on("pointerover", () => {
      if (this.isTravelTransitionActive()) return;
      const screen = worldToScreen(this.scene.cameras.main, sprite.x, sprite.y);
      this.airportHoverListener?.({
        cityId: "airport",
        title: "CLAUDE CITY AIRPORT · CCX",
        action: "Open departures · choose repository city",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    sprite.on("pointerout", () => this.airportHoverListener?.(undefined));
    sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!isCanvasPointer(pointer)) return;
      if (this.isTravelTransitionActive()) return;
      playUiClickSound();
      this.airportHoverListener?.(undefined);
      this.airportClickListener?.();
    });
  }

  private createActiveAircraft(start: ScreenPoint): {
    flight: Phaser.GameObjects.Sprite;
    shadow: Phaser.GameObjects.Sprite;
  } {
    this.parkedAirplane?.setVisible(false);
    this.parkedAirplaneShadow?.setVisible(false);
    const shadow = this.scene.add
      .sprite(start.x + 4, start.y + 4, AIRPLANE_SHADOW_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setDepth(SKY_DEPTH - 7);
    const flight = this.scene.add
      .sprite(start.x, start.y - AIRCRAFT_GROUND_LIFT, AIRPLANE_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setDepth(SKY_DEPTH - 5);
    this.activeFlight = flight;
    this.activeFlightShadow = shadow;
    return { flight, shadow };
  }

  private animateAircraft(
    flight: Phaser.GameObjects.Sprite,
    shadow: Phaser.GameObjects.Sprite,
    options: AircraftTweenOptions,
  ): Promise<void> {
    const cursor = { progress: 0 };
    const altitudeAt = options.altitudeAt ?? (() => 0);
    const scaleAt = options.scaleAt ?? (() => AIRCRAFT_GROUND_SCALE);
    const alphaAt = options.alphaAt ?? (() => 1);

    const setPose = (progress: number): void => {
      const point = options.groundAt(progress);
      const altitude = altitudeAt(progress);
      const sampleDistance = 0.004;
      const fromT = progress > 1 - sampleDistance ? progress - sampleDistance : progress;
      const toT = progress > 1 - sampleDistance ? progress : progress + sampleDistance;
      const fromGround = options.groundAt(Math.max(0, fromT));
      const toGround = options.groundAt(Math.min(1, toT));
      const fromAltitude = altitudeAt(Math.max(0, fromT));
      const toAltitude = altitudeAt(Math.min(1, toT));
      const pathRotation = aircraftRotation(
        { x: fromGround.x, y: fromGround.y - fromAltitude },
        { x: toGround.x, y: toGround.y - toAltitude },
      );
      const rotation = options.rotationAt?.(progress) ?? pathRotation;
      const groundRotation = options.rotationAt?.(progress) ??
        aircraftRotation(fromGround, toGround);
      const scale = scaleAt(progress);
      const alpha = alphaAt(progress);

      flight
        .setPosition(point.x, point.y - altitude - AIRCRAFT_GROUND_LIFT)
        .setRotation(rotation)
        .setScale(scale)
        .setAlpha(alpha);
      const altitudeFade = 1 - Math.min(0.86, altitude / 420);
      shadow
        .setPosition(point.x + 4, point.y + 4)
        .setRotation(groundRotation)
        .setScale(scale * (1 + altitude / 720))
        .setAlpha(0.34 * altitudeFade * alpha);
      options.onProgress?.(progress, point, altitude);
    };

    setPose(0);
    if (prefersReducedMotion()) {
      setPose(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: cursor,
        progress: 1,
        duration: options.duration,
        ease: options.ease,
        onUpdate: () => setPose(cursor.progress),
        onComplete: () => {
          setPose(1);
          resolve();
        },
      });
    });
  }

  private rotateAircraft(
    flight: Phaser.GameObjects.Sprite,
    shadow: Phaser.GameObjects.Sprite,
    targetRotation: number,
    duration: number,
  ): Promise<void> {
    const start = flight.rotation;
    const delta = Phaser.Math.Angle.Wrap(targetRotation - start);
    if (prefersReducedMotion()) {
      flight.setRotation(start + delta);
      shadow.setRotation(start + delta);
      return Promise.resolve();
    }
    const cursor = { progress: 0 };
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: cursor,
        progress: 1,
        duration,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          const rotation = start + delta * cursor.progress;
          flight.setRotation(rotation);
          shadow.setRotation(rotation);
        },
        onComplete: () => resolve(),
      });
    });
  }

  async playFlightTakeoff(snapshot?: WorldSnapshot): Promise<void> {
    // No city, no runway to roll down. The cover transition still plays, so
    // the journey reads as a jump cut rather than as an aeroplane taxiing
    // across a field that is not there.
    if (!snapshot) return;
    const airport = this.airportLayout(snapshot);
    const gate = projection.project(airport.gate.x, airport.gate.y);
    const threshold = projection.project(
      airport.departureThreshold.x,
      airport.departureThreshold.y,
    );
    const runwayEnd = projection.project(
      airport.runwayEnd.x - 0.35,
      airport.runwayEnd.y,
    );
    const runwayHeading = aircraftRotation(threshold, runwayEnd);
    const camera = this.scene.cameras.main;

    const exitTiles = Phaser.Math.Clamp(
      Math.ceil(camera.width / Math.max(1, camera.zoom * (TILE_WIDTH / 2))) + 8,
      18,
      64,
    );
    const climbExit = runwayExitPoint(airport, exitTiles);
    const climbGround = projection.project(climbExit.x, climbExit.y);
    const { flight, shadow } = this.createActiveAircraft(gate);

    const parkedRotation = this.parkedAircraftRotation(airport);
    const pushback = projection.project(
      airport.gate.x + 0.2,
      airport.gate.y + 0.52,
    );
    flight.setRotation(parkedRotation);
    shadow.setRotation(parkedRotation);
    await this.animateAircraft(flight, shadow, {
      groundAt: linePath(gate, pushback),
      rotationAt: () => parkedRotation,
      duration: 520,
      ease: "Sine.easeInOut",
    });

    const leftTurnControl = projection.project(
      airport.gate.x - 0.55,
      airport.gate.y + 1.15,
    );
    const thresholdApproach = projection.project(
      airport.departureThreshold.x + 0.8,
      airport.departureThreshold.y - 0.25,
    );
    await this.rotateAircraft(
      flight,
      shadow,
      aircraftRotation(pushback, leftTurnControl),
      360,
    );
    const taxiToThreshold = cubicPath(
      pushback,
      leftTurnControl,
      thresholdApproach,
      threshold,
    );
    await this.animateAircraft(flight, shadow, {
      groundAt: taxiToThreshold,
      duration: 1_900,
      ease: "Sine.easeInOut",
    });
    await this.wait(180);
    await this.rotateAircraft(flight, shadow, runwayHeading, 520);
    await this.wait(260);

    let nextDust = 0.14;
    const takeoffDuration = 2_850 + (airport.runwayLength - 18) * 90;
    await this.animateAircraft(flight, shadow, {
      groundAt: linePath(threshold, runwayEnd),
      rotationAt: () => runwayHeading,
      scaleAt: (progress) => lerp(AIRCRAFT_GROUND_SCALE, 0.61, progress),
      duration: takeoffDuration,
      ease: "Quad.easeIn",
      onProgress: (progress, point) => {
        if (progress >= nextDust) {
          this.spawnFlightDust(
            point.x - 12,
            point.y - 3,
            0.32 + progress * 0.2,
          );
          nextDust += 0.12;
        }
      },
    });

    await this.animateAircraft(flight, shadow, {
      groundAt: linePath(runwayEnd, climbGround),
      altitudeAt: (progress) => 1030 * progress ** 1.3,
      rotationAt: () => runwayHeading,
      scaleAt: (progress) => lerp(0.61, 0.47, progress),
      alphaAt: (progress) => {
        const fade = Math.max(0, (progress - 0.72) / 0.28);
        return 1 - fade * fade;
      },
      duration: 1_700,
      ease: "Sine.easeIn",
    });
    flight.destroy();
    shadow.destroy();
    this.activeFlight = undefined;
    this.activeFlightShadow = undefined;
  }

  async playFlightLanding(snapshot?: WorldSnapshot): Promise<void> {
    if (!snapshot) return;
    const airport = this.airportLayout(snapshot);
    const approachGrid = runwayExitPoint(airport, 18);
    const approachGround = projection.project(approachGrid.x, approachGrid.y);
    const touchdown = projection.project(airport.runwayEnd.x - 0.48, airport.runwayEnd.y);
    const landingHeading = aircraftRotation(approachGround, touchdown);
    const entry = projection.project(airport.runwayEntry.x, airport.runwayEntry.y);
    const gate = projection.project(airport.gate.x, airport.gate.y);

    const parkedRotation = this.parkedAircraftRotation(airport);
    if (this.isSkipRequested()) {
      this.activeFlight?.destroy();
      this.activeFlightShadow?.destroy();
      this.activeFlight = undefined;
      this.activeFlightShadow = undefined;
      this.parkedAirplane?.setVisible(true).setRotation(parkedRotation);
      this.parkedAirplaneShadow?.setVisible(true).setRotation(parkedRotation);
      return;
    }

    const { flight, shadow } = this.createActiveAircraft(approachGround);

    await this.animateAircraft(flight, shadow, {
      groundAt: linePath(approachGround, touchdown),
      altitudeAt: (progress) => 430 * (1 - progress) ** 1.3,
      rotationAt: () => landingHeading,
      scaleAt: (progress) => lerp(0.4, AIRCRAFT_GROUND_SCALE, progress),
      alphaAt: (progress) => lerp(0.18, 1, Math.min(1, progress * 1.8)),
      duration: 2_250,
      ease: "Sine.easeInOut",
    });
    const touchdownTrail = linePath(touchdown, approachGround);
    for (let index = 0; index < 4; index += 1) {
      const point = touchdownTrail((index + 1) * 0.014);
      this.spawnFlightDust(
        point.x,
        point.y + 3,
        0.58 - index * 0.06,
        { x: 14, y: 7 },
      );
    }

    await this.animateAircraft(flight, shadow, {
      groundAt: linePath(touchdown, entry),
      altitudeAt: (progress) => Math.max(0, 2.5 * (1 - progress) * Math.sin(progress * Math.PI * 3)),
      duration: 1_850,
      ease: "Cubic.easeOut",
    });
    await this.wait(130);

    const taxi = cubicPath(
      entry,
      projection.project(airport.runwayEntry.x - 0.05, airport.runwayEntry.y - 0.58),
      projection.project(airport.gate.x + 0.2, airport.gate.y + 0.52),
      gate,
    );
    await this.animateAircraft(flight, shadow, {
      groundAt: taxi,
      duration: 1_520,
      ease: "Sine.easeInOut",
    });

    flight.setRotation(parkedRotation);
    shadow.setRotation(parkedRotation);
    flight.destroy();
    shadow.destroy();
    this.activeFlight = undefined;
    this.activeFlightShadow = undefined;
    this.parkedAirplane?.setVisible(true).setRotation(parkedRotation);
    this.parkedAirplaneShadow?.setVisible(true).setRotation(parkedRotation);
  }

  private spawnFlightDust(
    x: number,
    y: number,
    scale: number,
    drift: ScreenPoint = { x: -14, y: -7 },
  ): void {
    const puff = this.scene.add
      .sprite(x, y, SMOKE_KEY)
      .setScale(scale)
      .setAlpha(0.34)
      .setDepth(SKY_DEPTH - 6);
    this.flightEffects.add(puff);
    this.scene.tweens.add({
      targets: puff,
      alpha: 0,
      scale: scale * 1.9,
      x: x + drift.x,
      y: y + drift.y,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.flightEffects.delete(puff);
        puff.destroy();
      },
    });
  }

  private wait(duration: number): Promise<void> {
    if (prefersReducedMotion()) return Promise.resolve();
    return new Promise((resolve) => this.scene.time.delayedCall(duration, resolve));
  }

  async coverForAirportTravel(
    snapshot: WorldSnapshot | undefined,
    transitionManager: WorldTransitionManager,
  ): Promise<void> {
    await this.playFlightTakeoff(snapshot);
    await transitionManager.playCoverTransition();
  }

  async revealAfterAirportTravel(
    snapshot: WorldSnapshot | undefined,
    transitionManager: WorldTransitionManager,
  ): Promise<void> {
    if (this.isSkipRequested() && snapshot) {
      const airport = this.airportLayout(snapshot);
      const parkedRotation = this.parkedAircraftRotation(airport);
      this.activeFlight?.destroy();
      this.activeFlightShadow?.destroy();
      this.activeFlight = undefined;
      this.activeFlightShadow = undefined;
      this.parkedAirplane?.setVisible(true).setRotation(parkedRotation);
      this.parkedAirplaneShadow?.setVisible(true).setRotation(parkedRotation);
      await transitionManager.partCloudCover();
      return;
    }
    const reveal = transitionManager.partCloudCover();
    await this.wait(WHITEOUT_HOLD_MS + 120);
    const landing = this.playFlightLanding(snapshot);
    await Promise.all([reveal, landing]);
  }

  clearAirportStatic(): void {
    this.airportTerminal?.destroy();
    this.airportTerminal = undefined;
    this.airportTower?.destroy();
    this.airportTower = undefined;
    for (const sprite of this.airportSurfaceSprites) sprite.destroy();
    for (const sprite of this.airportDecorationSprites) sprite.destroy();
    this.airportSurfaceSprites = [];
    this.airportDecorationSprites = [];
    this.parkedAirplane?.destroy();
    this.parkedAirplane = undefined;
    this.parkedAirplaneShadow?.destroy();
    this.parkedAirplaneShadow = undefined;
    if (this.airportBeacon) {
      this.scene.tweens.killTweensOf(this.airportBeacon);
      this.airportBeacon.destroy();
      this.airportBeacon = undefined;
    }
    this.airportLayoutSignature = undefined;
    this.airportHoverListener?.(undefined);
  }

  clearAirport(): void {
    this.clearAirportStatic();
    if (this.activeFlight) {
      this.scene.tweens.killTweensOf(this.activeFlight);
      this.activeFlight.destroy();
      this.activeFlight = undefined;
    }
    if (this.activeFlightShadow) {
      this.scene.tweens.killTweensOf(this.activeFlightShadow);
      this.activeFlightShadow.destroy();
      this.activeFlightShadow = undefined;
    }
    for (const effect of this.flightEffects) {
      this.scene.tweens.killTweensOf(effect);
      effect.destroy();
    }
    this.flightEffects.clear();
  }
}
