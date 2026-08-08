import type {
  Building,
  Plot,
  WorldMap,
  WorldSnapshot,
} from "@sudo-city/protocol";

export interface DistrictRect {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
}

export interface LayoutOptions {
  generatedAt?: string;
  height?: number;
  previousPlots?: Readonly<Record<string, Plot>>;
  width?: number;
}

export interface LayoutResult {
  districts: DistrictRect[];
  snapshot: WorldSnapshot;
  plots: Record<string, Plot>;
}

interface WeightedDistrict {
  path: string;
  weight: number;
}

const DEFAULT_SIZE = 64;

export function layoutWorld(
  world: WorldMap,
  options: LayoutOptions = {},
): LayoutResult {
  const width = options.width ?? DEFAULT_SIZE;
  const height = options.height ?? DEFAULT_SIZE;
  const districts = squarify(
    districtWeights(world),
    { path: "", x: 0, y: 0, width, height, weight: width * height },
  );
  const plots: Record<string, Plot> = {};
  const occupied = new Set<string>();

  for (const file of world.files) {
    const persisted = options.previousPlots?.[file.path];
    if (persisted && !occupied.has(plotKey(persisted))) {
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
      (district && findPlotInDistrict(district, occupied)) ??
      findGlobalPlot(occupied);
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
    districts,
    plots,
    snapshot: {
      id: `world:${world.revision}`,
      repoPath: world.repoPath,
      revision: world.revision,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
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

function findPlotInDistrict(
  district: DistrictRect,
  occupied: Set<string>,
): Plot | undefined {
  const startX = Math.max(0, Math.ceil(district.x) + 1);
  const startY = Math.max(0, Math.ceil(district.y) + 1);
  const endX = Math.max(startX, Math.floor(district.x + district.width) - 1);
  const endY = Math.max(startY, Math.floor(district.y + district.height) - 1);

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

function findGlobalPlot(occupied: Set<string>): Plot {
  for (let radius = 0; radius < 10_000; radius += 1) {
    for (let x = 0; x <= radius; x += 1) {
      const plot = { x: x * 2, y: (radius - x) * 2 };
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
