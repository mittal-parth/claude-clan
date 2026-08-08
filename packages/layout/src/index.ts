import type {
  Building,
  DistrictRect,
  Plot,
  WorldMap,
  WorldSnapshot,
} from "@sudo-city/protocol";

export type { DistrictRect } from "@sudo-city/protocol";

export interface LayoutOptions {
  generatedAt?: string;
  height?: number;
  previousPlots?: Readonly<Record<string, Plot>>;
  width?: number;
}

// District rectangles now travel on the snapshot so the renderer can draw
// district ground and streets; they are not duplicated here.
export interface LayoutResult {
  snapshot: WorldSnapshot;
  plots: Record<string, Plot>;
}

interface WeightedDistrict {
  path: string;
  weight: number;
}

const MIN_SIZE = 12;

/**
 * Plots sit on odd lanes with a stride of 2, so a file needs about four cells.
 * The multiplier is well above 2 because every district loses its border lanes
 * to the inset in findPlotInDistrict, and a repository with many small
 * directories fragments the field badly.
 *
 * Sizing to the repository keeps a small project from rattling around inside an
 * empty grid, and a large one from overflowing it.
 */
export function fieldSizeFor(fileCount: number): number {
  const side = Math.ceil(Math.sqrt(Math.max(fileCount, 1)) * 3.2);
  // Even sizes keep district origins aligned with the odd-lane plot grid.
  return Math.max(MIN_SIZE, side + (side % 2));
}

export function layoutWorld(
  world: WorldMap,
  options: LayoutOptions = {},
): LayoutResult {
  const size = fieldSizeFor(world.files.length);
  const width = options.width ?? size;
  const height = options.height ?? size;
  const districts = squarify(
    districtWeights(world),
    { path: "", x: 0, y: 0, width, height, weight: width * height },
  );
  const plots: Record<string, Plot> = {};
  const occupied = new Set<string>();

  for (const file of world.files) {
    const persisted = options.previousPlots?.[file.path];
    // A plot from a larger field would sit outside the city; reallocate it
    // rather than leaving a building stranded off the ground plane.
    if (
      persisted &&
      persisted.x < width &&
      persisted.y < height &&
      !occupied.has(plotKey(persisted))
    ) {
      plots[file.path] = persisted;
      occupied.add(plotKey(persisted));
    }
  }

  const districtByPath = new Map(
    districts.map((district) => [district.path, district]),
  );
  for (const file of [...world.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (plots[file.path]) {
      continue;
    }
    const district = districtByPath.get(file.directory);
    const plot =
      (district && findPlotInDistrict(district, occupied, width, height)) ??
      findGlobalPlot(occupied, width, height);
    plots[file.path] = plot;
    occupied.add(plotKey(plot));
  }

  const buildings: Building[] = world.files.map((file) => ({
    path: file.path,
    district: file.directory || "/",
    language: file.language,
    loc: file.loc,
    plot: plots[file.path] as Plot,
  }));

  return {
    plots,
    snapshot: {
      id: `world:${world.revision}`,
      repoPath: world.repoPath,
      revision: world.revision,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      size: { width, height },
      districts,
      buildings,
    },
  };
}

function districtWeights(world: WorldMap): WeightedDistrict[] {
  const weights = new Map<string, number>();
  for (const file of world.files) {
    weights.set(
      file.directory,
      (weights.get(file.directory) ?? 0) + Math.max(file.loc, 1),
    );
  }
  return [...weights]
    .map(([path, weight]) => ({ path, weight }))
    .sort(
      (left, right) =>
        right.weight - left.weight || left.path.localeCompare(right.path),
    );
}

function squarify(
  items: WeightedDistrict[],
  bounds: DistrictRect,
): DistrictRect[] {
  if (items.length === 0) {
    return [];
  }

  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  const totalArea = bounds.width * bounds.height;
  const areas = items.map((item) => ({
    ...item,
    area: (item.weight / totalWeight) * totalArea,
  }));
  const output: DistrictRect[] = [];
  let remaining = { ...bounds };
  let row: typeof areas = [];

  while (areas.length > 0) {
    const next = areas[0];
    if (!next) {
      break;
    }
    const side = Math.min(remaining.width, remaining.height);
    if (
      row.length === 0 ||
      worstAspect([...row, next], side) <= worstAspect(row, side)
    ) {
      row.push(next);
      areas.shift();
      continue;
    }
    remaining = placeRow(row, remaining, output);
    row = [];
  }
  if (row.length > 0) {
    placeRow(row, remaining, output);
  }
  return output;
}

function worstAspect(
  row: Array<WeightedDistrict & { area: number }>,
  side: number,
): number {
  if (row.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const sum = row.reduce((total, item) => total + item.area, 0);
  const largest = Math.max(...row.map((item) => item.area));
  const smallest = Math.min(...row.map((item) => item.area));
  const sideSquared = side * side;
  const sumSquared = sum * sum;
  return Math.max(
    (sideSquared * largest) / sumSquared,
    sumSquared / (sideSquared * smallest),
  );
}

function placeRow(
  row: Array<WeightedDistrict & { area: number }>,
  bounds: DistrictRect,
  output: DistrictRect[],
): DistrictRect {
  const rowArea = row.reduce((total, item) => total + item.area, 0);
  const horizontal = bounds.width >= bounds.height;
  const thickness = horizontal
    ? rowArea / bounds.height
    : rowArea / bounds.width;
  let offset = horizontal ? bounds.y : bounds.x;

  for (const item of row) {
    const length = item.area / thickness;
    const rectangle: DistrictRect = horizontal
      ? {
          path: item.path,
          x: bounds.x,
          y: offset,
          width: thickness,
          height: length,
          weight: item.weight,
        }
      : {
          path: item.path,
          x: offset,
          y: bounds.y,
          width: length,
          height: thickness,
          weight: item.weight,
        };
    output.push(rectangle);
    offset += length;
  }

  return horizontal
    ? {
        ...bounds,
        x: bounds.x + thickness,
        width: Math.max(0, bounds.width - thickness),
      }
    : {
        ...bounds,
        y: bounds.y + thickness,
        height: Math.max(0, bounds.height - thickness),
      };
}

/**
 * Plots sit one lane inside the district edge and step 2, leaving the even
 * lanes free for the renderer's street grid. A district too thin to hold a lane
 * yields nothing and the caller falls back to the field-wide search — clamping
 * here rather than widening the range is what keeps slivers from placing a
 * building outside the world.
 */
function findPlotInDistrict(
  district: DistrictRect,
  occupied: Set<string>,
  width: number,
  height: number,
): Plot | undefined {
  const startX = Math.max(0, Math.ceil(district.x) + 1);
  const startY = Math.max(0, Math.ceil(district.y) + 1);
  const endX = Math.min(
    width - 1,
    Math.floor(district.x + district.width) - 1,
  );
  const endY = Math.min(
    height - 1,
    Math.floor(district.y + district.height) - 1,
  );

  for (let y = startY; y <= endY; y += 2) {
    for (let x = startX; x <= endX; x += 2) {
      const plot = { x, y };
      if (!occupied.has(plotKey(plot))) {
        return plot;
      }
    }
  }
  return undefined;
}

/**
 * Overflow allocation for a file whose district is full. Stays inside the field
 * so the building lands on city ground rather than floating out in the
 * countryside; only a genuinely full field spills past the edge.
 */
function findGlobalPlot(
  occupied: Set<string>,
  width: number,
  height: number,
): Plot {
  for (let y = 1; y < height; y += 2) {
    for (let x = 1; x < width; x += 2) {
      const plot = { x, y };
      if (!occupied.has(plotKey(plot))) {
        return plot;
      }
    }
  }

  for (let radius = 0; radius < 10_000; radius += 1) {
    for (let x = 0; x <= radius; x += 1) {
      const plot = { x: x * 2 + 1, y: (radius - x) * 2 + 1 };
      if (!occupied.has(plotKey(plot))) {
        return plot;
      }
    }
  }
  throw new Error("Unable to allocate a world plot");
}

function plotKey(plot: Plot): string {
  return `${plot.x}:${plot.y}`;
}
