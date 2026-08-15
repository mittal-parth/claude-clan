import Phaser from "phaser";
import type { WorldSize } from "@sudo-city/protocol";
import { capitolDistrict, capitolFits } from "@sudo-city/protocol";
import { CAPITOL_OFFSET_V, capitolDepthTile } from "../../../layouts/capitol";
import { hashCoords, unitFloat } from "../../../math/hash";
import { playUiClickSound } from "@/lib/play-ui-click";
import {
  GROUND_DEPTH,
  PROP_BUDGET,
  projection,
} from "../../core/worldConstants";
import { nearShore, tileKeyFor, type ScreenPoint } from "../../core/worldMath";
import { worldToScreen } from "../../utils/hitZoneUtils";
import { isCanvasPointer } from "../../utils/pointerUtils";
import type { TerrainGrid } from "../../../layouts/terrain";
import { TERRAIN_ATLAS_KEY } from "../../../textures/terrain";
import { TILE_ANCHOR_Y } from "../../../textures/core";
import { propTextureKey } from "../../../textures/props";
import {
  CAPITOL_ANCHOR_Y,
  CAPITOL_KEY,
  CAPITOL_SCALE,
} from "../../../textures/capitol/base";
import type { ShipHoverInfo } from "../../../WorldScene";

export class WorldTerrainManager {
  public terrain?: TerrainGrid;
  public groundSprites: Phaser.GameObjects.Sprite[] = [];
  public propSprites: Phaser.GameObjects.Sprite[] = [];

  private capitolClickListener?: () => void;
  private capitolHoverListener?: (info?: ShipHoverInfo) => void;
  private capitolHoverHideTimer?: Phaser.Time.TimerEvent;

  constructor(
    private scene: Phaser.Scene,
    private isTravelTransitionActive: () => boolean,
  ) {}

  setCapitolClickListener(listener?: () => void): void {
    this.capitolClickListener = listener;
  }

  setCapitolHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.capitolHoverListener = listener;
  }

  drawTerrain(terrain: TerrainGrid, size: WorldSize): void {
    this.terrain = terrain;
    this.clear();

    const odds = this.propOdds(terrain);

    for (const cell of terrain.cells) {
      if (cell.kind === "water" && !nearShore(terrain, cell)) {
        continue;
      }

      const point = projection.project(cell.x, cell.y);
      const sprite = this.scene.add
        .sprite(point.x, point.y + TILE_ANCHOR_Y, TERRAIN_ATLAS_KEY, tileKeyFor(cell))
        .setOrigin(0.5, 1)
        .setDepth(GROUND_DEPTH);
      this.groundSprites.push(sprite);

      if (
        cell.prop &&
        (cell.keepProp ||
          unitFloat(hashCoords(cell.x, cell.y, 0xd0e)) < odds)
      ) {
        const prop = this.scene.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, propTextureKey(cell.prop))
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(cell.x, cell.y));
        this.propSprites.push(prop);
      }
    }

    this.drawCapitol(size);
  }

  private showCapitolHover(info: ShipHoverInfo): void {
    this.cancelCapitolHoverHide();
    this.capitolHoverListener?.(info);
  }

  private scheduleHideCapitolHover(): void {
    this.cancelCapitolHoverHide();
    this.capitolHoverHideTimer = this.scene.time.delayedCall(32, () => {
      this.capitolHoverHideTimer = undefined;
      this.capitolHoverListener?.(undefined);
    });
  }

  public cancelCapitolHoverHide(): void {
    this.capitolHoverHideTimer?.remove(false);
    this.capitolHoverHideTimer = undefined;
  }

  private drawCapitol(size: WorldSize): void {
    if (!capitolFits(size)) {
      return;
    }
    const mall = capitolDistrict(size);
    const anchor = projection.project(
      mall.centerX,
      mall.centerY + CAPITOL_OFFSET_V,
    );
    const sort = capitolDepthTile(mall);

    const capitol = this.scene.add
      .sprite(
        anchor.x,
        anchor.y + CAPITOL_ANCHOR_Y * CAPITOL_SCALE,
        CAPITOL_KEY,
      )
      .setOrigin(0.5, 1)
      .setScale(CAPITOL_SCALE)
      .setDepth(projection.depth(sort.x, sort.y))
      .setInteractive({ pixelPerfect: true, useHandCursor: true });

    capitol.on("pointerover", () => {
      if (this.isTravelTransitionActive()) return;
      const screen = worldToScreen(
        this.scene.cameras.main,
        capitol.x,
        capitol.y - 360,
      );
      this.showCapitolHover({
        cityId: "capitol",
        title: "TOWNHALL",
        action: "View city issues",
        screenX: screen.x,
        screenY: screen.y,
      });
    });

    capitol.on("pointerout", () => this.scheduleHideCapitolHover());
    capitol.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!isCanvasPointer(pointer)) return;
      if (this.isTravelTransitionActive()) return;
      playUiClickSound();
      this.cancelCapitolHoverHide();
      this.capitolHoverListener?.(undefined);
      this.capitolClickListener?.();
    });

    this.propSprites.push(capitol);
  }

  private propOdds(terrain: TerrainGrid): number {
    const candidates = terrain.cells.reduce(
      (total, cell) => (cell.prop ? total + 1 : total),
      0,
    );
    return Math.min(1, PROP_BUDGET / Math.max(candidates, 1));
  }

  clear(): void {
    for (const sprite of this.groundSprites) {
      sprite.destroy();
    }
    for (const sprite of this.propSprites) {
      sprite.destroy();
    }
    this.cancelCapitolHoverHide();
    this.capitolHoverListener?.(undefined);
    this.groundSprites = [];
    this.propSprites = [];
  }
}
