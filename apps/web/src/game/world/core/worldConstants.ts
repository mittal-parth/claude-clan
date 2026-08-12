import { createIsoProjection } from "../../math/iso";
import { TILE_WIDTH, TILE_HEIGHT } from "../../textures/core";

export {
  HIGHLIGHT_KEY,
  SMOKE_KEY,
  RUBBLE_KEY,
  ADDED_MARKER_KEY,
  SELECT_KEY,
} from "../../textures/effects";

export {
  DIFF_SCAFFOLD_HEIGHT,
  DIFF_SCAFFOLD_KEY,
} from "../../textures/scaffold";

export {
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
} from "../../layouts/terrain";

export const ADDED_TINT = 0xffcf94;
export const MODIFIED_TINT = 0x9fe7ff;
export const MODIFIED_GLOW_TINT = 0x66d9ef;

export const SCAFFOLD_TINT = 0xe0453a;
export const SCAFFOLD_WRAP = 0.82;
export const MIN_SCAFFOLD_HEIGHT = 40;

export const projection = createIsoProjection(TILE_WIDTH, TILE_HEIGHT);

export const GROUND_DEPTH = -1_000_000;
export const HIGHLIGHT_DEPTH = -900_000;
export const TRAFFIC_DEPTH = -800_000;
export const SKY_DEPTH = 100_000_000;

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
export const FOCUS_ZOOM = 1.25;
export const FOCUS_DURATION_MS = 450;
export const CONSTRUCTION_LEGIBLE_ZOOM = 0.75;
export const CLICK_SLOP = 5;
export const CAMERA_YIELD_MS = 8_000;
export const PROP_BUDGET = 2_000;
export const SHORE_BAND = 3;
export const OPEN_WATER = 0x2e9fe0;
export const WHITEOUT_HOLD_MS = 500;
export const WHITEOUT_ALPHA = 0.9;
export const AIRCRAFT_GROUND_SCALE = 0.58;
export const AIRCRAFT_GROUND_LIFT = 7;
export const AIRCRAFT_ART_HEADING = Math.atan2(0.46, 0.89);

export const SHIP_SPACING = 3;

export const HOIST_REST_DU = 0.5;
export const HOIST_REST_DROP = 10;
export const CARRIED_CONTAINER_DROP = 42;
export const CRANE_SLEW_MS = 620;
export const CRANE_HOIST_MS = 520;
export const CONTAINER_SHIP_SAIL_MS = 1_650;
export const NAVY_SHIP_SAIL_MS = 1_650;
export const HARBOUR_HOVER_LABEL_LIFT = 190;
export const NAVY_HOVER_LABEL_LIFT = 190;
export const NAVY_HIT_ZONE_LIFT = 100;
export const HARBOUR_HIT_ZONE_LIFT = 100;

export const YAW_OUTBOUND = 0;
export const YAW_SEAWARD = Math.PI / 2;
export const YAW_ALONGSIDE_IN = Math.PI;
export const YAW_INBOUND = (3 * Math.PI) / 2;

export const NAVY_RADAR_SWEEP_STEP_MS = 190;
export const NAVY_ROTOR_STEP_MS = 45;

export const SHIP_TURNAROUND_MS = 2_400;
export const SHIP_FAIRWAY_TILES = 3.4;
export const SHIP_OFFING_TILES = 16;
