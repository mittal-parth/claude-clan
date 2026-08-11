import { BLOCK, capitolDistrict, type DistrictRect, type WorldSnapshot } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { buildTerrain, roadClassAt, type TerrainGrid } from "./terrain";

function districtIndex(districts: readonly DistrictRect[]): Map<string, DistrictRect> {
  const index = new Map<string, DistrictRect>();
  for (const district of districts) {
    for (let y = district.y; y < district.y + district.height; y += 1) {
      for (let x = district.x; x < district.x + district.width; x += 1) {
        index.set(`${x}:${y}`, district);
      }
    }
  }
  return index;
}

// Four top-level folders, two districts each -- big enough to exercise every
// boundary kind: field edge, top-level folder boundary, same-folder district
// boundary, and an interior lane with no boundary at all.
const SIZE = BLOCK * 8 + 1;

function twoTopLevelFoldersTwoDistrictsEach(): DistrictRect[] {
  return [
    { path: "apps/web", x: 0, y: 0, width: BLOCK * 2, height: BLOCK * 8, weight: 1 },
    { path: "apps/server", x: BLOCK * 2, y: 0, width: BLOCK * 2, height: BLOCK * 8, weight: 1 },
    { path: "packages/layout", x: BLOCK * 4, y: 0, width: BLOCK * 2, height: BLOCK * 8, weight: 1 },
    { path: "packages/protocol", x: BLOCK * 6, y: 0, width: BLOCK * 2, height: BLOCK * 8, weight: 1 },
  ];
}

describe("road class", () => {
  it("makes the field's edge a boulevard all the way round", () => {
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const index = districtIndex(districts);

    for (let y = 0; y <= SIZE - 1; y += BLOCK) {
      expect(roadClassAt(0, y, index)).toBe("boulevard");
      expect(roadClassAt(SIZE - 1, y, index)).toBe("boulevard");
    }
    for (let x = 0; x <= SIZE - 1; x += BLOCK) {
      expect(roadClassAt(x, 0, index)).toBe("boulevard");
      expect(roadClassAt(x, SIZE - 1, index)).toBe("boulevard");
    }
  });

  it("puts a boulevard between two different top-level folders", () => {
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const index = districtIndex(districts);

    // The lane at x = BLOCK * 4 separates "apps/server" from "packages/layout".
    expect(roadClassAt(BLOCK * 4, BLOCK * 3 + 1, index)).toBe("boulevard");
  });

  it("puts a street between two districts of the same top-level folder", () => {
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const index = districtIndex(districts);

    // The lane at x = BLOCK * 2 separates "apps/web" from "apps/server" --
    // same top-level folder, different districts.
    expect(roadClassAt(BLOCK * 2, BLOCK * 3 + 1, index)).toBe("street");
  });

  it("leaves a lane inside a district a lane, off the arterial grid", () => {
    // A single district spanning several blocks, so its interior lanes have
    // the same district on both sides and are not on an ARTERIAL_BLOCKS-th row.
    const districts: DistrictRect[] = [
      { path: "src", x: 0, y: 0, width: BLOCK * 4, height: BLOCK * 4, weight: 1 },
    ];
    const index = districtIndex(districts);

    // x = BLOCK * 2 is not a multiple of BLOCK * ARTERIAL_BLOCKS (3), and both
    // sides are "src" -- an ordinary interior lane.
    expect(roadClassAt(BLOCK * 2, BLOCK + 1, index)).toBe("lane");
  });

  it("gives a single-district city a main road every ARTERIAL_BLOCKS-th lane", () => {
    const districts: DistrictRect[] = [
      { path: "src", x: 0, y: 0, width: BLOCK * 6, height: BLOCK * 6, weight: 1 },
    ];
    const index = districtIndex(districts);

    // x = BLOCK * 3 is the interior lane at the arterial stride, so even a
    // city with no district boundaries at all gets a main road.
    expect(roadClassAt(BLOCK * 3, BLOCK * 2 + 1, index)).toBe("street");
    expect(roadClassAt(BLOCK * 1, BLOCK * 2 + 1, index)).toBe("lane");
  });

  it("takes a junction's class from the widest of the roads that meet there", () => {
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const index = districtIndex(districts);

    // The junction at (BLOCK*4, BLOCK*3) sits on the boulevard between
    // "apps/server" and "packages/layout" but also carries an ordinary
    // interior lane running north-south through it inside "packages/layout";
    // the junction must read as the wider of the two.
    expect(roadClassAt(BLOCK * 4, BLOCK * 3, index)).toBe("boulevard");
  });

  it("rings the capitol in boulevard", () => {
    const size = { width: SIZE, height: SIZE };
    const mall = capitolDistrict(size);
    const snapshot: WorldSnapshot = {
      id: "world:test",
      repoPath: "/fixture",
      revision: "test",
      generatedAt: "2026-08-11T00:00:00.000Z",
      size,
      districts: twoTopLevelFoldersTwoDistrictsEach(),
      buildings: [],
    };
    const grid = buildTerrain(snapshot);

    expect(grid.cellAt(mall.minX, mall.centerY)?.roadClass).toBe("boulevard");
    expect(grid.cellAt(mall.maxX, mall.centerY)?.roadClass).toBe("boulevard");
    expect(grid.cellAt(mall.centerX, mall.minY)?.roadClass).toBe("boulevard");
    expect(grid.cellAt(mall.centerX, mall.maxY)?.roadClass).toBe("boulevard");
  });

  it("classifies a PR city identically to the main city it pins", () => {
    // main's districts travel onto a PR snapshot verbatim (layoutWorld's
    // options.districts contract); road class derives only from those
    // districts, so two snapshots that share districts and size must produce
    // the same road class at every lane cell, whatever their buildings are.
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const size = { width: SIZE, height: SIZE };
    const main: WorldSnapshot = {
      id: "world:main",
      repoPath: "/fixture",
      revision: "main-sha",
      generatedAt: "2026-08-11T00:00:00.000Z",
      size,
      districts,
      buildings: [],
    };
    const pr: WorldSnapshot = {
      ...main,
      id: "world:pr",
      revision: "pr-sha",
      buildings: [
        { path: "apps/web/x.ts", district: "apps/web", language: "TypeScript", loc: 10, plot: { x: 1, y: 1 } },
      ],
    };

    const mainGrid = buildTerrain(main);
    const prGrid = buildTerrain(pr);

    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const mainCell = mainGrid.cellAt(x, y);
        const prCell = prGrid.cellAt(x, y);
        if (mainCell?.kind === "road" || prCell?.kind === "road") {
          expect(prCell?.roadClass).toBe(mainCell?.roadClass);
        }
      }
    }
  });
});

describe("street furniture", () => {
  function build(): TerrainGrid {
    const districts = twoTopLevelFoldersTwoDistrictsEach();
    const snapshot: WorldSnapshot = {
      id: "world:test",
      repoPath: "/fixture",
      revision: "test",
      generatedAt: "2026-08-11T00:00:00.000Z",
      size: { width: SIZE, height: SIZE },
      districts,
      buildings: [],
    };
    return buildTerrain(snapshot);
  }

  it("plants a lamp, exempt from the decoration budget, at every boulevard junction", () => {
    const grid = build();
    // The capitol's own ring is a separate design system (its formal avenue
    // of trees), classified by capitolCell rather than classifyCity, so it
    // never reaches the lamp logic under test here -- exclude its reserve.
    const mall = capitolDistrict({ width: SIZE, height: SIZE });

    let sawBoulevardJunctionLamp = false;
    let sawNonBoulevardJunctionWithoutLamp = false;
    for (const cell of grid.roads) {
      const junction = cell.x % BLOCK === 0 && cell.y % BLOCK === 0;
      const inMall =
        cell.x >= mall.minX && cell.x <= mall.maxX && cell.y >= mall.minY && cell.y <= mall.maxY;
      if (!junction || inMall || cell.x < 0 || cell.y < 0 || cell.x >= SIZE || cell.y >= SIZE) {
        continue;
      }
      if (cell.roadClass === "boulevard") {
        expect(cell.prop).toBe("lamp");
        expect(cell.keepProp).toBe(true);
        sawBoulevardJunctionLamp = true;
      } else {
        expect(cell.prop).toBeUndefined();
        sawNonBoulevardJunctionWithoutLamp = true;
      }
    }
    expect(sawBoulevardJunctionLamp).toBe(true);
    expect(sawNonBoulevardJunctionWithoutLamp).toBe(true);
  });

  it("plants a kerbside tree, exempt from the decoration budget, on a verge beside a boulevard", () => {
    const grid = build();

    // (25, 26): a verge cell one tile east of the boulevard at x = 24, which
    // separates "apps/server" from "packages/layout" -- different top-level
    // folders, so every row along it is boulevard.
    const verge = grid.cellAt(25, 26);
    expect(verge?.kind).toBe("park");
    expect(verge?.prop).toBe("tree");
    expect(verge?.keepProp).toBe(true);
  });

  it("never gives a lane-adjacent verge cell a forced tree", () => {
    const grid = build();

    // (7, 2): a verge cell beside x = 6, an interior lane inside "apps/web"
    // (same district on both sides) -- not a boulevard, so no forced tree.
    const verge = grid.cellAt(7, 2);
    expect(verge?.kind).not.toBe("road");
    if (verge?.prop === "tree") {
      expect(verge.keepProp).toBeFalsy();
    }
  });
});
