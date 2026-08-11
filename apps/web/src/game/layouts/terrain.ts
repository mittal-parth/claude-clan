/**
 * Terrain derivation — pure, no Phaser import, so it stays unit-testable.
 *
 * The world is a bounded island: the district field in the middle, a ring of
 * countryside, a sand coast, then ocean out to a hard edge that doubles as the
 * camera bound. Streets run on the protocol package's global block lattice
 * rather than on anything derived from a district: every district used to
 * invent its own street phase from its own fractional origin, and two
 * districts whose origins differed by an odd amount put their lanes one tile
 * apart -- a twin road. One shared lattice makes that unrepresentable.
 */

import {
  ARTERIAL_BLOCKS,
  BLOCK,
  capitolDistrict,
  capitolFits,
  isCourtyardCell,
  isPlotCell,
  isRoadLane,
  type CapitolDistrict,
  type DistrictRect,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { isOnAirportGround } from "./airport";
import { capitolCell } from "./capitol";
import { isOnCoastInstallation } from "./coast";
import { createPortRoads, type PortRoadPlan } from "./portRoads";
import { COAST_RING, COUNTRYSIDE_RING, OUTER_RING } from "./rings";
import { chance, hashCoords, hashText, mod, pickIndex, unitFloat } from "../math/hash";

export {
  COUNTRYSIDE_RING,
  COAST_RING,
  OCEAN_RING,
  OUTER_RING,
} from "./rings";

export { BLOCK, isCourtyardCell, isPlotCell, isRoadLane } from "@sudo-city/protocol";

/**
 * "plaza" is paving: the apron around the capitol and the walk that carries it
 * out to the boulevard. It is a terrain kind rather than something baked into
 * the capitol's own texture so that the paving comes from the same atlas as
 * every other tile — it batches with them, and it can never drift out of
 * alignment with the road it runs into.
 */
export type TerrainKind =
  | "water"
  | "sand"
  | "grass"
  | "ground"
  | "road"
  | "park"
  | "plaza";

export type PropKind = "tree" | "pine" | "bush" | "rock" | "fountain" | "lamp";

/**
 * A lane's class is decided by what it separates, not by anything persisted:
 * `boulevard` on the field's own edge ring, on the capitol's ring, and
 * between two different top-level folders; `street` between two districts of
 * the same top-level folder, and on every ARTERIAL_BLOCKS-th lane regardless
 * (which is what gives even a single-district repository a main road);
 * `lane` everywhere else. Deriving it from the districts already on the
 * snapshot -- rather than storing it -- is what keeps a PR city's roads
 * identical to main's: main's districts are pinned onto the PR snapshot
 * verbatim, so the same derivation produces the same classes.
 */
export type RoadClass = "boulevard" | "street" | "lane";

export interface TerrainCell {
  x: number;
  y: number;
  kind: TerrainKind;
  /** Texture variant within the kind. */
  variant: number;
  /** 4-bit N/E/S/W neighbour mask; only meaningful when kind is "road". */
  roadMask: number;
  /** Only meaningful when kind is "road". */
  roadClass?: RoadClass;
  prop?: PropKind;
  /**
   * Planting that belongs to a designed layout rather than to scatter, and so
   * is exempt from the decoration budget. Thinning the capitol's avenue of
   * trees to a quota would delete half of it at random and destroy the
   * symmetry that makes the mall read as a mall.
   */
  keepProp?: boolean;
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

/**
 * Which of a building's two visible walls (see drawBox: only +u and +v are
 * ever plated) carries its street-facing detail -- a doorway, a shopfront
 * awning. A plot's frontage can be on any of up to two sides depending on
 * where it sits in its block's ring, but only +u and +v are ever drawn, so a
 * plot fronting -u or -v has no visible face to put the feature on and falls
 * back to "v" -- the same default the building already had before either
 * wall meant anything in particular.
 */
export type BuildingFacing = "u" | "v";

/**
 * The wall a building at (x, y) should face its street-side detail toward.
 * +v is checked first: it is the wall the sun already lights, so it is the
 * more visible of the two even when a plot happens to front both sides.
 */
export function buildingFacingAt(x: number, y: number, terrain: TerrainGrid): BuildingFacing {
  if (terrain.cellAt(x, y + 1)?.kind === "road") {
    return "v";
  }
  if (terrain.cellAt(x + 1, y)?.kind === "road") {
    return "u";
  }
  return "v";
}

export const ROAD_NORTH = 1;
export const ROAD_EAST = 2;
export const ROAD_SOUTH = 4;
export const ROAD_WEST = 8;

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** How far, in tiles, the natural shoreline wanders either side of the ring. */
const SHORE_JITTER = 2.4;
/**
 * Tiles over which the dredged port frontage blends back into natural shore, so
 * the change of character reads as the harbour works ending rather than a seam.
 */
const FRONTAGE_FADE = 3;

/**
 * How much shoreline wander a cell gets, from 0 (dredged straight) to 1.
 *
 * The island's east side, alongside the city, is its port frontage: both aprons
 * and the lighthouse stand there and their sea walls are engineered straight.
 * A wandering shore on that stretch pushes sand tiles out past the quay wall
 * and under the berthed ships. Everywhere else keeps its ragged natural coast.
 */
function shoreJitterScale(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  if (x < width) return 1;
  // Distance, in tiles, past either end of the city's own height band.
  const beyond = Math.max(0, -y, y - (height - 1));
  return Math.min(1, beyond / FRONTAGE_FADE);
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
 * Distance from the city with the shoreline's wander applied — the number the
 * ring classifier actually thresholds against.
 *
 * The dock road has to ask the same question ("is this cell dry?") before it
 * lays a tile, and it has to get the same answer: computing the jitter twice
 * from two call sites is how a road ends up laid across a cell that classify()
 * then insists is open water.
 */
function shoreDistance(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const raw = distanceOutsideCity(x, y, width, height);
  if (raw === 0) {
    return 0;
  }
  // Jitter the shoreline so the island is not a rounded rectangle. Only ever
  // applied outside the city, so it can never erode buildable ground -- and
  // damped to nothing along the port frontage, where it would otherwise leave
  // sand standing through a quay and under a moored hull.
  return (
    raw +
    (unitFloat(hashCoords(x, y, 0x5ea)) - 0.5) *
      SHORE_JITTER *
      shoreJitterScale(x, y, width, height)
  );
}

/**
 * Indexes districts by integer cell. District rectangles are block-aligned and
 * half-open (a cell at x === district.x + district.width belongs to the next
 * district, or to no district at all on the field's own edge), so every cell
 * has exactly one owner with no rounding at the boundary.
 */
function indexDistricts(
  districts: readonly DistrictRect[],
  width: number,
  height: number,
): Map<string, DistrictRect> {
  const index = new Map<string, DistrictRect>();
  for (const district of districts) {
    const startX = Math.max(0, district.x);
    const startY = Math.max(0, district.y);
    const endX = Math.min(width - 1, district.x + district.width - 1);
    const endY = Math.min(height - 1, district.y + district.height - 1);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        index.set(cellKey(x, y), district);
      }
    }
  }
  return index;
}

/** The top-level path segment a district lives under, "" for the repo root. */
function topSegment(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

const ROAD_CLASS_RANK: Record<RoadClass, number> = { lane: 0, street: 1, boulevard: 2 };

function widerRoadClass(left: RoadClass, right: RoadClass): RoadClass {
  return ROAD_CLASS_RANK[left] >= ROAD_CLASS_RANK[right] ? left : right;
}

/**
 * The class of a single (non-junction) lane cell -- the arm reaching out from
 * a junction, or an ordinary mid-block lane cell. Determines its own
 * orientation from its own coordinate, so calling it on a junction's four
 * orthogonal neighbours classifies each of the junction's own arms.
 */
function laneClass(
  x: number,
  y: number,
  districtAt: ReadonlyMap<string, DistrictRect>,
): RoadClass {
  const vertical = mod(x, BLOCK) === 0;
  const a = districtAt.get(cellKey(vertical ? x - 1 : x, vertical ? y : y - 1));
  const b = districtAt.get(cellKey(vertical ? x + 1 : x, vertical ? y : y + 1));

  let boundary: RoadClass;
  if (!a || !b) {
    // The field's own edge ring: nothing lies on the far side.
    boundary = "boulevard";
  } else if (topSegment(a.path) !== topSegment(b.path)) {
    boundary = "boulevard";
  } else if (a.path !== b.path) {
    boundary = "street";
  } else {
    boundary = "lane";
  }

  const arterial = vertical
    ? mod(x, BLOCK * ARTERIAL_BLOCKS) === 0
    : mod(y, BLOCK * ARTERIAL_BLOCKS) === 0;
  const floor: RoadClass = arterial ? "street" : "lane";

  return widerRoadClass(boundary, floor);
}

/**
 * The class of any road lane cell, junction or straight run. A junction takes
 * the widest class of its own four arms -- the boulevard a junction sits on
 * must not be narrowed just because a back lane happens to cross it there.
 */
export function roadClassAt(
  x: number,
  y: number,
  districtAt: ReadonlyMap<string, DistrictRect>,
): RoadClass {
  const junction = mod(x, BLOCK) === 0 && mod(y, BLOCK) === 0;
  if (!junction) {
    return laneClass(x, y, districtAt);
  }
  return [
    laneClass(x + 1, y, districtAt),
    laneClass(x - 1, y, districtAt),
    laneClass(x, y + 1, districtAt),
    laneClass(x, y - 1, districtAt),
  ].reduce(widerRoadClass);
}

/**
 * Whether a non-lane cell has a boulevard immediately on one of its four
 * sides. Only ever true for a verge cell -- a plot or courtyard cell is
 * never adjacent to a lane at all, since the ring position between them
 * (offset 1 or 5) is exactly what a verge cell is.
 */
function borderingBoulevard(
  x: number,
  y: number,
  districtAt: ReadonlyMap<string, DistrictRect>,
): boolean {
  const neighbours: Array<[number, number]> = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
  return neighbours.some(
    ([nx, ny]) => isRoadLane(nx, ny) && roadClassAt(nx, ny, districtAt) === "boulevard",
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

  // The mall outranks every other classifier: its reserve is already excluded
  // from plot allocation, so nothing it overwrites was ever going to be built.
  const mall = capitolFits(snapshot.size)
    ? capitolDistrict(snapshot.size)
    : undefined;

  // The dock road is planned before any cell is classified because it is a
  // route, not a per-cell rule: it has to be walked end to end to know where
  // it runs out of dry land.
  const ports = createPortRoads({
    width,
    height,
    isLand: (x, y) => shoreDistance(x, y, width, height) <= COUNTRYSIDE_RING + COAST_RING,
    isCityRoad: (x, y) => isRoadLane(x, y),
  });

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const cell = classify(x, y, width, height, occupied, districtAt, mall, ports);
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
  mall: CapitolDistrict | undefined,
  ports: PortRoadPlan,
): TerrainCell {
  const mallCell = mall && capitolCell(mall, x, y);
  if (mallCell) {
    return mallCell;
  }

  if (distanceOutsideCity(x, y, width, height) === 0) {
    return classifyCity(x, y, occupied, districtAt);
  }

  // The dock road is only ever consulted outside the field, below the city
  // branch above: it runs from the city edge out to the two aprons and must
  // never be in a position to pave over a plot.
  if (ports.has(x, y)) {
    // A working road, not a back lane and not a boulevard.
    return { x, y, kind: "road", variant: 0, roadMask: 0, roadClass: "street" };
  }

  const distance = shoreDistance(x, y, width, height);

  if (distance <= COUNTRYSIDE_RING) {
    // The harbour, the naval base and the airport are all sprites, not
    // terrain (see CLAUDE.md on the capitol), so nothing else stops the
    // countryside's tree scatter from planting one on the runway or inside
    // the naval base's own fence line.
    const noProp =
      isOnCoastInstallation(x, y, width, height) || isOnAirportGround(x, y, width, height);
    return grassCell(x, y, 0x7ee, noProp);
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

/**
 * Classifies one city cell against the lattice.
 *
 * The order matters and is the fix for the old checkerboard: a plot cell is
 * classified as ground whether or not a building actually stands there yet,
 * so the allocator and the terrain pass can never disagree about which cells
 * are streets. isPlotCell only ever returns true for a cell isRoadLane
 * already rejected, so a building can no longer win a fight with a road tile
 * for the same cell -- there is no fight, because the two sets are disjoint
 * by construction.
 */
function classifyCity(
  x: number,
  y: number,
  occupied: ReadonlySet<string>,
  districtAt: ReadonlyMap<string, DistrictRect>,
): TerrainCell {
  const district = districtAt.get(cellKey(x, y));

  if (occupied.has(cellKey(x, y))) {
    return { x, y, kind: "ground", variant: 0, roadMask: 0 };
  }
  if (isRoadLane(x, y)) {
    const roadClass = roadClassAt(x, y, districtAt);
    // A lamp at every boulevard junction. keepProp exempts it from the
    // decoration budget, the same guard the capitol's own avenue uses --
    // without it a large city would thin a designed row of lamps down to a
    // random scatter of them.
    const junction = mod(x, BLOCK) === 0 && mod(y, BLOCK) === 0;
    const lamp = junction && roadClass === "boulevard";
    return {
      x,
      y,
      kind: "road",
      variant: 0,
      roadMask: 0,
      roadClass,
      prop: lamp ? "lamp" : undefined,
      keepProp: lamp,
    };
  }
  if (!district) {
    return grassCell(x, y, 0x9c1);
  }
  if (isPlotCell(x, y)) {
    // An empty lot -- a plot cell nothing has been sited on yet.
    return { x, y, kind: "ground", variant: 0, roadMask: 0 };
  }

  // The verge and the courtyard: the cells of a block that are neither a
  // plot ring position nor a lane. A verge cell beside a boulevard gets a
  // kerbside tree, deliberately and every time -- the avenue that marks a
  // main road, not a random chance of one -- exempted from the decoration
  // budget for the same reason the lamps are.
  if (borderingBoulevard(x, y, districtAt)) {
    return {
      x,
      y,
      kind: "park",
      variant: pickIndex(hashCoords(x, y, 0x3f5), 2),
      roadMask: 0,
      prop: "tree",
      keepProp: true,
    };
  }

  // The courtyard core gets a higher chance of planting than the verge --
  // it reads as the block's own shared green, so it should look more
  // deliberately kept than the odd corner of a lot.
  const courtyard = isCourtyardCell(x, y);
  // Salting the variant pick with the district's own path, rather than only
  // the tile coordinate, is what gives one neighbourhood's parks a different
  // lean between the two park textures than its neighbour's -- still random
  // tile to tile, but biased the same way across one district, which is the
  // only way ground tone can read as belonging to a place rather than to a
  // single square of it.
  const seed = hashCoords(x, y, courtyard ? 0x3f3 : 0x3f0);
  if (!chance(seed, courtyard ? 0.7 : 0.4)) {
    return { x, y, kind: "ground", variant: 0, roadMask: 0 };
  }
  const districtSalt = hashText(district.path, 0x3f4);
  return {
    x,
    y,
    kind: "park",
    variant: pickIndex(hashCoords(x, y, 0x3f1) ^ districtSalt, 2),
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

/**
 * `noProp` keeps a tile's ground kind and colour untouched but never seeds a
 * tree, pine, bush or rock on it -- used for the countryside tiles a coastal
 * installation or the airport occupies, which are sprites drawn over the
 * terrain rather than terrain cells themselves (see CLAUDE.md on the
 * capitol), so nothing else would stop a prop growing right through one.
 */
function grassCell(x: number, y: number, salt: number, noProp = false): TerrainCell {
  const seed = hashCoords(x, y, salt);
  return {
    x,
    y,
    kind: "grass",
    variant: pickIndex(hashCoords(x, y, salt ^ 0x11), 3),
    roadMask: 0,
    prop: noProp ? undefined : countrysideProp(seed),
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
