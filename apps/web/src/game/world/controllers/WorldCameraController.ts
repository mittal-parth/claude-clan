import Phaser from "phaser";
import type { Building, WorldSnapshot } from "@sudo-city/protocol";
import {
  CLICK_SLOP,
  FOCUS_DURATION_MS,
  FOCUS_ZOOM,
  HIGHLIGHT_DEPTH,
  MAX_ZOOM,
  MIN_ZOOM,
  projection,
  SELECT_KEY,
  HIGHLIGHT_KEY,
} from "../core/worldConstants";
import { wheelSteps } from "../core/worldMath";
import { isCanvasPointer } from "../utils/pointerUtils";
import type { AirportLayout } from "../../layouts/airport";
import type { TerrainCell, TerrainGrid } from "../../layouts/terrain";
import { TILE_HEIGHT, TILE_WIDTH, TILE_ANCHOR_Y } from "../../textures/core";
import { playUiClickSound } from "@/lib/play-ui-click";
import type { WorldBuildingManager } from "../entities/buildings/WorldBuildingManager";

export class WorldCameraController {
  public lastCameraInputAt = Number.NEGATIVE_INFINITY;
  public zoomTarget = 1;
  public focusTween?: Phaser.Tweens.Tween;

  private dragOrigin?: { x: number; y: number };
  private pressOrigin?: { x: number; y: number };
  private highlight?: Phaser.GameObjects.Sprite;
  private selectionMarker?: Phaser.GameObjects.Sprite;
  private selectedPath?: string;

  private selectionListener?: (building?: Building) => void;
  private buildingDragListener?: (building: Building) => void;

  private pressedBuilding?: Building;
  private draggingBuilding?: Building;

  constructor(
    private scene: Phaser.Scene,
    private getBuildingManager: () => WorldBuildingManager,
    private getTerrain: () => TerrainGrid | undefined,
    private isTravelTransitionActive: () => boolean,
  ) {}

  initHighlightAndSelection(): void {
    this.highlight = this.scene.add
      .sprite(0, 0, HIGHLIGHT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(HIGHLIGHT_DEPTH)
      .setVisible(false);
    this.selectionMarker = this.scene.add
      .sprite(0, 0, SELECT_KEY)
      .setOrigin(0.5, 1)
      .setDepth(HIGHLIGHT_DEPTH + 1)
      .setVisible(false);
  }

  setSelectionListener(listener: (building?: Building) => void): void {
    this.selectionListener = listener;
  }

  setBuildingDragListener(listener: (building: Building) => void): void {
    this.buildingDragListener = listener;
  }

  getSelectedPath(): string | undefined {
    return this.selectedPath;
  }

  getPressedBuilding(): Building | undefined {
    return this.pressedBuilding;
  }

  getDraggingBuilding(): Building | undefined {
    return this.draggingBuilding;
  }

  setPressedBuilding(b?: Building): void {
    this.pressedBuilding = b;
  }

  setDraggingBuilding(b?: Building): void {
    this.draggingBuilding = b;
  }

  resetInputState(): void {
    this.dragOrigin = undefined;
    this.pressOrigin = undefined;
    this.pressedBuilding = undefined;
    this.draggingBuilding = undefined;
    this.highlight?.setVisible(false);
  }

  noteCameraInput(): void {
    this.lastCameraInputAt = this.scene.time.now;
    this.focusTween?.stop();
    this.focusTween = undefined;
  }

  applyCameraBounds(terrain: TerrainGrid): void {
    const { minX, minY, maxX, maxY } = terrain.bounds;
    const left = projection.project(minX, maxY).x - TILE_WIDTH;
    const right = projection.project(maxX, minY).x + TILE_WIDTH;
    const top = projection.project(minX, minY).y - TILE_HEIGHT * 6;
    const bottom = projection.project(maxX, maxY).y + TILE_HEIGHT * 2;

    this.scene.cameras.main.setBounds(left, top, right - left, bottom - top);
  }

  fitCamera(snapshot: WorldSnapshot, airport: AirportLayout): void {
    const camera = this.scene.cameras.main;
    const margin = 4;
    const cityMinX = -margin;
    const cityMinY = -margin;
    const cityMaxX = snapshot.size.width - 1 + margin;
    const cityMaxY = snapshot.size.height - 1 + margin;
    const points = [
      projection.project(cityMinX, cityMinY),
      projection.project(cityMaxX, cityMinY),
      projection.project(cityMaxX, cityMaxY),
      projection.project(cityMinX, cityMaxY),
      projection.project(airport.runwayStart.x - 0.8, airport.runwayStart.y + 0.9),
      projection.project(airport.runwayEnd.x + 0.8, airport.runwayEnd.y - 0.9),
      projection.project(airport.apron.x - 2.4, airport.apron.y + 1.6),
    ];
    const terminal = projection.project(airport.terminal.x, airport.terminal.y);
    const tower = projection.project(airport.tower.x, airport.tower.y);
    const left = Math.min(...points.map((point) => point.x)) - 40;
    const right = Math.max(...points.map((point) => point.x)) + 40;
    const top = Math.min(
      ...points.map((point) => point.y),
      terminal.y - 175,
      tower.y - 232,
    ) - 24;
    const bottom = Math.max(...points.map((point) => point.y)) + 44;
    const width = Math.max(TILE_WIDTH, right - left);
    const height = Math.max(TILE_HEIGHT, bottom - top);
    const viewportPadding = 40;

    this.zoomTarget = Phaser.Math.Clamp(
      Math.min(
        Math.max(1, camera.width - viewportPadding * 2) / width,
        Math.max(1, camera.height - viewportPadding * 2) / height,
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    camera.setZoom(this.zoomTarget);
    camera.centerOn((left + right) / 2, (top + bottom) / 2);
  }

  moveCameraTo(
    x: number,
    y: number,
    zoom: number,
    onArrive?: () => void,
  ): void {
    this.focusTween?.stop();
    this.focusTween = undefined;

    const camera = this.scene.cameras.main;
    const targetZoom = Phaser.Math.Clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const startScrollX = camera.scrollX;
    const startScrollY = camera.scrollY;
    const startZoom = camera.zoom;

    camera.setZoom(targetZoom);
    camera.centerOn(x, y);
    const targetScrollX = camera.scrollX;
    const targetScrollY = camera.scrollY;

    camera.setZoom(startZoom);
    camera.scrollX = startScrollX;
    camera.scrollY = startScrollY;

    this.focusTween = this.scene.tweens.add({
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
        onArrive?.();
      },
    });
  }

  focusBuilding(path: string): boolean {
    const bm = this.getBuildingManager();
    const view = bm.getViews().get(path);
    if (!view) {
      return false;
    }

    playUiClickSound();
    this.moveCameraTo(view.sprite.x, view.sprite.y, FOCUS_ZOOM, () =>
      this.select(path),
    );
    return true;
  }

  select(path?: string): void {
    const bm = this.getBuildingManager();
    const views = bm.getViews();
    const previous = this.selectedPath
      ? views.get(this.selectedPath)
      : undefined;
    previous?.sprite.clearTint();

    this.selectedPath = path;
    const view = path ? views.get(path) : undefined;

    if (this.selectionMarker) {
      if (view) {
        this.selectionMarker
          .setPosition(view.sprite.x, view.sprite.y)
          .setDepth(view.sprite.depth + 1)
          .setVisible(true);
      } else {
        this.selectionMarker.setVisible(false);
      }
    }

    view?.sprite.setTint(0xffd9a0);
    this.selectionListener?.(view?.building);
  }

  cellAtPointer(pointer: Phaser.Input.Pointer): TerrainCell | undefined {
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const grid = projection.unproject(world.x, world.y);
    return this.getTerrain()?.cellAt(Math.round(grid.x), Math.round(grid.y));
  }

  buildingAtPointer(pointer: Phaser.Input.Pointer): Building | undefined {
    const bm = this.getBuildingManager();
    const views = bm.getViews();
    const hits = this.scene.input
      .hitTestPointer(pointer)
      .filter(
        (object): object is Phaser.GameObjects.Sprite =>
          object instanceof Phaser.GameObjects.Sprite &&
          typeof object.getData("path") === "string",
      )
      .sort((left, right) => right.depth - left.depth);

    for (const hit of hits) {
      const view = views.get(String(hit.getData("path")));
      if (view) {
        return view.building;
      }
    }
    return undefined;
  }

  moveHighlight(pointer: Phaser.Input.Pointer): void {
    if (!this.highlight) {
      return;
    }

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

  bindCamera(): void {
    this.scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isTravelTransitionActive()) return;
      // A press on the HUD, a dialog or the login card is not a press on the
      // city -- see isCanvasPointer. Starting a camera drag from one made the
      // world lurch under a dialog the moment the mouse moved.
      if (!isCanvasPointer(pointer)) return;
      this.dragOrigin = { x: pointer.x, y: pointer.y };
      this.pressOrigin = { x: pointer.x, y: pointer.y };
      this.pressedBuilding = this.buildingAtPointer(pointer);
      this.draggingBuilding = undefined;
    });

    const endDrag = (pointer: Phaser.Input.Pointer): void => {
      if (this.isTravelTransitionActive()) {
        this.dragOrigin = undefined;
        this.pressOrigin = undefined;
        return;
      }
      const press = this.pressOrigin;
      const draggedBuilding = this.draggingBuilding;
      const bm = this.getBuildingManager();
      bm.clearDragPreview();
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

    this.scene.input.on("pointerup", endDrag);
    this.scene.input.on("pointerupoutside", endDrag);

    this.scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.isTravelTransitionActive()) return;
      const bm = this.getBuildingManager();
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
          bm.beginDragPreview(this.draggingBuilding, pointer);
          this.buildingDragListener?.(this.draggingBuilding);
        }
        if (this.draggingBuilding) {
          bm.moveDragPreview(pointer);
          this.moveHighlight(pointer);
          return;
        }

        const camera = this.scene.cameras.main;
        camera.scrollX -= (pointer.x - this.dragOrigin.x) / camera.zoom;
        camera.scrollY -= (pointer.y - this.dragOrigin.y) / camera.zoom;
        this.dragOrigin = { x: pointer.x, y: pointer.y };
        this.noteCameraInput();
        return;
      }
      this.moveHighlight(pointer);
    });

    this.scene.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _objects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        if (this.isTravelTransitionActive()) return;
        const camera = this.scene.cameras.main;
        this.noteCameraInput();
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
}
