import Phaser from "phaser";
import type { WorldSnapshot } from "@sudo-city/protocol";
import { playUiClickSound } from "@/lib/play-ui-click";
import {
  CARRIED_CONTAINER_DROP,
  CONTAINER_SHIP_SAIL_MS,
  CRANE_HOIST_MS,
  CRANE_SLEW_MS,
  HARBOUR_HIT_ZONE_LIFT,
  HARBOUR_HOVER_LABEL_LIFT,
  HOIST_REST_DROP,
  HOIST_REST_DU,
  projection,
  SHIP_FAIRWAY_TILES,
  SHIP_OFFING_TILES,
  SHIP_TURNAROUND_MS,
  SHIP_TURN_END,
  SHIP_TURN_START,
  SKY_DEPTH,
  YAW_ALONGSIDE_IN,
  YAW_INBOUND,
  YAW_OUTBOUND,
  YAW_SEAWARD,
} from "../../core/worldConstants";
import type { ScreenPoint } from "../../core/worldMath";
import { createFootprintHitZone, worldToScreen } from "../../utils/hitZoneUtils";
import {
  createHarbourLayout,
  harbourLayoutKey,
  type HarbourLayout,
  type HarbourPoint,
} from "../../../layouts/harbour";
import {
  HARBOUR_BOLLARD_KEY,
  HARBOUR_LAMP_GLOW_Y,
  HARBOUR_LAMP_KEY,
  HARBOUR_LIGHTHOUSE_ANCHOR_Y,
  HARBOUR_LIGHTHOUSE_KEY,
  HARBOUR_LIGHTHOUSE_LAMP_Y,
  HARBOUR_MARKER_KEY,
  HARBOUR_MARKER_LAMP_Y,
  HARBOUR_PIER_ANCHOR_Y,
  HARBOUR_PIER_KEY,
  HARBOUR_QUAY_ANCHOR_Y,
  HARBOUR_QUAY_DECK,
  HARBOUR_QUAY_KEY,
  HARBOUR_SIGN_ANCHOR_Y,
  HARBOUR_SIGN_KEY,
  HARBOUR_WAREHOUSE_ANCHOR_Y,
  HARBOUR_WAREHOUSE_KEY,
} from "../../../textures/harbour/base";
import {
  HARBOUR_CARGO_ANCHOR_Y,
  HARBOUR_CARGO_CONTAINER_KEY,
  HARBOUR_CARGO_KEYS,
  HARBOUR_CONTAINERS_ANCHOR_Y,
  HARBOUR_CONTAINERS_KEYS,
  HARBOUR_CONTAINER_ANCHOR_Y,
} from "../../../textures/harbour/cargo";
import {
  HARBOUR_CRANE_ANCHOR_Y,
  HARBOUR_CRANE_JIB_KEYS,
  HARBOUR_CRANE_JIB_ORIGIN,
  HARBOUR_CRANE_KEY,
  HARBOUR_CRANE_SLEW_SWEEP,
  HARBOUR_CRANE_SLEW_U,
  HARBOUR_CRANE_SLEW_Y,
  HARBOUR_CRANE_SPREADER_KEY,
  HARBOUR_CRANE_TROLLEY_KEY,
  HARBOUR_CRANE_TROLLEY_PICK,
  HARBOUR_CRANE_TROLLEY_REACH,
  HARBOUR_CRANE_TROLLEY_Y,
} from "../../../textures/harbour/crane";
import {
  HARBOUR_SHIP_ANCHOR_Y,
  HARBOUR_SHIP_BAY_OFFSETS,
  HARBOUR_SHIP_KEY,
  HARBOUR_SHIP_KEYS,
} from "../../../textures/harbour/ship";
import { TILE_ANCHOR_Y, TILE_HEIGHT, TILE_WIDTH } from "../../../textures/core";
import { prefersReducedMotion } from "../../../systems/ambient";
import type { ShipHoverInfo } from "../../../WorldScene";
import type { WorldTransitionManager } from "../../effects/WorldTransitionManager";

export class WorldHarbourManager {
  private harbourSprites: Phaser.GameObjects.Sprite[] = [];
  private harbourShapes: Phaser.GameObjects.Shape[] = [];
  private harbourGlows: Phaser.GameObjects.Arc[] = [];
  private harbourLayoutSignature?: string;
  private harbourLayout?: HarbourLayout;
  private harbourHoverAnchorSprite?: Phaser.GameObjects.Sprite;

  private harbourShip?: Phaser.GameObjects.Sprite;
  private harbourCraneJib?: Phaser.GameObjects.Sprite;
  private harbourTrolley?: Phaser.GameObjects.Sprite;
  private harbourSpreader?: Phaser.GameObjects.Sprite;
  private harbourCable?: Phaser.GameObjects.Rectangle;
  private harbourSpreaderCargo?: Phaser.GameObjects.Sprite;
  private harbourShipCargo?: Phaser.GameObjects.Sprite;
  private harbourQuayCargo?: Phaser.GameObjects.Sprite;

  private harbourHoist = { du: HOIST_REST_DU, angle: 0, hoist: HOIST_REST_DROP };
  private harbourShipBay: { x: number; y: number } = HARBOUR_SHIP_BAY_OFFSETS[0]!;

  private harbourShipClickListener?: () => void;
  private harbourShipHoverListener?: (info?: ShipHoverInfo) => void;
  private harbourSignClickListener?: () => void;
  private harbourHoverHideTimer?: Phaser.Time.TimerEvent;
  private harbourHitZone?: Phaser.GameObjects.Zone;

  constructor(
    private scene: Phaser.Scene,
    private isTravelTransitionActive: () => boolean,
  ) {}

  setHarbourShipClickListener(listener?: () => void): void {
    this.harbourShipClickListener = listener;
  }

  setHarbourShipHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.harbourShipHoverListener = listener;
  }

  setHarbourSignClickListener(listener?: () => void): void {
    this.harbourSignClickListener = listener;
  }

  layoutHarbour(snapshot?: WorldSnapshot, currentCityId?: string): void {
    if (!snapshot) {
      this.clearHarbour();
      return;
    }
    const { width, height } = snapshot.size;
    const harbour = createHarbourLayout(width, height);
    const signature = harbourLayoutKey(harbour);
    if (signature === this.harbourLayoutSignature && this.harbourSprites.length > 0) {
      return;
    }
    this.clearHarbour();
    this.harbourLayoutSignature = signature;
    this.harbourLayout = harbour;

    const quayPoint = projection.project(harbour.quay.x, harbour.quay.y);
    this.harbourSprites.push(
      this.scene.add
        .sprite(quayPoint.x, quayPoint.y + HARBOUR_QUAY_ANCHOR_Y, HARBOUR_QUAY_KEY)
        .setOrigin(0.5, 1)
        .setDepth(
          projection.depth(
            harbour.quay.x - harbour.quayHalfU,
            harbour.quay.y - harbour.quayHalfV,
          ) + 2,
        ),
    );

    for (const tile of harbour.pier) {
      const point = projection.project(tile.x, tile.y);
      this.harbourSprites.push(
        this.scene.add
          .sprite(point.x, point.y + HARBOUR_PIER_ANCHOR_Y, HARBOUR_PIER_KEY)
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(tile.x, tile.y) + 4),
      );
    }

    const onQuay = (
      point: HarbourPoint,
      key: string,
      anchorY: number,
      depthOffset: number,
    ): Phaser.GameObjects.Sprite => {
      const projected = projection.project(point.x, point.y);
      const sprite = this.scene.add
        .sprite(projected.x, projected.y + anchorY - HARBOUR_QUAY_DECK, key)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(point.x, point.y) + depthOffset);
      this.harbourSprites.push(sprite);
      return sprite;
    };

    onQuay(harbour.warehouse, HARBOUR_WAREHOUSE_KEY, HARBOUR_WAREHOUSE_ANCHOR_Y, 12);

    harbour.containers.forEach((stack, index) => {
      onQuay(
        stack,
        HARBOUR_CONTAINERS_KEYS[index % HARBOUR_CONTAINERS_KEYS.length]!,
        HARBOUR_CONTAINERS_ANCHOR_Y,
        12,
      );
    });

    harbour.cargo.forEach((pile, index) => {
      onQuay(
        pile,
        HARBOUR_CARGO_KEYS[index % HARBOUR_CARGO_KEYS.length]!,
        HARBOUR_CARGO_ANCHOR_Y,
        12,
      );
    });

    for (const crane of harbour.cranes) {
      onQuay(crane, HARBOUR_CRANE_KEY, HARBOUR_CRANE_ANCHOR_Y, 16);
      const jib = this.addCraneJib(crane);
      if (crane.y === harbour.workingCrane.y) {
        this.harbourCraneJib = jib;
      }
    }
    this.layoutHarbourHoist(harbour);
    for (const bollard of harbour.bollards) {
      onQuay(bollard, HARBOUR_BOLLARD_KEY, TILE_ANCHOR_Y, 14);
    }

    const sign = onQuay(harbour.sign, HARBOUR_SIGN_KEY, HARBOUR_SIGN_ANCHOR_Y, 18);
    sign.setData("hoverTitle", "CLAUDE CITY PORT");
    this.harbourHoverAnchorSprite = sign;

    for (const lamp of harbour.lamps) {
      onQuay(lamp, HARBOUR_LAMP_KEY, TILE_ANCHOR_Y, 14);
    }

    const lighthousePoint = projection.project(
      harbour.lighthouse.x,
      harbour.lighthouse.y,
    );
    const lighthouseSprite = this.scene.add
      .sprite(
        lighthousePoint.x,
        lighthousePoint.y + HARBOUR_LIGHTHOUSE_ANCHOR_Y,
        HARBOUR_LIGHTHOUSE_KEY,
      )
      .setOrigin(0.5, 1)
      .setDepth(
        projection.depth(harbour.lighthouse.x, harbour.lighthouse.y) + 20,
      );
    this.harbourSprites.push(lighthouseSprite);

    const markerPoint = projection.project(harbour.pierHead.x, harbour.pierHead.y);
    this.harbourSprites.push(
      this.scene.add
        .sprite(markerPoint.x, markerPoint.y + TILE_ANCHOR_Y, HARBOUR_MARKER_KEY)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(harbour.pierHead.x, harbour.pierHead.y) + 6),
    );

    this.layoutContainerShip(harbour, currentCityId);
    this.layoutQuayCargo(harbour);

    this.harbourHitZone = createFootprintHitZone(
      this.scene,
      harbour.quay.x,
      harbour.quay.y,
      harbour.quayHalfU,
      harbour.quayHalfV,
      HARBOUR_HIT_ZONE_LIFT,
      projection.depth(harbour.quay.x, harbour.quay.y) + 50,
    );
    this.bindHarbourInteractions(this.harbourHitZone);

    this.addHarbourGlow(
      harbour.lighthouse,
      { x: 0, y: HARBOUR_LIGHTHOUSE_LAMP_Y },
      SKY_DEPTH - 3,
      { radius: 4.5, color: 0xffd27f, peak: 0.95, scale: 3.4, duration: 1_500 },
    );
    for (const lamp of harbour.lamps) {
      this.addHarbourGlow(
        lamp,
        { x: 12, y: HARBOUR_LAMP_GLOW_Y + HARBOUR_QUAY_DECK },
        projection.depth(lamp.x, lamp.y) + 15,
        { radius: 5, color: 0xffc46b, peak: 0.42, scale: 1.5, duration: 2_400 },
      );
    }
    this.addHarbourGlow(
      harbour.pierHead,
      { x: 0, y: HARBOUR_MARKER_LAMP_Y },
      projection.depth(harbour.pierHead.x, harbour.pierHead.y) + 7,
      { radius: 3.5, color: 0x6effa8, peak: 0.85, scale: 2.2, duration: 1_050 },
    );
  }

  private layoutContainerShip(harbour: HarbourLayout, currentCityId?: string): void {
    const berth = projection.project(
      harbour.containerShip.x,
      harbour.containerShip.y,
    );
    const ship = this.scene.add
      .sprite(berth.x, berth.y + HARBOUR_SHIP_ANCHOR_Y, HARBOUR_SHIP_KEY)
      .setOrigin(0.5, 1)
      .setDepth(
        projection.depth(harbour.containerShip.x, harbour.containerShip.y) + 8,
      )
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    ship.setData("restY", ship.y);
    this.harbourShip = ship;
    this.harbourShipBay = HARBOUR_SHIP_BAY_OFFSETS[0]!;
    this.harbourSprites.push(ship);

    ship.on("pointerover", () => {
      if (this.isTravelTransitionActive()) return;
      const homeward = currentCityId !== "main";
      const anchor = this.harbourHoverAnchor() ?? { x: ship.x, y: ship.y };
      const screen = worldToScreen(this.scene.cameras.main, anchor.x, anchor.y);
      this.showHarbourHover({
        cityId: "container-ship",
        title: "MV CLAUDE FEEDER",
        action: homeward ? "Sail home to main city" : "Sail out to your own PRs and worktrees",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    ship.on("pointerout", () => this.scheduleHideHarbourHover());
    ship.on("pointerdown", () => {
      if (this.isTravelTransitionActive()) return;
      playUiClickSound();
      this.cancelHarbourHoverHide();
      this.harbourShipHoverListener?.(undefined);
      this.harbourShipClickListener?.();
    });

    this.idleBobContainerShip();
  }

  private harbourHoverAnchor(): ScreenPoint | undefined {
    const sign = this.harbourHoverAnchorSprite;
    if (!sign) return undefined;
    return { x: sign.x, y: sign.y - HARBOUR_HOVER_LABEL_LIFT };
  }

  private showHarbourHover(info: ShipHoverInfo): void {
    this.cancelHarbourHoverHide();
    this.harbourShipHoverListener?.(info);
  }

  private scheduleHideHarbourHover(): void {
    this.cancelHarbourHoverHide();
    this.harbourHoverHideTimer = this.scene.time.delayedCall(32, () => {
      this.harbourHoverHideTimer = undefined;
      this.harbourShipHoverListener?.(undefined);
    });
  }

  public cancelHarbourHoverHide(): void {
    this.harbourHoverHideTimer?.remove(false);
    this.harbourHoverHideTimer = undefined;
  }

  private bindHarbourInteractions(
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Zone,
  ): void {
    sprite.on("pointerover", () => {
      if (this.isTravelTransitionActive()) return;
      const anchor = this.harbourHoverAnchor() ?? { x: sprite.x, y: sprite.y };
      const screen = worldToScreen(this.scene.cameras.main, anchor.x, anchor.y);
      this.showHarbourHover({
        cityId: "harbour",
        title: String(sprite.getData("hoverTitle") ?? "CLAUDE CITY PORT"),
        action: "Sail out to your own PRs and worktrees",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    sprite.on("pointerout", () => this.scheduleHideHarbourHover());
    sprite.on("pointerdown", () => {
      if (this.isTravelTransitionActive()) return;
      playUiClickSound();
      this.cancelHarbourHoverHide();
      this.harbourShipHoverListener?.(undefined);
      this.harbourSignClickListener?.();
    });
  }

  private idleBobContainerShip(): void {
    const ship = this.harbourShip;
    if (!ship) return;
    const restY = ship.getData("restY") as number;
    ship.setY(restY);
    this.scene.tweens.add({
      targets: ship,
      y: restY - 4,
      duration: 2_100,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      onUpdate: () => this.syncShipCargo(),
    });
  }

  private syncShipCargo(): void {
    const ship = this.harbourShip;
    const cargo = this.harbourShipCargo;
    if (!ship || !cargo) return;
    const bay = this.harbourShipBay;
    cargo.setPosition(
      ship.x + bay.x,
      ship.y - HARBOUR_SHIP_ANCHOR_Y + bay.y + HARBOUR_CONTAINER_ANCHOR_Y,
    );
    cargo.setDepth(ship.depth + 1);
  }

  private quayPoint(point: HarbourPoint, lift: number): ScreenPoint {
    const projected = projection.project(point.x, point.y);
    return { x: projected.x, y: projected.y - lift - HARBOUR_QUAY_DECK };
  }

  private addCraneJib(crane: HarbourPoint): Phaser.GameObjects.Sprite {
    const axis = this.quayPoint(
      { x: crane.x + HARBOUR_CRANE_SLEW_U, y: crane.y },
      HARBOUR_CRANE_SLEW_Y,
    );
    const jib = this.scene.add
      .sprite(axis.x, axis.y, HARBOUR_CRANE_JIB_KEYS[0]!)
      .setOrigin(HARBOUR_CRANE_JIB_ORIGIN.x, HARBOUR_CRANE_JIB_ORIGIN.y)
      .setDepth(projection.depth(crane.x, crane.y) + 17);
    this.harbourSprites.push(jib);
    return jib;
  }

  private layoutHarbourHoist(harbour: HarbourLayout): void {
    const crane = harbour.workingCrane;
    const trolley = this.scene.add
      .sprite(0, 0, HARBOUR_CRANE_TROLLEY_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(projection.depth(crane.x, crane.y) + 18);
    const cable = this.scene.add
      .rectangle(0, 0, 1.5, 1, 0x7f8f97)
      .setOrigin(0.5, 0)
      .setDepth(projection.depth(crane.x, crane.y) + 18);
    const spreader = this.scene.add
      .sprite(0, 0, HARBOUR_CRANE_SPREADER_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(projection.depth(crane.x, crane.y) + 19);
    this.harbourTrolley = trolley;
    this.harbourCable = cable;
    this.harbourSpreader = spreader;
    this.harbourSprites.push(trolley, spreader);
    this.harbourShapes.push(cable);
    this.harbourHoist = { du: HOIST_REST_DU, angle: 0, hoist: HOIST_REST_DROP };
    this.applyHoistPose();
  }

  private applyHoistPose(): void {
    const harbour = this.harbourLayout;
    const trolley = this.harbourTrolley;
    const spreader = this.harbourSpreader;
    const cable = this.harbourCable;
    if (!harbour || !trolley || !spreader || !cable) {
      return;
    }
    const crane = harbour.workingCrane;
    const axis = this.quayPoint(
      { x: crane.x + HARBOUR_CRANE_SLEW_U, y: crane.y },
      HARBOUR_CRANE_SLEW_Y,
    );
    const { du, angle, hoist } = this.harbourHoist;

    const outU = du * Math.cos(angle);
    const outV = du * Math.sin(angle);
    const trolleyX = axis.x + (outU - outV) * (TILE_WIDTH / 2);
    const trolleyY =
      axis.y +
      (outU + outV) * (TILE_HEIGHT / 2) -
      (HARBOUR_CRANE_TROLLEY_Y - HARBOUR_CRANE_SLEW_Y);

    const jib = this.harbourCraneJib;
    if (jib) {
      const last = HARBOUR_CRANE_JIB_KEYS.length - 1;
      const frame = Phaser.Math.Clamp(
        Math.round((angle / HARBOUR_CRANE_SLEW_SWEEP) * last),
        0,
        last,
      );
      const key = HARBOUR_CRANE_JIB_KEYS[frame]!;
      if (jib.texture.key !== key) jib.setTexture(key);
    }
    trolley.setPosition(trolleyX, trolleyY);
    cable.setPosition(trolleyX, trolleyY);
    cable.setSize(1.5, Math.max(1, hoist));
    spreader.setPosition(trolleyX, trolleyY + hoist);
    this.harbourSpreaderCargo?.setPosition(
      trolleyX,
      trolleyY + hoist + CARRIED_CONTAINER_DROP,
    );
  }

  private addHarbourGlow(
    point: HarbourPoint,
    offset: { x: number; y: number },
    depth: number,
    style: {
      radius: number;
      color: number;
      peak: number;
      scale: number;
      duration: number;
    },
  ): void {
    const projected = projection.project(point.x, point.y);
    const glow = this.scene.add
      .circle(projected.x + offset.x, projected.y - offset.y, style.radius, style.color, 0.18)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: glow,
      alpha: style.peak,
      scale: style.scale,
      duration: style.duration,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.harbourGlows.push(glow);
  }

  private tweenHoist(
    to: Partial<{ du: number; angle: number; hoist: number }>,
    duration: number,
    ease = "Sine.easeInOut",
  ): Promise<void> {
    if (prefersReducedMotion()) {
      Object.assign(this.harbourHoist, to);
      this.applyHoistPose();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.harbourHoist,
        ...to,
        duration,
        ease,
        onUpdate: () => this.applyHoistPose(),
        onComplete: () => {
          this.applyHoistPose();
          resolve();
        },
      });
    });
  }

  private layoutQuayCargo(harbour: HarbourLayout): void {
    const drop = this.quayPoint(harbour.containerDrop, 0);
    const cargo = this.scene.add
      .sprite(drop.x, drop.y + HARBOUR_CONTAINER_ANCHOR_Y, HARBOUR_CARGO_CONTAINER_KEY)
      .setOrigin(0.5, 1)
      .setDepth(
        projection.depth(harbour.containerDrop.x, harbour.containerDrop.y) + 13,
      );
    this.harbourQuayCargo = cargo;
    this.harbourSprites.push(cargo);
  }

  private liftQuayCargo(): void {
    const cargo = this.harbourQuayCargo;
    if (!cargo) return;
    this.harbourQuayCargo = undefined;
    this.harbourSpreaderCargo = cargo;
    cargo.setDepth((this.harbourSpreader?.depth ?? 0) - 1);
    this.applyHoistPose();
  }

  private async playContainerLoad(): Promise<void> {
    if (!this.harbourShip || !this.harbourSpreader) return;
    await this.tweenHoist(
      { du: HARBOUR_CRANE_TROLLEY_PICK, angle: HARBOUR_CRANE_SLEW_SWEEP },
      CRANE_SLEW_MS,
    );
    await this.tweenHoist({ hoist: this.quayHoistDrop() }, CRANE_HOIST_MS, "Sine.easeIn");
    this.liftQuayCargo();
    await this.wait(180);
    await this.tweenHoist({ hoist: HOIST_REST_DROP }, CRANE_HOIST_MS, "Sine.easeOut");
    await this.tweenHoist(
      { du: HARBOUR_CRANE_TROLLEY_REACH, angle: 0 },
      CRANE_SLEW_MS + 160,
    );
    await this.tweenHoist({ hoist: this.bayHoistDrop() }, CRANE_HOIST_MS, "Sine.easeIn");
    this.stowSpreaderCargoInBay();
    await this.wait(180);
    await this.tweenHoist(
      { du: HOIST_REST_DU, hoist: HOIST_REST_DROP },
      CRANE_HOIST_MS,
      "Sine.easeOut",
    );
  }

  private async playContainerUnload(): Promise<void> {
    if (!this.harbourShip || !this.harbourShipCargo) return;
    await this.tweenHoist({ du: HARBOUR_CRANE_TROLLEY_REACH }, CRANE_SLEW_MS);
    await this.tweenHoist({ hoist: this.bayHoistDrop() }, CRANE_HOIST_MS, "Sine.easeIn");
    this.harbourSpreaderCargo = this.harbourShipCargo;
    this.harbourShipCargo = undefined;
    this.applyHoistPose();
    await this.wait(180);
    await this.tweenHoist({ hoist: HOIST_REST_DROP }, CRANE_HOIST_MS, "Sine.easeOut");
    await this.tweenHoist(
      { du: HARBOUR_CRANE_TROLLEY_PICK, angle: HARBOUR_CRANE_SLEW_SWEEP },
      CRANE_SLEW_MS + 160,
    );
    await this.tweenHoist({ hoist: this.quayHoistDrop() }, CRANE_HOIST_MS, "Sine.easeIn");
    this.landSpreaderCargoOnQuay();
    await this.wait(180);
    await this.tweenHoist(
      { du: HOIST_REST_DU, angle: 0, hoist: HOIST_REST_DROP },
      CRANE_SLEW_MS,
      "Sine.easeOut",
    );
  }

  private quayHoistDrop(): number {
    const harbour = this.harbourLayout;
    if (!harbour) return HOIST_REST_DROP;
    const deck = this.quayPoint(harbour.containerDrop, 0);
    const trolley = this.harbourTrolley;
    return Math.max(HOIST_REST_DROP, deck.y - (trolley?.y ?? deck.y) - 20);
  }

  private bayHoistDrop(): number {
    const ship = this.harbourShip;
    const trolley = this.harbourTrolley;
    if (!ship || !trolley) return HOIST_REST_DROP;
    const bayY = ship.y - HARBOUR_SHIP_ANCHOR_Y + this.harbourShipBay.y;
    return Math.max(HOIST_REST_DROP, bayY - trolley.y - 20);
  }

  private stowSpreaderCargoInBay(): void {
    const cargo = this.harbourSpreaderCargo;
    if (!cargo) return;
    this.harbourSpreaderCargo = undefined;
    this.harbourShipCargo = cargo;
    this.syncShipCargo();
  }

  private landSpreaderCargoOnQuay(): void {
    const cargo = this.harbourSpreaderCargo;
    const harbour = this.harbourLayout;
    if (!cargo || !harbour) return;
    this.harbourSpreaderCargo = undefined;
    this.harbourQuayCargo = cargo;
    const drop = this.quayPoint(harbour.containerDrop, 0);
    cargo
      .setPosition(drop.x, drop.y + HARBOUR_CONTAINER_ANCHOR_Y)
      .setDepth(
        projection.depth(harbour.containerDrop.x, harbour.containerDrop.y) + 13,
      );
  }

  private containerShipCourse():
    | { berth: ScreenPoint; corner: ScreenPoint; open: ScreenPoint }
    | undefined {
    const harbour = this.harbourLayout;
    if (!harbour) return undefined;
    const projected = projection.project(
      harbour.containerShip.x,
      harbour.containerShip.y,
    );
    const berth = { x: projected.x, y: projected.y + HARBOUR_SHIP_ANCHOR_Y };
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

  private sailContainerShip(
    from: ScreenPoint,
    through: ScreenPoint,
    to: ScreenPoint,
    ease: string,
    yaw: { from: number; to: number },
  ): Promise<void> {
    const ship = this.harbourShip;
    if (!ship) return Promise.resolve();
    this.scene.tweens.killTweensOf(ship);
    ship.setPosition(from.x, from.y);
    this.setShipYaw(yaw.from);
    if (prefersReducedMotion()) {
      ship.setPosition(to.x, to.y);
      this.setShipYaw(yaw.to);
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: cursor,
        t: 1,
        duration: CONTAINER_SHIP_SAIL_MS,
        ease,
        onUpdate: () => {
          const t = cursor.t;
          const inverse = 1 - t;
          const weight = { a: inverse * inverse, b: 2 * inverse * t, c: t * t };
          ship.setPosition(
            weight.a * from.x + weight.b * through.x + weight.c * to.x,
            weight.a * from.y + weight.b * through.y + weight.c * to.y,
          );
          const helm = Phaser.Math.Clamp(
            (t - SHIP_TURN_START) / (SHIP_TURN_END - SHIP_TURN_START),
            0,
            1,
          );
          const eased = helm * helm * (3 - 2 * helm);
          this.setShipYaw(yaw.from + (yaw.to - yaw.from) * eased);
        },
        onComplete: () => resolve(),
      });
    });
  }

  private playContainerShipTurnaround(): Promise<void> {
    const course = this.containerShipCourse();
    const ship = this.harbourShip;
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
      this.setShipYaw(YAW_OUTBOUND);
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
          this.setShipYaw(
            YAW_ALONGSIDE_IN + (YAW_OUTBOUND - YAW_ALONGSIDE_IN) * t,
          );
        },
        onComplete: () => {
          ship.setPosition(berth.x, berth.y);
          this.setShipYaw(YAW_OUTBOUND);
          ship.setData("restY", berth.y);
          this.idleBobContainerShip();
          resolve();
        },
      });
    });
  }

  private setShipYaw(yaw: number): void {
    const ship = this.harbourShip;
    if (!ship) return;
    const count = HARBOUR_SHIP_KEYS.length;
    const turns = yaw / (Math.PI * 2);
    const frame = ((Math.round(turns * count) % count) + count) % count;
    const key = HARBOUR_SHIP_KEYS[frame]!;
    if (ship.texture.key !== key) {
      ship.setTexture(key);
    }
    this.harbourShipBay = HARBOUR_SHIP_BAY_OFFSETS[frame]!;
    this.syncShipCargo();
  }

  private playContainerShipDeparture(): Promise<void> {
    const course = this.containerShipCourse();
    if (!course) return Promise.resolve();
    return this.sailContainerShip(
      course.berth,
      course.corner,
      course.open,
      "Quad.easeIn",
      { from: YAW_OUTBOUND, to: YAW_SEAWARD },
    );
  }

  prepareContainerArrival(carriesContainer: boolean): void {
    const ship = this.harbourShip;
    const course = this.containerShipCourse();
    if (!ship || !course) return;
    this.scene.tweens.killTweensOf(ship);
    ship.setPosition(course.open.x, course.open.y);
    this.setShipYaw(YAW_INBOUND);
    if (carriesContainer) {
      this.harbourQuayCargo?.destroy();
      this.harbourQuayCargo = undefined;
    }
    if (carriesContainer && !this.harbourShipCargo) {
      const cargo = this.scene.add
        .sprite(0, 0, HARBOUR_CARGO_CONTAINER_KEY)
        .setOrigin(0.5, 1);
      this.harbourShipCargo = cargo;
      this.harbourSprites.push(cargo);
    }
    this.syncShipCargo();
  }

  private async playContainerShipArrival(): Promise<void> {
    const ship = this.harbourShip;
    const course = this.containerShipCourse();
    if (!ship || !course) return;
    await this.sailContainerShip(
      course.open,
      course.corner,
      course.berth,
      "Quad.easeOut",
      { from: YAW_INBOUND, to: YAW_ALONGSIDE_IN },
    );
    ship.setData("restY", course.berth.y);
  }

  async coverForContainerVoyage(
    carriesContainer: boolean,
    transitionManager: WorldTransitionManager,
  ): Promise<void> {
    if (carriesContainer) {
      await this.playContainerLoad();
    }
    await this.playContainerShipDeparture();
    await transitionManager.playCoverTransition();
  }

  async revealAfterContainerVoyage(
    carriesContainer: boolean,
    transitionManager: WorldTransitionManager,
  ): Promise<void> {
    await transitionManager.partCloudCover();
    await this.playContainerShipArrival();
    if (carriesContainer) {
      await this.playContainerUnload();
    }
    await this.playContainerShipTurnaround();
  }

  private wait(duration: number): Promise<void> {
    if (prefersReducedMotion()) return Promise.resolve();
    return new Promise((resolve) => this.scene.time.delayedCall(duration, resolve));
  }

  clearHarbour(): void {
    for (const sprite of this.harbourSprites) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    for (const shape of this.harbourShapes) {
      shape.destroy();
    }
    for (const glow of this.harbourGlows) {
      this.scene.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.scene.tweens.killTweensOf(this.harbourHoist);
    this.cancelHarbourHoverHide();
    this.harbourHitZone?.destroy();
    this.harbourHitZone = undefined;
    this.harbourSprites = [];
    this.harbourShapes = [];
    this.harbourGlows = [];
    this.harbourShip = undefined;
    this.harbourCraneJib = undefined;
    this.harbourTrolley = undefined;
    this.harbourSpreader = undefined;
    this.harbourCable = undefined;
    this.harbourSpreaderCargo = undefined;
    this.harbourShipCargo = undefined;
    this.harbourQuayCargo = undefined;
    this.harbourLayout = undefined;
    this.harbourLayoutSignature = undefined;
    this.harbourHoverAnchorSprite = undefined;
    this.harbourShipHoverListener?.(undefined);
  }
}
