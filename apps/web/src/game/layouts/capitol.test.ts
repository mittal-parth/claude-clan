import {
  BLOCK,
  CAPITOL_BLOCKS_U,
  CAPITOL_BLOCKS_V,
  CAPITOL_HALF_U,
  CAPITOL_HALF_V,
  CAPITOL_MIN_FIELD_HEIGHT,
  CAPITOL_MIN_FIELD_WIDTH,
  blocksAcross,
  capitolDistrict,
  capitolFits,
  inCapitolDistrict,
  type WorldSnapshot,
} from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import {
  CAPITOL_OFFSET_V,
  capitolCell,
  capitolDepthTile,
} from "./capitol";
import { buildTerrain, ROAD_EAST, ROAD_WEST } from "./terrain";

/** Comfortably larger than the reserve, so the mall has city around it. */
const SIZE = 40;

function snapshot(size = SIZE): WorldSnapshot {
  return {
    id: "world:test",
    repoPath: "/fixture",
    revision: "test",
    generatedAt: "2026-08-10T00:00:00.000Z",
    size: { width: size, height: size },
    districts: [
      { path: "src", x: 0, y: 0, width: size / 2, height: size, weight: 100 },
      {
        path: "test",
        x: size / 2,
        y: 0,
        width: size / 2,
        height: size,
        weight: 60,
      },
    ],
    buildings: [],
  };
}

describe("the capitol reserve", () => {
  it("sits near the centre of the field, on whole blocks either side", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const sideBlocks = blocksAcross(SIZE);

    // The reserve is seated on block boundaries: its own width and height are
    // exact multiples of BLOCK, so its perimeter is always a lattice lane.
    expect(mall.minX % BLOCK).toBe(0);
    expect(mall.minY % BLOCK).toBe(0);
    expect(mall.maxX - mall.minX).toBe(CAPITOL_HALF_U * 2);
    expect(mall.maxY - mall.minY).toBe(CAPITOL_HALF_V * 2);

    // CAPITOL_BLOCKS_U is odd and CAPITOL_BLOCKS_V is even, so a square field
    // cannot centre the reserve exactly on both axes at once -- the floor
    // division in capitolDistrict is documented to leave up to half a block
    // of slack on one side rather than grow the whole field for it. The two
    // margins can therefore differ by at most one block.
    const marginBeforeX = mall.minX / BLOCK;
    const marginAfterX = sideBlocks - CAPITOL_BLOCKS_U - marginBeforeX;
    expect(Math.abs(marginBeforeX - marginAfterX)).toBeLessThanOrEqual(1);

    const marginBeforeY = mall.minY / BLOCK;
    const marginAfterY = sideBlocks - CAPITOL_BLOCKS_V - marginBeforeY;
    expect(Math.abs(marginBeforeY - marginAfterY)).toBeLessThanOrEqual(1);
  });

  it("is declined by a field too small to give the block away", () => {
    expect(capitolFits({ width: 12, height: 12 })).toBe(false);
    expect(capitolFits({ width: CAPITOL_MIN_FIELD_WIDTH, height: CAPITOL_MIN_FIELD_HEIGHT })).toBe(true);
    expect(capitolFits({ width: CAPITOL_MIN_FIELD_WIDTH - 1, height: CAPITOL_MIN_FIELD_HEIGHT })).toBe(false);
    expect(capitolFits({ width: CAPITOL_MIN_FIELD_WIDTH, height: CAPITOL_MIN_FIELD_HEIGHT - 1 })).toBe(false);
    expect(capitolFits({ width: SIZE, height: SIZE })).toBe(true);
  });

  it("covers every tile the mall classifier claims, and none beyond", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    for (let dv = -CAPITOL_HALF_V - 2; dv <= CAPITOL_HALF_V + 2; dv += 1) {
      for (let du = -CAPITOL_HALF_U - 2; du <= CAPITOL_HALF_U + 2; du += 1) {
        const x = mall.centerX + du;
        const y = mall.centerY + dv;
        const claimed = capitolCell(mall, x, y) !== undefined;
        expect(claimed).toBe(inCapitolDistrict(mall, x, y));
      }
    }
  });
});

describe("the mall's ground", () => {
  it("rings the block in road", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    expect(capitolCell(mall, mall.minX, mall.centerY)?.kind).toBe("road");
    expect(capitolCell(mall, mall.maxX, mall.centerY)?.kind).toBe("road");
    expect(capitolCell(mall, mall.centerX, mall.minY)?.kind).toBe("road");
    expect(capitolCell(mall, mall.centerX, mall.maxY)?.kind).toBe("road");

    expect(capitolCell(mall, mall.minX + 1, mall.centerY)?.kind).toBe("park");
  });

  it("uses only tile kinds the terrain atlas already bakes", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const kinds = new Set<string>();

    for (let y = mall.minY; y <= mall.maxY; y += 1) {
      for (let x = mall.minX; x <= mall.maxX; x += 1) {
        kinds.add(capitolCell(mall, x, y)?.kind as string);
      }
    }
    // A kind of its own would need a texture of its own, which is exactly what
    // made the old baked ground plate mismatch the field it sat in.
    expect([...kinds].sort()).toEqual(["park", "plaza", "road"]);
  });

  it("leaves the ground under the building unplanted", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    // After the 0.75 scale and one-tile rear offset, the visible building spans
    // roughly du -4..4 and dv -2..1; the next front row is designed lawn.
    for (let dv = -2; dv <= 1; dv += 1) {
      for (let du = -4; du <= 4; du += 1) {
        const cell = capitolCell(mall, mall.centerX + du, mall.centerY + dv);
        expect(cell?.prop).toBeUndefined();
      }
    }
  });

  it("lays apron, lawn, then boulevard on every side", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const kindAt = (du: number, dv: number) =>
      capitolCell(mall, mall.centerX + du, mall.centerY + dv)?.kind;

    // Sideways, clear of the approach: building to du 5, the baked apron
    // overhangs du 6, lawn carries to du CAPITOL_HALF_U - 1, and the
    // boulevard sits on the reserve's own perimeter at du CAPITOL_HALF_U.
    for (const side of [1, -1]) {
      expect(kindAt(side * 6, 0)).toBe("park");
      expect(kindAt(side * (CAPITOL_HALF_U - 1), 0)).toBe("park");
      expect(kindAt(side * CAPITOL_HALF_U, 0)).toBe("road");
    }

    // Behind: building to dv -2, the baked apron overhangs dv -3, lawn to
    // -(CAPITOL_HALF_V - 1), boulevard at -CAPITOL_HALF_V.
    expect(kindAt(0, -3)).toBe("park");
    expect(kindAt(0, -(CAPITOL_HALF_V - 1))).toBe("park");
    expect(kindAt(0, -CAPITOL_HALF_V)).toBe("road");

    // In front, off the approach, lawn runs to CAPITOL_HALF_V - 1 and the
    // boulevard is at CAPITOL_HALF_V -- the reserve is symmetric front and
    // back now that it is sized in whole blocks either side of the building.
    expect(kindAt(6, CAPITOL_HALF_V - 1)).toBe("park");
    expect(kindAt(6, CAPITOL_HALF_V)).toBe("road");
  });

  it("walks the approach from the apron to the boulevard at stair width", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const kindAt = (du: number, dv: number) =>
      capitolCell(mall, mall.centerX + du, mall.centerY + dv)?.kind;

    // Every row between the apron and the boulevard carries concrete from the
    // stair into the walk, with the boulevard closing it at CAPITOL_HALF_V.
    for (let dv = 1; dv <= CAPITOL_HALF_V - 1; dv += 1) {
      for (let du = -1; du <= 1; du += 1) {
        expect(kindAt(du, dv)).toBe("plaza");
      }
      // The scaled stair is exactly three tiles wide — the tile either side
      // remains lawn.
      expect(kindAt(2, dv)).toBe("park");
      expect(kindAt(-2, dv)).toBe("park");
    }
    expect(kindAt(0, CAPITOL_HALF_V)).toBe("road");

    // The walk runs to the front only; the back keeps its unbroken lawn.
    expect(kindAt(0, -3)).toBe("park");
  });

  it("plants the avenue symmetrically rather than at random", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const propAt = (du: number, dv: number) =>
      capitolCell(mall, mall.centerX + du, mall.centerY + dv)?.prop;

    // Mirroring across the wing axis is what reads as a designed mall.
    for (let dv = -(CAPITOL_HALF_V - 1); dv <= CAPITOL_HALF_V - 1; dv += 1) {
      expect(propAt(CAPITOL_HALF_U - 1, dv)).toBe(propAt(-(CAPITOL_HALF_U - 1), dv));
    }
    // All four corners of the lawn are marked, front and back alike -- the
    // reserve's symmetry means neither pair needs its own separate assertion.
    expect(propAt(CAPITOL_HALF_U - 1, -(CAPITOL_HALF_V - 1))).toBe("fountain");
    expect(propAt(-(CAPITOL_HALF_U - 1), -(CAPITOL_HALF_V - 1))).toBe("fountain");
    expect(propAt(CAPITOL_HALF_U - 1, CAPITOL_HALF_V - 1)).toBe("fountain");
    expect(propAt(-(CAPITOL_HALF_U - 1), CAPITOL_HALF_V - 1)).toBe("fountain");
    // The ceremonial approach stays open.
    expect(propAt(0, CAPITOL_HALF_V - 1)).toBeUndefined();
  });

  it("exempts its planting from the decoration budget", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const cell = capitolCell(mall, mall.centerX + CAPITOL_HALF_U - 1, mall.centerY);

    expect(cell?.prop).toBeDefined();
    expect(cell?.keepProp).toBe(true);
  });
});

describe("the mall inside a built world", () => {
  it("welds its boulevard to the surrounding street grid", () => {
    const grid = buildTerrain(snapshot());
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    // A ring cell on the east side must join to its neighbours along the ring,
    // which is what roadMaskAt gives it for free by treating these as streets.
    const ring = grid.cellAt(mall.maxX, mall.centerY);
    expect(ring?.kind).toBe("road");

    // Wherever a city lane runs into the ring, the ring cell records the
    // junction rather than the lane dead-ending against a sprite.
    let junctions = 0;
    for (let y = mall.minY + 1; y <= mall.maxY - 1; y += 1) {
      const cell = grid.cellAt(mall.maxX, y);
      if (cell && cell.roadMask & ROAD_EAST) {
        junctions += 1;
      }
      const west = grid.cellAt(mall.minX, y);
      if (west && west.roadMask & ROAD_WEST) {
        junctions += 1;
      }
    }
    expect(junctions).toBeGreaterThan(0);
  });

  it("overrides whatever the city would otherwise have put there", () => {
    const grid = buildTerrain(snapshot());
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    for (let y = mall.minY; y <= mall.maxY; y += 1) {
      for (let x = mall.minX; x <= mall.maxX; x += 1) {
        expect(["road", "park", "plaza"]).toContain(grid.cellAt(x, y)?.kind);
      }
    }
  });

  it("leaves a small city untouched", () => {
    const small = snapshot(CAPITOL_MIN_FIELD_WIDTH - 1);
    const grid = buildTerrain(small);
    const centre = grid.cellAt(6, 6);

    expect(capitolFits(small.size)).toBe(false);
    expect(centre).toBeDefined();
    // Nothing was reserved, so the centre is ordinary city ground.
    expect(["road", "ground", "park"]).toContain(centre?.kind);
  });
});

describe("the capitol sprite's sort key", () => {
  it("sorts from the front of the building, not its middle", () => {
    const mall = capitolDistrict({ width: SIZE, height: SIZE });
    const sort = capitolDepthTile(mall);

    expect(sort.x).toBe(mall.centerX);
    expect(sort.y).toBe(mall.centerY + CAPITOL_OFFSET_V + 2);
    expect(sort.y).toBeGreaterThan(mall.centerY);
    // Still inside its own reserve, so it can never outsort a neighbour that
    // is genuinely in front of the mall.
    expect(inCapitolDistrict(mall, sort.x, sort.y)).toBe(true);
  });
});
