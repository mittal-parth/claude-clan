import type {
  Building,
  CitySummary,
  PullRequestOverlay,
  WorldSnapshot,
} from "@sudo-city/protocol";
import Phaser from "phaser";
import { AmbientLife } from "./ambient";
import { playUiClickSound } from "@/lib/play-ui-click";
import { hashCoords, hashText, pickIndex, unitFloat } from "./hash";
import { createIsoProjection } from "./iso";
import { markerFor, rubbleMarkers } from "./overlay";
import { archetypeFor, tierFor } from "./palette";
import {
  buildTerrain,
  COUNTRYSIDE_RING,
  COAST_RING,
  type TerrainCell,
  type TerrainGrid,
} from "./terrain";
import {
  HIGHLIGHT_KEY,
  RUBBLE_KEY,
  SCAFFOLD_KEY,
  SELECT_KEY,
  SHIP_KEY,
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

/** Tints applied to a marked building; the marker sprite carries its own colour. */
const ADDED_TINT = 0xffcf94;
const MODIFIED_TINT = 0x9fe7ff;
const MODIFIED_GLOW_TINT = 0x66d9ef;

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
/** Pointer travel, in screen pixels, above which a press is a drag not a click. */
const CLICK_SLOP = 5;
/** Most trees, bushes and fountains the world will place, at any size. */
const PROP_BUDGET = 2_000;
/** Rings of real water tiles at the coast; past this the background takes over. */
const SHORE_BAND = 3;
export const OPEN_WATER = 0x2e9fe0;
/** Keep the map white long enough for the voyage to feel intentional. */
const WHITEOUT_HOLD_MS = 500;
const WHITEOUT_ALPHA = 0.9;

export type FileChange = "added" | "modified" | "deleted";

interface BuildingView {
  building: Building;
  sprite: Phaser.GameObjects.Sprite;
}

export interface ShipHoverInfo {
  cityId: string;
  title: string;
  action: string;
  /** Position relative to the canvas element, for an HTML tooltip. */
  screenX: number;
  screenY: number;
}

/** How far apart, in tiles, two moored ships sit. */
const SHIP_SPACING = 3;

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

  private dragOrigin?: { x: number; y: number };
  private pressOrigin?: { x: number; y: number };
  private hasFitCamera = false;
  /** Continuous zoom, accumulated across wheel events. */
  private zoomTarget = 1;
  /** Which city's snapshot the scene currently holds, if any. */
  private currentCityId?: string;

  private overlay?: PullRequestOverlay;
  /** Scaffold ring markers for added buildings, keyed by path. */
  private addedMarkers = new Map<string, Phaser.GameObjects.Sprite>();
  /** Looping glow for modified buildings, keyed by path. */
  private modifiedGlows = new Map<string, Phaser.GameObjects.Sprite>();
  private rubbleSprites: Phaser.GameObjects.Sprite[] = [];

  /** Ships link main to PR cities and provide every PR city a way home. */
  private lastCities: CitySummary[] = [];
  private shipSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private shipHoverListener?: (info?: ShipHoverInfo) => void;
  private shipClickListener?: (cityId: string) => void;
  /** Individually drawn puffs; every travel creates a new set of silhouettes. */
  private transitionClouds: Phaser.GameObjects.Graphics[] = [];
  /** Whiteout layer beneath the clouds; it guarantees a fully covered map. */
  private transitionCloudVeil?: Phaser.GameObjects.Rectangle;

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
  }

  setSelectionListener(listener: (building?: Building) => void): void {
    this.selectionListener = listener;
  }

  setShipHoverListener(listener: (info?: ShipHoverInfo) => void): void {
    this.shipHoverListener = listener;
  }

  setShipClickListener(listener: (cityId: string) => void): void {
    this.shipClickListener = listener;
  }

  /**
   * The current PR roster. Every city gets a harbor: main has one ship per
   * open PR, while a PR city has one return ship. If cities arrive before the
   * first world snapshot, layoutShips no-ops until setWorld has a snapshot.
   */
  setCities(cities: readonly CitySummary[]): void {
    this.lastCities = [...cities];
    if (this.currentCityId) {
      this.layoutShips();
    }
  }

  /**
   * cityId identifies which city this snapshot belongs to. When it differs
   * from the city the scene currently holds, every per-world sprite and flag
   * is torn down first (resetWorld) rather than diffed against the outgoing
   * city's buildings -- diffing two unrelated cities by path would treat
   * every building as a coincidental match or a stale ghost.
   */
  setWorld(snapshot: WorldSnapshot, cityId: string): void {
    if (!this.scene.isActive()) {
      this.events.once(Phaser.Scenes.Events.CREATE, () =>
        this.setWorld(snapshot, cityId),
      );
      return;
    }

    if (this.currentCityId !== undefined && this.currentCityId !== cityId) {
      this.resetWorld();
    }
    this.currentCityId = cityId;

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
    // Rebuilds marker sprites against whatever views syncBuildings just
    // produced -- a structural change replaces a building's sprite outright,
    // so a marker positioned off the old sprite would be orphaned.
    this.applyOverlay();

    this.layoutShips();

    // hasFitCamera is reset to false by resetWorld() above, so this also
    // refits the camera for every newly-arrived city, not just the first
    // snapshot the scene ever sees.
    if (!this.hasFitCamera) {
      this.fitCamera();
      this.hasFitCamera = true;
    }
  }

  /**
   * A PR city's diff against main: added buildings get a scaffold ring,
   * modified buildings a looping glow, deleted files a rubble sprite at
   * their old plot. Call after setWorld (or standalone once an overlay
   * arrives later than the world did) -- either order is safe since this
   * only reads views/snapshot, never mutates them.
   */
  setOverlay(overlay: PullRequestOverlay | undefined): void {
    this.overlay = overlay;
    this.applyOverlay();
  }

  private applyOverlay(): void {
    for (const marker of this.addedMarkers.values()) {
      marker.destroy();
    }
    this.addedMarkers.clear();
    for (const glow of this.modifiedGlows.values()) {
      this.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.modifiedGlows.clear();
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
        const marker = this.add
          .sprite(view.sprite.x, view.sprite.y, SCAFFOLD_KEY)
          .setOrigin(0.5, 1)
          .setDepth(view.sprite.depth - 1);
        this.addedMarkers.set(view.building.path, marker);
      } else if (change === "modified") {
        view.sprite.setTint(MODIFIED_TINT);
        const glow = this.add
          .sprite(view.sprite.x, view.sprite.y, SELECT_KEY)
          .setOrigin(0.5, 1)
          .setDepth(view.sprite.depth - 1)
          .setTint(MODIFIED_GLOW_TINT);
        this.tweens.add({
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
    }

    for (const rubble of rubbleMarkers(overlay)) {
      const point = projection.project(rubble.plot.x, rubble.plot.y);
      this.rubbleSprites.push(
        this.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, RUBBLE_KEY)
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(rubble.plot.x, rubble.plot.y)),
      );
    }
  }

  /**
   * Tears down every sprite and flag that belongs to the outgoing city
   * before a different city's snapshot lands. Destroys immediately rather
   * than tweening demolition, so rapidly switching cities never leaves a
   * ghost sprite from a still-in-flight demolish() tween. Clearing
   * hasFitCamera here is what makes setWorld refit the camera and skip the
   * "new construction" rise tween for the incoming city's first snapshot --
   * both already gated on that one flag.
   */
  private resetWorld(): void {
    for (const view of this.views.values()) {
      this.tweens.killTweensOf(view.sprite);
      this.ambient?.releaseSmoke(view.sprite);
      view.sprite.destroy();
    }
    this.views.clear();

    for (const sprite of this.groundSprites) {
      sprite.destroy();
    }
    for (const sprite of this.propSprites) {
      sprite.destroy();
    }
    this.groundSprites = [];
    this.propSprites = [];

    for (const marker of this.addedMarkers.values()) {
      marker.destroy();
    }
    this.addedMarkers.clear();
    for (const glow of this.modifiedGlows.values()) {
      this.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.modifiedGlows.clear();
    for (const rubble of this.rubbleSprites) {
      rubble.destroy();
    }
    this.rubbleSprites = [];
    this.overlay = undefined;

    this.clearShips();

    this.select(undefined);
    this.snapshot = undefined;
    this.terrain = undefined;
    this.hasFitCamera = false;
    this.dragOrigin = undefined;
    this.pressOrigin = undefined;
  }

  /**
   * Immediate feedback for an agent edit. The authoritative rescan follows and
   * lands through setWorld; this only animates what is already standing.
   * cityId is checked against the scene's current city so a file.changed
   * event that arrives just after a travel -- for a city the scene has
   * already left -- cannot animate the wrong city's building.
   */
  applyFileChange(path: string, change: FileChange, cityId: string): void {
    if (this.currentCityId !== cityId) {
      return;
    }
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
    sprite.setInteractive({ pixelPerfect: true });
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
    this.ambient?.releaseSmoke(view.sprite);
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
    });

    const endDrag = (pointer: Phaser.Input.Pointer): void => {
      const press = this.pressOrigin;
      this.dragOrigin = undefined;
      this.pressOrigin = undefined;
      if (!press) {
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

  // -------------------------------------------------------------------------
  // Ships and city travel
  // -------------------------------------------------------------------------

  /**
   * Moors one ship per open PR just past main's east coast. In a PR city a
   * single, west-coast ship returns to main. Reuses sprites by destination
   * city id so a roster refresh does not make ships flicker.
   */
  private layoutShips(): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return;
    }
    const isMain = this.currentCityId === "main";
    const destinations = isMain
      ? this.lastCities.filter((city) => city.kind === "pull-request")
      : [{ id: "main", title: "main city" }];
    const { width, height } = snapshot.size;
    // Just past the sand ring, safely in open water. The return ship docks
    // on the opposite shore so its departure also reads as heading home.
    const dockX = isMain
      ? width - 1 + COUNTRYSIDE_RING + COAST_RING + 2
      : -COUNTRYSIDE_RING - COAST_RING - 2;
    const startY =
      height / 2 - ((destinations.length - 1) * SHIP_SPACING) / 2;

    const seen = new Set<string>();
    destinations.forEach((city, index) => {
      seen.add(city.id);
      const gy = startY + index * SHIP_SPACING;
      const point = projection.project(dockX, gy);

      let sprite = this.shipSprites.get(city.id);
      if (!sprite) {
        sprite = this.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, SHIP_KEY)
          .setOrigin(0.5, 1)
          .setScale(1.55)
          .setInteractive({ useHandCursor: true });
        this.shipSprites.set(city.id, sprite);
        this.bindShipInteractions(sprite, city.id);
      } else {
        this.tweens.killTweensOf(sprite);
      }

      sprite
        .setPosition(point.x, point.y + TILE_ANCHOR_Y)
        .setDepth(projection.depth(dockX, gy))
        .setAlpha(1);
      sprite.setData("title", city.title);
      sprite.setData("returning", !isMain);

      const restY = sprite.y;
      this.tweens.add({
        targets: sprite,
        y: restY - 4,
        duration: 1_400 + index * 90,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    });

    for (const [cityId, sprite] of this.shipSprites) {
      if (!seen.has(cityId)) {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
        this.shipSprites.delete(cityId);
      }
    }
  }

  private bindShipInteractions(
    sprite: Phaser.GameObjects.Sprite,
    cityId: string,
  ): void {
    sprite.on("pointerover", () => {
      const camera = this.cameras.main;
      this.shipHoverListener?.({
        cityId,
        title: String(sprite.getData("title") ?? cityId),
        action: sprite.getData("returning")
          ? "Return to main city"
          : `Sail to ${String(sprite.getData("title") ?? cityId)}`,
        screenX: (sprite.x - camera.scrollX) * camera.zoom,
        screenY: (sprite.y - camera.scrollY) * camera.zoom,
      });
    });
    sprite.on("pointerout", () => {
      this.shipHoverListener?.(undefined);
    });
    sprite.on("pointerdown", () => {
      playUiClickSound();
      this.shipHoverListener?.(undefined);
      this.shipClickListener?.(cityId);
    });
  }

  private clearShips(): void {
    for (const sprite of this.shipSprites.values()) {
      this.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.shipSprites.clear();
    this.shipHoverListener?.(undefined);
  }

  /** Sails the clicked ship away from the island and out of view. */
  private playShipDeparture(cityId: string): Promise<void> {
    const sprite = this.shipSprites.get(cityId);
    if (!sprite) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.killTweensOf(sprite);
      this.tweens.add({
        targets: sprite,
        x: sprite.x + (this.currentCityId === "main" ? 300 : -300),
        y: sprite.y - 60,
        alpha: 0,
        duration: 700,
        ease: "Cubic.easeIn",
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * A random cloud swarm drifts across the map before it fades to white. The
   * final white veil fills the Phaser viewport exactly, so the city cannot
   * show through between puffs or on an unusually shaped canvas.
   */
  private playCoverTransition(): Promise<void> {
    const camera = this.cameras.main;
    this.clearTransitionClouds();

    const veil = this.add
      .rectangle(0, 0, camera.width, camera.height, 0xffffff, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(SKY_DEPTH + 9);
    this.transitionCloudVeil = veil;
    const cloudCount = Phaser.Math.Clamp(
      Math.round((camera.width * camera.height) / 42_000),
      14,
      24,
    );

    return new Promise((resolve) => {
      let finishedClouds = 0;
      let veilFinished = false;
      const finishIfWhite = (): void => {
        if (veilFinished && finishedClouds === cloudCount) {
          resolve();
        }
      };

      this.tweens.add({
        targets: veil,
        alpha: WHITEOUT_ALPHA,
        delay: 320,
        duration: 820,
        ease: "Sine.easeInOut",
        onComplete: () => {
          veilFinished = true;
          finishIfWhite();
        },
      });

      for (let index = 0; index < cloudCount; index += 1) {
        // The cloud shapes are intentionally enormous: their irregular
        // silhouettes read as a weather front sweeping over the whole map.
        const cloudSize = Phaser.Math.Between(1_500, 3_000);
        const start = randomCloudEdge(camera, cloudSize);
        const cloud = this.createTransitionCloud(
          cloudSize,
          SKY_DEPTH + 10 + index,
        )
          .setPosition(start.x, start.y)
          .setAlpha(0);
        this.transitionClouds.push(cloud);

        const restingX = Phaser.Math.Between(
          -Math.round(cloudSize * 0.25),
          camera.width + Math.round(cloudSize * 0.25),
        );
        const restingY = Phaser.Math.Between(
          -Math.round(cloudSize * 0.2),
          camera.height + Math.round(cloudSize * 0.2),
        );
        this.tweens.add({
          targets: cloud,
          x: restingX,
          y: restingY,
          alpha: Phaser.Math.FloatBetween(0.38, 0.7),
          duration: Phaser.Math.Between(520, 900),
          delay: Phaser.Math.Between(0, 420),
          ease: "Sine.easeOut",
          onComplete: () => {
            finishedClouds += 1;
            finishIfWhite();
          },
        });
      }
    });
  }

  /**
   * Departs the clicked ship, then covers the screen in cloud. Resolves once
   * fully covered -- the caller swaps to the new city's snapshot at that
   * point, hidden behind the cover, then calls revealAfterTravel.
   */
  async coverForTravel(cityId: string): Promise<void> {
    await this.playShipDeparture(cityId);
    await this.playCoverTransition();
  }

  /**
   * Positions the destination harbor ship outside the frame before the cloud
   * cover parts. revealAfterTravel then sails it into port, making the trip
   * visibly continue into the new city instead of ending at a hard swap.
   */
  prepareArrivalForTravel(
    departureCityId: string | undefined,
    destinationCityId: string,
  ): void {
    const shipId = destinationCityId === "main" ? departureCityId : "main";
    if (!shipId) {
      return;
    }
    const ship = this.shipSprites.get(shipId);
    if (!ship) {
      return;
    }
    this.tweens.killTweensOf(ship);
    ship.setData("arrivalX", ship.x);
    ship.setData("arrivalY", ship.y);
    ship.setPosition(
      ship.x + (destinationCityId === "main" ? 300 : -300),
      ship.y - 55,
    );
  }

  /** Parts the cloud cover to reveal whatever city has landed underneath. */
  revealAfterTravel(): Promise<void> {
    const clouds = this.transitionClouds;
    this.transitionClouds = [];
    const veil = this.transitionCloudVeil;
    this.transitionCloudVeil = undefined;
    if (clouds.length === 0 && !veil) {
      return Promise.resolve();
    }

    const camera = this.cameras.main;
    return new Promise((resolve) => {
      let remaining = clouds.length + (veil ? 1 : 0);
      const finishReveal = (): void => {
        remaining -= 1;
        if (remaining === 0) {
          void this.playShipArrival().then(resolve);
        }
      };

      if (veil) {
        this.tweens.add({
          targets: veil,
          alpha: 0,
          duration: 780,
          delay: WHITEOUT_HOLD_MS,
          ease: "Sine.easeInOut",
          onComplete: () => {
            veil.destroy();
            finishReveal();
          },
        });
      }

      clouds.forEach((cloud) => {
        const exit = randomCloudEdge(
          camera,
          cloud.getData("travelSize") as number,
        );
        // Keep the exact position reached during the cover phase. The return
        // journey therefore visibly retraces from the settled cloud field,
        // rather than popping to a new random point before flying outward.
        this.tweens.add({
          targets: cloud,
          x: exit.x,
          y: exit.y,
          alpha: 0,
          duration: Phaser.Math.Between(520, 920),
          delay: WHITEOUT_HOLD_MS + Phaser.Math.Between(0, 260),
          ease: "Sine.easeIn",
          onComplete: () => {
            cloud.destroy();
            finishReveal();
          },
        });
      });
    });
  }

  private clearTransitionClouds(): void {
    for (const cloud of this.transitionClouds) {
      this.tweens.killTweensOf(cloud);
      cloud.destroy();
    }
    this.transitionClouds = [];
    if (this.transitionCloudVeil) {
      this.tweens.killTweensOf(this.transitionCloudVeil);
      this.transitionCloudVeil.destroy();
      this.transitionCloudVeil = undefined;
    }
  }

  /** Draws an irregular puff silhouette; no two transition clouds match. */
  private createTransitionCloud(
    size: number,
    depth: number,
  ): Phaser.GameObjects.Graphics {
    const cloud = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(depth);
    const puffs = Array.from(
      { length: Phaser.Math.Between(4, 8) },
      () => ({
        x: Phaser.Math.FloatBetween(-size * 0.55, size * 0.55),
        y: Phaser.Math.FloatBetween(-size * 0.18, size * 0.18),
        radius: Phaser.Math.FloatBetween(size * 0.16, size * 0.32),
      }),
    );

    cloud.fillStyle(0xcfe5f7, 0.52);
    for (const puff of puffs) {
      cloud.fillCircle(puff.x + size * 0.035, puff.y + size * 0.06, puff.radius);
    }
    cloud.fillStyle(0xffffff, 0.95);
    for (const puff of puffs) {
      cloud.fillCircle(puff.x, puff.y, puff.radius);
    }
    cloud.setData("travelSize", size);
    return cloud;
  }

  private playShipArrival(): Promise<void> {
    const arrivals: Phaser.GameObjects.Sprite[] = [];
    for (const ship of this.shipSprites.values()) {
      const arrivalX = ship.getData("arrivalX") as number | undefined;
      const arrivalY = ship.getData("arrivalY") as number | undefined;
      if (arrivalX === undefined || arrivalY === undefined) {
        continue;
      }
      arrivals.push(ship);
    }
    if (arrivals.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let remaining = arrivals.length;
      arrivals.forEach((ship) => {
        const arrivalX = ship.getData("arrivalX") as number;
        const arrivalY = ship.getData("arrivalY") as number;
        ship.data?.remove(["arrivalX", "arrivalY"]);
        this.tweens.add({
          targets: ship,
          x: arrivalX,
          y: arrivalY,
          duration: 900,
          ease: "Sine.easeOut",
          onComplete: () => {
            this.tweens.add({
              targets: ship,
              y: arrivalY - 6,
              duration: 1_400,
              yoyo: true,
              repeat: -1,
              ease: "Sine.easeInOut",
            });
            remaining -= 1;
            if (remaining === 0) {
              resolve();
            }
          },
        });
      });
    });
  }
}

/** Returns a random point just beyond one edge of the screen-fixed viewport. */
function randomCloudEdge(
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
