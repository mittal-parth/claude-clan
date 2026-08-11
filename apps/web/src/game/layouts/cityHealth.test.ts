/**
 * The property tests every later phase is judged on.
 *
 * These fail on the code that shipped the screenshot in the layout plan: 13%
 * of buildings had no adjacent road, 24 plots sat on street lanes, the road
 * network was split into 12 disconnected pieces, and 77% of buildings stood
 * outside their own folder's district. Each property below is one of those
 * failures turned into an assertion, run across a matrix of repository shapes
 * rather than just this repo, so a fix here has to generalise rather than
 * overfit to one fixture.
 */

import { isPlotCell, type SourceFile, type WorldMap, type WorldSnapshot } from "@sudo-city/protocol";
import { layoutWorld } from "@sudo-city/layout";
import { describe, expect, it } from "vitest";
import { buildTerrain, type TerrainGrid } from "./terrain";

export interface CityHealth {
  buildings: number;
  /** Buildings with no orthogonally adjacent road. */
  landlocked: number;
  /** Buildings sitting on a lattice lane. */
  plotsOnLane: number;
  /** Connected components of the road network. */
  roadComponents: number;
  /** Road components of two cells or fewer. */
  isolatedRoadCells: number;
  /** Road cells whose mask has 0 or 1 bits set, inside the published field. */
  deadEndRoadCells: number;
  /** 2x2 all-road patches. */
  fatRoadPatches: number;
  /** Buildings not inside their own district's rectangle. */
  outsideOwnDistrict: number;
  /** Buildings divided by lattice plot cells inside the field. */
  fillRatio: number;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function isRoad(grid: TerrainGrid, x: number, y: number): boolean {
  return grid.cellAt(x, y)?.kind === "road";
}

/** Every district a building's own directory could match, deepest first. */
function districtCandidates(directory: string): string[] {
  if (directory === "") {
    return [""];
  }
  const segments = directory.split("/");
  const candidates: string[] = [];
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    candidates.push(segments.slice(0, depth).join("/"));
  }
  return candidates;
}

export function measure(snapshot: WorldSnapshot, grid: TerrainGrid): CityHealth {
  const { width, height } = snapshot.size;

  let landlocked = 0;
  let plotsOnLane = 0;
  let outsideOwnDistrict = 0;

  const districtByPath = new Map(
    snapshot.districts.map((district) => [district.path, district]),
  );

  for (const building of snapshot.buildings) {
    const { x, y } = building.plot;
    if (
      !isRoad(grid, x + 1, y) &&
      !isRoad(grid, x - 1, y) &&
      !isRoad(grid, x, y + 1) &&
      !isRoad(grid, x, y - 1)
    ) {
      landlocked += 1;
    }
    if (grid.cellAt(x, y)?.kind === "road") {
      plotsOnLane += 1;
    }

    const directory = building.district === "/" ? "" : building.district;
    const owned = districtCandidates(directory).some((path) => {
      const district = districtByPath.get(path);
      return (
        district !== undefined &&
        x >= district.x &&
        x < district.x + district.width &&
        y >= district.y &&
        y < district.y + district.height
      );
    });
    if (!owned) {
      outsideOwnDistrict += 1;
    }
  }

  const roadKeys = new Set(grid.roads.map((cell) => cellKey(cell.x, cell.y)));
  const seen = new Set<string>();
  const componentSizes: number[] = [];
  for (const key of roadKeys) {
    if (seen.has(key)) {
      continue;
    }
    let size = 0;
    const stack = [key];
    seen.add(key);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      size += 1;
      const [cx, cy] = current.split(":").map(Number) as [number, number];
      const neighbours: Array<[number, number]> = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of neighbours) {
        const neighbourKey = cellKey(nx, ny);
        if (roadKeys.has(neighbourKey) && !seen.has(neighbourKey)) {
          seen.add(neighbourKey);
          stack.push(neighbourKey);
        }
      }
    }
    componentSizes.push(size);
  }

  let fatRoadPatches = 0;
  for (let y = -1; y <= height; y += 1) {
    for (let x = -1; x <= width; x += 1) {
      if (
        isRoad(grid, x, y) &&
        isRoad(grid, x + 1, y) &&
        isRoad(grid, x, y + 1) &&
        isRoad(grid, x + 1, y + 1)
      ) {
        fatRoadPatches += 1;
      }
    }
  }

  let deadEndRoadCells = 0;
  for (const cell of grid.roads) {
    if (cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) {
      continue;
    }
    const bits =
      (cell.roadMask & 1) + ((cell.roadMask >> 1) & 1) + ((cell.roadMask >> 2) & 1) + ((cell.roadMask >> 3) & 1);
    if (bits <= 1) {
      deadEndRoadCells += 1;
    }
  }

  // Capacity is measured over the districts themselves, not the whole field:
  // a small repository's field is floored by the capitol's own minimum size
  // (MIN_SIDE_BLOCKS), not by how many files it has, so a field-wide count
  // would charge a small repo for parkland it was never going to build on.
  // District rectangles tile only the ground actually handed to a folder, so
  // this is "how full are the neighbourhoods we built", not "how full is the
  // whole island".
  const districtPlotCapacity = snapshot.districts.reduce((total, district) => {
    let capacity = 0;
    for (let y = district.y; y < district.y + district.height; y += 1) {
      for (let x = district.x; x < district.x + district.width; x += 1) {
        if (isPlotCell(x, y)) {
          capacity += 1;
        }
      }
    }
    return total + capacity;
  }, 0);

  return {
    buildings: snapshot.buildings.length,
    landlocked,
    plotsOnLane,
    roadComponents: componentSizes.length,
    isolatedRoadCells: componentSizes.filter((size) => size <= 2).length,
    deadEndRoadCells,
    fatRoadPatches,
    outsideOwnDistrict,
    fillRatio: snapshot.buildings.length / Math.max(districtPlotCapacity, 1),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function file(path: string, loc: number, language = "TypeScript"): SourceFile {
  const slash = path.lastIndexOf("/");
  return {
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language,
    loc,
    bytes: loc * 30,
    churn: 0,
    authors: 1,
  };
}

function repo(files: SourceFile[]): WorldMap {
  return {
    repoPath: "/fixture",
    revision: "fixture",
    files,
    imports: [],
    externalDependencies: [],
  };
}

interface Fixture {
  name: string;
  world: WorldMap;
  /** fillRatio floor is skipped for fields too small to carry a meaningful ratio. */
  skipFill?: boolean;
}

function fixtures(): Fixture[] {
  const singleFile: Fixture = {
    name: "single file",
    world: repo([file("index.ts", 20)]),
    skipFill: true,
  };

  const tiny: Fixture = {
    name: "tiny",
    world: repo(Array.from({ length: 9 }, (_unused, index) => file(`src/f${index}.ts`, 60))),
    skipFill: true,
  };

  const flatRoot: Fixture = {
    name: "flat root",
    world: repo(Array.from({ length: 120 }, (_unused, index) => file(`file${index}.py`, 80, "Python"))),
  };

  const fatFolders: Fixture = {
    name: "fat folders",
    world: repo(
      Array.from({ length: 600 }, (_unused, index) => file(`app${index % 6}/mod${index}.py`, 50 + (index % 200), "Python")),
    ),
  };

  const deepFiles: SourceFile[] = [];
  for (let pkg = 0; pkg < 12; pkg += 1) {
    for (let mod = 0; mod < 10; mod += 1) {
      for (let index = 0; index < 4; index += 1) {
        deepFiles.push(file(`packages/p${pkg}/src/${mod}/f${index}.ts`, 40 + index * 30));
      }
    }
  }
  const deepMonorepo: Fixture = { name: "deep monorepo", world: repo(deepFiles) };

  const longTailFiles: SourceFile[] = [];
  for (let index = 0; index < 90; index += 1) {
    longTailFiles.push(file(`core/mod${index}.ts`, 30 + (index % 100)));
  }
  for (let folder = 0; folder < 40; folder += 1) {
    const count = 1 + (folder % 2);
    for (let index = 0; index < count; index += 1) {
      longTailFiles.push(file(`misc/leaf${folder}/f${index}.ts`, 20 + index * 10));
    }
  }
  const longTail: Fixture = { name: "long tail", world: repo(longTailFiles) };

  const largeFiles: SourceFile[] = [];
  for (let dir = 0; dir < 200; dir += 1) {
    for (let index = 0; index < 15; index += 1) {
      largeFiles.push(file(`src/area${dir % 20}/sub${dir}/file${index}.ts`, 30 + ((dir * index) % 400)));
    }
  }
  const large: Fixture = { name: "large", world: repo(largeFiles) };

  const docsFiles: SourceFile[] = [];
  for (let dir = 0; dir < 5; dir += 1) {
    for (let index = 0; index < 16; index += 1) {
      docsFiles.push(file(`docs/section${dir}/page${index}.md`, 40 + index * 5, "Markdown"));
    }
  }
  const docsOnly: Fixture = { name: "docs only", world: repo(docsFiles) };

  return [singleFile, tiny, flatRoot, fatFolders, deepMonorepo, longTail, large, docsOnly];
}

interface Measured extends Fixture {
  snapshot: WorldSnapshot;
  grid: TerrainGrid;
  health: CityHealth;
}

function measureAll(): Measured[] {
  return fixtures().map((fixture) => {
    const { snapshot } = layoutWorld(fixture.world);
    const grid = buildTerrain(snapshot);
    return { ...fixture, snapshot, grid, health: measure(snapshot, grid) };
  });
}

describe("city health", () => {
  const measured = measureAll();

  it.each(measured.map((m) => [m.name, m] as const))(
    "gives every building street frontage — %s",
    (_name, m) => {
      expect(m.health.landlocked).toBe(0);
    },
  );

  it.each(measured.map((m) => [m.name, m] as const))(
    "never sites a building on a lane — %s",
    (_name, m) => {
      expect(m.health.plotsOnLane).toBe(0);
    },
  );

  it.each(measured.map((m) => [m.name, m] as const))(
    "lays one connected road network — %s",
    (_name, m) => {
      expect(m.health.roadComponents).toBe(1);
    },
  );

  it.each(measured.map((m) => [m.name, m] as const))(
    "leaves no road stub or orphan tile — %s",
    (_name, m) => {
      expect(m.health.isolatedRoadCells).toBe(0);
      expect(m.health.deadEndRoadCells).toBe(0);
    },
  );

  it.each(measured.map((m) => [m.name, m] as const))(
    "never doubles a road back on itself — %s",
    (_name, m) => {
      expect(m.health.fatRoadPatches).toBe(0);
    },
  );

  it.each(measured.map((m) => [m.name, m] as const))(
    "keeps a folder's files in its own district — %s",
    (_name, m) => {
      expect(m.health.outsideOwnDistrict / Math.max(m.health.buildings, 1)).toBeLessThanOrEqual(0.05);
    },
  );

  it.each(
    measured.filter((m) => !m.skipFill).map((m) => [m.name, m] as const),
  )("builds on most of the ground it clears — %s", (_name, m) => {
    // Districts always tile the field exactly (see
    // "publishes one district per surviving folder, covering the field
    // exactly" in packages/layout), so when the capitol's own minimum field
    // size floors a repository with few districts, the spare room becomes
    // extra breathing room spread across the existing districts rather than
    // orphaned blocks with no owner. That is a deliberate choice -- a small
    // city should read as spacious, not crammed to its bounding box -- and it
    // legitimately pulls the ratio down for a repo with few, large districts.
    // 0.35 still catches the actual regression this test exists for: the
    // pre-lattice layout measured 10% here, an order of magnitude below any
    // shape this matrix produces once the lattice and block treemap are
    // correct.
    expect(m.health.fillRatio).toBeGreaterThanOrEqual(0.35);
  });
});
