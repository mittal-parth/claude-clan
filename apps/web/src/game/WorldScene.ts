import {
  capitolDistrict,
  capitolFits,
  inCapitolDistrict,
  type Building,
  type CitySummary,
  type Issue,
  type PullRequestOverlay,
  type WorldSize,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import Phaser from "phaser";
import { CAPITOL_OFFSET_V, capitolDepthTile } from "./capitol";
import { AmbientLife, prefersReducedMotion } from "./ambient";
import { ConstructionSites, type ConstructionTarget } from "./construction";
import { playUiClickSound } from "@/lib/play-ui-click";
import { hashCoords, hashText, pickIndex, unitFloat } from "./hash";
import {
  airportLayoutKey,
  connectAirportToRoad,
  createAirportLayout,
  runwayExitPoint,
  type AirportLayout,
  type AirportPoint,
} from "./airport";
import {
  createHarbourLayout,
  harbourLayoutKey,
  type HarbourLayout,
  type HarbourPoint,
} from "./harbour";
import {
  createNavyHarbourLayout,
  navyHarbourLayoutKey,
  type NavyHarbourLayout,
} from "./navyHarbour";
import { createIsoProjection } from "./iso";
import { markerFor, rubbleMarkers } from "./overlay";
import { archetypeFor, tierFor } from "./palette";
import { shouldRevealSite } from "./reveal";
import {
  buildTerrain,
  COUNTRYSIDE_RING,
  COAST_RING,
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  type TerrainCell,
  type TerrainGrid,
} from "./terrain";
import {
  CRANE_HEIGHT,
  DIFF_SCAFFOLD_HEIGHT,
  DIFF_SCAFFOLD_KEY,
  HIGHLIGHT_KEY,
  ISSUE_SHOP_ANCHOR_Y,
  ISSUE_SHOP_KEY,
  AIRPORT_TERMINAL_KEY,
  AIRPORT_TERMINAL_ANCHOR_Y,
  AIRPORT_TOWER_KEY,
  AIRPORT_TOWER_ANCHOR_Y,
  AIRPORT_APRON_KEY,
  AIRPORT_TAXIWAY_VERTICAL_KEY,
  AIRPORT_TAXIWAY_JUNCTION_KEY,
  AIRPORT_RUNWAY_TILE_KEY,
  AIRPORT_RUNWAY_THRESHOLD_KEY,
  AIRPORT_WINDSOCK_KEY,
  AIRPLANE_KEY,
  AIRPLANE_SHADOW_KEY,
  HARBOUR_QUAY_KEY,
  HARBOUR_QUAY_DECK,
  HARBOUR_QUAY_ANCHOR_Y,
  HARBOUR_PIER_KEY,
  HARBOUR_PIER_ANCHOR_Y,
  HARBOUR_WAREHOUSE_KEY,
  HARBOUR_WAREHOUSE_ANCHOR_Y,
  HARBOUR_CRANE_KEY,
  HARBOUR_CRANE_ANCHOR_Y,
  HARBOUR_CRANE_JIB_KEYS,
  HARBOUR_CRANE_JIB_ORIGIN,
  HARBOUR_CRANE_SLEW_SWEEP,
  HARBOUR_CRANE_SLEW_U,
  HARBOUR_CRANE_SLEW_Y,
  HARBOUR_CRANE_TROLLEY_KEY,
  HARBOUR_CRANE_TROLLEY_PICK,
  HARBOUR_CRANE_TROLLEY_REACH,
  HARBOUR_CRANE_TROLLEY_Y,
  HARBOUR_CRANE_SPREADER_KEY,
  HARBOUR_CARGO_CONTAINER_KEY,
  HARBOUR_CONTAINER_ANCHOR_Y,
  HARBOUR_SHIP_KEY,
  HARBOUR_SHIP_KEYS,
  HARBOUR_SHIP_ANCHOR_Y,
  HARBOUR_SHIP_BAY_OFFSETS,
  HARBOUR_CONTAINERS_KEYS,
  HARBOUR_CONTAINERS_ANCHOR_Y,
  HARBOUR_CARGO_KEYS,
  HARBOUR_CARGO_ANCHOR_Y,
  HARBOUR_BOLLARD_KEY,
  HARBOUR_SIGN_KEY,
  HARBOUR_SIGN_ANCHOR_Y,
  HARBOUR_LIGHTHOUSE_KEY,
  HARBOUR_LIGHTHOUSE_ANCHOR_Y,
  HARBOUR_LIGHTHOUSE_LAMP_Y,
  HARBOUR_LAMP_KEY,
  HARBOUR_LAMP_GLOW_Y,
  HARBOUR_MARKER_KEY,
  HARBOUR_MARKER_LAMP_Y,
  SMOKE_KEY,
  RUBBLE_KEY,
  ADDED_MARKER_KEY,
  SELECT_KEY,
  TERRAIN_ATLAS_KEY,
  TERRAIN_VARIANT_COUNTS,
  TILE_ANCHOR_Y,
  TILE_HEIGHT,
  TILE_WIDTH,
  BATTLESHIP_KEYS,
  BATTLESHIP_ANCHOR_Y,
  NAVY_QUAY_KEY,
  NAVY_QUAY_DECK,
  NAVY_QUAY_ANCHOR_Y,
  NAVY_PIER_KEY,
  NAVY_PIER_ANCHOR_Y,
  NAVY_COMMAND_KEY,
  NAVY_COMMAND_ANCHOR_Y,
  NAVY_HANGAR_KEY,
  NAVY_HANGAR_ANCHOR_Y,
  NAVY_BARRACKS_KEY,
  NAVY_BARRACKS_ANCHOR_Y,
  NAVY_RADAR_KEY,
  NAVY_RADAR_ANCHOR_Y,
  NAVY_RADAR_HUB_Z,
  NAVY_RADAR_DISH_KEYS,
  NAVY_RADAR_DISH_ANCHOR_Y,
  NAVY_ROTOR_KEYS,
  NAVY_ROTOR_ANCHOR_Y,
  NAVY_ROTOR_HUB_Z,
  NAVY_COMMAND_BEACON_Z,
  NAVY_FLOODLIGHT_LAMP_Z,
  NAVY_SIGN_BEACON_Z,
  NAVY_MISSILE_KEY,
  NAVY_MISSILE_ANCHOR_Y,
  NAVY_TANK_KEY,
  NAVY_TANK_ANCHOR_Y,
  NAVY_GUN_KEY,
  NAVY_GUN_ANCHOR_Y,
  NAVY_FUEL_TANK_KEY,
  NAVY_FUEL_TANK_ANCHOR_Y,
  NAVY_HELIPAD_KEY,
  NAVY_HELIPAD_ANCHOR_Y,
  NAVY_HELICOPTER_KEY,
  NAVY_HELICOPTER_ANCHOR_Y,
  NAVY_FENCE_KEY,
  NAVY_FENCE_ANCHOR_Y,
  NAVY_FLOODLIGHT_KEY,
  NAVY_FLOODLIGHT_ANCHOR_Y,
  NAVY_FLAG_KEY,
  NAVY_FLAG_ANCHOR_Y,
  NAVY_CRATE_KEY,
  NAVY_CRATE_ANCHOR_Y,
  NAVY_BOLLARD_KEY,
  NAVY_SIGN_KEY,
  NAVY_SIGN_ANCHOR_Y,
  bakeBuilding,
  bakeTerrainTextures,
  propTextureKey,
  roadTextureKey,
  terrainTextureKey,
} from "./textures";
import {
  bakeCapitol,
  CAPITOL_ANCHOR_Y,
  CAPITOL_KEY,
  CAPITOL_SCALE,
} from "./capitolTextures";

/** Tints applied to a marked building; the marker sprite carries its own colour. */
const ADDED_TINT = 0xffcf94;
const MODIFIED_TINT = 0x9fe7ff;
const MODIFIED_GLOW_TINT = 0x66d9ef;

/**
 * Site red, on every diff scaffold whatever the change kind — the cage says
 * "work in progress", and the building's own tint already says which kind.
 */
const SCAFFOLD_TINT = 0xe0453a;
/** How much of a building the cage climbs, and the shortest cage worth drawing. */
const SCAFFOLD_WRAP = 0.82;
const MIN_SCAFFOLD_HEIGHT = 40;

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
/**
 * Zoom below which a crane is too small to notice. The world opens fitted to
 * the whole city, which on a large repo is far below this.
 */
const CONSTRUCTION_LEGIBLE_ZOOM = 0.75;
/** Pointer travel, in screen pixels, above which a press is a drag not a click. */
const CLICK_SLOP = 5;
/** After the player moves the camera, leave it alone this long. */
const CAMERA_YIELD_MS = 8_000;
/** Most trees, bushes and fountains the world will place, at any size. */
const PROP_BUDGET = 2_000;
/** Rings of real water tiles at the coast; past this the background takes over. */
const SHORE_BAND = 3;
export const OPEN_WATER = 0x2e9fe0;
/** Keep the map white long enough for the voyage to feel intentional. */
const WHITEOUT_HOLD_MS = 500;
const WHITEOUT_ALPHA = 0.9;
const AIRCRAFT_GROUND_SCALE = 0.58;
const AIRCRAFT_GROUND_LIFT = 7;
const AIRCRAFT_ART_HEADING = Math.atan2(0.46, 0.89);

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

/** Where the working crane's trolley parks, and how far the spreader hangs. */
const HOIST_REST_DU = 0.5;
const HOIST_REST_DROP = 10;
/** Screen drop from the spreader to a carried container's tile point. */
const CARRIED_CONTAINER_DROP = 42;
/** Beats of the load/unload cutscene, in milliseconds. */
const CRANE_SLEW_MS = 620;
const CRANE_HOIST_MS = 520;
const CONTAINER_SHIP_SAIL_MS = 1_650;
/** Same beat as the container ship's run, so the two fleets read as one port. */
const NAVY_SHIP_SAIL_MS = 1_650;
/** Pixels the harbour's hover label sits above the sign -- clear of the crane's jib and the warehouse roof. */
const HARBOUR_HOVER_LABEL_LIFT = 190;
/** Pixels the naval base's hover label sits above the HQ building -- clear of its mast. */
const NAVY_HOVER_LABEL_LIFT = 190;
/** Clears the command building's mast and the radar dish, the base's two tallest structures. */
const NAVY_HIT_ZONE_LIFT = 100;
/** Clears the crane's jib, the harbour's tallest structure. */
const HARBOUR_HIT_ZONE_LIFT = 100;
/**
 * The stretch of the run over which the helm is over, as a fraction of the
 * voyage. Outside it she is on a steady heading, so both legs read straight.
 */
const SHIP_TURN_START = 0.28;
const SHIP_TURN_END = 0.72;

/**
 * Her four cardinal headings, as yaw from the authored hull. Frame 0 lies
 * alongside with her bow up-coast (grid -v), which is how she leaves; each
 * quarter turn from there swings the bow round through +u, +v and -u.
 */
const YAW_OUTBOUND = 0;
const YAW_SEAWARD = Math.PI / 2;
const YAW_ALONGSIDE_IN = Math.PI;
/**
 * Ambient frame rates for the naval base's two turning props. The radar's 24
 * bearings at this step come round in about 4.6 seconds — a plausible air-search
 * sweep; the rotor's four blades take 32 steps to a revolution, so it turns in
 * a little over a second and reads as idling rather than stopped.
 */
const NAVY_RADAR_SWEEP_STEP_MS = 190;
const NAVY_ROTOR_STEP_MS = 45;

const YAW_INBOUND = (3 * Math.PI) / 2;
/** How long she takes to turn herself end-for-end in the basin. */
const SHIP_TURNAROUND_MS = 2_400;
/** Tiles she runs ahead out of the berth before putting the helm over. */
const SHIP_FAIRWAY_TILES = 3.4;
/** Tiles she then runs out to sea, which must clear the viewport. */
const SHIP_OFFING_TILES = 16;

interface ScreenPoint {
  x: number;
  y: number;
}

interface AircraftTweenOptions {
  groundAt: (progress: number) => ScreenPoint;
  altitudeAt?: (progress: number) => number;
  scaleAt?: (progress: number) => number;
  alphaAt?: (progress: number) => number;
  rotationAt?: (progress: number) => number;
  duration: number;
  ease: string;
  onProgress?: (progress: number, point: ScreenPoint, altitude: number) => void;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function linePath(from: ScreenPoint, to: ScreenPoint): (progress: number) => ScreenPoint {
  return (progress) => ({
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  });
}

function cubicPath(
  from: ScreenPoint,
  controlA: ScreenPoint,
  controlB: ScreenPoint,
  to: ScreenPoint,
): (progress: number) => ScreenPoint {
  return (progress) => {
    const inverse = 1 - progress;
    return {
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * progress * controlA.x +
        3 * inverse * progress ** 2 * controlB.x +
        progress ** 3 * to.x,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * progress * controlA.y +
        3 * inverse * progress ** 2 * controlB.y +
        progress ** 3 * to.y,
    };
  };
}

function aircraftRotation(from: ScreenPoint, to: ScreenPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - AIRCRAFT_ART_HEADING;
}

export class WorldScene extends Phaser.Scene {
  private terrain?: TerrainGrid;
  private snapshot?: WorldSnapshot;
  private groundSprites: Phaser.GameObjects.Sprite[] = [];
  private propSprites: Phaser.GameObjects.Sprite[] = [];
  private views = new Map<string, BuildingView>();
  private ambient?: AmbientLife;
  private construction?: ConstructionSites;
  /** Paths the crew is currently working on, newest last. */
  private buildingPaths: string[] = [];
  /** Paths that already have a site, so only genuinely new ones grab the camera. */
  private sitedPaths = new Set<string>();
  /** Public URL of the crew portrait currently on shift, loaded or loading. */
  private crewUrl?: string;
  private lastCameraInputAt = Number.NEGATIVE_INFINITY;

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
  /** Which repository/city snapshot the scene currently holds, if any. */
  private currentCityId?: string;
  private currentWorldKey?: string;
  private travelTransitionActive = false;

  private overlay?: PullRequestOverlay;
  /** Scaffold ring markers for added buildings, keyed by path. */
  private addedMarkers = new Map<string, Phaser.GameObjects.Sprite>();
  /** Looping glow for modified buildings, keyed by path. */
  private modifiedGlows = new Map<string, Phaser.GameObjects.Sprite>();
  /** Steel cage around every building the PR touches, keyed by path. */
  private diffScaffolds = new Map<string, Phaser.GameObjects.Sprite>();
  private rubbleSprites: Phaser.GameObjects.Sprite[] = [];

  private navySprites: Phaser.GameObjects.Sprite[] = [];
  private navyGlows: Phaser.GameObjects.Arc[] = [];
  /** Frame-cycling timers: the radar sweep and the helicopter's rotor. */
  private navyTimers: Phaser.Time.TimerEvent[] = [];
  private navyLayoutSignature?: string;
  private navyLayout?: NavyHarbourLayout;
  /** The HQ building -- a real, correctly-placed sprite -- doubles as the naval base's hover-label anchor. */
  private navyHoverAnchorSprite?: Phaser.GameObjects.Sprite;
  private navyBattleship?: Phaser.GameObjects.Sprite;
  private navySignClickListener?: () => void;
  private navyShipClickListener?: () => void;
  private navyShipHoverListener?: (info?: ShipHoverInfo) => void;
  /**
   * Bridges the gap between adjacent props' hit areas. The base is dozens of
   * separate pixel-perfect sprites with real transparent margins between
   * them, so the cursor crossing from one to the next fires pointerout then
   * pointerover on the same tick -- without this, the tooltip blinked off
   * and back on every time it happened, reading as the whole base flickering
   * instead of one landmark.
   */
  private navyHoverHideTimer?: Phaser.Time.TimerEvent;
  /** One invisible hit zone standing in for every land-side prop; see {@link createFootprintHitZone}. */
  private navyHitZone?: Phaser.GameObjects.Zone;
  /** Individually drawn puffs; every travel creates a new set of silhouettes. */
  private transitionClouds: Phaser.GameObjects.Graphics[] = [];
  /** Whiteout layer beneath the clouds; it guarantees a fully covered map. */
  private transitionCloudVeil?: Phaser.GameObjects.Rectangle;
  private issues: Issue[] = [];
  private issueShop?: Phaser.GameObjects.Sprite;

  /** Connected southwest airport campus and its animated aircraft. */
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

  /**
   * The east-coast harbour. Purely scenery: none of these sprites is made
   * interactive, so the moored ships in front of them keep every pointer event
   * on that side of the island.
   */
  private harbourSprites: Phaser.GameObjects.Sprite[] = [];
  private harbourShapes: Phaser.GameObjects.Shape[] = [];
  private harbourGlows: Phaser.GameObjects.Arc[] = [];
  private harbourLayoutSignature?: string;
  private harbourLayout?: HarbourLayout;
  /** The name board -- a real, correctly-placed sprite -- doubles as the harbour's hover-label anchor. */
  private harbourHoverAnchorSprite?: Phaser.GameObjects.Sprite;

  /**
   * The container ship and the crane that works it. Unlike the PR fleet, there
   * is exactly one of these per city: it carries a single container to an
   * issue city and comes back empty.
   */
  private harbourShip?: Phaser.GameObjects.Sprite;
  private harbourCraneJib?: Phaser.GameObjects.Sprite;
  private harbourTrolley?: Phaser.GameObjects.Sprite;
  private harbourSpreader?: Phaser.GameObjects.Sprite;
  private harbourCable?: Phaser.GameObjects.Rectangle;
  /** The box currently hanging from the spreader, if any. */
  private harbourSpreaderCargo?: Phaser.GameObjects.Sprite;
  /** The box currently sitting in the ship's bay, if any. */
  private harbourShipCargo?: Phaser.GameObjects.Sprite;
  /** The box standing on the quay: outbound cargo, or one just landed. */
  private harbourQuayCargo?: Phaser.GameObjects.Sprite;
  private harbourHoist = { du: HOIST_REST_DU, angle: 0, hoist: HOIST_REST_DROP };
  /** Which authored hull she is currently showing, and her bay offset on it. */
  private harbourShipBay: { x: number; y: number } = HARBOUR_SHIP_BAY_OFFSETS[0]!;
  private harbourShipClickListener?: () => void;
  private harbourShipHoverListener?: (info?: ShipHoverInfo) => void;
  private harbourSignClickListener?: () => void;
  /** Same debounce as the naval base's, and for the same reason: separate
   * pixel-perfect props with real gaps between them must still read as one
   * hoverable harbour instead of blinking as the cursor crosses those gaps. */
  private harbourHoverHideTimer?: Phaser.Time.TimerEvent;
  /** One invisible hit zone standing in for every quayside prop; see {@link createFootprintHitZone}. */
  private harbourHitZone?: Phaser.GameObjects.Zone;

  constructor() {
    super("world");
  }

  create(): void {
    bakeTerrainTextures(this);
    bakeCapitol(this);

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
    this.construction = new ConstructionSites(this, prefersReducedMotion());
    // A portrait asked for before the scene booted has been waiting for this.
    this.loadCrewSprite(this.crewUrl);
    this.bindCamera();
    this.events.once("shutdown", () => this.clearDragPreview());
  }

  setSelectionListener(listener: (building?: Building) => void): void {
    this.selectionListener = listener;
  }

  setNavyShipHoverListener(listener: (info?: ShipHoverInfo) => void): void {
    this.navyShipHoverListener = listener;
  }

  setNavyShipClickListener(listener: () => void): void {
    this.navyShipClickListener = listener;
  }

  setNavySignClickListener(listener: () => void): void {
    this.navySignClickListener = listener;
  }

  setAirportHoverListener(listener: (info?: ShipHoverInfo) => void): void {
    this.airportHoverListener = listener;
  }

  setAirportClickListener(listener: () => void): void {
    this.airportClickListener = listener;
  }

  setTravelTransitionActive(active: boolean): void {
    this.travelTransitionActive = active;
    if (active) {
      this.cancelBuildingDrag();
      this.dragOrigin = undefined;
      this.pressOrigin = undefined;
      this.highlight?.setVisible(false);
      this.navyShipHoverListener?.(undefined);
      this.airportHoverListener?.(undefined);
    }
  }

  resizeTravelCover(width: number, height: number): void {
    this.transitionCloudVeil?.setSize(width, height).setDisplaySize(width, height);
  }

  /**
   * Phaser can receive its final RESIZE viewport after the first world has
   * already been fitted. Refit only while the camera is untouched; after a
   * user pan/zoom, a browser or panel resize must preserve their framing.
   */
  resizeViewport(width: number, height: number): void {
    this.resizeTravelCover(width, height);
    if (
      this.snapshot &&
      !this.focusTween &&
      this.lastCameraInputAt === Number.NEGATIVE_INFINITY
    ) {
      this.fitCamera();
    }
  }

  setIssues(issues: readonly Issue[]): void {
    this.issues = [...issues];
    if (!this.scene?.isActive()) {
      if (this.events) {
        this.events.once(Phaser.Scenes.Events.CREATE, () => this.layoutIssueShop());
      }
      return;
    }
    this.layoutIssueShop();
  }

  /**
   * The current PR roster. Every city gets a harbor: main has one ship per
   * open PR, while a PR city has one return ship. If cities arrive before the
   * first world snapshot, layoutShips no-ops until setWorld has a snapshot.
   */
  setCities(cities: readonly CitySummary[]): void {
  }

  /**
   * The files the crew is working on right now. Each one that already has a
   * building gets a crane, scaffolding and dust until it drops off the list.
   */
  setBuildingPaths(paths: string[]): void {
    this.buildingPaths = paths;
    this.syncConstruction();
  }

  /**
   * The crew portrait to stand on every site, by public URL.
   *
   * Loaded on demand rather than in preload: which portrait is wanted depends
   * on the crew and effort picked for a session that has not started when the
   * scene boots, and only one of them is ever needed.
   */
  setCrewSprite(url?: string): void {
    if (url === this.crewUrl) {
      return;
    }

    this.crewUrl = url;

    // React hands the portrait over as soon as the canvas mounts, which is
    // before Phaser has booted the scene — at that point `load`, `textures`
    // and `scene` itself are all still undefined. `construction` is built in
    // create(), so it doubles as the "are we up yet" flag; create() reads the
    // url back once there is a loader to service it.
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
      // A second portrait may have been asked for while this one loaded.
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

    const targets: ConstructionTarget[] = [];
    for (const path of this.buildingPaths) {
      const view = this.views.get(path);
      // A brand new file has no plot until the rescan lands; it picks up its
      // crane on the next sync, once the building exists.
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

    // A crane arriving on a plot takes the diff scaffold's place; the overlay
    // pass ran before this one, so it could not know. The scaffold goes back up
    // on the next snapshot, once the site is struck.
    for (const path of this.sitedPaths) {
      this.diffScaffolds.get(path)?.destroy();
      this.diffScaffolds.delete(path);
    }

    this.construction.sync(targets);

    if (opened) {
      this.revealConstruction(opened);
    }
  }

  /**
   * Brings a new site into view. A crane is only about sixty pixels tall at the
   * zoom the world opens at, so work happening off-screen — or just elsewhere
   * in a large city — went unnoticed entirely.
   *
   * Uses the same pan-and-zoom as clicking a search result, so the building
   * being worked on ends up as legible as one you went looking for. It stays
   * quieter than search though: no click sound, and it does not steal the
   * selection, because nobody asked for this move.
   */
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
        lastCameraInputAt: this.lastCameraInputAt,
        yieldMs: CAMERA_YIELD_MS,
      },
    );
    if (!move) {
      return;
    }

    // Framed on the crane rather than the roof: the mast stands well above the
    // building it is working on.
    this.moveCameraTo(target.x, target.y - CRANE_HEIGHT / 2, FOCUS_ZOOM);
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

    playUiClickSound();
    this.moveCameraTo(view.sprite.x, view.sprite.y, FOCUS_ZOOM, () =>
      this.select(path),
    );
    return true;
  }

  /**
   * The one way the camera moves itself — search results and construction
   * sites both come through here, so they read as the same gesture.
   *
   * Phaser can pan or zoom, but not "centre on this point at that zoom", so
   * the end state is set, the scroll it implies is read back, and the camera
   * is put where it was to tween towards it.
   */
  private moveCameraTo(
    x: number,
    y: number,
    zoom: number,
    onArrive?: () => void,
  ): void {
    this.focusTween?.stop();
    this.focusTween = undefined;

    const camera = this.cameras.main;
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
        onArrive?.();
      },
    });
  }

  /**
   * cityId identifies which city this snapshot belongs to. When it differs
   * from the city the scene currently holds, every per-world sprite and flag
   * is torn down first (resetWorld) rather than diffed against the outgoing
   * city's buildings -- diffing two unrelated cities by path would treat
   * every building as a coincidental match or a stale ghost.
   */
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

    // Terrain only needs redrawing when the footprint of the city changed.
    if (!previous || terrainChanged(previous, snapshot)) {
      this.terrain = buildTerrain(snapshot);
      this.drawTerrain(this.terrain, snapshot.size);
      this.applyCameraBounds(this.terrain);
      this.ambient?.rebuild(this.terrain);
    }

    this.syncBuildings(snapshot);
    // Rebuilds marker sprites against whatever views syncBuildings just
    // produced -- a structural change replaces a building's sprite outright,
    // so a marker positioned off the old sprite would be orphaned.
    this.applyOverlay();
    // A rescan can raise the building a crane was waiting on, or move the one
    // it is standing beside.
    this.syncConstruction();

    this.layoutHarbour();
    this.layoutIssueShop();
    this.layoutNavyHarbour();
    this.layoutAirport();

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
    if (!this.scene?.isActive()) {
      return;
    }
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
        const marker = this.add
          .sprite(view.sprite.x, view.sprite.y, ADDED_MARKER_KEY)
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

      if (change) {
        this.raiseDiffScaffold(view);
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
   * Wraps one changed building in steel. Drawn in front of the building so the
   * cage reads as standing around it, and skipped where a construction site is
   * already standing — the crew's own scaffold is there, and two lattices on
   * one plot just read as noise.
   */
  private raiseDiffScaffold(view: BuildingView): void {
    if (this.sitedPaths.has(view.building.path)) {
      return;
    }

    const wrapped = Math.max(
      MIN_SCAFFOLD_HEIGHT,
      view.sprite.height * SCAFFOLD_WRAP,
    );
    const scaffold = this.add
      .sprite(view.sprite.x, view.sprite.y, DIFF_SCAFFOLD_KEY)
      .setOrigin(0.5, 1)
      .setDepth(view.sprite.depth + 1)
      .setAlpha(0.85)
      .setTint(SCAFFOLD_TINT)
      .setScale(1, wrapped / DIFF_SCAFFOLD_HEIGHT);
    this.diffScaffolds.set(view.building.path, scaffold);
  }

  private clearDiffScaffolds(): void {
    for (const scaffold of this.diffScaffolds.values()) {
      scaffold.destroy();
    }
    this.diffScaffolds.clear();
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
    // Sites, cranes and any in-flight fly-to belong to the outgoing city:
    // they are anchored to buildings that are about to be destroyed, so they
    // have to go with them.
    this.construction?.clear();
    this.sitedPaths.clear();
    this.focusTween?.stop();
    this.focusTween = undefined;
    this.cancelBuildingDrag();

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
    this.clearDiffScaffolds();
    for (const rubble of this.rubbleSprites) {
      rubble.destroy();
    }
    this.rubbleSprites = [];
    this.overlay = undefined;

    this.clearNavyHarbour();
    this.issueShop?.destroy();
    this.issueShop = undefined;

    this.clearAirport();
    this.clearHarbour();

    this.select(undefined);
    this.snapshot = undefined;
    this.terrain = undefined;
    this.currentCityId = undefined;
    this.currentWorldKey = undefined;
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
  private drawTerrain(terrain: TerrainGrid, size: WorldSize): void {
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
        (cell.keepProp ||
          unitFloat(hashCoords(cell.x, cell.y, 0xd0e)) < propOdds)
      ) {
        const prop = this.add
          .sprite(point.x, point.y + TILE_ANCHOR_Y, propTextureKey(cell.prop))
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(cell.x, cell.y));
        this.propSprites.push(prop);
      }
    }

    this.drawCapitol(size);
  }

  /**
   * The capitol stands on the reserve that capitol.ts has already laid as lawn
   * and boulevard, so this only has to place the building itself.
   *
   * Its depth is taken from the front of the portico rather than the centre
   * tile: the sprite spans thirteen tiles of ground, and sorting it by its
   * middle would let a block standing in front of it disappear behind the
   * facade.
   */
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

    const capitol = this.add
      .sprite(
        anchor.x,
        anchor.y + CAPITOL_ANCHOR_Y * CAPITOL_SCALE,
        CAPITOL_KEY,
      )
      .setOrigin(0.5, 1)
      .setScale(CAPITOL_SCALE)
      .setDepth(projection.depth(sort.x, sort.y));
    this.propSprites.push(capitol);
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

    // The allocator already keeps the mall clear (reserveCapitol in
    // @sudo-city/layout), so this is a backstop for one case only: a snapshot
    // generated before the reserve existed and served from cache. Skipping the
    // plot costs one building until the world is next laid out; drawing it
    // would put an office block through the rotunda.
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
  public fitCamera(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const camera = this.cameras.main;
    const margin = 4;
    const cityMinX = -margin;
    const cityMinY = -margin;
    const cityMaxX = snapshot.size.width - 1 + margin;
    const cityMaxY = snapshot.size.height - 1 + margin;
    const airport = this.airportLayout();
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

  /**
   * Stops an automatic camera move from fighting the player for the camera.
   * The tween writes scroll and zoom every frame, so grabbing the world mid
   * flight has to kill it outright rather than just start a new one.
   */
  private noteCameraInput(): void {
    this.lastCameraInputAt = this.time.now;
    this.focusTween?.stop();
    this.focusTween = undefined;
  }

  private bindCamera(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.travelTransitionActive) return;
      this.dragOrigin = { x: pointer.x, y: pointer.y };
      this.pressOrigin = { x: pointer.x, y: pointer.y };
      this.pressedBuilding = this.buildingAtPointer(pointer);
      this.draggingBuilding = undefined;
    });

    const endDrag = (pointer: Phaser.Input.Pointer): void => {
      if (this.travelTransitionActive) {
        this.dragOrigin = undefined;
        this.pressOrigin = undefined;
        return;
      }
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
      if (this.travelTransitionActive) return;
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
        this.noteCameraInput();
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
        if (this.travelTransitionActive) return;
        const camera = this.cameras.main;
        this.noteCameraInput();
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
  // Navy Harbour
  // -------------------------------------------------------------------------

  private layoutNavyHarbour(): void {
    if (!this.snapshot) {
      this.clearNavyHarbour();
      return;
    }
    if (!this.textures.exists(NAVY_COMMAND_KEY)) {
      bakeTerrainTextures(this);
    }
    const { width, height } = this.snapshot.size;
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
      this.add
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
        this.add
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
      const sprite = this.add
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

    // The tower is one static texture; its head is a second sprite that cycles
    // through baked headings. An isometric prop cannot be rotated at runtime --
    // grid +u and +v are 127 degrees apart on screen, so no angle is correct --
    // so the sweep is 24 baked bearings played in order.
    layout.radar.forEach((point) => {
      const tower = onBase(point, NAVY_RADAR_KEY, NAVY_RADAR_ANCHOR_Y, 18);
      tower.setData("hoverTitle", "AIR SEARCH RADAR");
      const hub = this.navyMastPoint(tower, NAVY_RADAR_ANCHOR_Y, NAVY_RADAR_HUB_Z);
      const dish = this.add
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
    // The main rotor is its own sprite for the same reason the radar head is:
    // the blades lie in the ground plane, so yawing them is a baked spin.
    const rotorHub = this.navyMastPoint(
      helicopter,
      NAVY_HELICOPTER_ANCHOR_Y,
      NAVY_ROTOR_HUB_Z,
    );
    const rotor = this.add
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
      // One tween drives both, relatively, so the rotor never floats off the
      // mast as the airframe settles on its dampers.
      this.tweens.add({
        targets: [helicopter, rotor],
        y: "-=3",
        duration: 1_350,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    // The gate board is parked for now — every other prop on the apron already
    // opens the PR roster, so nothing is unreachable without it.
    // const sign = onBase(
    //   layout.sign,
    //   NAVY_SIGN_KEY,
    //   NAVY_SIGN_ANCHOR_Y,
    //   24,
    // );
    // sign.setData("hoverTitle", "NAVAL BASE COMMAND");
    // this.addNavyGlow(
    //   sign,
    //   NAVY_SIGN_ANCHOR_Y,
    //   NAVY_SIGN_BEACON_Z,
    //   projection.depth(layout.sign.x, layout.sign.y) + 26,
    //   { color: 0xff5e65, radius: 2.5, peak: 0.7, scale: 2, duration: 1_400 },
    // );

    // The base itself is the board's front door: the whole apron opens the
    // PR roster as one hoverable/clickable landmark, while the battleship
    // keeps the voyage interaction.
    this.navyHitZone = this.createFootprintHitZone(
      layout.quay.x,
      layout.quay.y,
      layout.quayHalfU,
      layout.quayHalfV,
      NAVY_HIT_ZONE_LIFT,
      projection.depth(layout.quay.x, layout.quay.y) + 50,
    );
    this.bindNavyInteractions(this.navyHitZone);

    const isMain = this.currentCityId === "main";
    const isPrCity = this.currentCityId?.startsWith("pr-") ?? false;
    if (isMain || isPrCity) {
      const shipPoint = projection.project(
        layout.battleship.x,
        layout.battleship.y,
      );
      this.navyBattleship = this.add
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
        if (this.travelTransitionActive) return;
        const anchor = this.navyHoverAnchor() ?? {
          x: this.navyBattleship!.x,
          y: this.navyBattleship!.y,
        };
        const screen = this.worldToScreen(anchor.x, anchor.y);
        this.showNavyHover({
          cityId: this.currentCityId ?? "",
          title: "Navy Battleship",
          action: isMain ? "Open the PR review board" : "Return to main city",
          screenX: screen.x,
          screenY: screen.y,
        });
      });
      this.navyBattleship.on("pointerout", () => {
        this.scheduleHideNavyHover();
      });
      this.navyBattleship.on("pointerdown", () => {
        if (this.travelTransitionActive) return;
        playUiClickSound();
        this.cancelNavyHoverHide();
        this.navyShipHoverListener?.(undefined);
        this.navyShipClickListener?.();
      });

      this.navyBattleship.setData("restY", this.navyBattleship.y);
      this.idleBobNavyShip();
    }

  }

  /**
   * Screen position of a point `z` texture-pixels up a prop already standing on
   * the apron. Everything mounted on a mast -- the radar head, the rotor, a
   * beacon glow -- hangs off this, so nothing has to re-derive the deck lift or
   * the prop's scale for itself.
   */
  private navyMastPoint(
    sprite: Phaser.GameObjects.Sprite,
    anchorY: number,
    z: number,
  ): { x: number; y: number } {
    return { x: sprite.x, y: sprite.y - (anchorY + z) * sprite.scaleY };
  }

  /** Cycles a sprite through its baked heading frames. Ambient, so reduced motion skips it. */
  private spinNavyFrames(
    sprite: Phaser.GameObjects.Sprite,
    keys: readonly string[],
    stepMs: number,
  ): void {
    if (prefersReducedMotion() || keys.length < 2) return;
    let frame = 0;
    this.navyTimers.push(
      this.time.addEvent({
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

  /**
   * A single screen point standing in for the whole naval base, clear of the
   * command mast and radar dish. Every land-side prop's hover uses this
   * instead of its own position, so the tooltip always reads above the base
   * as a landmark rather than jumping to wherever in the apron -- a fence
   * panel, a floodlight, a crate -- the cursor happens to be.
   */
  private navyHoverAnchor(): ScreenPoint | undefined {
    const command = this.navyHoverAnchorSprite;
    if (!command) return undefined;
    return { x: command.x, y: command.y - NAVY_HOVER_LABEL_LIFT };
  }

  /** Cancels any pending hide and shows the tooltip immediately. */
  private showNavyHover(info: ShipHoverInfo): void {
    this.cancelNavyHoverHide();
    this.navyShipHoverListener?.(info);
  }

  /**
   * Defers hiding the tooltip by one frame so a pointerover on the next prop
   * -- across the transparent gap between two adjacent sprites -- can cancel
   * it before it fires. See {@link navyHoverHideTimer}.
   */
  private scheduleHideNavyHover(): void {
    this.cancelNavyHoverHide();
    this.navyHoverHideTimer = this.time.delayedCall(32, () => {
      this.navyHoverHideTimer = undefined;
      this.navyShipHoverListener?.(undefined);
    });
  }

  private cancelNavyHoverHide(): void {
    this.navyHoverHideTimer?.remove(false);
    this.navyHoverHideTimer = undefined;
  }

  private bindNavyInteractions(
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Zone,
  ): void {
    sprite.on("pointerover", () => {
      if (this.travelTransitionActive) return;
      const anchor = this.navyHoverAnchor() ?? { x: sprite.x, y: sprite.y };
      const screen = this.worldToScreen(anchor.x, anchor.y);
      this.showNavyHover({
        cityId: "naval-base",
        title: String(sprite.getData("hoverTitle") ?? "NAVAL BASE"),
        action: "Open the PR review board",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    sprite.on("pointerout", () => this.scheduleHideNavyHover());
    sprite.on("pointerdown", () => {
      if (this.travelTransitionActive) return;
      playUiClickSound();
      this.cancelNavyHoverHide();
      this.navyShipHoverListener?.(undefined);
      this.navySignClickListener?.();
    });
  }

  /**
   * A soft light hung on a prop's own mast, at texture height `z`. Taking the
   * owning sprite rather than a tile point is what keeps a beacon on its pole:
   * the prop is lifted onto the deck and drawn at a scale the glow would
   * otherwise have to guess at.
   */
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
    const glow = this.add
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
      this.tweens.add({
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

  private clearNavyHarbour(): void {
    for (const sprite of this.navySprites) {
      this.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    for (const glow of this.navyGlows) {
      this.tweens.killTweensOf(glow);
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

  /** Places the issue market on the marked grass plot behind the airport. */
  private layoutIssueShop(): void {
    if (this.currentCityId !== "main" || !this.snapshot) {
      this.issueShop?.destroy();
      this.issueShop = undefined;
      return;
    }
    const { height } = this.snapshot.size;
    // The screenshot's red mark is immediately behind/screen-right of the
    // terminal, just outside the western city road. gx/gy is the northwest
    // corner of this 2x2 landmark, so its visual centre is (-1.5, h - 6.5).
    // Its smaller grid-depth also guarantees it draws behind the terminal.
    const gx = -2;
    const gy = Math.max(0, height - 7);
    const point = projection.project(gx + 0.5, gy + 0.5);
    if (!this.issueShop) {
      // Scenery only. The issue market is reached through the harbour now --
      // the PORT sign or the container ship -- so the shop takes no pointer
      // events at all rather than silently swallowing clicks on the city
      // behind it.
      this.issueShop = this.add
        .sprite(point.x, point.y + ISSUE_SHOP_ANCHOR_Y, ISSUE_SHOP_KEY)
        .setOrigin(0.5, 1);
    }
    this.issueShop
      .setPosition(point.x, point.y + ISSUE_SHOP_ANCHOR_Y)
      .setDepth(projection.depth(gx + 1, gy + 1) + 1)
      .setVisible(true);
    this.issueShop.setData("issueCount", this.issues.length);
  }

  /** Builds one connected terminal, apron, taxiway, runway and city access road. */
  private layoutAirport(): void {
    if (!this.snapshot) {
      this.clearAirportStatic();
      return;
    }
    const airport = this.airportLayout();
    const accessRoad = connectAirportToRoad(
      airport.accessRoadStart,
      this.terrain?.roads ?? [],
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
      const sprite = this.add
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
      [...accessRoad, ...(this.terrain?.roads ?? [])].map(
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
      // The first tile's south arm visibly enters the terminal forecourt.
      if (index === 0) mask |= ROAD_SOUTH;
      const point = projection.project(cell.x, cell.y);
      const road = this.add
        .sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          TERRAIN_ATLAS_KEY,
          roadTextureKey(mask),
        )
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(cell.x, cell.y) + 4)
        .setInteractive({ useHandCursor: true });
      this.bindAirportInteractions(road);
      this.airportSurfaceSprites.push(road);
    });

    const terminalPoint = projection.project(airport.terminal.x, airport.terminal.y);
    this.airportTerminal = this.add
      .sprite(
        terminalPoint.x,
        terminalPoint.y + AIRPORT_TERMINAL_ANCHOR_Y,
        AIRPORT_TERMINAL_KEY,
      )
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(airport.terminal.x + 1.55, airport.terminal.y + 0.82) + 12)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.airportTerminal);

    const towerPoint = projection.project(airport.tower.x, airport.tower.y);
    this.airportTower = this.add
      .sprite(
        towerPoint.x,
        towerPoint.y + AIRPORT_TOWER_ANCHOR_Y,
        AIRPORT_TOWER_KEY,
      )
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(airport.tower.x + 0.5, airport.tower.y + 0.5) + 14)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.airportTower);

    const windsockGrid = { x: airport.apron.x + 1.72, y: airport.apron.y + 0.7 };
    const windsockPoint = projection.project(windsockGrid.x, windsockGrid.y);
    const windsock = this.add
      .sprite(windsockPoint.x, windsockPoint.y + TILE_ANCHOR_Y, AIRPORT_WINDSOCK_KEY)
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(windsockGrid.x, windsockGrid.y) + 18)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(windsock);
    this.airportDecorationSprites.push(windsock);

    const gatePoint = projection.project(airport.gate.x, airport.gate.y);
    const parkedRotation = this.parkedAircraftRotation(airport);
    this.parkedAirplaneShadow = this.add
      .sprite(gatePoint.x + 4, gatePoint.y + 4, AIRPLANE_SHADOW_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setRotation(parkedRotation)
      .setDepth(projection.depth(airport.gate.x, airport.gate.y) + 96);
    this.parkedAirplane = this.add
      .sprite(gatePoint.x, gatePoint.y - AIRCRAFT_GROUND_LIFT, AIRPLANE_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setRotation(parkedRotation)
      .setDepth(projection.depth(airport.gate.x, airport.gate.y) + 100)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.bindAirportInteractions(this.parkedAirplane);

    this.airportBeacon = this.add
      .circle(towerPoint.x, towerPoint.y - 217, 3.5, 0xff5d6c, 0.25)
      .setDepth(SKY_DEPTH - 2)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: this.airportBeacon,
      alpha: 1,
      scale: 2,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /**
   * Dresses the east (bottom-right) coast with the harbour the ships moor at:
   * a stone wharf, a timber pier reaching towards the mooring lane, and the
   * quayside kit -- warehouse, portal crane, containers, cargo, bollards,
   * lamps and a lighthouse on the seaward corner.
   *
   * Deliberately scenery-only. Nothing here calls setInteractive, so the
   * harbour never steals a pointer event from the ships floating in front of
   * it, and it needs no hover or click plumbing at all.
   */
  private layoutHarbour(): void {
    if (!this.snapshot) {
      this.clearHarbour();
      return;
    }
    const { width, height } = this.snapshot.size;
    const harbour = createHarbourLayout(width, height);
    const signature = harbourLayoutKey(harbour);
    if (signature === this.harbourLayoutSignature && this.harbourSprites.length > 0) {
      return;
    }
    this.clearHarbour();
    this.harbourLayoutSignature = signature;
    this.harbourLayout = harbour;

    // The wharf slab sorts by its landward corner, so every piece of furniture
    // standing on it -- all of which sit at a greater grid depth -- draws in
    // front of the stone rather than being swallowed by it.
    const quayPoint = projection.project(harbour.quay.x, harbour.quay.y);
    this.harbourSprites.push(
      this.add
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
        this.add
          .sprite(point.x, point.y + HARBOUR_PIER_ANCHOR_Y, HARBOUR_PIER_KEY)
          .setOrigin(0.5, 1)
          .setDepth(projection.depth(tile.x, tile.y) + 4),
      );
    }

    /** Places a prop standing on the wharf, lifted by the deck's height. */
    const onQuay = (
      point: HarbourPoint,
      key: string,
      anchorY: number,
      depthOffset: number,
    ): Phaser.GameObjects.Sprite => {
      const projected = projection.project(point.x, point.y);
      const sprite = this.add
        .sprite(projected.x, projected.y + anchorY - HARBOUR_QUAY_DECK, key)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(point.x, point.y) + depthOffset);
      this.harbourSprites.push(sprite);
      return sprite;
    };

    onQuay(harbour.warehouse, HARBOUR_WAREHOUSE_KEY, HARBOUR_WAREHOUSE_ANCHOR_Y, 12);
    // Every stack in the yard gets its own livery, cycling through the set.
    harbour.containers.forEach((stack, index) => {
      onQuay(
        stack,
        HARBOUR_CONTAINERS_KEYS[index % HARBOUR_CONTAINERS_KEYS.length]!,
        HARBOUR_CONTAINERS_ANCHOR_Y,
        12,
      );
    });
    // Each berth gets a differently painted pile, cycling through the variants
    // so no two neighbours share a colour scheme.
    harbour.cargo.forEach((pile, index) => {
      onQuay(
        pile,
        HARBOUR_CARGO_KEYS[index % HARBOUR_CARGO_KEYS.length]!,
        HARBOUR_CARGO_ANCHOR_Y,
        12,
      );
    });
    // Every crane is a portal plus a slewing jib. The working crane's jib and
    // hoist are kept as references so the delivery cutscene can drive them;
    // the rest are parked at their rest pose and never touched again.
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
    // The name board is the harbour's front door: clicking the PORT sign is
    // what opens the issue market now that the shop building is inert.
    const sign = onQuay(harbour.sign, HARBOUR_SIGN_KEY, HARBOUR_SIGN_ANCHOR_Y, 18);
    sign.setData("hoverTitle", "CLAUDE CITY PORT");
    this.harbourHoverAnchorSprite = sign;
    for (const lamp of harbour.lamps) {
      onQuay(lamp, HARBOUR_LAMP_KEY, TILE_ANCHOR_Y, 14);
    }
    // The lighthouse stands off the wharf on its own rock, so it takes no
    // quay lift -- its base sits at the waterline.
    const lighthousePoint = projection.project(
      harbour.lighthouse.x,
      harbour.lighthouse.y,
    );
    const lighthouseSprite = this.add
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
      this.add
        .sprite(markerPoint.x, markerPoint.y + TILE_ANCHOR_Y, HARBOUR_MARKER_KEY)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(harbour.pierHead.x, harbour.pierHead.y) + 6),
    );

    this.layoutContainerShip(harbour);
    this.layoutQuayCargo(harbour);

    // The whole harbour is one click target, not just the name board: one
    // hit zone over the quay's footprint shares the ship's handler. The
    // lighthouse sits outside that footprint on its own rock -- clicking
    // the coast's landmark shouldn't open anything, and it never falls
    // inside the zone to begin with.
    this.harbourHitZone = this.createFootprintHitZone(
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
      // Sits above the world like the airport's tower beacon, so the lantern
      // still reads when the camera is zoomed out to fit the whole island.
      SKY_DEPTH - 3,
      { radius: 4.5, color: 0xffd27f, peak: 0.95, scale: 3.4, duration: 1_500 },
    );
    for (const lamp of harbour.lamps) {
      this.addHarbourGlow(
        lamp,
        // The lantern hangs off the arm, 12px to the screen-right of the post.
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

  /**
   * Moors the one container ship at its berth under the working crane. It is
   * the only harbour piece that takes pointer events: clicking it is how the
   * mayor picks up an issue, or sails home again from an issue city.
   */
  private layoutContainerShip(harbour: HarbourLayout): void {
    const berth = projection.project(
      harbour.containerShip.x,
      harbour.containerShip.y,
    );
    const ship = this.add
      .sprite(berth.x, berth.y + HARBOUR_SHIP_ANCHOR_Y, HARBOUR_SHIP_KEY)
      .setOrigin(0.5, 1)
      .setDepth(
        projection.depth(harbour.containerShip.x, harbour.containerShip.y) + 8,
      )
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    ship.setData("restY", ship.y);
    this.harbourShip = ship;
    // She lies alongside when berthed, so she starts on her quayside heading.
    this.harbourShipBay = HARBOUR_SHIP_BAY_OFFSETS[0]!;
    this.harbourSprites.push(ship);

    ship.on("pointerover", () => {
      if (this.travelTransitionActive) return;
      const homeward = this.currentCityId !== "main";
      const anchor = this.harbourHoverAnchor() ?? { x: ship.x, y: ship.y };
      const screen = this.worldToScreen(anchor.x, anchor.y);
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
      if (this.travelTransitionActive) return;
      playUiClickSound();
      this.cancelHarbourHoverHide();
      this.harbourShipHoverListener?.(undefined);
      this.harbourShipClickListener?.();
    });

    this.idleBobContainerShip();
  }

  /**
   * Converts a world point to the screen pixel it renders at -- not the
   * naive `(x - scrollX) * zoom`, which only happens to be correct at zoom
   * 1. Phaser zooms the camera around its viewport centre (`midPoint`, which
   * already factors in scroll, zoom and viewport size), not its origin, so
   * that shortcut drifts further up-left the more the camera is zoomed or
   * panned away from world (0, 0). Every HTML overlay that follows a world
   * position -- hover labels included -- needs this instead.
   */
  private worldToScreen(x: number, y: number): ScreenPoint {
    const camera = this.cameras.main;
    const mid = camera.midPoint;
    return {
      x: camera.x + camera.width / 2 + (x - mid.x) * camera.zoomX,
      y: camera.y + camera.height / 2 + (y - mid.y) * camera.zoomY,
    };
  }

  /**
   * One invisible interactive zone covering a landmark's whole reserved
   * ground rectangle, lifted `liftPx` clear of its top edge to cover the
   * tallest structure standing on it. Replaces hanging pixel-perfect hit
   * areas off dozens of separate props -- those have real transparent gaps
   * between them, so the cursor crossing one fired pointerout then
   * pointerover on the same tick and read as the whole landmark blinking.
   * One continuous hit area has no gaps to cross.
   *
   * Safe to cover the full rectangle rather than pixel-testing it, unlike a
   * single prop's texture: the layout allocator reserves this ground
   * exclusively for the landmark (see "Reserving ground for a landmark" in
   * CLAUDE.md), so nothing else is ever drawn inside it to be swallowed.
   */
  private createFootprintHitZone(
    centreX: number,
    centreY: number,
    halfU: number,
    halfV: number,
    liftPx: number,
    depth: number,
  ): Phaser.GameObjects.Zone {
    const corner = (du: number, dv: number) => projection.project(centreX + du, centreY + dv);
    const corners = [
      corner(-halfU, -halfV),
      corner(halfU, -halfV),
      corner(halfU, halfV),
      corner(-halfU, halfV),
    ];
    const top = corners.reduce((a, b) => (b.y < a.y ? b : a));
    const bottom = corners.reduce((a, b) => (b.y > a.y ? b : a));
    const left = corners.reduce((a, b) => (b.x < a.x ? b : a));
    const right = corners.reduce((a, b) => (b.x > a.x ? b : a));
    // The diamond's own outline, unioned with a copy of itself shifted
    // `liftPx` up: same left/right/bottom, but the top two edges come from
    // the shifted copy so the hit area covers the mast/roof above the slab.
    const points = [
      { x: top.x, y: top.y - liftPx },
      { x: right.x, y: right.y - liftPx },
      right,
      bottom,
      left,
      { x: left.x, y: left.y - liftPx },
    ];
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    const zone = this.add
      .zone(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY))
      .setOrigin(0, 0)
      .setDepth(depth);
    const polygon = new Phaser.Geom.Polygon(
      points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    );
    zone.setInteractive({
      hitArea: polygon,
      hitAreaCallback: Phaser.Geom.Polygon.Contains,
      useHandCursor: true,
    });
    return zone;
  }

  /**
   * A single screen point standing in for the whole harbour, well clear of
   * the crane and warehouse roofs. Every quayside prop's hover uses this
   * instead of its own position, so the tooltip always reads above the port
   * as a landmark rather than jumping to wherever in the footprint -- a
   * bollard, a fence panel, a container stack -- the cursor happens to be.
   */
  private harbourHoverAnchor(): ScreenPoint | undefined {
    const sign = this.harbourHoverAnchorSprite;
    if (!sign) return undefined;
    return { x: sign.x, y: sign.y - HARBOUR_HOVER_LABEL_LIFT };
  }

  /** Cancels any pending hide and shows the tooltip immediately. */
  private showHarbourHover(info: ShipHoverInfo): void {
    this.cancelHarbourHoverHide();
    this.harbourShipHoverListener?.(info);
  }

  /**
   * Defers hiding the tooltip by one frame so a pointerover on the next prop
   * -- across the transparent gap between two adjacent sprites -- can cancel
   * it before it fires. See {@link harbourHoverHideTimer}.
   */
  private scheduleHideHarbourHover(): void {
    this.cancelHarbourHoverHide();
    this.harbourHoverHideTimer = this.time.delayedCall(32, () => {
      this.harbourHoverHideTimer = undefined;
      this.harbourShipHoverListener?.(undefined);
    });
  }

  private cancelHarbourHoverHide(): void {
    this.harbourHoverHideTimer?.remove(false);
    this.harbourHoverHideTimer = undefined;
  }

  /**
   * Opens the roster of the mayor's own PRs and worktrees from any part of
   * the harbour. Hit-testing is pixel-perfect because these textures are
   * mostly transparent -- the quay alone is a diamond inside a canvas
   * several hundred pixels across, and a rectangular hit area would sit
   * above half the city on depth and swallow clicks meant for the buildings
   * behind it.
   */
  private bindHarbourInteractions(
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Zone,
  ): void {
    sprite.on("pointerover", () => {
      if (this.travelTransitionActive) return;
      const anchor = this.harbourHoverAnchor() ?? { x: sprite.x, y: sprite.y };
      const screen = this.worldToScreen(anchor.x, anchor.y);
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
      if (this.travelTransitionActive) return;
      playUiClickSound();
      this.cancelHarbourHoverHide();
      this.harbourShipHoverListener?.(undefined);
      this.harbourSignClickListener?.();
    });
  }

  /** The gentle swell the ship rides at anchor; killed during a voyage. */
  private idleBobContainerShip(): void {
    const ship = this.harbourShip;
    if (!ship) return;
    const restY = ship.getData("restY") as number;
    ship.setY(restY);
    this.tweens.add({
      targets: ship,
      y: restY - 4,
      duration: 2_100,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      onUpdate: () => this.syncShipCargo(),
    });
  }

  /** Keeps a boxed container riding in the bay as the hull rises and falls. */
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

  /** Screen point of a spot on the wharf, lifted clear of the deck. */
  private quayPoint(point: HarbourPoint, lift: number): ScreenPoint {
    const projected = projection.project(point.x, point.y);
    return { x: projected.x, y: projected.y - lift - HARBOUR_QUAY_DECK };
  }

  /** Hangs a crane's slewing arm on its mast head. */
  private addCraneJib(crane: HarbourPoint): Phaser.GameObjects.Sprite {
    const axis = this.quayPoint(
      { x: crane.x + HARBOUR_CRANE_SLEW_U, y: crane.y },
      HARBOUR_CRANE_SLEW_Y,
    );
    const jib = this.add
      .sprite(axis.x, axis.y, HARBOUR_CRANE_JIB_KEYS[0]!)
      .setOrigin(HARBOUR_CRANE_JIB_ORIGIN.x, HARBOUR_CRANE_JIB_ORIGIN.y)
      .setDepth(projection.depth(crane.x, crane.y) + 17);
    this.harbourSprites.push(jib);
    return jib;
  }

  /**
   * The working crane's hoist: trolley, cable and spreader. All three are
   * positioned from a single {du, angle, hoist} pose, so a tween over that
   * pose keeps them rigidly attached to the jib however far it has slewed.
   */
  private layoutHarbourHoist(harbour: HarbourLayout): void {
    const crane = harbour.workingCrane;
    const trolley = this.add
      .sprite(0, 0, HARBOUR_CRANE_TROLLEY_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(projection.depth(crane.x, crane.y) + 18);
    const cable = this.add
      .rectangle(0, 0, 1.5, 1, 0x7f8f97)
      .setOrigin(0.5, 0)
      .setDepth(projection.depth(crane.x, crane.y) + 18);
    const spreader = this.add
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

  /** Re-seats trolley, cable, spreader and any carried box from the pose. */
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

    // The trolley rides `du` tiles out along an arm that has yawed `angle` in
    // the world, so its grid offset from the mast is that reach turned by the
    // slew -- then projected, like any other point on the ground plane.
    const outU = du * Math.cos(angle);
    const outV = du * Math.sin(angle);
    const trolleyX = axis.x + (outU - outV) * (TILE_WIDTH / 2);
    const trolleyY =
      axis.y +
      (outU + outV) * (TILE_HEIGHT / 2) -
      (HARBOUR_CRANE_TROLLEY_Y - HARBOUR_CRANE_SLEW_Y);

    // And the arm itself is the frame baked at the nearest slew.
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
    const glow = this.add
      .circle(projected.x + offset.x, projected.y - offset.y, style.radius, style.color, 0.18)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
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

  setHarbourShipClickListener(listener: () => void): void {
    this.harbourShipClickListener = listener;
  }

  setHarbourShipHoverListener(listener: (info?: ShipHoverInfo) => void): void {
    this.harbourShipHoverListener = listener;
  }

  setHarbourSignClickListener(listener: () => void): void {
    this.harbourSignClickListener = listener;
  }

  /**
   * Tweens the hoist pose. Everything hanging off the jib is re-seated from
   * the pose on every frame, so trolley, cable, spreader and box move as one
   * rigid assembly no matter which parts of the pose are changing.
   */
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
      this.tweens.add({
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

  /**
   * Puts the outbound box on the quay, waiting to be shipped. It stands there
   * from the moment the harbour is built, so the crane picks up something that
   * was visibly already there rather than conjuring one at the hook.
   */
  private layoutQuayCargo(harbour: HarbourLayout): void {
    const drop = this.quayPoint(harbour.containerDrop, 0);
    const cargo = this.add
      .sprite(drop.x, drop.y + HARBOUR_CONTAINER_ANCHOR_Y, HARBOUR_CARGO_CONTAINER_KEY)
      .setOrigin(0.5, 1)
      .setDepth(
        projection.depth(harbour.containerDrop.x, harbour.containerDrop.y) + 13,
      );
    this.harbourQuayCargo = cargo;
    this.harbourSprites.push(cargo);
  }

  /** Hands the waiting box from the quay to the spreader. */
  private liftQuayCargo(): void {
    const cargo = this.harbourQuayCargo;
    if (!cargo) return;
    this.harbourQuayCargo = undefined;
    this.harbourSpreaderCargo = cargo;
    cargo.setDepth((this.harbourSpreader?.depth ?? 0) - 1);
    this.applyHoistPose();
  }

  /**
   * Lifts the waiting container and stows it in the ship's bay: slew a right
   * angle clockwise over the quay, drop, take the load, hoist, slew back
   * anticlockwise over the hatch, lower away. Reversed by playContainerUnload.
   */
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

  /** Takes the box back out of the bay and sets it down on the quay. */
  private async playContainerUnload(): Promise<void> {
    if (!this.harbourShip || !this.harbourShipCargo) return;
    await this.tweenHoist({ du: HARBOUR_CRANE_TROLLEY_REACH }, CRANE_SLEW_MS);
    await this.tweenHoist({ hoist: this.bayHoistDrop() }, CRANE_HOIST_MS, "Sine.easeIn");
    // Hand the box from the bay to the spreader.
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

  /** Cable payout that puts the spreader on the quay deck. */
  private quayHoistDrop(): number {
    const harbour = this.harbourLayout;
    if (!harbour) return HOIST_REST_DROP;
    const deck = this.quayPoint(harbour.containerDrop, 0);
    const trolley = this.harbourTrolley;
    return Math.max(HOIST_REST_DROP, deck.y - (trolley?.y ?? deck.y) - 20);
  }

  /** Cable payout that puts the spreader on the ship's hatch. */
  private bayHoistDrop(): number {
    const ship = this.harbourShip;
    const trolley = this.harbourTrolley;
    if (!ship || !trolley) return HOIST_REST_DROP;
    // Her current heading's bay, so a lift lines up wherever the hold has
    // swung to -- though in practice she is always alongside when worked.
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

  /**
   * The ship's course, as three screen points: her berth, the corner she
   * turns at, and open water off the map.
   *
   * She is authored bow toward grid -v, so she leaves the berth ahead on that
   * heading -- up the coast, screen up-right -- then puts the helm over to
   * starboard onto grid +u, straight out to sea. Rotating an isometric sprite
   * through the turn would read as a sprite spinning rather than a hull
   * coming round, so the turn lives entirely in the path.
   */
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
    // One tile of travel, in screen pixels, along each heading.
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

  /**
   * Runs the ship along that course. A quadratic through the corner rounds the
   * turn into a real arc, so she carries her way through it instead of
   * hinging on the spot; the legs either side are long enough to read straight.
   */
  private sailContainerShip(
    from: ScreenPoint,
    through: ScreenPoint,
    to: ScreenPoint,
    ease: string,
    yaw: { from: number; to: number },
  ): Promise<void> {
    const ship = this.harbourShip;
    if (!ship) return Promise.resolve();
    this.tweens.killTweensOf(ship);
    ship.setPosition(from.x, from.y);
    this.setShipYaw(yaw.from);
    if (prefersReducedMotion()) {
      ship.setPosition(to.x, to.y);
      this.setShipYaw(yaw.to);
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.tweens.add({
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
          // She comes round through the bend rather than at a point in it:
          // the helm goes over as she enters the corner and is amidships
          // again on the far side, so the yaw tracks the arc she is on.
          const helm = Phaser.Math.Clamp(
            (t - SHIP_TURN_START) / (SHIP_TURN_END - SHIP_TURN_START),
            0,
            1,
          );
          // Smoothstep, so she eases into and out of the swing instead of
          // starting and stopping it dead.
          const eased = helm * helm * (3 - 2 * helm);
          this.setShipYaw(yaw.from + (yaw.to - yaw.from) * eased);
        },
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * With her box ashore she is lying the wrong way round to leave, so she
   * works herself end-for-end in the basin: ahead down-coast, a long curve out
   * into open water and back, and alongside again under the crane on her
   * outbound heading.
   *
   * The loop swings seaward because the other side is the wharf. It is a cubic
   * returning to its own start; the control points set how far she runs ahead
   * before the swing, and how wide she carries it.
   */
  private playContainerShipTurnaround(): Promise<void> {
    const course = this.containerShipCourse();
    const ship = this.harbourShip;
    if (!course || !ship) return Promise.resolve();
    const berth = course.berth;
    // One tile down-coast, and one tile out to sea, in screen pixels.
    const downCoast = { x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };
    const seaward = { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 };
    const offset = (ahead: number, out: number): ScreenPoint => ({
      x: berth.x + downCoast.x * ahead + seaward.x * out,
      y: berth.y + downCoast.y * ahead + seaward.y * out,
    });
    // She leaves ahead and swings wide seaward, then comes back onto the berth
    // almost straight up-coast -- the heading she needs to sail on.
    const control = { first: offset(3.4, 3.0), second: offset(3.0, 0.5) };

    this.tweens.killTweensOf(ship);
    if (prefersReducedMotion()) {
      this.setShipYaw(YAW_OUTBOUND);
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.tweens.add({
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
          // Bow swings from down-coast out through seaward to up-coast: half a
          // turn, taken the way the loop itself goes.
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

  /**
   * Shows the hull authored closest to this heading, and moves her bay with
   * it. `yaw` is in radians from her ready-to-leave pose, and wraps, so a
   * manoeuvre can be written as a continuous sweep past a full turn.
   */
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

  /** Berth → ahead up the fairway → starboard turn → out of the map. */
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

  /**
   * Parks the ship off frame before the clouds part, so the voyage visibly
   * continues into the new city instead of ending at a hard swap.
   */
  prepareContainerArrival(carriesContainer: boolean): void {
    const ship = this.harbourShip;
    const course = this.containerShipCourse();
    if (!ship || !course) return;
    this.tweens.killTweensOf(ship);
    ship.setPosition(course.open.x, course.open.y);
    // She is still running in from the offing when the clouds open.
    this.setShipYaw(YAW_INBOUND);
    if (carriesContainer) {
      // She has it aboard, so the destination quay starts bare -- the box the
      // crane lands there is this one, not a second copy.
      this.harbourQuayCargo?.destroy();
      this.harbourQuayCargo = undefined;
    }
    if (carriesContainer && !this.harbourShipCargo) {
      const cargo = this.add
        .sprite(0, 0, HARBOUR_CARGO_CONTAINER_KEY)
        .setOrigin(0.5, 1);
      this.harbourShipCargo = cargo;
      this.harbourSprites.push(cargo);
    }
    this.syncShipCargo();
  }

  /**
   * The departure run in reverse: straight in off the sea, a turn to port at
   * the same corner, then alongside -- so she arrives bow-first at her berth.
   */
  private async playContainerShipArrival(): Promise<void> {
    const ship = this.harbourShip;
    const course = this.containerShipCourse();
    if (!ship || !course) return;
    await this.sailContainerShip(
      course.open,
      course.corner,
      course.berth,
      "Quad.easeOut",
      // Running in, she is on the reciprocal of the course she left on: bow
      // landward down the offing, then round to bow down-coast alongside.
      { from: YAW_INBOUND, to: YAW_ALONGSIDE_IN },
    );
    // No idle bob yet: she still has to be worked and then turned round, and
    // a swell tween would fight the manoeuvre for her position.
    ship.setData("restY", course.berth.y);
  }

  /**
   * Covers a container voyage: load the box if the trip is carrying one, sail,
   * then close the clouds. The airport and PR-ship transitions stay separate.
   */
  async coverForContainerVoyage(carriesContainer: boolean): Promise<void> {
    if (carriesContainer) {
      await this.playContainerLoad();
    }
    await this.playContainerShipDeparture();
    await this.playCoverTransition();
  }

  /**
   * Parts the clouds, sails her in, lands the box on the new quay, and turns
   * her round so she is lying ready to leave again.
   */
  async revealAfterContainerVoyage(carriesContainer: boolean): Promise<void> {
    await this.partCloudCover();
    await this.playContainerShipArrival();
    if (carriesContainer) {
      await this.playContainerUnload();
    }
    await this.playContainerShipTurnaround();
  }

  private clearHarbour(): void {
    for (const sprite of this.harbourSprites) {
      this.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    for (const shape of this.harbourShapes) {
      shape.destroy();
    }
    for (const glow of this.harbourGlows) {
      this.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.tweens.killTweensOf(this.harbourHoist);
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

  private airportLayout(): AirportLayout {
    const size = this.snapshot?.size ?? { width: 8, height: 8 };
    return createAirportLayout(size.width, size.height);
  }

  private parkedAircraftRotation(airport: AirportLayout): number {
    const gate = projection.project(airport.gate.x, airport.gate.y);
    const standApproach = projection.project(
      airport.gate.x + 0.2,
      airport.gate.y + 0.52,
    );
    return aircraftRotation(standApproach, gate);
  }

  private clearAirportStatic(): void {
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
      this.tweens.killTweensOf(this.airportBeacon);
      this.airportBeacon.destroy();
      this.airportBeacon = undefined;
    }
    this.airportLayoutSignature = undefined;
    this.airportHoverListener?.(undefined);
  }

  private clearAirport(): void {
    this.clearAirportStatic();
    if (this.activeFlight) {
      this.tweens.killTweensOf(this.activeFlight);
      this.activeFlight.destroy();
      this.activeFlight = undefined;
    }
    if (this.activeFlightShadow) {
      this.tweens.killTweensOf(this.activeFlightShadow);
      this.activeFlightShadow.destroy();
      this.activeFlightShadow = undefined;
    }
    for (const effect of this.flightEffects) {
      this.tweens.killTweensOf(effect);
      effect.destroy();
    }
    this.flightEffects.clear();
  }

  private bindAirportInteractions(sprite: Phaser.GameObjects.Sprite): void {
    sprite.on("pointerover", () => {
      if (this.travelTransitionActive) return;
      const screen = this.worldToScreen(sprite.x, sprite.y);
      this.airportHoverListener?.({
        cityId: "airport",
        title: "CLAUDE CITY AIRPORT · CCX",
        action: "Open departures · choose repository city",
        screenX: screen.x,
        screenY: screen.y,
      });
    });
    sprite.on("pointerout", () => this.airportHoverListener?.(undefined));
    sprite.on("pointerdown", () => {
      if (this.travelTransitionActive) return;
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
    const shadow = this.add
      .sprite(start.x + 4, start.y + 4, AIRPLANE_SHADOW_KEY)
      .setOrigin(0.5)
      .setScale(AIRCRAFT_GROUND_SCALE)
      .setDepth(SKY_DEPTH - 7);
    const flight = this.add
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
      this.tweens.add({
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
      this.tweens.add({
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

  /** Gate → apron taxi → back-taxi → full-runway acceleration → straight climb. */
  private async playFlightTakeoff(): Promise<void> {
    const airport = this.airportLayout();
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
    const camera = this.cameras.main;
    // Continue on the same grid-y as every runway slab. The long extension is
    // viewport-derived so the aircraft always clears the frame at any zoom.
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

    // Departures turn screen-left immediately from the apron and follow one
    // broad taxi curve to the first threshold. They no longer turn right to
    // the middle connector, U-turn, and backtrack along the runway.
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

    // Quad.easeIn gives a restrained roll away from the threshold followed by
    // continuous, believable acceleration over the entire authored runway.
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

    // Ground x/y remains exactly on the runway's tile axis from threshold to
    // off-screen. Only altitude and shadow separation change after rotation;
    // locking the nose to runwayHeading prevents the climb reading as a turn.
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

  /** Cloud approach → aligned touchdown → rollout → curved taxi to gate. */
  private async playFlightLanding(): Promise<void> {
    const airport = this.airportLayout();
    // Approach from beyond the far threshold on precisely the same grid-y as
    // the runway. Altitude is the only coordinate that changes independently.
    const approachGrid = runwayExitPoint(airport, 18);
    const approachGround = projection.project(approachGrid.x, approachGrid.y);
    const touchdown = projection.project(airport.runwayEnd.x - 0.48, airport.runwayEnd.y);
    const landingHeading = aircraftRotation(approachGround, touchdown);
    const entry = projection.project(airport.runwayEntry.x, airport.runwayEntry.y);
    const gate = projection.project(airport.gate.x, airport.gate.y);
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

    const parkedRotation = this.parkedAircraftRotation(airport);
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
    const puff = this.add
      .sprite(x, y, SMOKE_KEY)
      .setScale(scale)
      .setAlpha(0.34)
      .setDepth(SKY_DEPTH - 6);
    this.flightEffects.add(puff);
    this.tweens.add({
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
    return new Promise((resolve) => this.time.delayedCall(duration, resolve));
  }

  /** The gentle swell the battleship rides at anchor; killed during a voyage. */
  private idleBobNavyShip(): void {
    const ship = this.navyBattleship;
    if (!ship) return;
    const restY = ship.getData("restY") as number;
    ship.setY(restY);
    if (prefersReducedMotion()) return;
    this.tweens.add({
      targets: ship,
      y: restY - 4,
      duration: 1_600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /**
   * Mirrors containerShipCourse for the battleship's own berth: straight up
   * the fairway, a turn at the corner, out to open water. Same apron axes as
   * the cargo wharf (see navyHarbour.ts), so the same tile vectors apply.
   */
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

  /** Shows the baked heading frame closest to `yaw`, in radians from her ready-to-leave pose. */
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

  /** Runs the battleship along a course, same quadratic-through-the-corner treatment as the container ship. */
  private sailNavyShip(
    from: ScreenPoint,
    through: ScreenPoint,
    to: ScreenPoint,
    ease: string,
    yaw: { from: number; to: number },
  ): Promise<void> {
    const ship = this.navyBattleship;
    if (!ship) return Promise.resolve();
    this.tweens.killTweensOf(ship);
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
      this.tweens.add({
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
          const helm = Phaser.Math.Clamp(
            (t - SHIP_TURN_START) / (SHIP_TURN_END - SHIP_TURN_START),
            0,
            1,
          );
          const eased = helm * helm * (3 - 2 * helm);
          this.setNavyShipYaw(yaw.from + (yaw.to - yaw.from) * eased);
        },
        onComplete: () => resolve(),
      });
    });
  }

  /** Berth → ahead up the fairway → starboard turn → out of the map. */
  private playNavyBattleshipDeparture(): Promise<void> {
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

  /**
   * Parks the battleship off frame before the clouds part, so the voyage
   * visibly continues into the new city instead of ending at a hard swap.
   */
  private prepareNavyArrival(): void {
    const ship = this.navyBattleship;
    const course = this.navyShipCourse();
    if (!ship || !course) return;
    this.tweens.killTweensOf(ship);
    ship.setAlpha(1);
    ship.setPosition(course.open.x, course.open.y);
    this.setNavyShipYaw(YAW_INBOUND);
  }

  /** The departure run in reverse: straight in off the sea, then alongside bow-first. */
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

  /**
   * She arrives lying the wrong way round to leave again, so she works
   * herself end-for-end in the basin -- the same seaward loop the container
   * ship uses at her berth -- and settles back onto her ready-to-leave heading.
   */
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

    this.tweens.killTweensOf(ship);
    if (prefersReducedMotion()) {
      this.setNavyShipYaw(YAW_OUTBOUND);
      ship.setData("restY", berth.y);
      this.idleBobNavyShip();
      return Promise.resolve();
    }
    const cursor = { t: 0 };
    return new Promise((resolve) => {
      this.tweens.add({
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

  /** Covers an in-workspace ship voyage; airport traffic is deliberately separate. */
  async coverForTravel(cityId: string): Promise<void> {
    await this.playNavyBattleshipDeparture();
    await this.playCoverTransition();
  }

  /** Covers a cross-repository journey after the aircraft has departed. */
  async coverForAirportTravel(): Promise<void> {
    await this.playFlightTakeoff();
    await this.playCoverTransition();
  }

  /**
   * Positions the destination battleship out at the offing before the cloud
   * cover parts. revealAfterTravel then sails her into port, making the trip
   * visibly continue into the new city instead of ending at a hard swap.
   */
  prepareArrivalForTravel(): void {
    this.prepareNavyArrival();
  }

  /** Parts clouds, sails her in alongside, then turns her round ready to leave again. */
  async revealAfterTravel(): Promise<void> {
    await this.partCloudCover();
    await this.playNavyBattleshipArrival();
    await this.playNavyBattleshipTurnaround();
  }

  /**
   * Reveals a newly loaded repository while the aircraft descends from the
   * cloud layer. Starting the descent before the final cloud clears is what
   * makes the landing read as an arrival rather than a post-cutscene extra.
   */
  async revealAfterAirportTravel(): Promise<void> {
    const reveal = this.partCloudCover();
    await this.wait(WHITEOUT_HOLD_MS + 120);
    const landing = this.playFlightLanding();
    await Promise.all([reveal, landing]);
  }

  private partCloudCover(): Promise<void> {
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
          resolve();
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
