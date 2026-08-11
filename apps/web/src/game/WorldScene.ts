import type {
  Building,
  CitySummary,
  Issue,
  PullRequestOverlay,
  WorldSnapshot,
} from "@sudo-city/protocol";
import Phaser from "phaser";
import { AmbientLife, prefersReducedMotion } from "./systems/ambient";
import { ConstructionSites, type ConstructionTarget } from "./systems/construction";
import { shouldRevealSite } from "./math/reveal";
import { CRANE_HEIGHT } from "./layouts/crane";
import { buildTerrain } from "./layouts/terrain";
import { bakeTerrainTextures } from "./textures/init";
import { bakeCapitol } from "./textures/capitol/base";

import {
  OPEN_WATER,
  CONSTRUCTION_LEGIBLE_ZOOM,
  FOCUS_ZOOM,
  CAMERA_YIELD_MS,
  GROUND_DEPTH,
  TRAFFIC_DEPTH,
  SKY_DEPTH,
  projection,
} from "./world/core/worldConstants";
import {
  terrainChanged,
  variantFor,
} from "./world/core/worldMath";

import { WorldCameraController } from "./world/controllers/WorldCameraController";
import { WorldTerrainManager } from "./world/entities/terrain/WorldTerrainManager";
import { WorldBuildingManager } from "./world/entities/buildings/WorldBuildingManager";
import { WorldHarbourManager } from "./world/entities/facilities/WorldHarbourManager";
import { WorldNavyManager } from "./world/entities/facilities/WorldNavyManager";
import { WorldAirportManager } from "./world/entities/facilities/WorldAirportManager";
import { WorldIssueShopManager } from "./world/entities/facilities/WorldIssueShopManager";
import { WorldTransitionManager } from "./world/effects/WorldTransitionManager";

export { OPEN_WATER };
export { variantFor };

export type FileChange = "added" | "modified" | "deleted";

export interface ShipHoverInfo {
  cityId: string;
  title: string;
  action: string;
  /** Position relative to the canvas element, for an HTML tooltip. */
  screenX: number;
  screenY: number;
}

export class WorldScene extends Phaser.Scene {
  public buildingManager = new WorldBuildingManager(this);
  public terrainManager = new WorldTerrainManager(this, () => this.travelTransitionActive);
  public cameraController = new WorldCameraController(
    this,
    () => this.buildingManager,
    () => this.terrainManager.terrain,
    () => this.travelTransitionActive,
  );
  public harbourManager = new WorldHarbourManager(this, () => this.travelTransitionActive);
  public navyManager = new WorldNavyManager(this, () => this.travelTransitionActive);
  public airportManager = new WorldAirportManager(this, () => this.travelTransitionActive);
  public issueShopManager = new WorldIssueShopManager(
    this,
    () => this.currentCityId,
    () => this.snapshot,
  );
  public transitionManager = new WorldTransitionManager(this);

  private snapshot?: WorldSnapshot;
  private ambient?: AmbientLife;
  private construction?: ConstructionSites;

  private buildingPaths: string[] = [];
  private sitedPaths = new Set<string>();
  private crewUrl?: string;

  private hasFitCamera = false;
  private currentCityId?: string;
  private currentWorldKey?: string;
  private travelTransitionActive = false;

  constructor() {
    super("world");
  }

  get zoomTarget(): number {
    return this.cameraController.zoomTarget;
  }

  set zoomTarget(val: number) {
    if (this.cameraController) {
      this.cameraController.zoomTarget = val;
    }
  }

  create(): void {
    bakeTerrainTextures(this);
    bakeCapitol(this);

    this.cameras.main.setBackgroundColor(OPEN_WATER);

    this.cameraController.initHighlightAndSelection();

    this.ambient = new AmbientLife(this, projection, {
      ground: GROUND_DEPTH,
      traffic: TRAFFIC_DEPTH,
      sky: SKY_DEPTH,
    });
    this.construction = new ConstructionSites(this, prefersReducedMotion());

    this.loadCrewSprite(this.crewUrl);
    this.cameraController.bindCamera();
    this.events.once("shutdown", () => this.cancelBuildingDrag());
  }

  setSelectionListener(listener: (building?: Building) => void): void {
    this.cameraController.setSelectionListener(listener);
  }

  setNavyShipHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.navyManager.setNavyShipHoverListener(listener);
  }

  setNavyShipClickListener(listener?: () => void): void {
    this.navyManager.setNavyShipClickListener(listener);
  }

  setNavySignClickListener(listener?: () => void): void {
    this.navyManager.setNavySignClickListener(listener);
  }

  setAirportHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.airportManager.setAirportHoverListener(listener);
  }

  setAirportClickListener(listener?: () => void): void {
    this.airportManager.setAirportClickListener(listener);
  }

  setCapitolClickListener(listener?: () => void): void {
    this.terrainManager.setCapitolClickListener(listener);
  }

  setCapitolHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.terrainManager.setCapitolHoverListener(listener);
  }

  setHarbourShipClickListener(listener?: () => void): void {
    this.harbourManager.setHarbourShipClickListener(listener);
  }

  setHarbourShipHoverListener(listener?: (info?: ShipHoverInfo) => void): void {
    this.harbourManager.setHarbourShipHoverListener(listener);
  }

  setHarbourSignClickListener(listener?: () => void): void {
    this.harbourManager.setHarbourSignClickListener(listener);
  }

  setTravelTransitionActive(active: boolean): void {
    this.travelTransitionActive = active;
    if (active) {
      this.cancelBuildingDrag();
      this.cameraController.resetInputState();
      this.navyManager.clearHover();
      this.airportManager.clearHover();
    }
  }

  resizeTravelCover(width: number, height: number): void {
    this.transitionManager.resizeTravelCover(width, height);
  }

  resizeViewport(width: number, height: number): void {
    this.resizeTravelCover(width, height);
    if (
      this.snapshot &&
      !this.cameraController.focusTween &&
      this.cameraController.lastCameraInputAt === Number.NEGATIVE_INFINITY
    ) {
      this.fitCamera();
    }
  }

  setIssues(issues: readonly Issue[]): void {
    this.issueShopManager.setIssues(issues);
  }

  setCities(_cities: readonly CitySummary[]): void {}

  setBuildingPaths(paths: string[]): void {
    this.buildingPaths = paths;
    this.syncConstruction();
  }

  setCrewSprite(url?: string): void {
    if (url === this.crewUrl) {
      return;
    }
    this.crewUrl = url;
    if (this.construction) {
      this.loadCrewSprite(url);
    }
  }

  private loadCrewSprite(url?: string): void {
    if (!url) {
      this.construction?.setCrewTexture(undefined);
      return;
    }

    const key = `crew:${url}`;
    if (this.textures.exists(key)) {
      this.construction?.setCrewTexture(key);
      return;
    }

    this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.crewUrl === url && this.textures.exists(key)) {
        this.construction?.setCrewTexture(key);
      }
    });
    this.load.start();
  }

  private syncConstruction(): void {
    if (!this.construction) {
      return;
    }

    const views = this.buildingManager.getViews();
    const targets: ConstructionTarget[] = [];
    for (const path of this.buildingPaths) {
      const view = views.get(path);
      if (!view) {
        continue;
      }
      targets.push({
        path,
        x: view.sprite.x,
        y: view.sprite.y,
        depth: view.sprite.depth,
        height: view.sprite.height,
      });
    }

    const opened = targets.find((target) => !this.sitedPaths.has(target.path));
    this.sitedPaths = new Set(targets.map((target) => target.path));

    for (const path of this.sitedPaths) {
      this.buildingManager.removeDiffScaffold(path);
    }

    this.construction.sync(targets);

    if (opened) {
      this.revealConstruction(opened);
    }
  }

  private revealConstruction(target: ConstructionTarget): void {
    const camera = this.cameras.main;

    const move = shouldRevealSite(
      target,
      {
        x: camera.worldView.x,
        y: camera.worldView.y,
        right: camera.worldView.right,
        bottom: camera.worldView.bottom,
        zoom: camera.zoom,
      },
      {
        margin: CRANE_HEIGHT,
        legibleZoom: CONSTRUCTION_LEGIBLE_ZOOM,
        now: this.time.now,
        lastCameraInputAt: this.cameraController.lastCameraInputAt,
        yieldMs: CAMERA_YIELD_MS,
      },
    );
    if (!move) {
      return;
    }

    this.cameraController.moveCameraTo(
      target.x,
      target.y - CRANE_HEIGHT / 2,
      FOCUS_ZOOM,
    );
  }

  setBuildingDragListener(listener: (building: Building) => void): void {
    this.cameraController.setBuildingDragListener(listener);
  }

  getBuildingPreviewSource(building: Building): string | undefined {
    return this.buildingManager.getBuildingPreviewSource(building);
  }

  cancelBuildingDrag(): void {
    this.buildingManager.clearDragPreview();
    this.cameraController.resetInputState();
  }

  focusBuilding(path: string): boolean {
    return this.cameraController.focusBuilding(path);
  }

  fitCamera(): void {
    if (!this.snapshot) return;
    const airport = this.airportManager.airportLayout(this.snapshot);
    this.cameraController.fitCamera(this.snapshot, airport);
  }

  setWorld(snapshot: WorldSnapshot, cityId: string, worldKey = cityId): void {
    if (!this.scene?.isActive()) {
      if (this.events) {
        this.events.once(Phaser.Scenes.Events.CREATE, () =>
          this.setWorld(snapshot, cityId, worldKey),
        );
      }
      return;
    }

    if (
      this.currentWorldKey !== undefined &&
      (this.currentWorldKey !== worldKey || this.currentCityId !== cityId)
    ) {
      this.resetWorld();
    }
    this.currentWorldKey = worldKey;
    this.currentCityId = cityId;

    const previous = this.snapshot;
    this.snapshot = snapshot;

    if (!previous || terrainChanged(previous, snapshot)) {
      this.terrainManager.drawTerrain(buildTerrain(snapshot), snapshot.size);
      if (this.terrainManager.terrain) {
        this.cameraController.applyCameraBounds(this.terrainManager.terrain);
        this.ambient?.rebuild(this.terrainManager.terrain);
      }
    }

    this.buildingManager.syncBuildings(
      snapshot,
      this.hasFitCamera,
      this.terrainManager.terrain,
      this.ambient,
    );
    const selected = this.cameraController.getSelectedPath();
    if (selected && !this.buildingManager.getViews().has(selected)) {
      this.cameraController.select(undefined);
    }
    this.buildingManager.applyOverlay(this.sitedPaths);
    this.syncConstruction();

    this.harbourManager.layoutHarbour(snapshot, this.currentCityId);
    this.issueShopManager.layoutIssueShop();
    this.navyManager.layoutNavyHarbour(snapshot, this.currentCityId);
    this.airportManager.layoutAirport(
      snapshot,
      this.terrainManager.terrain?.roads ?? [],
    );

    if (!this.hasFitCamera) {
      this.fitCamera();
      this.hasFitCamera = true;
    }
  }

  setOverlay(overlay: PullRequestOverlay | undefined): void {
    this.buildingManager.setOverlay(overlay, this.sitedPaths);
  }

  private resetWorld(): void {
    this.construction?.clear();
    this.sitedPaths.clear();
    this.cameraController.focusTween?.stop();
    this.cameraController.focusTween = undefined;
    this.cancelBuildingDrag();

    this.buildingManager.clear(this.ambient);
    this.terrainManager.clear();
    this.terrainManager.terrain = undefined;
    this.navyManager.clearNavyHarbour();
    this.issueShopManager.clear();
    this.airportManager.clearAirport();
    this.harbourManager.clearHarbour();

    this.cameraController.select(undefined);
    this.snapshot = undefined;
    this.currentCityId = undefined;
    this.currentWorldKey = undefined;
    this.hasFitCamera = false;
    this.cameraController.resetInputState();
  }

  applyFileChange(path: string, change: FileChange, cityId: string): void {
    this.buildingManager.applyFileChange(
      path,
      change,
      cityId,
      this.currentCityId,
      this.ambient,
    );
  }

  async coverForContainerVoyage(carriesContainer: boolean): Promise<void> {
    await this.harbourManager.coverForContainerVoyage(
      carriesContainer,
      this.transitionManager,
    );
  }

  async revealAfterContainerVoyage(carriesContainer: boolean): Promise<void> {
    await this.harbourManager.revealAfterContainerVoyage(
      carriesContainer,
      this.transitionManager,
    );
  }

  prepareContainerArrival(carriesContainer: boolean): void {
    this.harbourManager.prepareContainerArrival(carriesContainer);
  }

  async coverForTravel(cityId: string): Promise<void> {
    await this.navyManager.coverForTravel(cityId, this.transitionManager);
  }

  async coverForAirportTravel(): Promise<void> {
    await this.airportManager.coverForAirportTravel(
      this.snapshot,
      this.transitionManager,
    );
  }

  prepareArrivalForTravel(): void {
    this.navyManager.prepareArrivalForTravel();
  }

  async revealAfterTravel(): Promise<void> {
    await this.navyManager.revealAfterTravel(this.transitionManager);
  }

  /**
   * `destination` is the snapshot the caller already matched against the
   * arrival's destination key, and it is what the runway is derived from.
   *
   * Taking the scene's own `this.snapshot` instead is what put the aeroplane
   * down in the sea. The runway is sized from the field (`runwayY` is
   * `height + 2.4`), so flying the departure city's approach into a smaller
   * one aims the touchdown tens of tiles past the island — and the two are
   * separate sources of truth: React gates the arrival on the `world` prop
   * while `this.snapshot` is set by setWorld(), which defers itself to the
   * scene's CREATE event whenever the scene is not yet active. Passing the
   * one the caller verified removes the gap rather than narrowing it.
   */
  async revealAfterAirportTravel(destination?: WorldSnapshot): Promise<void> {
    await this.airportManager.revealAfterAirportTravel(
      destination ?? this.snapshot,
      this.transitionManager,
    );
  }
}
