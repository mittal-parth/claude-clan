/**
 * Terrain derivation — pure, no Phaser import, so it stays unit-testable.
 *
 * The world is a bounded island: the district field in the middle, a ring of
 * countryside, a sand coast, then ocean out to a hard edge that doubles as the
 * camera bound. Streets are derived from the layout package's plot stride
 * rather than invented: findPlotInDistrict() steps 2 and insets by 1, so every
 * even lane inside a district is guaranteed free.
 */

import type { DistrictRect, WorldSnapshot } from "@sudo-city/protocol";
import { chance, hashCoords, mod, pickIndex, unitFloat } from "./hash";

export const COUNTRYSIDE_RING = 6;
export const COAST_RING = 2;
export const OCEAN_RING = 12;
export const OUTER_RING = COUNTRYSIDE_RING + COAST_RING + OCEAN_RING;

/**
 * Streets every 6 lanes. Free lanes inside a district sit at even offsets and
 * buildings at odd ones, so an even stride always lands on a free lane and can
 * never collide with a plot. Six leaves a five-wide block — three building
 * columns and the greenery between them — where four made the city read as
 * mostly road.
 */
export const BLOCK_STRIDE = 6;

export type TerrainKind = "water" | "sand" | "grass" | "ground" | "road" | "park";

export type PropKind = "tree" | "pine" | "bush" | "rock" | "fountain";

export interface TerrainCell {
  x: number;
  y: number;
  kind: TerrainKind;
  /** Texture variant within the kind. */
  variant: number;
  /** 4-bit N/E/S/W neighbour mask; only meaningful when kind is "road". */
  roadMask: number;
  prop?: PropKind;
}

export interface TerrainBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TerrainGrid {
  bounds: TerrainBounds;
  cells: TerrainCell[];
  roads: TerrainCell[];
  cellAt(x: number, y: number): TerrainCell | undefined;
}

export const ROAD_NORTH = 1;
export const ROAD_EAST = 2;
export const ROAD_SOUTH = 4;
export const ROAD_WEST = 8;

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** Euclidean distance from a point to the city rectangle; 0 when inside. */
function distanceOutsideCity(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const dx = x < 0 ? -x : x > width - 1 ? x - (width - 1) : 0;
  const dy = y < 0 ? -y : y > height - 1 ? y - (height - 1) : 0;
  return Math.hypot(dx, dy);
}

/**
 * Indexes districts by integer cell. Districts tile the field exactly, so
 * assigning by cell centre gives each cell exactly one owner.
 */
function indexDistricts(
  districts: readonly DistrictRect[],
  width: number,
  height: number,
): Map<string, DistrictRect> {
  const index = new Map<string, DistrictRect>();
  for (const district of districts) {
    const startX = Math.max(0, Math.round(district.x));
    const startY = Math.max(0, Math.round(district.y));
    const endX = Math.min(width - 1, Math.ceil(district.x + district.width) - 1);
    const endY = Math.min(height - 1, Math.ceil(district.y + district.height) - 1);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        index.set(cellKey(x, y), district);
      }
    }
  }
  return index;
}

/** A street lane runs along every BLOCK_STRIDE-th lane from the district origin. */
export function isRoadLane(district: DistrictRect, x: number, y: number): boolean {
  const originX = Math.ceil(district.x);
  const originY = Math.ceil(district.y);
  return (
    mod(x - originX, BLOCK_STRIDE) === 0 || mod(y - originY, BLOCK_STRIDE) === 0
  );
}

export function buildTerrain(snapshot: WorldSnapshot): TerrainGrid {
  const { width, height } = snapshot.size;
  const bounds: TerrainBounds = {
    minX: -OUTER_RING,
    minY: -OUTER_RING,
    maxX: width - 1 + OUTER_RING,
    maxY: height - 1 + OUTER_RING,
  };

  const occupied = new Set<string>(
    snapshot.buildings.map((building) => cellKey(building.plot.x, building.plot.y)),
  );
  const districtAt = indexDistricts(snapshot.districts, width, height);

  const cells: TerrainCell[] = [];
  const byKey = new Map<string, TerrainCell>();

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const cell = classify(x, y, width, height, occupied, districtAt);
      cells.push(cell);
      byKey.set(cellKey(x, y), cell);
    }
  }

  // Connectivity needs every road classified first.
  const roads = cells.filter((cell) => cell.kind === "road");
  for (const cell of roads) {
    cell.roadMask = roadMaskAt(cell.x, cell.y, byKey);
  }

  return {
    bounds,
    cells,
    roads,
    cellAt: (x, y) => byKey.get(cellKey(x, y)),
  };
}

function classify(
  x: number,
  y: number,
  width: number,
  height: number,
  occupied: ReadonlySet<string>,
  districtAt: ReadonlyMap<string, DistrictRect>,
): TerrainCell {
  const raw = distanceOutsideCity(x, y, width, height);

  if (raw === 0) {
    return classifyCity(x, y, occupied, districtAt);
  }

  // Jitter the shoreline so the island is not a rounded rectangle. Only ever
  // applied outside the city, so it can never erode buildable ground.
  const distance = raw + (unitFloat(hashCoords(x, y, 0x5ea)) - 0.5) * 2.4;

  if (distance <= COUNTRYSIDE_RING) {
    return grassCell(x, y, 0x7ee);
  }
  if (distance <= COUNTRYSIDE_RING + COAST_RING) {
    return {
      x,
      y,
      kind: "sand",
      variant: pickIndex(hashCoords(x, y, 0x5a4), 2),
      roadMask: 0,
    };
  }
  return {
    x,
    y,
    kind: "water",
    variant: 0,
    roadMask: 0,
  };
}

function classifyCity(
  x: number,
  y: number,
  occupied: ReadonlySet<string>,
  districtAt: ReadonlyMap<string, DistrictRect>,
): TerrainCell {
  const district = districtAt.get(cellKey(x, y));

  // A plot always wins — a building must never be planted on a street.
  if (occupied.has(cellKey(x, y))) {
    return { x, y, kind: "ground", variant: 0, roadMask: 0 };
  }
  if (!district) {
    return grassCell(x, y, 0x9c1);
  }
  if (isRoadLane(district, x, y)) {
    return { x, y, kind: "road", variant: 0, roadMask: 0 };
  }

  // The lane between two building columns becomes greenery or a bare lot.
  const seed = hashCoords(x, y, 0x3f0);
  if (!chance(seed, 0.6)) {
    return { x, y, kind: "ground", variant: 0, roadMask: 0 };
  }
  return {
    x,
    y,
    kind: "park",
    variant: pickIndex(hashCoords(x, y, 0x3f1), 2),
    roadMask: 0,
    prop: parkProp(hashCoords(x, y, 0x3f2)),
  };
}

function parkProp(seed: number): PropKind | undefined {
  const roll = unitFloat(seed);
  if (roll < 0.34) {
    return "tree";
  }
  if (roll < 0.52) {
    return "bush";
  }
  if (roll < 0.6) {
    return "fountain";
  }
  return undefined;
}

function grassCell(x: number, y: number, salt: number): TerrainCell {
  const seed = hashCoords(x, y, salt);
  return {
    x,
    y,
    kind: "grass",
    variant: pickIndex(hashCoords(x, y, salt ^ 0x11), 3),
    roadMask: 0,
    prop: countrysideProp(seed),
  };
}

function countrysideProp(seed: number): PropKind | undefined {
  const roll = unitFloat(seed);
  if (roll < 0.09) {
    return "tree";
  }
  if (roll < 0.15) {
    return "pine";
  }
  if (roll < 0.18) {
    return "bush";
  }
  if (roll < 0.19) {
    return "rock";
  }
  return undefined;
}

export function roadMaskAt(
  x: number,
  y: number,
  byKey: ReadonlyMap<string, TerrainCell>,
): number {
  const isRoad = (nx: number, ny: number): boolean =>
    byKey.get(cellKey(nx, ny))?.kind === "road";

  return (
    (isRoad(x, y - 1) ? ROAD_NORTH : 0) |
    (isRoad(x + 1, y) ? ROAD_EAST : 0) |
    (isRoad(x, y + 1) ? ROAD_SOUTH : 0) |
    (isRoad(x - 1, y) ? ROAD_WEST : 0)
  );
}
