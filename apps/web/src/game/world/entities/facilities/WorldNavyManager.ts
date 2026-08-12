import Phaser from "phaser";
import type { WorldSnapshot } from "@sudo-city/protocol";
import { playUiClickSound } from "@/lib/play-ui-click";
import {
  BATTLESHIP_ANCHOR_Y,
  BATTLESHIP_KEYS,
} from "../../../textures/navy/battleship";
import {
  NAVY_BARRACKS_ANCHOR_Y,
  NAVY_BARRACKS_KEY,
  NAVY_BOLLARD_KEY,
  NAVY_COMMAND_ANCHOR_Y,
  NAVY_COMMAND_BEACON_Z,
  NAVY_COMMAND_KEY,
  NAVY_CRATE_ANCHOR_Y,
  NAVY_CRATE_KEY,
  NAVY_FENCE_ANCHOR_Y,
  NAVY_FENCE_KEY,
  NAVY_FLAG_ANCHOR_Y,
  NAVY_FLAG_KEY,
  NAVY_FLOODLIGHT_ANCHOR_Y,
  NAVY_FLOODLIGHT_KEY,
  NAVY_FLOODLIGHT_LAMP_Z,
  NAVY_HANGAR_ANCHOR_Y,
  NAVY_HANGAR_KEY,
  NAVY_PIER_ANCHOR_Y,
  NAVY_PIER_KEY,
  NAVY_QUAY_ANCHOR_Y,
  NAVY_QUAY_DECK,
  NAVY_QUAY_KEY,
  NAVY_RADAR_ANCHOR_Y,
  NAVY_RADAR_DISH_ANCHOR_Y,
  NAVY_RADAR_DISH_KEYS,
  NAVY_RADAR_HUB_Z,
  NAVY_RADAR_KEY,
} from "../../../textures/navy/base";
import {
  NAVY_HELICOPTER_ANCHOR_Y,
  NAVY_HELICOPTER_KEY,
  NAVY_HELIPAD_ANCHOR_Y,
  NAVY_HELIPAD_KEY,
  NAVY_ROTOR_ANCHOR_Y,
  NAVY_ROTOR_HUB_Z,
  NAVY_ROTOR_KEYS,
} from "../../../textures/navy/aircraft";
import {
  NAVY_FUEL_TANK_ANCHOR_Y,
  NAVY_FUEL_TANK_KEY,
  NAVY_GUN_ANCHOR_Y,
  NAVY_GUN_KEY,
  NAVY_MISSILE_ANCHOR_Y,
  NAVY_MISSILE_KEY,
  NAVY_TANK_ANCHOR_Y,
  NAVY_TANK_KEY,
} from "../../../textures/navy/vehicles";
import {
  createNavyHarbourLayout,
  navyHarbourLayoutKey,
  type NavyHarbourLayout,
} from "../../../layouts/navyHarbour";
import type { HarbourPoint } from "../../../layouts/harbour";
import {
  NAVY_HIT_ZONE_LIFT,
  NAVY_HOVER_LABEL_LIFT,
  NAVY_RADAR_SWEEP_STEP_MS,
  NAVY_ROTOR_STEP_MS,
  NAVY_SHIP_SAIL_MS,
  projection,
  SHIP_FAIRWAY_TILES,
  SHIP_OFFING_TILES,
  SHIP_TURNAROUND_MS,
  SKY_DEPTH,
  YAW_ALONGSIDE_IN,
  YAW_INBOUND,
  YAW_OUTBOUND,
  YAW_SEAWARD,
} from "../../core/worldConstants";
import { headingFromTangent, type ScreenPoint } from "../../core/worldMath";
import { createFootprintHitZone, worldToScreen } from "../../utils/hitZoneUtils";
import { isCanvasPointer } from "../../utils/pointerUtils";
import { AmbientLife, prefersReducedMotion } from "../../../systems/ambient";
import { bakeTerrainTextures } from "../../../textures/init";
import { TILE_ANCHOR_Y, TILE_HEIGHT, TILE_WIDTH } from "../../../textures/core";
import type { ShipHoverInfo } from "../../../WorldScene";
import type { WorldTransitionManager } from "../../effects/WorldTransitionManager";

export class WorldNavyManager {
  private navySprites: Phaser.GameObjects.Sprite[] = [];
  private navyGlows: Phaser.GameObjects.Arc[] = [];
  private navyTimers: Phaser.Time.TimerEvent[] = [];
  private navyLayoutSignature?: string;
  private navyLayout?: NavyHarbourLayout;
  private navyHoverAnchorSprite?: Phaser.GameObjects.Sprite;
  private navyBattleship?: Phaser.GameObjects.Sprite;
  private navySignClickListener?: () => void;
  private navyShipClickListener?: () => void;
  private navyShipHoverListener?: (info?: ShipHoverInfo) => void;
  private navyHoverHideTimer?: Phaser.Time.TimerEvent;
  private navyHitZone?: Phaser.GameObjects.Zone;

  constructor(
    private scene: Phaser.Scene,
    private isTravelTransitionActive: () => boolean,
  ) {}

  setNavyShipHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.navyShipHoverListener = listener;
  }

  clearHover(): void {
    this.cancelNavyHoverHide();
    this.navyShipHoverListener?.(undefined);
  }

  setNavyShipClickListener(listener?: () => void): void {
    this.navyShipClickListener = listener;
  }

  setNavySignClickListener(listener?: () => void): void {
    this.navySignClickListener = listener;
  }

  layoutNavyHarbour(snapshot?: WorldSnapshot, currentCityId?: string): void {
    if (!snapshot) {
      this.clearNavyHarbour();
      return;
    }
    if (!this.scene.textures.exists(NAVY_COMMAND_KEY)) {
      bakeTerrainTextures(this.scene);
    }
    const { width, height } = snapshot.size;
    const layout = createNavyHarbourLayout(width, height);
    const signature = navyHarbourLayoutKey(layout);
    if (signature === this.navyLayoutSignature && this.navySprites.length > 0) {
      return;
    }
    this.clearNavyHarbour();
    this.navyLayoutSignature = signature;
    this.navyLayout = layout;

    const quayPoint = projection.project(layout.quay.x, layout.quay.y);
    this.navySprites.push(
      this.scene.add
        .sprite(quayPoint.x, quayPoint.y + NAVY_QUAY_ANCHOR_Y, NAVY_QUAY_KEY)
        .setOrigin(0.5, 1)
        .setDepth(
          projection.depth(
            layout.quay.x - layout.quayHalfU,
            layout.quay.y - layout.quayHalfV,
          ) + 2,
        ),
    );

    for (const tile of layout.pier) {
      const point = projection.project(tile.x, tile.y);
      this.navySprites.push(
        this.scene.add
          .sprite(point.x, point.y + NAVY_PIER_ANCHOR_Y, NAVY_PIER_KEY)
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(tile.x, tile.y) + 4),
      );
    }

    const onBase = (
      point: HarbourPoint,
      key: string,
      anchorY: number,
      depthOffset = 12,
      scale = 0.76,
      yOffset = 0,
    ): Phaser.GameObjects.Sprite => {
      const projected = projection.project(point.x, point.y);
      const sprite = this.scene.add
        .sprite(
          projected.x,
          projected.y + anchorY - NAVY_QUAY_DECK + yOffset,
          key,
        )
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(point.x, point.y) + depthOffset)
        .setScale(scale);
      this.navySprites.push(sprite);
      return sprite;
    };

    const command = onBase(
      layout.command,
      NAVY_COMMAND_KEY,
      NAVY_COMMAND_ANCHOR_Y,
      18,
    );
    command.setData("hoverTitle", "NAVAL OPERATIONS HQ");
    this.navyHoverAnchorSprite = command;
    this.addNavyGlow(command, NAVY_COMMAND_ANCHOR_Y, NAVY_COMMAND_BEACON_Z, SKY_DEPTH - 4, {
      color: 0xff5e65,
      radius: 3,
      peak: 0.82,
      scale: 2.4,
      duration: 1_050,
    });

    const hangar = onBase(
      layout.hangar,
      NAVY_HANGAR_KEY,
      NAVY_HANGAR_ANCHOR_Y,
      16,
    );
    hangar.setData("hoverTitle", "FLEET MAINTENANCE HANGAR");
    onBase(layout.barracks, NAVY_BARRACKS_KEY, NAVY_BARRACKS_ANCHOR_Y, 14);

    layout.radar.forEach((point) => {
      const tower = onBase(point, NAVY_RADAR_KEY, NAVY_RADAR_ANCHOR_Y, 18);
      tower.setData("hoverTitle", "AIR SEARCH RADAR");
      const hub = this.navyMastPoint(tower, NAVY_RADAR_ANCHOR_Y, NAVY_RADAR_HUB_Z);
      const dish = this.scene.add
        .sprite(
          hub.x,
          hub.y + NAVY_RADAR_DISH_ANCHOR_Y * tower.scaleY,
          NAVY_RADAR_DISH_KEYS[0]!,
        )
        .setOrigin(0.5, 1)
        .setDepth(tower.depth + 2)
        .setScale(tower.scaleX, tower.scaleY);
      dish.setData("hoverTitle", "AIR SEARCH RADAR");
      this.navySprites.push(dish);
      this.spinNavyFrames(dish, NAVY_RADAR_DISH_KEYS, NAVY_RADAR_SWEEP_STEP_MS);
      this.addNavyGlow(
        tower,
        NAVY_RADAR_ANCHOR_Y,
        NAVY_RADAR_HUB_Z,
        projection.depth(point.x, point.y) + 23,
        { color: 0x74e5ef, radius: 3, peak: 0.62, scale: 1.9, duration: 1_200 },
      );
    });

    layout.missileBatteries.forEach((point) =>
      onBase(point, NAVY_MISSILE_KEY, NAVY_MISSILE_ANCHOR_Y, 18),
    );
    layout.gunEmplacements.forEach((point) =>
      onBase(point, NAVY_GUN_KEY, NAVY_GUN_ANCHOR_Y, 18),
    );
    layout.panzers.forEach((point) =>
      onBase(point, NAVY_TANK_KEY, NAVY_TANK_ANCHOR_Y, 20),
    );
    layout.fuelTanks.forEach((point) =>
      onBase(point, NAVY_FUEL_TANK_KEY, NAVY_FUEL_TANK_ANCHOR_Y, 14),
    );
    layout.crates.forEach((point) =>
      onBase(point, NAVY_CRATE_KEY, NAVY_CRATE_ANCHOR_Y, 20),
    );
    layout.fences.forEach((point) =>
      onBase(point, NAVY_FENCE_KEY, NAVY_FENCE_ANCHOR_Y, 15),
    );
    layout.bollards.forEach((point) =>
      onBase(point, NAVY_BOLLARD_KEY, TILE_ANCHOR_Y, 16),
    );
    layout.floodlights.forEach((point) => {
      const mast = onBase(point, NAVY_FLOODLIGHT_KEY, NAVY_FLOODLIGHT_ANCHOR_Y, 21);
      this.addNavyGlow(
        mast,
        NAVY_FLOODLIGHT_ANCHOR_Y,
        NAVY_FLOODLIGHT_LAMP_Z,
        projection.depth(point.x, point.y) + 25,
        { color: 0xffc45c, radius: 3.5, peak: 0.44, scale: 1.55, duration: 2_200, nudgeX: 6 },
      );
    });
    layout.flags.forEach((point) =>
      onBase(point, NAVY_FLAG_KEY, NAVY_FLAG_ANCHOR_Y, 22),
    );

    onBase(
      layout.helicopterPad,
      NAVY_HELIPAD_KEY,
      NAVY_HELIPAD_ANCHOR_Y,
      16,
    );
    const helicopter = onBase(
      layout.helicopter,
      NAVY_HELICOPTER_KEY,
      NAVY_HELICOPTER_ANCHOR_Y,
      24,
      0.72,
    );
    helicopter.setData("hoverTitle", "NAVAL AIR WING");

    const rotorHub = this.navyMastPoint(
      helicopter,
      NAVY_HELICOPTER_ANCHOR_Y,
      NAVY_ROTOR_HUB_Z,
    );
    const rotor = this.scene.add
      .sprite(
        rotorHub.x,
        rotorHub.y + NAVY_ROTOR_ANCHOR_Y * helicopter.scaleY,
        NAVY_ROTOR_KEYS[0]!,
      )
      .setOrigin(0.5, 1)
      .setDepth(helicopter.depth + 2)
      .setScale(helicopter.scaleX, helicopter.scaleY);
    rotor.setData("hoverTitle", "NAVAL AIR WING");
    this.navySprites.push(rotor);
    this.spinNavyFrames(rotor, NAVY_ROTOR_KEYS, NAVY_ROTOR_STEP_MS);
    if (!prefersReducedMotion()) {
      this.scene.tweens.add({
        targets: [helicopter, rotor],
        y: "-=3",
        duration: 1_350,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    this.navyHitZone = createFootprintHitZone(
      this.scene,
      layout.quay.x,
      layout.quay.y,
      layout.quayHalfU,
      layout.quayHalfV,
      NAVY_HIT_ZONE_LIFT,
      projection.depth(layout.quay.x, layout.quay.y) + 50,
    );
    this.bindNavyInteractions(this.navyHitZone);

    const isMain = currentCityId === "main";
    const isPrCity = currentCityId?.startsWith("pr-") ?? false;
    if (isMain || isPrCity) {
      const shipPoint = projection.project(
        layout.battleship.x,
        layout.battleship.y,
      );
      this.navyBattleship = this.scene.add
        .sprite(
          shipPoint.x,
          shipPoint.y + BATTLESHIP_ANCHOR_Y,
          BATTLESHIP_KEYS[0]!,
        )
        .setOrigin(0.5, 1)
        .setDepth(
          projection.depth(layout.battleship.x, layout.battleship.y) + 8,
        )
        .setScale(0.88)
        .setInteractive({ pixelPerfect: true, useHandCursor: true });
      this.navySprites.push(this.navyBattleship);

      this.navyBattleship.on("pointerover", () => {
        if (this.isTravelTransitionActive()) return;
        const anchor = this.navyHoverAnchor() ?? {
          x: this.navyBattleship!.x,
          y: this.navyBattleship!.y,
        };
        const screen = worldToScreen(this.scene.cameras.main, anchor.x, anchor.y);
        this.showNavyHover({
          cityId: currentCityId ?? "",
          title: "Navy Battleship",
          action: isMain ? "Open the PR review board" : "Return to main city",
          screenX: screen.x,
          screenY: screen.y,
        });
      });
      this.navyBattleship.on("pointerout", () => {
        this.scheduleHideNavyHover();
      });
      this.navyBattleship.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!isCanvasPointer(pointer)) return;
        if (this.isTravelTransitionActive()) return;
        playUiClickSound();
        this.cancelNavyHoverHide();
        this.navyShipHoverListener?.(undefined);
        this.navyShipClickListener?.();
      });

      this.navyBattleship.setData("restY", this.navyBattleship.y);
      this.idleBobNavyShip();
    }
  }

  private navyMastPoint(
    sprite: Phaser.GameObjects.Sprite,
    anchorY: number,
    z: number,
  ): { x: number; y: number } {
    return { x: sprite.x, y: sprite.y - (anchorY + z) * sprite.scaleY };
  }

  private spinNavyFrames(
    sprite: Phaser.GameObjects.Sprite,
    keys: readonly string[],
    stepMs: number,
  ): void {
    if (prefersReducedMotion() || keys.length < 2) return;
    let frame = 0;
    this.navyTimers.push(
      this.scene.time.addEvent({
        delay: stepMs,
        loop: true,
        callback: () => {
          if (!sprite.active) return;
          frame = (frame + 1) % keys.length;
          sprite.setTexture(keys[frame]!);
        },
      }),
    );
  }

  private navyHoverAnchor(): ScreenPoint | undefined {
    const command = this.navyHoverAnchorSprite;
    if (!command) return undefined;
    return { x: command.x, y: command.y - NAVY_HOVER_LABEL_LIFT };
  }

  private showNavyHover(info: ShipHoverInfo): void {
    this.cancelNavyHoverHide();
    this.navyShipHoverListener?.(info);
  }

  private scheduleHideNavyHover(): void {
    this.cancelNavyHoverHide();
    this.navyHoverHideTimer = this.scene.time.delayedCall(32, () => {
      this.navyHoverHideTimer = undefined;
      this.navyShipHoverListener?.(undefined);
    });
  }

  public cancelNavyHoverHide(): void {
    this.navyHoverHideTimer?.remove(false);
    this.navyHoverHideTimer = undefined;
  }

  private bindNavyInteractions(
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Zone,
  ): void {
    sprite.on("pointerover", () => {
      if (this.isTravelTransitionActive()) return;
      const anchor = this.navyHoverAnchor() ?? { x: sprite.x, y: sprite.y };
      const screen = worldToScreen(this.scene.cameras.main, anchor.x, anchor.y);
      this.showNavyHover({
        cityId: "naval-base",
        title: String(sprite.getData("hoverTitle") ?? "NAVAL BASE"),
        action: "Open the PR review board",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    sprite.on("pointerout", () => this.scheduleHideNavyHover());
    sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!isCanvasPointer(pointer)) return;
      if (this.isTravelTransitionActive()) return;
      playUiClickSound();
      this.cancelNavyHoverHide();
      this.navyShipHoverListener?.(undefined);
      this.navySignClickListener?.();
    });
  }

  private addNavyGlow(
    sprite: Phaser.GameObjects.Sprite,
    anchorY: number,
    z: number,
    depth: number,
    style: {
      radius: number;
      color: number;
      peak: number;
      scale: number;
      duration: number;
      nudgeX?: number;
    },
  ): void {
    const mast = this.navyMastPoint(sprite, anchorY, z);
    const glow = this.scene.add
      .circle(
        mast.x + (style.nudgeX ?? 0) * sprite.scaleX,
        mast.y,
        style.radius,
        style.color,
        0.16,
      )
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD);
    if (!prefersReducedMotion()) {
      this.scene.tweens.add({
        targets: glow,
        alpha: style.peak,
        scale: style.scale,
        duration: style.duration,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    this.navyGlows.push(glow);
  }

  private idleBobNavyShip(): void {
    const ship = this.navyBattleship;
    if (!ship) return;
    const restY = ship.getData("restY") as number;
    ship.setY(restY);
    if (prefersReducedMotion()) return;
    this.scene.tweens.add({
      targets: ship,
      y: restY - 4,
      duration: 1_600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private navyShipCourse():
    | { berth: ScreenPoint; corner: ScreenPoint; open: ScreenPoint }
    | undefined {
    const layout = this.navyLayout;
    if (!layout) return undefined;
    const projected = projection.project(layout.battleship.x, layout.battleship.y);
    const berth = { x: projected.x, y: projected.y + BATTLESHIP_ANCHOR_Y };
    const ahead = { x: TILE_WIDTH / 2, y: -TILE_HEIGHT / 2 };
    const seaward = { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };
    const corner = {
      x: berth.x + ahead.x * SHIP_FAIRWAY_TILES,
      y: berth.y + ahead.y * SHIP_FAIRWAY_TILES,
    };
    return {
      berth,
      corner,
      open: {
        x: corner.x + seaward.x * SHIP_OFFING_TILES,
        y: corner.y + seaward.y * SHIP_OFFING_TILES,
      },
    };
  }

  private setNavyShipYaw(yaw: number): void {
    const ship = this.navyBattleship;
    if (!ship) return;
    const count = BATTLESHIP_KEYS.length;
    const turns = yaw / (Math.PI * 2);
    const frame = ((Math.round(turns * count) % count) + count) % count;
    const key = BATTLESHIP_KEYS[frame]!;
    if (ship.texture.key !== key) {
      ship.setTexture(key);
    }
  }

  private sailNavyShip(
    from: ScreenPoint,
    through: ScreenPoint,
    to: ScreenPoint,
    ease: string,
    yaw: { from: number; to: number },
  ): Promise<void> {
    const ship = this.navyBattleship;
    if (!ship) return Promise.resolve();
    this.scene.tweens.killTweensOf(ship);
    ship.setAlpha(1);
    ship.setPosition(from.x, from.y);
    this.setNavyShipYaw(yaw.from);
    if (prefersReducedMotion()) {
      ship.setPosition(to.x, to.y);
      this.setNavyShipYaw(yaw.to);
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: cursor,
        t: 1,
        duration: NAVY_SHIP_SAIL_MS,
        ease,
        onUpdate: () => {
          const t = cursor.t;
          const inverse = 1 - t;
          const weight = { a: inverse * inverse, b: 2 * inverse * t, c: t * t };
          ship.setPosition(
            weight.a * from.x + weight.b * through.x + weight.c * to.x,
            weight.a * from.y + weight.b * through.y + weight.c * to.y,
          );
          // Derivative of the quadratic bezier above: the instantaneous
          // direction of travel at this point on the curve, so the hull's
          // heading tracks the turn continuously instead of snapping between
          // yaw.from and yaw.to over a narrow window in the middle.
          const tangentX =
            2 * inverse * (through.x - from.x) + 2 * t * (to.x - through.x);
          const tangentY =
            2 * inverse * (through.y - from.y) + 2 * t * (to.y - through.y);
          this.setNavyShipYaw(headingFromTangent(tangentX, tangentY));
        },
        onComplete: () => resolve(),
      });
    });
  }

  playNavyBattleshipDeparture(): Promise<void> {
    const course = this.navyShipCourse();
    if (!course) return Promise.resolve();
    return this.sailNavyShip(
      course.berth,
      course.corner,
      course.open,
      "Quad.easeIn",
      { from: YAW_OUTBOUND, to: YAW_SEAWARD },
    );
  }

  prepareNavyArrival(): void {
    const ship = this.navyBattleship;
    const course = this.navyShipCourse();
    if (!ship || !course) return;
    this.scene.tweens.killTweensOf(ship);
    ship.setAlpha(1);
    ship.setPosition(course.open.x, course.open.y);
    this.setNavyShipYaw(YAW_INBOUND);
  }

  private async playNavyBattleshipArrival(): Promise<void> {
    const ship = this.navyBattleship;
    const course = this.navyShipCourse();
    if (!ship || !course) return;
    await this.sailNavyShip(
      course.open,
      course.corner,
      course.berth,
      "Quad.easeOut",
      { from: YAW_INBOUND, to: YAW_ALONGSIDE_IN },
    );
    ship.setData("restY", course.berth.y);
  }

  private playNavyBattleshipTurnaround(): Promise<void> {
    const course = this.navyShipCourse();
    const ship = this.navyBattleship;
    if (!course || !ship) return Promise.resolve();
    const berth = course.berth;
    const downCoast = { x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };
    const seaward = { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };
    const offset = (ahead: number, out: number): ScreenPoint => ({
      x: berth.x + downCoast.x * ahead + seaward.x * out,
      y: berth.y + downCoast.y * ahead + seaward.y * out,
    });
    const control = { first: offset(3.4, 3.0), second: offset(3.0, 0.5) };

    this.scene.tweens.killTweensOf(ship);
    if (prefersReducedMotion()) {
      this.setNavyShipYaw(YAW_OUTBOUND);
      ship.setData("restY", berth.y);
      this.idleBobNavyShip();
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: cursor,
        t: 1,
        duration: SHIP_TURNAROUND_MS,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          const t = cursor.t;
          const inverse = 1 - t;
          const weight = {
            a: inverse * inverse * inverse,
            b: 3 * inverse * inverse * t,
            c: 3 * inverse * t * t,
            d: t * t * t,
          };
          ship.setPosition(
            weight.a * berth.x +
              weight.b * control.first.x +
              weight.c * control.second.x +
              weight.d * berth.x,
            weight.a * berth.y +
              weight.b * control.first.y +
              weight.c * control.second.y +
              weight.d * berth.y,
          );
          this.setNavyShipYaw(
            YAW_ALONGSIDE_IN + (YAW_OUTBOUND - YAW_ALONGSIDE_IN) * t,
          );
        },
        onComplete: () => {
          ship.setPosition(berth.x, berth.y);
          this.setNavyShipYaw(YAW_OUTBOUND);
          ship.setData("restY", berth.y);
          this.idleBobNavyShip();
          resolve();
        },
      });
    });
  }

  async coverForTravel(_cityId: string, transitionManager: WorldTransitionManager): Promise<void> {
    await this.playNavyBattleshipDeparture();
    await transitionManager.playCoverTransition();
  }

  prepareArrivalForTravel(): void {
    this.prepareNavyArrival();
  }

  async revealAfterTravel(transitionManager: WorldTransitionManager): Promise<void> {
    await transitionManager.partCloudCover();
    await this.playNavyBattleshipArrival();
    await this.playNavyBattleshipTurnaround();
  }

  clearNavyHarbour(): void {
    for (const sprite of this.navySprites) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    for (const glow of this.navyGlows) {
      this.scene.tweens.killTweensOf(glow);
      glow.destroy();
    }
    for (const timer of this.navyTimers) {
      timer.remove(false);
    }
    this.cancelNavyHoverHide();
    this.navyHitZone?.destroy();
    this.navyHitZone = undefined;
    this.navySprites = [];
    this.navyGlows = [];
    this.navyTimers = [];
    this.navyBattleship = undefined;
    this.navyLayoutSignature = undefined;
    this.navyLayout = undefined;
    this.navyHoverAnchorSprite = undefined;
    this.navyShipHoverListener?.(undefined);
  }
}
