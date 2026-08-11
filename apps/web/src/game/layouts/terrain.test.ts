import { BLOCK } from "@sudo-city/protocol";
import type { WorldSnapshot } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { isOnAirportGround } from "./airport";
import { coastLanes, isOnCoastInstallation } from "./coast";
import { createPortRoads } from "./portRoads";
import {
  COAST_RING,
  COUNTRYSIDE_RING,
  OUTER_RING,
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  buildTerrain,
  buildingFacingAt,
  isPlotCell,
  isRoadLane,
  roadMaskAt,
  type TerrainCell,
} from "./terrain";

// Four blocks square: (25 - 1) / BLOCK === 4, so the field tiles exactly with
// no remainder, and the "src" / "test" districts each get two whole blocks.
const SIZE = BLOCK * 4 + 1;

/**
 * Mirrors layoutWorld output: two block-aligned districts tiling the field,
 * with plots on the lattice's own ring cells (isPlotCell), exactly as
 * layoutWorld would hand out.
 */
function snapshot(): WorldSnapshot {
  const plots = [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { x: BLOCK + 1, y: 1 },
    { x: 1, y: BLOCK + 1 },
    { x: BLOCK * 2 + 1, y: 1 },
    { x: BLOCK * 2 + 5, y: 1 },
    { x: BLOCK * 3 + 1, y: 1 },
    { x: BLOCK * 2 + 1, y: BLOCK + 1 },
  ];
  return {
    id: "world:test",
    repoPath: "/fixture",
    revision: "test",
    generatedAt: "2026-08-08T00:00:00.000Z",
    size: { width: SIZE, height: SIZE },
    districts: [
      { path: "src", x: 0, y: 0, width: BLOCK * 2, height: BLOCK * 4, weight: 100 },
      { path: "test", x: BLOCK * 2, y: 0, width: BLOCK * 2, height: BLOCK * 4, weight: 60 },
    ],
    buildings: plots.map((plot, index) => ({
      path: `src/file-${index}.ts`,
      district: plot.x < BLOCK * 2 ? "src" : "test",
      language: "TypeScript",
      loc: 40 + index * 30,
      plot,
    })),
  };
}

describe("terrain bounds", () => {
  it("wraps the city in countryside, coast and ocean", () => {
    const grid = buildTerrain(snapshot());

    expect(grid.bounds).toEqual({
      minX: -OUTER_RING,
      minY: -OUTER_RING,
      maxX: SIZE - 1 + OUTER_RING,
      maxY: SIZE - 1 + OUTER_RING,
    });
    const span = SIZE + OUTER_RING * 2;
    expect(grid.cells).toHaveLength(span * span);
  });

  it("classifies each ring by distance from the city", () => {
    const grid = buildTerrain(snapshot());
    const kindAt = (x: number, y: number) => grid.cellAt(x, y)?.kind;

    // Inside the field.
    expect(["road", "ground", "park"]).toContain(kindAt(4, 4));
    // Just outside: countryside, well within the jitter band.
    expect(kindAt(-2, -2)).toBe("grass");
    expect(kindAt(SIZE + 1, 4)).toBe("grass");
    // Far outside: open water.
    expect(kindAt(-OUTER_RING, -OUTER_RING)).toBe("water");
    expect(kindAt(SIZE - 1 + OUTER_RING, 4)).toBe("water");
  });

  it("lays a sand coast between the countryside and the ocean", () => {
    const grid = buildTerrain(snapshot());
    const sand = grid.cells.filter((cell) => cell.kind === "sand");

    expect(sand.length).toBeGreaterThan(0);
    for (const cell of sand) {
      const dx = cell.x < 0 ? -cell.x : Math.max(0, cell.x - (SIZE - 1));
      const dy = cell.y < 0 ? -cell.y : Math.max(0, cell.y - (SIZE - 1));
      const distance = Math.hypot(dx, dy);
      // Jitter is +/-1.2, so the band can only ever drift by that much.
      expect(distance).toBeGreaterThan(COUNTRYSIDE_RING - 1.3);
      expect(distance).toBeLessThan(COUNTRYSIDE_RING + COAST_RING + 1.3);
    }
  });

  it("never floods a city cell", () => {
    const grid = buildTerrain(snapshot());

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        expect(grid.cellAt(x, y)?.kind).not.toBe("water");
        expect(grid.cellAt(x, y)?.kind).not.toBe("sand");
      }
    }
  });
});

describe("street grid", () => {
  it("puts a street on every BLOCK-th lane, regardless of district", () => {
    expect(isRoadLane(0, 1)).toBe(true);
    expect(isRoadLane(BLOCK, 1)).toBe(true);
    expect(isRoadLane(1, BLOCK)).toBe(true);
    expect(isRoadLane(1, 1)).toBe(false);
    expect(isRoadLane(BLOCK - 1, BLOCK - 1)).toBe(false);
  });

  it("is the same lattice on both sides of a district boundary", () => {
    // Before the lattice, each district measured its own lanes from its own
    // origin, so two neighbouring districts whose origins differed by an odd
    // amount put their lanes one tile apart. A global lattice has no origin to
    // differ: isRoadLane depends only on the coordinate.
    expect(isRoadLane(BLOCK * 2, 1)).toBe(true);
    expect(isRoadLane(BLOCK * 2 - 1, 1)).toBe(false);
    expect(isRoadLane(BLOCK * 2 + 1, 1)).toBe(false);
  });

  it("never puts a street on a plot cell", () => {
    for (let x = 0; x < BLOCK * 4; x += 1) {
      for (let y = 0; y < BLOCK * 4; y += 1) {
        if (isPlotCell(x, y)) {
          expect(isRoadLane(x, y)).toBe(false);
        }
      }
    }
  });

  it("gives every plot cell frontage on a lane", () => {
    for (let x = 0; x < BLOCK * 4; x += 1) {
      for (let y = 0; y < BLOCK * 4; y += 1) {
        if (!isPlotCell(x, y)) {
          continue;
        }
        const adjacent =
          isRoadLane(x + 1, y) || isRoadLane(x - 1, y) || isRoadLane(x, y + 1) || isRoadLane(x, y - 1);
        expect(adjacent).toBe(true);
      }
    }
  });

  it("never places a street on an occupied plot", () => {
    const world = snapshot();
    const grid = buildTerrain(world);

    for (const building of world.buildings) {
      expect(grid.cellAt(building.plot.x, building.plot.y)?.kind).toBe("ground");
    }
  });

  it("leaves an empty verge cell as greenery or a lot", () => {
    const grid = buildTerrain(snapshot());

    // (1, 2) is a verge cell: not a lane, not a plot ring position, and not
    // part of the courtyard core, so it only ever gets the plain treatment.
    expect(["park", "ground"]).toContain(grid.cellAt(1, 2)?.kind);
    expect(grid.cellAt(1, 2)?.kind).not.toBe("road");
  });

  it("leaves the block's courtyard core as greenery or a lot, like any other interior cell", () => {
    const grid = buildTerrain(snapshot());
    for (let dx = 2; dx <= 4; dx += 1) {
      for (let dy = 2; dy <= 4; dy += 1) {
        const kind = grid.cellAt(dx, dy)?.kind;
        expect(["park", "ground"]).toContain(kind);
      }
    }
  });

  it("produces a connected grid, not isolated fragments", () => {
    const grid = buildTerrain(snapshot());

    expect(grid.roads.length).toBeGreaterThan(0);
    const isolated = grid.roads.filter((road) => road.roadMask === 0);
    expect(isolated).toEqual([]);
  });

  it("meets at a crossroads where two streets intersect", () => {
    const grid = buildTerrain(snapshot());
    const junction = grid.cellAt(BLOCK, BLOCK);

    expect(junction?.kind).toBe("road");
    expect(junction?.roadMask).toBe(
      ROAD_NORTH | ROAD_EAST | ROAD_SOUTH | ROAD_WEST,
    );
  });

  it("turns a corner at the city edge", () => {
    const grid = buildTerrain(snapshot());

    // (0,0): no street north or west (outside the field), streets running
    // east and south along the field's own ring road.
    expect(grid.cellAt(0, 0)?.roadMask).toBe(ROAD_EAST | ROAD_SOUTH);
  });
});

describe("the dock road", () => {
  it("carries the street grid out to both aprons", () => {
    const grid = buildTerrain(snapshot());
    const road = createPortRoads({
      width: SIZE,
      height: SIZE,
      isLand: () => true,
      isCityRoad: () => true,
    });
    const lanes = coastLanes(SIZE);

    for (const lane of [lanes.navy, lanes.harbour]) {
      expect(grid.cellAt(road.spineX, Math.round(lane))?.kind).toBe("road");
    }
  });

  it("welds itself to a city street rather than dead-ending at the field", () => {
    const grid = buildTerrain(snapshot());
    // The field's east edge (x = SIZE - 1) is entirely a lattice lane, so the
    // link always finds a street to join on its very first try: the ideal row.
    const linkRow = Math.min(SIZE - 1, Math.max(0, Math.round(coastLanes(SIZE).lighthouse)));

    expect(grid.cellAt(SIZE - 1, linkRow)?.kind).toBe("road");
    expect(grid.cellAt(SIZE, linkRow)?.kind).toBe("road");
    expect(grid.cellAt(SIZE - 1, linkRow)?.roadMask ?? 0).toBeGreaterThan(0);
    expect((grid.cellAt(SIZE, linkRow)?.roadMask ?? 0) & ROAD_WEST).toBe(ROAD_WEST);
  });

  it("never paves a cell the city wanted for something else", () => {
    const world = snapshot();
    const grid = buildTerrain(world);

    // Everything outside the field that is road belongs to the dock road, and
    // none of it may stand on water or on a plot.
    const outside = grid.roads.filter(
      (cell) => cell.x > SIZE - 1 || cell.x < 0 || cell.y > SIZE - 1 || cell.y < 0,
    );
    expect(outside.length).toBeGreaterThan(0);
    for (const cell of outside) {
      expect(cell.x).toBeGreaterThan(SIZE - 1);
    }
    for (const building of world.buildings) {
      expect(grid.cellAt(building.plot.x, building.plot.y)?.kind).toBe("ground");
    }
  });
});

describe("landmark clearings", () => {
  it("never seeds a tree, pine, bush or rock inside a coastal installation's own ground", () => {
    const grid = buildTerrain(snapshot());
    let checked = 0;

    for (const cell of grid.cells) {
      if (!isOnCoastInstallation(cell.x, cell.y, SIZE, SIZE)) {
        continue;
      }
      checked += 1;
      expect(cell.prop).toBeUndefined();
    }
    // The fixture's coastline has to actually pass through the harbour's and
    // the naval base's own reserved ground, or this test would trivially pass
    // by never finding a cell to check.
    expect(checked).toBeGreaterThan(0);
  });

  it("never seeds a tree, pine, bush or rock inside the airport's own ground", () => {
    const grid = buildTerrain(snapshot());
    let checked = 0;

    for (const cell of grid.cells) {
      // Restricted to genuinely outside-city cells: the airport's reserved
      // rectangles are only ever consulted for the countryside ring (see
      // classify() in terrain.ts), and a corner of one can geometrically
      // touch the field's own edge column without that column ever being
      // reached through this path -- it is governed by classifyCity instead.
      const outsideCity = cell.x < 0 || cell.x >= SIZE || cell.y < 0 || cell.y >= SIZE;
      if (!outsideCity || !isOnAirportGround(cell.x, cell.y, SIZE, SIZE)) {
        continue;
      }
      checked += 1;
      expect(cell.prop).toBeUndefined();
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("leaves the ground kind and colour of a reserved tile untouched -- only its prop is suppressed", () => {
    const grid = buildTerrain(snapshot());

    for (const cell of grid.cells) {
      if (!isOnCoastInstallation(cell.x, cell.y, SIZE, SIZE)) {
        continue;
      }
      // Still ordinary countryside grass (or sand/water, further out) --
      // the clearing is invisible, not a bare patch standing out from its
      // surroundings.
      expect(["grass", "sand", "water", "road"]).toContain(cell.kind);
    }
  });
});

describe("building facing", () => {
  // One district covering the whole field, so every lattice lane is a road
  // regardless of district boundaries -- isolates buildingFacingAt's own
  // logic from roadClassAt's.
  const FACING_SIZE = BLOCK * 3 + 1;
  function facingSnapshot(): WorldSnapshot {
    return {
      id: "world:facing",
      repoPath: "/fixture",
      revision: "facing",
      generatedAt: "2026-08-11T00:00:00.000Z",
      size: { width: FACING_SIZE, height: FACING_SIZE },
      districts: [
        { path: "src", x: 0, y: 0, width: FACING_SIZE - 1, height: FACING_SIZE - 1, weight: 1 },
      ],
      buildings: [],
    };
  }

  it("faces the +v wall toward a street on the south side of the plot", () => {
    const grid = buildTerrain(facingSnapshot());
    // (9, 11): the south-mid ring position of block (1,1) -- its only
    // frontage is the lane at y = 12, directly on its +v side.
    expect(buildingFacingAt(9, 11, grid)).toBe("v");
  });

  it("faces the +u wall toward a street on the east side of the plot", () => {
    const grid = buildTerrain(facingSnapshot());
    // (11, 9): the east-mid ring position of block (1,1) -- its only
    // frontage is the lane at x = 12, directly on its +u side.
    expect(buildingFacingAt(11, 9, grid)).toBe("u");
  });

  it("prefers +v when a corner plot fronts both visible walls", () => {
    const grid = buildTerrain(facingSnapshot());
    // (11, 11): the south-east corner of block (1,1) -- both x = 12 and
    // y = 12 are lanes, so either wall is a legitimate street frontage.
    expect(buildingFacingAt(11, 11, grid)).toBe("v");
  });

  it("falls back to +v when neither visible wall fronts a street", () => {
    const grid = buildTerrain(facingSnapshot());
    // (7, 1): the north-mid ring position of block (1,0) -- its only
    // frontage is at y = 0, the -v side, which drawBox never plates.
    expect(buildingFacingAt(7, 1, grid)).toBe("v");
  });
});

describe("road connectivity masks", () => {
  function mapWith(neighbours: Array<[number, number]>): Map<string, TerrainCell> {
    const road = (x: number, y: number): TerrainCell => ({
      x,
      y,
      kind: "road",
      variant: 0,
      roadMask: 0,
    });
    const cells = new Map<string, TerrainCell>();
    cells.set("0:0", road(0, 0));
    for (const [x, y] of neighbours) {
      cells.set(`${x}:${y}`, road(x, y));
    }
    return cells;
  }

  const north: [number, number] = [0, -1];
  const east: [number, number] = [1, 0];
  const south: [number, number] = [0, 1];
  const west: [number, number] = [-1, 0];

  it("resolves all sixteen neighbour combinations", () => {
    const cases: Array<[Array<[number, number]>, number]> = [
      [[], 0],
      [[north], ROAD_NORTH],
      [[east], ROAD_EAST],
      [[south], ROAD_SOUTH],
      [[west], ROAD_WEST],
      [[north, south], ROAD_NORTH | ROAD_SOUTH],
      [[east, west], ROAD_EAST | ROAD_WEST],
      [[north, east], ROAD_NORTH | ROAD_EAST],
      [[east, south], ROAD_EAST | ROAD_SOUTH],
      [[south, west], ROAD_SOUTH | ROAD_WEST],
      [[west, north], ROAD_WEST | ROAD_NORTH],
      [[north, east, south], ROAD_NORTH | ROAD_EAST | ROAD_SOUTH],
      [[east, south, west], ROAD_EAST | ROAD_SOUTH | ROAD_WEST],
      [[south, west, north], ROAD_SOUTH | ROAD_WEST | ROAD_NORTH],
      [[west, north, east], ROAD_WEST | ROAD_NORTH | ROAD_EAST],
      [
        [north, east, south, west],
        ROAD_NORTH | ROAD_EAST | ROAD_SOUTH | ROAD_WEST,
      ],
    ];

    expect(new Set(cases.map(([, mask]) => mask)).size).toBe(16);
    for (const [neighbours, expected] of cases) {
      expect(roadMaskAt(0, 0, mapWith(neighbours))).toBe(expected);
    }
  });

  it("ignores neighbours that are not streets", () => {
    const cells = new Map<string, TerrainCell>([
      ["0:0", { x: 0, y: 0, kind: "road", variant: 0, roadMask: 0 }],
      ["0:-1", { x: 0, y: -1, kind: "park", variant: 0, roadMask: 0 }],
      ["1:0", { x: 1, y: 0, kind: "road", variant: 0, roadMask: 0 }],
    ]);

    expect(roadMaskAt(0, 0, cells)).toBe(ROAD_EAST);
  });
});

describe("determinism", () => {
  it("classifies identically across rebuilds", () => {
    const world = snapshot();

    expect(buildTerrain(world).cells).toEqual(buildTerrain(world).cells);
  });

  it("changes nothing but the new plot when a building is added", () => {
    const before = buildTerrain(snapshot());
    // Build on a park cell so the change is actually observable; a bare lot
    // and a built plot both classify as "ground".
    const park = before.cells.find(
      (cell) => cell.kind === "park" && cell.x > 0 && cell.x < BLOCK * 2,
    );
    if (!park) {
      throw new Error("fixture produced no park cell to build on");
    }

    const grown = snapshot();
    grown.buildings.push({
      path: "src/late.ts",
      district: "src",
      language: "TypeScript",
      loc: 20,
      plot: { x: park.x, y: park.y },
    });
    const after = buildTerrain(grown);

    const differing = after.cells.filter(
      (cell, index) =>
        JSON.stringify(cell) !== JSON.stringify(before.cells[index]),
    );

    expect(differing.map((cell) => [cell.x, cell.y])).toEqual([[park.x, park.y]]);
    expect(after.cellAt(park.x, park.y)?.kind).toBe("ground");
  });

  it("keeps every plot cell off the lattice's own lanes", () => {
    for (let x = 0; x < BLOCK * 6; x += 1) {
      for (let y = 0; y < BLOCK * 6; y += 1) {
        expect(isPlotCell(x, y) && isRoadLane(x, y)).toBe(false);
      }
    }
  });
});
