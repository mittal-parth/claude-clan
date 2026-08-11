import { TERRAIN_COLORS } from "../math/palette";
import { RoadClass, TerrainKind } from "../layouts/terrain";
import Phaser, { Scene } from "phaser";
import { Baker, TILE_WIDTH, TILE_HEIGHT, HALF_W, HALF_H, fillFace, diamond, strokeFace, shade, Point3 } from "./core";

export const GRASS_VARIANTS = TERRAIN_COLORS.grass.length;

export const PARK_VARIANTS = 2;

export const SAND_VARIANTS = 2;

export const WATER_VARIANTS = 3;


// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainTextureKey(kind: TerrainKind, variant: number): string {
  return `tile:${kind}:${variant}`;
}


export function roadTextureKey(mask: number, roadClass: RoadClass): string {
  return `tile:road:${roadClass}:${mask}`;
}

/** Every road class the atlas bakes, widest first -- also the bake order. */
export const ROAD_CLASSES: readonly RoadClass[] = ["boulevard", "street", "lane"];


export const TERRAIN_VARIANT_COUNTS: Record<TerrainKind, number> = {
  grass: GRASS_VARIANTS,
  park: PARK_VARIANTS,
  sand: SAND_VARIANTS,
  water: WATER_VARIANTS,
  ground: 1,
  road: 1,
  plaza: 1,
};


/**
 * Every ground tile lives in ONE texture, so the whole terrain plane can be a
 * single batched object. A large repository lays down tens of thousands of
 * tiles; as individual Sprites that is a per-frame culling and depth-sorting
 * cost that dominates the frame budget.
 */
export const TERRAIN_ATLAS_KEY = "terrain-atlas";


/** Half-footprint of a building, in tiles. Leaves a gap between neighbours. */
export const FOOTPRINT = 0.42;


/** Half-width of the asphalt, in tiles. */
export const ROAD_HALF = 0.3;

export const KERB_HALF = 0.4;

/**
 * Carriageway and kerb half-widths per road class. A back lane is deliberately
 * narrower than the block's own frontage row so it reads as service access
 * rather than a street; a boulevard is wider than a block's ordinary road
 * budget allows in most places, which is exactly what marks it as the main
 * road when it crosses one.
 */
export const ROAD_WIDTHS: Record<RoadClass, { road: number; kerb: number }> = {
  boulevard: { road: 0.42, kerb: 0.5 },
  street: { road: ROAD_HALF, kerb: KERB_HALF },
  lane: { road: 0.2, kerb: 0.26 },
};

export const ATLAS_COLUMNS = 8;


export function bakeTerrainAtlas(scene: Phaser.Scene, baker: Baker): void {
  const slots: Array<{ name: string; x: number; y: number }> = [];
  let index = 0;

  const place = (name: string, draw: (x: number, y: number) => void): void => {
    const x = (index % ATLAS_COLUMNS) * TILE_WIDTH;
    const y = Math.floor(index / ATLAS_COLUMNS) * TILE_HEIGHT;
    draw(x + HALF_W, y + HALF_H);
    slots.push({ name, x, y });
    index += 1;
  };

  for (let variant = 0; variant < GRASS_VARIANTS; variant += 1) {
    place(terrainTextureKey("grass", variant), (x, y) =>
      drawGroundTile(baker, x, y, TERRAIN_COLORS.grass[variant] as number, variant),
    );
  }
  for (let variant = 0; variant < PARK_VARIANTS; variant += 1) {
    place(terrainTextureKey("park", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.park : TERRAIN_COLORS.field,
        variant + 7,
      ),
    );
  }
  for (let variant = 0; variant < SAND_VARIANTS; variant += 1) {
    place(terrainTextureKey("sand", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.sand : TERRAIN_COLORS.sandShade,
        variant + 3,
      ),
    );
  }
  place(terrainTextureKey("ground", 0), (x, y) =>
    drawGroundTile(baker, x, y, TERRAIN_COLORS.ground, 11),
  );
  place(terrainTextureKey("plaza", 0), (x, y) => drawPlazaTile(baker, x, y));
  for (let variant = 0; variant < WATER_VARIANTS; variant += 1) {
    place(terrainTextureKey("water", variant), (x, y) =>
      drawWaterTile(baker, x, y, variant),
    );
  }
  for (const roadClass of ROAD_CLASSES) {
    for (let mask = 0; mask < 16; mask += 1) {
      place(roadTextureKey(mask, roadClass), (x, y) => drawRoadTile(baker, x, y, mask, roadClass));
    }
  }

  const rows = Math.ceil(index / ATLAS_COLUMNS);
  baker.flush(TERRAIN_ATLAS_KEY, ATLAS_COLUMNS * TILE_WIDTH, rows * TILE_HEIGHT);

  const texture = scene.textures.get(TERRAIN_ATLAS_KEY);
  for (const slot of slots) {
    texture.add(slot.name, 0, slot.x, slot.y, TILE_WIDTH, TILE_HEIGHT);
  }
}


export function drawGroundTile(
  baker: Baker,
  originX: number,
  originY: number,
  color: number,
  seed: number,
): void {
  fillFace(baker, color, 1, diamond(0.5), originX, originY);

  // A faint darker edge on the two far sides reads as a very shallow slab and
  // stops large fields looking like flat paper.
  strokeFace(baker, shade(color, -8), 0.5, 1, diamond(0.5), originX, originY);

  // Scattered blades, positioned from the variant seed so tiles differ but
  // each variant is stable.
  baker.graphics.fillStyle(shade(color, 10), 0.55);
  for (let index = 0; index < 6; index += 1) {
    const angle = ((seed * 37 + index * 61) % 360) * (Math.PI / 180);
    const radius = 0.12 + ((seed * 13 + index * 29) % 24) / 100;
    const point = baker.at(
      [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
      originX,
      originY,
    );
    baker.graphics.fillRect(point.x, point.y, 3, 2);
  }
}


/**
 * Paving: the capitol's apron and the walk out to its boulevard.
 *
 * Deliberately the same stone as the pavement beside every street in the city,
 * so the walk reads as continuous with the road it meets rather than as a
 * different material that happens to touch it. The quartered joint is what
 * keeps a run of these from looking like one flat sheet.
 */
export function drawPlazaTile(baker: Baker, originX: number, originY: number): void {
  fillFace(baker, TERRAIN_COLORS.pavement, 1, diamond(0.5), originX, originY);
  strokeFace(
    baker,
    shade(TERRAIN_COLORS.pavement, -10),
    0.55,
    1,
    diamond(0.5),
    originX,
    originY,
  );
  // Slab joints across the middle of the tile, in grid space so they line up
  // tile to tile.
  baker.graphics.lineStyle(1, shade(TERRAIN_COLORS.pavement, -8), 0.5);
  for (const line of [
    [
      [-0.5, 0, 0],
      [0.5, 0, 0],
    ],
    [
      [0, -0.5, 0],
      [0, 0.5, 0],
    ],
  ] as Point3[][]) {
    const from = baker.at(line[0] as Point3, originX, originY);
    const to = baker.at(line[1] as Point3, originX, originY);
    baker.graphics.lineBetween(from.x, from.y, to.x, to.y);
  }
}


export function drawWaterTile(
  baker: Baker,
  originX: number,
  originY: number,
  variant: number,
): void {
  const base = variant === 2 ? TERRAIN_COLORS.waterDeep : TERRAIN_COLORS.water;
  fillFace(baker, base, 1, diamond(0.5), originX, originY);
  fillFace(baker, shade(base, -6), 0.6, diamond(0.34), originX, originY);

  if (variant !== 2) {
    baker.graphics.fillStyle(TERRAIN_COLORS.waterFoam, 0.35);
    const crest = baker.at([-0.1 + variant * 0.18, -0.05, 0], originX, originY);
    baker.graphics.fillRect(crest.x - 8, crest.y, 16, 2);
  }
}


/**
 * Roads are drawn as a centre block plus one arm per connected neighbour, all
 * in grid space, so junctions line up exactly whatever the mask.
 *
 * The carriageway and kerb widths come from the cell's own road class, so
 * where a narrow back lane's arm meets a boulevard's wide centre block the
 * narrow arm simply joins the wide one -- no junction special-casing is
 * needed, the geometry does it.
 */
export function drawRoadTile(
  baker: Baker,
  originX: number,
  originY: number,
  mask: number,
  roadClass: RoadClass = "street",
): void {
  const { road: roadHalf, kerb: kerbHalf } = ROAD_WIDTHS[roadClass];
  const arms: Array<[number, Point3[]]> = [
    // North is -v, which projects up-and-right on screen.
    [1, band(-0.5, -roadHalf, "v", roadHalf)],
    [2, band(roadHalf, 0.5, "u", roadHalf)],
    [4, band(roadHalf, 0.5, "v", roadHalf)],
    [8, band(-0.5, -roadHalf, "u", roadHalf)],
  ];
  const kerbArms: Array<[number, Point3[]]> = [
    [1, band(-0.5, -kerbHalf, "v", kerbHalf)],
    [2, band(kerbHalf, 0.5, "u", kerbHalf)],
    [4, band(kerbHalf, 0.5, "v", kerbHalf)],
    [8, band(-0.5, -kerbHalf, "u", kerbHalf)],
  ];

  // Grass base, so an arm that stops mid-tile blends into the lot beside it.
  fillFace(baker, TERRAIN_COLORS.ground, 1, diamond(0.5), originX, originY);

  // A boulevard's kerb runs a shade paler than an ordinary street's, so the
  // main road reads as a different, grander pavement rather than just a wider
  // version of the same one.
  const kerbColor =
    roadClass === "boulevard" ? shade(TERRAIN_COLORS.pavement, 6) : TERRAIN_COLORS.pavement;
  fillFace(baker, kerbColor, 1, diamond(kerbHalf), originX, originY);
  for (const [bit, points] of kerbArms) {
    if (mask & bit) {
      fillFace(baker, kerbColor, 1, points, originX, originY);
    }
  }

  fillFace(baker, TERRAIN_COLORS.road, 1, diamond(roadHalf), originX, originY);
  for (const [bit, points] of arms) {
    if (mask & bit) {
      fillFace(baker, TERRAIN_COLORS.road, 1, points, originX, originY);
    }
  }

  // Lane markings only on a straight run; a junction would be a mess of
  // paint. A back lane carries no markings at all -- it reads as service
  // access, not a through street.
  if (roadClass === "lane") {
    return;
  }
  const straightUV = mask === (2 | 8);
  const straightVU = mask === (1 | 4);
  if (!straightUV && !straightVU) {
    return;
  }
  // A boulevard gets a solid centre line flanked by a dash on each side --
  // "both directions" of a divided carriageway -- where an ordinary street
  // keeps its single dashed lane line.
  const dashes =
    roadClass === "boulevard"
      ? [
          { offset: -0.3, solid: false },
          { offset: 0, solid: true },
          { offset: 0.3, solid: false },
        ]
      : [
          { offset: -0.28, solid: false },
          { offset: 0.04, solid: false },
        ];
  for (const { offset, solid } of dashes) {
    const start = solid ? -0.5 : offset;
    const end = solid ? 0.5 : offset + 0.24;
    const from: Point3 = straightUV ? [start, offset, 0] : [offset, start, 0];
    const to: Point3 = straightUV ? [end, offset, 0] : [offset, end, 0];
    baker.graphics.lineStyle(2, TERRAIN_COLORS.roadLine, 0.85);
    baker.graphics.lineBetween(
      baker.at(from, originX, originY).x,
      baker.at(from, originX, originY).y,
      baker.at(to, originX, originY).x,
      baker.at(to, originX, originY).y,
    );
  }
}


/** A rectangular strip in grid space, running along one axis. */
export function band(
  from: number,
  to: number,
  axis: "u" | "v",
  half = ROAD_HALF,
): Point3[] {
  return axis === "u"
    ? [
        [from, -half, 0],
        [to, -half, 0],
        [to, half, 0],
        [from, half, 0],
      ]
    : [
        [-half, from, 0],
        [half, from, 0],
        [half, to, 0],
        [-half, to, 0],
      ];
}
