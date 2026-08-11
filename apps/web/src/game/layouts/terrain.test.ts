import type { WorldSnapshot } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import {
  BLOCK_STRIDE,
  COAST_RING,
  COUNTRYSIDE_RING,
  OUTER_RING,
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  buildTerrain,
  isRoadLane,
  roadMaskAt,
  type TerrainCell,
} from "./terrain";

const SIZE = 16;

/**
 * Mirrors layoutWorld output: two districts tiling a 16x16 field, with plots on
 * the odd lanes that findPlotInDistrict would have handed out.
 */
function snapshot(): WorldSnapshot {
  const plots = [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 5, y: 3 },
    { x: 1, y: 5 },
    { x: 7, y: 7 },
    { x: 9, y: 1 },
    { x: 11, y: 3 },
    { x: 13, y: 9 },
  ];
  return {
    id: "world:test",
    repoPath: "/fixture",
    revision: "test",
    generatedAt: "2026-08-08T00:00:00.000Z",
    size: { width: SIZE, height: SIZE },
    districts: [
      { path: "src", x: 0, y: 0, width: 8, height: 16, weight: 100 },
      { path: "test", x: 8, y: 0, width: 8, height: 16, weight: 60 },
    ],
    buildings: plots.map((plot, index) => ({
      path: `src/file-${index}.ts`,
      district: plot.x < 8 ? "src" : "test",
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
  it("puts a street on every BLOCK_STRIDE-th lane from the district origin", () => {
    const district = { path: "src", x: 0, y: 0, width: 24, height: 24, weight: 1 };

    expect(isRoadLane(district, 0, 1)).toBe(true);
    expect(isRoadLane(district, BLOCK_STRIDE, 1)).toBe(true);
    expect(isRoadLane(district, 1, BLOCK_STRIDE)).toBe(true);
    expect(isRoadLane(district, 1, 1)).toBe(false);
    expect(isRoadLane(district, BLOCK_STRIDE - 1, BLOCK_STRIDE - 1)).toBe(false);
  });

  it("offsets the lane grid to each district's own origin", () => {
    const district = { path: "test", x: 8, y: 0, width: 24, height: 24, weight: 1 };

    expect(isRoadLane(district, 8, 1)).toBe(true);
    expect(isRoadLane(district, 8 + BLOCK_STRIDE, 1)).toBe(true);
    expect(isRoadLane(district, 9, 1)).toBe(false);
  });

  it("never puts a street on an odd lane, where plots live", () => {
    const district = { path: "src", x: 0, y: 0, width: 24, height: 24, weight: 1 };

    // findPlotInDistrict starts at ceil(x)+1 and steps 2, so plots are odd.
    for (let x = 1; x < 24; x += 2) {
      for (let y = 1; y < 24; y += 2) {
        expect(isRoadLane(district, x, y)).toBe(false);
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

  it("leaves the lane between building columns as greenery or a lot", () => {
    const grid = buildTerrain(snapshot());

    // x=2,y=2 is neither a plot (odd lanes) nor a street lane (stride 4).
    expect(["park", "ground"]).toContain(grid.cellAt(2, 2)?.kind);
    expect(grid.cellAt(2, 2)?.kind).not.toBe("road");
  });

  it("produces a connected grid, not isolated fragments", () => {
    const grid = buildTerrain(snapshot());

    expect(grid.roads.length).toBeGreaterThan(0);
    const isolated = grid.roads.filter((road) => road.roadMask === 0);
    expect(isolated).toEqual([]);
  });

  it("meets at a crossroads where two streets intersect", () => {
    const grid = buildTerrain(snapshot());
    const junction = grid.cellAt(BLOCK_STRIDE, BLOCK_STRIDE);

    expect(junction?.kind).toBe("road");
    expect(junction?.roadMask).toBe(
      ROAD_NORTH | ROAD_EAST | ROAD_SOUTH | ROAD_WEST,
    );
  });

  it("turns a corner at the city edge", () => {
    const grid = buildTerrain(snapshot());

    // (0,0): no street north or west, streets running east and south.
    expect(grid.cellAt(0, 0)?.roadMask).toBe(ROAD_EAST | ROAD_SOUTH);
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
      (cell) => cell.kind === "park" && cell.x > 0 && cell.x < 8,
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

  it("keeps the block stride aligned with the layout package's plot stride", () => {
    // findPlotInDistrict steps 2, so a stride of 4 always lands on a free lane.
    expect(BLOCK_STRIDE % 2).toBe(0);
  });
});
