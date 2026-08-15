import Phaser from "phaser";
import type { Building, PullRequestOverlay, WorldSnapshot } from "@sudo-city/protocol";
import { capitolDistrict, capitolFits, inCapitolDistrict } from "@sudo-city/protocol";
import {
  ADDED_MARKER_KEY,
  ADDED_TINT,
  DIFF_SCAFFOLD_HEIGHT,
  DIFF_SCAFFOLD_KEY,
  MIN_SCAFFOLD_HEIGHT,
  MODIFIED_GLOW_TINT,
  MODIFIED_TINT,
  projection,
  RUBBLE_KEY,
  SCAFFOLD_TINT,
  SCAFFOLD_WRAP,
  SELECT_KEY,
  SKY_DEPTH,
} from "../../core/worldConstants";
import { sameStructure } from "../../core/worldMath";
import type { AmbientLife } from "../../../systems/ambient";
import { markerFor, rubbleMarkers } from "../../../math/overlay";
import { archetypeFor, tierFor } from "../../../math/palette";
import { bakeBuilding } from "../../../textures/buildings";
import { TILE_ANCHOR_Y } from "../../../textures/core";
import { buildingFacingAt, type TerrainGrid } from "../../../layouts/terrain";
import type { FileChange } from "../../../WorldScene";

export interface BuildingView {
  building: Building;
  sprite: Phaser.GameObjects.Sprite;
}

export class WorldBuildingManager {
  private views = new Map<string, BuildingView>();
  private overlay?: PullRequestOverlay;
  private addedMarkers = new Map<string, Phaser.GameObjects.Sprite>();
  private modifiedGlows = new Map<string, Phaser.GameObjects.Sprite>();
  private diffScaffolds = new Map<string, Phaser.GameObjects.Sprite>();
  private rubbleSprites: Phaser.GameObjects.Sprite[] = [];

  private dragPreview?: Phaser.GameObjects.Sprite;
  private dragPreviewOffset?: { x: number; y: number };

  constructor(private scene: Phaser.Scene) {}

  getViews(): Map<string, BuildingView> {
    return this.views;
  }

  getOverlay(): PullRequestOverlay | undefined {
    return this.overlay;
  }

  setOverlay(
    overlay: PullRequestOverlay | undefined,
    sitedPaths: Set<string>,
  ): void {
    this.overlay = overlay;
    if (!this.scene.scene?.isActive()) {
      return;
    }
    this.applyOverlay(sitedPaths);
  }

  syncBuildings(
    snapshot: WorldSnapshot,
    hasFitCamera: boolean,
    terrain: TerrainGrid | undefined,
    ambient?: AmbientLife,
  ): void {
    const seen = new Set<string>();

    const mall = capitolFits(snapshot.size)
      ? capitolDistrict(snapshot.size)
      : undefined;

    for (const building of snapshot.buildings) {
      if (mall && inCapitolDistrict(mall, building.plot.x, building.plot.y)) {
        continue;
      }

      seen.add(building.path);
      const existing = this.views.get(building.path);

      if (existing && sameStructure(existing.building, building)) {
        existing.building = building;
        continue;
      }
      if (existing) {
        existing.sprite.destroy();
        this.views.delete(building.path);
      }
      this.views.set(
        building.path,
        this.raise(building, existing !== undefined, hasFitCamera, terrain, ambient),
      );
    }

    for (const [path, view] of this.views) {
      if (!seen.has(path)) {
        this.demolish(view, ambient);
        this.views.delete(path);
      }
    }
  }

  private raise(
    building: Building,
    replacing: boolean,
    hasFitCamera: boolean,
    terrain: TerrainGrid | undefined,
    ambient?: AmbientLife,
  ): BuildingView {
    const archetype = archetypeFor(building.language, building.loc, building.district);
    const tier = tierFor(building.loc);
    // Only house and townhouse actually vary by facing (see FACING_VARIES in
    // buildings.ts); computing it regardless is cheap and keeps this call
    // site simple rather than special-casing two archetypes here too.
    const facing = terrain
      ? buildingFacingAt(building.plot.x, building.plot.y, terrain)
      : "v";
    const baked = bakeBuilding(this.scene, archetype, tier, building.language, facing);
    const point = projection.project(building.plot.x, building.plot.y);

    const sprite = this.scene.add
      .sprite(point.x, point.y + TILE_ANCHOR_Y, baked.key)
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(building.plot.x, building.plot.y));

    sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });
    sprite.setData("path", building.path);

    ambient?.attachSmoke(sprite, baked.smokeAnchor);

    if (hasFitCamera && !replacing) {
      sprite.setScale(1, 0);
      this.scene.tweens.add({
        targets: sprite,
        scaleY: 1,
        duration: 420,
        ease: "Back.easeOut",
      });
      this.pulse(sprite);
    }

    return { building, sprite };
  }

  demolish(view: BuildingView, ambient?: AmbientLife): void {
    this.scene.tweens.killTweensOf(view.sprite);
    ambient?.releaseSmoke(view.sprite);
    this.scene.tweens.add({
      targets: view.sprite,
      scaleY: 0,
      scaleX: 1.2,
      alpha: 0.2,
      duration: 320,
      ease: "Quad.easeIn",
      onComplete: () => view.sprite.destroy(),
    });
  }

  pulse(sprite: Phaser.GameObjects.Sprite): void {
    const glow = this.scene.add
      .sprite(sprite.x, sprite.y, SELECT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(sprite.depth - 1);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: 1.6,
      duration: 700,
      ease: "Quad.easeOut",
      onComplete: () => glow.destroy(),
    });
  }

  applyOverlay(sitedPaths: Set<string>): void {
    for (const marker of this.addedMarkers.values()) {
      marker.destroy();
    }
    this.addedMarkers.clear();
    for (const glow of this.modifiedGlows.values()) {
      this.scene.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.modifiedGlows.clear();
    this.clearDiffScaffolds();
    for (const rubble of this.rubbleSprites) {
      rubble.destroy();
    }
    this.rubbleSprites = [];
    for (const view of this.views.values()) {
      view.sprite.clearTint();
    }

    const overlay = this.overlay;
    if (!overlay) {
      return;
    }

    for (const view of this.views.values()) {
      const change = markerFor(overlay, view.building.path);
      if (change === "added") {
        view.sprite.setTint(ADDED_TINT);
        const marker = this.scene.add
          .sprite(view.sprite.x, view.sprite.y, ADDED_MARKER_KEY)
          .setOrigin(0.5, 1)
          .setDepth(view.sprite.depth - 1);
        this.addedMarkers.set(view.building.path, marker);
      } else if (change === "modified") {
        view.sprite.setTint(MODIFIED_TINT);
        const glow = this.scene.add
          .sprite(view.sprite.x, view.sprite.y, SELECT_KEY)
          .setOrigin(0.5, 1)
          .setDepth(view.sprite.depth - 1)
          .setTint(MODIFIED_GLOW_TINT);
        this.scene.tweens.add({
          targets: glow,
          alpha: { from: 0.25, to: 0.75 },
          scale: { from: 1, to: 1.15 },
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        this.modifiedGlows.set(view.building.path, glow);
      }

      if (change) {
        this.raiseDiffScaffold(view, sitedPaths);
      }
    }

    for (const rubble of rubbleMarkers(overlay)) {
      const point = projection.project(rubble.plot.x, rubble.plot.y);
      this.rubbleSprites.push(
        this.scene.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, RUBBLE_KEY)
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(rubble.plot.x, rubble.plot.y)),
      );
    }
  }

  raiseDiffScaffold(view: BuildingView, sitedPaths: Set<string>): void {
    if (sitedPaths.has(view.building.path)) {
      return;
    }

    const wrapped = Math.max(
      MIN_SCAFFOLD_HEIGHT,
      view.sprite.height * SCAFFOLD_WRAP,
    );
    const scaffold = this.scene.add
      .sprite(view.sprite.x, view.sprite.y, DIFF_SCAFFOLD_KEY)
      .setOrigin(0.5, 1)
      .setDepth(view.sprite.depth + 1)
      .setAlpha(0.85)
      .setTint(SCAFFOLD_TINT)
      .setScale(1, wrapped / DIFF_SCAFFOLD_HEIGHT);
    this.diffScaffolds.set(view.building.path, scaffold);
  }

  clearDiffScaffolds(): void {
    for (const scaffold of this.diffScaffolds.values()) {
      scaffold.destroy();
    }
    this.diffScaffolds.clear();
  }

  removeDiffScaffold(path: string): void {
    const scaffold = this.diffScaffolds.get(path);
    if (scaffold) {
      scaffold.destroy();
      this.diffScaffolds.delete(path);
    }
  }

  applyFileChange(
    path: string,
    change: FileChange,
    cityId: string,
    currentCityId?: string,
    ambient?: AmbientLife,
  ): void {
    if (currentCityId !== cityId) {
      return;
    }
    const view = this.views.get(path);
    if (!view) {
      return;
    }

    if (change === "deleted") {
      this.demolish(view, ambient);
      this.views.delete(path);
      return;
    }

    this.scene.tweens.killTweensOf(view.sprite);
    view.sprite.setScale(1);
    this.scene.tweens.add({
      targets: view.sprite,
      scaleY: 1.12,
      scaleX: 0.94,
      duration: 140,
      yoyo: true,
      repeat: 1,
      ease: "Sine.easeInOut",
    });
    this.pulse(view.sprite);
  }

  getBuildingPreviewSource(building: Building): string | undefined {
    const view = this.views.get(building.path);
    if (!view) {
      return undefined;
    }

    const source = view.sprite.texture.getSourceImage();
    if (
      typeof HTMLCanvasElement !== "undefined" &&
      source instanceof HTMLCanvasElement
    ) {
      return source.toDataURL();
    }
    if (
      typeof HTMLImageElement !== "undefined" &&
      source instanceof HTMLImageElement
    ) {
      return source.currentSrc || source.src;
    }
    return undefined;
  }

  clearDragPreview(): void {
    this.dragPreview?.destroy();
    this.dragPreview = undefined;
    this.dragPreviewOffset = undefined;
  }

  beginDragPreview(building: Building, pointer: Phaser.Input.Pointer): void {
    const view = this.views.get(building.path);
    if (!view) {
      return;
    }

    this.clearDragPreview();
    const pointerWorld = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.dragPreviewOffset = {
      x: view.sprite.x - pointerWorld.x,
      y: view.sprite.y - pointerWorld.y,
    };
    this.dragPreview = this.scene.add
      .sprite(view.sprite.x, view.sprite.y, view.sprite.texture.key)
      .setOrigin(view.sprite.originX, view.sprite.originY)
      .setAlpha(0.48)
      .setDepth(SKY_DEPTH + 1);
    this.moveDragPreview(pointer);
  }

  moveDragPreview(pointer: Phaser.Input.Pointer): void {
    if (!this.dragPreview) {
      return;
    }

    const pointerWorld = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const offset = this.dragPreviewOffset ?? { x: 0, y: 0 };
    this.dragPreview.setPosition(
      pointerWorld.x + offset.x,
      pointerWorld.y + offset.y,
    );
  }

  clear(ambient?: AmbientLife): void {
    for (const view of this.views.values()) {
      this.scene.tweens.killTweensOf(view.sprite);
      ambient?.releaseSmoke(view.sprite);
      view.sprite.destroy();
    }
    this.views.clear();

    for (const marker of this.addedMarkers.values()) {
      marker.destroy();
    }
    this.addedMarkers.clear();

    for (const glow of this.modifiedGlows.values()) {
      this.scene.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.modifiedGlows.clear();

    this.clearDiffScaffolds();

    for (const rubble of this.rubbleSprites) {
      rubble.destroy();
    }
    this.rubbleSprites = [];
    this.overlay = undefined;
    this.clearDragPreview();
  }
}
