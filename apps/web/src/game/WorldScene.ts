import type { Building, WorldSnapshot } from "@sudo-city/protocol";
import Phaser from "phaser";
import { AmbientLife } from "./ambient";
import { playUiClickSound } from "@/lib/play-ui-click";
import { hashCoords, hashText, pickIndex, unitFloat } from "./hash";
import { createIsoProjection } from "./iso";
import { archetypeFor, tierFor } from "./palette";
import {
  buildTerrain,
  type TerrainCell,
  type TerrainGrid,
} from "./terrain";
import {
  HIGHLIGHT_KEY,
  SELECT_KEY,
  TERRAIN_ATLAS_KEY,
  TERRAIN_VARIANT_COUNTS,
  TILE_ANCHOR_Y,
  TILE_HEIGHT,
  TILE_WIDTH,
  bakeBuilding,
  bakeTerrainTextures,
  propTextureKey,
  roadTextureKey,
  terrainTextureKey,
} from "./textures";

const projection = createIsoProjection(TILE_WIDTH, TILE_HEIGHT);

/**
 * Depth bands. Sprites live on the scene display list rather than in Containers
 * so the camera culls them; layering is by depth instead of parenting.
 */
const GROUND_DEPTH = -1_000_000;
const HIGHLIGHT_DEPTH = -900_000;
/** Above the roads, below every building and prop. See AmbientLife.spawnCars. */
const TRAFFIC_DEPTH = -800_000;
const SKY_DEPTH = 100_000_000;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FOCUS_ZOOM = 1.25;
const FOCUS_DURATION_MS = 450;
/** Pointer travel, in screen pixels, above which a press is a drag not a click. */
const CLICK_SLOP = 5;
/** Most trees, bushes and fountains the world will place, at any size. */
const PROP_BUDGET = 2_000;
/** Rings of real water tiles at the coast; past this the background takes over. */
const SHORE_BAND = 3;
export const OPEN_WATER = 0x2e9fe0;

export type FileChange = "added" | "modified" | "deleted";

interface BuildingView {
  building: Building;
  sprite: Phaser.GameObjects.Sprite;
}

export class WorldScene extends Phaser.Scene {
  private terrain?: TerrainGrid;
  private snapshot?: WorldSnapshot;
  private groundSprites: Phaser.GameObjects.Sprite[] = [];
  private propSprites: Phaser.GameObjects.Sprite[] = [];
  private views = new Map<string, BuildingView>();
  private ambient?: AmbientLife;

  private highlight?: Phaser.GameObjects.Sprite;
  private selectionMarker?: Phaser.GameObjects.Sprite;
  private selectedPath?: string;
  private selectionListener?: (building?: Building) => void;
  private buildingDragListener?: (building: Building) => void;
  private pressedBuilding?: Building;
  private draggingBuilding?: Building;
  private dragPreview?: Phaser.GameObjects.Sprite;
  private dragPreviewOffset?: { x: number; y: number };

  private dragOrigin?: { x: number; y: number };
  private pressOrigin?: { x: number; y: number };
  private hasFitCamera = false;
  /** Continuous zoom, accumulated across wheel events. */
  private zoomTarget = 1;
  private focusTween?: Phaser.Tweens.Tween;

  constructor() {
    super("world");
  }

  create(): void {
    bakeTerrainTextures(this);

    // The background IS the open ocean — only the shoreline band gets real
    // tiles, so this has to be the same blue they fade into.
    this.cameras.main.setBackgroundColor(OPEN_WATER);

    this.highlight = this.add
      .sprite(0, 0, HIGHLIGHT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(HIGHLIGHT_DEPTH)
      .setVisible(false);
    this.selectionMarker = this.add
      .sprite(0, 0, SELECT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(HIGHLIGHT_DEPTH + 1)
      .setVisible(false);

    this.ambient = new AmbientLife(this, projection, {
      ground: GROUND_DEPTH,
      traffic: TRAFFIC_DEPTH,
      sky: SKY_DEPTH,
    });
    this.bindCamera();
    this.events.once("shutdown", () => this.clearDragPreview());
  }

  setSelectionListener(listener: (building?: Building) => void): void {
    this.selectionListener = listener;
  }

  setBuildingDragListener(listener: (building: Building) => void): void {
    this.buildingDragListener = listener;
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

  cancelBuildingDrag(): void {
    this.clearDragPreview();
    this.dragOrigin = undefined;
    this.pressOrigin = undefined;
    this.pressedBuilding = undefined;
    this.draggingBuilding = undefined;
  }

  private clearDragPreview(): void {
    this.dragPreview?.destroy();
    this.dragPreview = undefined;
    this.dragPreviewOffset = undefined;
  }

  private beginDragPreview(
    building: Building,
    pointer: Phaser.Input.Pointer,
  ): void {
    const view = this.views.get(building.path);
    if (!view) {
      return;
    }

    this.clearDragPreview();
    const pointerWorld = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.dragPreviewOffset = {
      x: view.sprite.x - pointerWorld.x,
      y: view.sprite.y - pointerWorld.y,
    };
    this.dragPreview = this.add
      .sprite(view.sprite.x, view.sprite.y, view.sprite.texture.key)
      .setOrigin(view.sprite.originX, view.sprite.originY)
      .setAlpha(0.48)
      .setDepth(SKY_DEPTH + 1);
    this.moveDragPreview(pointer);
  }

  private moveDragPreview(pointer: Phaser.Input.Pointer): void {
    if (!this.dragPreview) {
      return;
    }

    const pointerWorld = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const offset = this.dragPreviewOffset ?? { x: 0, y: 0 };
    this.dragPreview.setPosition(
      pointerWorld.x + offset.x,
      pointerWorld.y + offset.y,
    );
  }

  /** Pan and zoom the camera onto a building, then select it. */
  focusBuilding(path: string): boolean {
    const view = this.views.get(path);
    if (!view) {
      return false;
    }

    this.focusTween?.stop();
    this.focusTween = undefined;

    const camera = this.cameras.main;
    const targetZoom = Phaser.Math.Clamp(FOCUS_ZOOM, MIN_ZOOM, MAX_ZOOM);
    const startScrollX = camera.scrollX;
    const startScrollY = camera.scrollY;
    const startZoom = camera.zoom;

    camera.setZoom(targetZoom);
    camera.centerOn(view.sprite.x, view.sprite.y);
    const targetScrollX = camera.scrollX;
    const targetScrollY = camera.scrollY;

    camera.setZoom(startZoom);
    camera.scrollX = startScrollX;
    camera.scrollY = startScrollY;

    playUiClickSound();
    this.focusTween = this.tweens.add({
      targets: camera,
      scrollX: targetScrollX,
      scrollY: targetScrollY,
      zoom: targetZoom,
      duration: FOCUS_DURATION_MS,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        this.zoomTarget = camera.zoom;
      },
      onComplete: () => {
        this.zoomTarget = targetZoom;
        this.focusTween = undefined;
        this.select(path);
      },
    });

    return true;
  }

  setWorld(snapshot: WorldSnapshot): void {
    if (!this.scene.isActive()) {
      this.events.once(Phaser.Scenes.Events.CREATE, () => this.setWorld(snapshot));
      return;
    }

    const previous = this.snapshot;
    this.snapshot = snapshot;

    // Terrain only needs redrawing when the footprint of the city changed.
    if (!previous || terrainChanged(previous, snapshot)) {
      this.terrain = buildTerrain(snapshot);
      this.drawTerrain(this.terrain);
      this.applyCameraBounds(this.terrain);
      this.ambient?.rebuild(this.terrain);
    }

    this.syncBuildings(snapshot);

    if (!this.hasFitCamera) {
      this.fitCamera();
      this.hasFitCamera = true;
    }
  }

  /**
   * Immediate feedback for an agent edit. The authoritative rescan follows and
   * lands through setWorld; this only animates what is already standing.
   */
  applyFileChange(path: string, change: FileChange): void {
    const view = this.views.get(path);
    if (!view) {
      return;
    }

    if (change === "deleted") {
      this.demolish(view);
      this.views.delete(path);
      return;
    }

    this.tweens.killTweensOf(view.sprite);
    view.sprite.setScale(1);
    this.tweens.add({
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

  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------

  /**
   * Ground tiles are Sprites so the camera culls them individually. A Blitter
   * would batch them into one object, but it silently stops drawing partway
   * through a field this size, and a renderer that quietly loses terrain is
   * worse than one that costs frames.
   *
   * The cost is controlled instead by not emitting what cannot be seen: open
   * ocean is the camera's background colour, and decoration is thinned to a
   * budget on large worlds.
   */
  private drawTerrain(terrain: TerrainGrid): void {
    for (const sprite of this.groundSprites) {
      sprite.destroy();
    }
    for (const sprite of this.propSprites) {
      sprite.destroy();
    }
    this.groundSprites = [];
    this.propSprites = [];

    const propOdds = this.propOdds(terrain);

    for (const cell of terrain.cells) {
      // Open ocean is a flat colour; only the shoreline band needs tiles to
      // carry the foam and the depth change.
      if (cell.kind === "water" && !nearShore(terrain, cell)) {
        continue;
      }

      const point = projection.project(cell.x, cell.y);
      // Every ground tile is a frame of one atlas, so the whole plane batches
      // without the renderer rebinding a texture per tile.
      const sprite = this.add
        .sprite(point.x, point.y + TILE_ANCHOR_Y, TERRAIN_ATLAS_KEY, tileKeyFor(cell))
        .setOrigin(0.5, 1)
        .setDepth(GROUND_DEPTH);
      this.groundSprites.push(sprite);

      if (
        cell.prop &&
        unitFloat(hashCoords(cell.x, cell.y, 0xd0e)) < propOdds
      ) {
        const prop = this.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, propTextureKey(cell.prop))
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(cell.x, cell.y));
        this.propSprites.push(prop);
      }
    }
  }

  /**
   * Fraction of decorated cells that actually get a prop. Thinned rather than
   * switched off, so a big repository still reads as a landscape. Chosen from a
   * stable hash so the same trees survive across snapshots.
   */
  private propOdds(terrain: TerrainGrid): number {
    const candidates = terrain.cells.reduce(
      (total, cell) => (cell.prop ? total + 1 : total),
      0,
    );
    return Math.min(1, PROP_BUDGET / Math.max(candidates, 1));
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  /**
   * Diffs against what is already standing rather than rebuilding. Plots are
   * persisted server-side, so an unchanged file keeps its exact sprite and any
   * running animation.
   */
  private syncBuildings(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();

    for (const building of snapshot.buildings) {
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
      this.views.set(building.path, this.raise(building, existing !== undefined));
    }

    for (const [path, view] of this.views) {
      if (!seen.has(path)) {
        this.demolish(view);
        this.views.delete(path);
      }
    }

    if (this.selectedPath && !this.views.has(this.selectedPath)) {
      this.select(undefined);
    }
  }

  private raise(building: Building, replacing: boolean): BuildingView {
    const archetype = archetypeFor(building.language, building.loc);
    const tier = tierFor(building.loc);
    const baked = bakeBuilding(this, archetype, tier, building.language);
    const point = projection.project(building.plot.x, building.plot.y);

    const sprite = this.add
      .sprite(point.x, point.y + TILE_ANCHOR_Y, baked.key)
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(building.plot.x, building.plot.y));

    // A tall building is drawn many tiles above the plot it stands on, so
    // picking by tile would make you click empty ground north of the tower.
    // Pixel-perfect hit testing matches what the player actually sees.
    sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });
    sprite.setData("path", building.path);

    this.ambient?.attachSmoke(sprite, baked.smokeAnchor);

    // Only animate genuinely new construction; the first snapshot should not
    // play a thousand tweens at once.
    if (this.hasFitCamera && !replacing) {
      sprite.setScale(1, 0);
      this.tweens.add({
        targets: sprite,
        scaleY: 1,
        duration: 420,
        ease: "Back.easeOut",
      });
      this.pulse(sprite);
    }

    return { building, sprite };
  }

  private demolish(view: BuildingView): void {
    this.tweens.killTweensOf(view.sprite);
    this.tweens.add({
      targets: view.sprite,
      scaleY: 0,
      scaleX: 1.2,
      alpha: 0.2,
      duration: 320,
      ease: "Quad.easeIn",
      onComplete: () => view.sprite.destroy(),
    });
  }

  /** A brief glow that fades, marking a building the agent just touched. */
  private pulse(sprite: Phaser.GameObjects.Sprite): void {
    const glow = this.add
      .sprite(sprite.x, sprite.y, SELECT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(sprite.depth - 1);
    this.tweens.add({
      targets: glow,
      alpha: 0,
      scale: 1.6,
      duration: 700,
      ease: "Quad.easeOut",
      onComplete: () => glow.destroy(),
    });
  }

  // -------------------------------------------------------------------------
  // Camera and picking
  // -------------------------------------------------------------------------

  private applyCameraBounds(terrain: TerrainGrid): void {
    const { minX, minY, maxX, maxY } = terrain.bounds;
    const left = projection.project(minX, maxY).x - TILE_WIDTH;
    const right = projection.project(maxX, minY).x + TILE_WIDTH;
    const top = projection.project(minX, minY).y - TILE_HEIGHT * 6;
    const bottom = projection.project(maxX, maxY).y + TILE_HEIGHT * 2;

    this.cameras.main.setBounds(left, top, right - left, bottom - top);
  }

  /**
   * Frames the built-up area plus a little countryside — fitting the whole
   * ocean would push the city down to a few pixels on any sizeable repo.
   */
  private fitCamera(): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return;
    }
    const camera = this.cameras.main;
    const margin = 4;
    const minX = -margin;
    const minY = -margin;
    const maxX = snapshot.size.width - 1 + margin;
    const maxY = snapshot.size.height - 1 + margin;

    const width = projection.project(maxX, minY).x - projection.project(minX, maxY).x;
    const height =
      projection.project(maxX, maxY).y - projection.project(minX, minY).y;

    this.zoomTarget = Phaser.Math.Clamp(
      Math.min(camera.width / width, camera.height / height),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    camera.setZoom(this.zoomTarget);

    const center = projection.project((minX + maxX) / 2, (minY + maxY) / 2);
    camera.centerOn(center.x, center.y);
  }

  private bindCamera(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.dragOrigin = { x: pointer.x, y: pointer.y };
      this.pressOrigin = { x: pointer.x, y: pointer.y };
      this.pressedBuilding = this.buildingAtPointer(pointer);
      this.draggingBuilding = undefined;
    });

    const endDrag = (pointer: Phaser.Input.Pointer): void => {
      const press = this.pressOrigin;
      const draggedBuilding = this.draggingBuilding;
      this.clearDragPreview();
      this.dragOrigin = undefined;
      this.pressOrigin = undefined;
      this.pressedBuilding = undefined;
      this.draggingBuilding = undefined;
      if (!press || draggedBuilding) {
        return;
      }
      const travel = Phaser.Math.Distance.Between(
        press.x,
        press.y,
        pointer.x,
        pointer.y,
      );
      if (travel <= CLICK_SLOP) {
        const building = this.buildingAtPointer(pointer);
        if (building) {
          playUiClickSound();
        }
        this.select(building?.path);
      }
    };

    this.input.on("pointerup", endDrag);
    // Releasing outside the canvas used to leave a stale drag origin behind.
    this.input.on("pointerupoutside", endDrag);

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && this.dragOrigin) {
        const travel = Phaser.Math.Distance.Between(
          this.pressOrigin?.x ?? pointer.x,
          this.pressOrigin?.y ?? pointer.y,
          pointer.x,
          pointer.y,
        );
        if (
          !this.draggingBuilding &&
          this.pressedBuilding &&
          travel > CLICK_SLOP
        ) {
          this.draggingBuilding = this.pressedBuilding;
          this.beginDragPreview(this.draggingBuilding, pointer);
          this.buildingDragListener?.(this.draggingBuilding);
        }
        if (this.draggingBuilding) {
          this.moveDragPreview(pointer);
          this.moveHighlight(pointer);
          return;
        }

        const camera = this.cameras.main;
        camera.scrollX -= (pointer.x - this.dragOrigin.x) / camera.zoom;
        camera.scrollY -= (pointer.y - this.dragOrigin.y) / camera.zoom;
        this.dragOrigin = { x: pointer.x, y: pointer.y };
        return;
      }
      this.moveHighlight(pointer);
    });

    this.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _objects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        const camera = this.cameras.main;
        // Anchor the zoom on the cursor: keep whatever world point is under
        // the pointer pinned there as the zoom changes.
        const before = camera.getWorldPoint(pointer.x, pointer.y);
        this.zoomTarget = Phaser.Math.Clamp(
          this.zoomTarget * Math.pow(2, -wheelSteps(pointer, deltaY)),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        camera.setZoom(this.zoomTarget);
        const after = camera.getWorldPoint(pointer.x, pointer.y);
        camera.scrollX += before.x - after.x;
        camera.scrollY += before.y - after.y;
      },
    );
  }

  private cellAtPointer(pointer: Phaser.Input.Pointer): TerrainCell | undefined {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const grid = projection.unproject(world.x, world.y);
    return this.terrain?.cellAt(Math.round(grid.x), Math.round(grid.y));
  }

  /** Topmost building whose painted pixels lie under the pointer. */
  private buildingAtPointer(
    pointer: Phaser.Input.Pointer,
  ): Building | undefined {
    const hits = this.input
      .hitTestPointer(pointer)
      .filter(
        (object): object is Phaser.GameObjects.Sprite =>
          object instanceof Phaser.GameObjects.Sprite &&
          typeof object.getData("path") === "string",
      )
      .sort((left, right) => right.depth - left.depth);

    for (const hit of hits) {
      const view = this.views.get(String(hit.getData("path")));
      if (view) {
        return view.building;
      }
    }
    return undefined;
  }

  private moveHighlight(pointer: Phaser.Input.Pointer): void {
    if (!this.highlight) {
      return;
    }

    // Hovering a tower highlights the plot it stands on, not the empty ground
    // its roof happens to overlap.
    const building = this.buildingAtPointer(pointer);
    const cell = building?.plot ?? this.cellAtPointer(pointer);
    if (!cell) {
      this.highlight.setVisible(false);
      return;
    }
    const point = projection.project(cell.x, cell.y);
    this.highlight
      .setPosition(point.x, point.y + TILE_ANCHOR_Y)
      .setVisible(true);
  }

  private select(path?: string): void {
    const previous = this.selectedPath
      ? this.views.get(this.selectedPath)
      : undefined;
    previous?.sprite.clearTint();

    this.selectedPath = path;
    const view = path ? this.views.get(path) : undefined;

    if (this.selectionMarker) {
      if (view) {
        this.selectionMarker
          .setPosition(view.sprite.x, view.sprite.y)
          // The marker sits on the building's own tile, so it has to draw
          // above it — at ground depth the building would hide it entirely.
          .setDepth(view.sprite.depth + 1)
          .setVisible(true);
      } else {
        this.selectionMarker.setVisible(false);
      }
    }

    // The footprint ring alone is easy to miss in a dense block; tinting the
    // structure makes the selection unambiguous.
    view?.sprite.setTint(0xffd9a0);

    this.selectionListener?.(view?.building);
  }
}

/**
 * True when a water cell is close enough to land that its tile is worth
 * drawing. Open ocean is indistinguishable from the flat background.
 */
function nearShore(terrain: TerrainGrid, cell: TerrainCell): boolean {
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

function tileKeyFor(cell: TerrainCell): string {
  if (cell.kind === "road") {
    return roadTextureKey(cell.roadMask);
  }
  const variants = TERRAIN_VARIANT_COUNTS[cell.kind];
  return terrainTextureKey(cell.kind, Math.min(cell.variant, variants - 1));
}

/** Terrain depends on the field size, the districts and which plots are taken. */
function terrainChanged(before: WorldSnapshot, after: WorldSnapshot): boolean {
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

function plotFingerprint(snapshot: WorldSnapshot): number {
  let fingerprint = 0;
  for (const building of snapshot.buildings) {
    fingerprint ^= hashText(`${building.plot.x}:${building.plot.y}`);
  }
  return fingerprint;
}

/** True when the two revisions would bake to the same sprite in the same place. */
function sameStructure(before: Building, after: Building): boolean {
  return (
    before.plot.x === after.plot.x &&
    before.plot.y === after.plot.y &&
    before.language === after.language &&
    tierFor(before.loc) === tierFor(after.loc) &&
    archetypeFor(before.language, before.loc) ===
      archetypeFor(after.language, after.loc)
  );
}

/**
 * Wheel deltas in "doublings of zoom".
 *
 * A mouse notch reports deltaY around 100 while a trackpad reports single
 * digits many times a second, so zoom has to be proportional and accumulate
 * rather than step: quantising to fixed stops threw away every trackpad event.
 * deltaMode is normalised because Firefox reports lines, not pixels.
 */
function wheelSteps(pointer: Phaser.Input.Pointer, deltaY: number): number {
  const event = pointer.event as WheelEvent | undefined;
  const unit =
    event?.deltaMode === 1 ? 16 : event?.deltaMode === 2 ? 100 : 1;
  return (deltaY * unit) / 500;
}

/** Deterministic variant choice for anything keyed by identity rather than cell. */
export function variantFor(identity: string, count: number): number {
  return pickIndex(hashText(identity), count);
}
