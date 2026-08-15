/**
 * Billboard placement — pure, no Phaser import, so it stays unit-testable.
 *
 * Two kinds of sign stand in the world. One large billboard names the
 * repository and greets arrivals at the airport, which is where a repo switch
 * puts you down. Smaller advertising boards ring the countryside facing the
 * city.
 *
 * Everything here is deterministic. Snapshots arrive repeatedly and the scene
 * diffs them, so a billboard has to resolve to the same tile every time or the
 * signage walks around the island between rescans.
 */

import { hashText, pickIndex } from "../math/hash";
import {
  HALF_TILE_HEIGHT,
  HALF_TILE_WIDTH,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "../math/iso";
import { COAST_QUAY_HALF_U, coastLanes, coastQuayX } from "./coast";
import { COUNTRYSIDE_RING } from "./rings";

/**
 * Which way a sign face points, named for the side of the tile diamond it sits
 * on — the same "screen-left wall / screen-right wall" language the building
 * bakery uses.
 *
 * With +x running screen-right-and-down and +y screen-left-and-down:
 *
 *   "left"   — constant-y plane, the diamond's lower-LEFT edge.  Faces SOUTHWEST.
 *   "right"  — constant-x plane, the diamond's lower-RIGHT edge. Faces SOUTHEAST.
 *   "screen" — turned a further 45 degrees to sit square to the camera, so the
 *              artwork is drawn upright with no shear at all. This is what an
 *              advertiser wants: a poster read head-on rather than raked away
 *              along a grid axis.
 *
 * See billboardPanelTransform for the matching shear.
 */
export type BillboardFacing = "left" | "right" | "screen";

/**
 * Board shapes, keyed by name. This table is the definition: add a key here,
 * give it a spec, and the bakery, the transform and the sponsor list all pick
 * it up — nothing switches on the individual names.
 */
export type BillboardSize = keyof typeof BILLBOARD_SPECS;

export interface BillboardSlot {
  x: number;
  y: number;
  facing: BillboardFacing;
  size: BillboardSize;
}

export interface Sponsor {
  id: string;
  name: string;
  /** Opened when the board is clicked. A sponsor without one is scenery. */
  url?: string;
  /** Public path of the artwork, served out of apps/web/public. */
  artwork: string;
  /**
   * Board shape to print this creative on. Defaults to the landscape board;
   * set it to match the artwork's own aspect so the letterbox stays small.
   */
  size?: BillboardSize;
  /**
   * Panel colour behind the artwork. Creatives are scaled to fit rather than
   * cropped, so this shows in the letterbox and should match the artwork's own
   * background or the board reads as a picture floating on a slab.
   */
  background: string;
}

/**
 * Advertisers, in a fixed order.
 *
 * This array is the whole configuration: add an entry and drop its image in
 * apps/web/public/ads to put another board in the world. assignSponsors decides
 * which slot each one lands on, and AD_BILLBOARD_COUNT follows the roster size,
 * so the ring stays populated without showing duplicate creatives.
 */
export const SPONSORS: readonly Sponsor[] = [
  {
    id: "pushtoprod",
    name: "PushToProd.art",
    url: "https://pushtoprod.art",
    artwork: "/ads/pushtoprod.webp",
    size: "square",
    background: "#f4ede1",
  },
  {
    id: "basecamp",
    name: "Basecamp",
    url: "https://basecamp.com",
    artwork: "/ads/basecamp.png",
    size: "small",
    background: "#283441",
  },
];

/** Number of advertising boards placed along the countryside ring. */
export const AD_BILLBOARD_COUNT = SPONSORS.length;

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * The repository's own billboard at the airport.
 *
 * Sits directly behind the airport terminal, turned 90 degrees anticlockwise
 * ("right" facing, along the constant-x plane) to face southeast toward the
 * arrival plaza and town.
 */
export function repoBillboardSlot(cityHeight: number): BillboardSlot {
  const safeHeight = Math.max(1, Math.round(cityHeight));
  return {
    x: -1.8,
    y: safeHeight - 6.5,
    facing: "right",
    size: "large",
  };
}

/**
 * Half-span of a board's footprint, in grid units along its facing axis.
 *
 * A 176px board projects across 176 / 96 = 1.83 grid tiles, so its wings
 * extend ~0.92 tiles either side of its anchor.
 */
export function halfSpanOf(panelWidth: number): number {
  return panelWidth / (2 * TILE_WIDTH);
}

/**
 * Perimeter slots for advertising boards around the city edge.
 *
 * - PushToProd sits along the northern countryside edge, facing the city.
 * - Basecamp sits along the roadside grass near the naval base dock road approach.
 */
export function adBillboardSlots(width: number, height: number): BillboardSlot[] {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const offset = Math.max(2, Math.floor(COUNTRYSIDE_RING / 2));
  const quayX = coastQuayX(safeWidth);
  const spineX = quayX - Math.round(COAST_QUAY_HALF_U) - 1;
  const navyLane = coastLanes(safeHeight).navy;

  return [
    {
      x: Math.round(safeWidth / 2),
      y: -offset,
      facing: "screen",
      size: "small",
    },
    {
      x: spineX - 1.8,
      y: Math.round(navyLane - 2),
      facing: "screen",
      size: "square",
    },
  ];
}

/**
 * Spreads `count` slots across a span, inset from both ends so a board never
 * sits at a corner where the two edges meet.
 */
function spread(span: number, index: number, count: number): number {
  const usable = Math.max(1, span - 2);
  return Math.round(1 + (usable * (index + 0.5)) / count);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface BillboardSpec {
  /** Screen width of the sign face, in pixels, frame included. */
  panelWidth: number;
  /** Screen height of the sign face, in pixels, frame included. */
  panelHeight: number;
  /** How far the underside of the panel stands off the ground. */
  legHeight: number;
  /** Half-depth of the slab, in tile units — the sliver of edge that shows. */
  thickness: number;
}

export const BILLBOARD_SPECS = {
  /** Landscape roadside board, the default for an advertiser. */
  small: { panelWidth: 176, panelHeight: 104, legHeight: 32, thickness: 0.05 },
  /**
   * For creatives that are square or portrait, which a letterbox wastes.
   * Deliberately narrower than the landscape board: matching its width would
   * make a square panel half again as tall and tower over its neighbours.
   */
  square: { panelWidth: 120, panelHeight: 120, legHeight: 30, thickness: 0.05 },
  /** The repository's own board at the airport. */
  large: { panelWidth: 300, panelHeight: 172, legHeight: 84, thickness: 0.06 },
} as const satisfies Record<string, BillboardSpec>;

export const BILLBOARD_SIZES = Object.keys(BILLBOARD_SPECS) as BillboardSize[];

export const BILLBOARD_FACINGS: readonly BillboardFacing[] = [
  "left",
  "right",
  "screen",
];

/** The two facings that lie along a grid axis and so carry an isometric shear. */
export const ISOMETRIC_FACINGS: readonly BillboardFacing[] = ["left", "right"];

/** Border of frame drawn around the artwork, in pixels. */
export const BILLBOARD_FRAME_INSET = 7;

/** Slack around the baked texture so strokes and the ground shadow aren't clipped. */
const BILLBOARD_MARGIN = 4;

export interface BillboardPanelTransform {
  /** Size of the baked frame texture, which the content canvas matches exactly. */
  canvasWidth: number;
  canvasHeight: number;
  /** Usable artwork area inside the frame. */
  contentWidth: number;
  contentHeight: number;
  /** Vertical offset from the projected tile centre down to the sprite's foot. */
  anchorY: number;
  /**
   * Canvas transform placing artwork pixels onto the sign face:
   * ctx.setTransform(1, shear, 0, 1, offsetX, offsetY). A shear rather than a
   * rotation — rotating would tilt the frame's posts, which stay vertical on
   * screen in an isometric projection.
   */
  shear: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Maps artwork-local pixels onto a billboard's sign face.
 *
 * The content canvas is the same size as the baked frame texture so the two
 * sprites can share a position and origin with no further arithmetic; the
 * artwork simply lands in the right place inside it.
 */
export function billboardPanelTransform(
  size: BillboardSize,
  facing: BillboardFacing,
): BillboardPanelTransform {
  const spec = BILLBOARD_SPECS[size];
  const contentWidth = spec.panelWidth - BILLBOARD_FRAME_INSET * 2;
  const contentHeight = spec.panelHeight - BILLBOARD_FRAME_INSET * 2;

  // A screen-facing board is not on a grid plane at all: it stands square to
  // the camera, so its face is a plain upright rectangle and the artwork needs
  // no shear. Its foot sits on the projected tile centre.
  if (facing === "screen") {
    const shadowRadius = Math.ceil(spec.legHeight * 0.08) + 1;
    const bottomMargin = Math.max(BILLBOARD_MARGIN, shadowRadius);
    const canvasWidth = spec.panelWidth + BILLBOARD_MARGIN * 2;
    const canvasHeight =
      spec.legHeight + spec.panelHeight + BILLBOARD_MARGIN + bottomMargin;
    return {
      canvasWidth,
      canvasHeight,
      contentWidth,
      contentHeight,
      anchorY: bottomMargin,
      shear: 0,
      offsetX: BILLBOARD_MARGIN + BILLBOARD_FRAME_INSET,
      offsetY: BILLBOARD_MARGIN + BILLBOARD_FRAME_INSET,
    };
  }

  // Half-span of the face along the board axis, in tile units. A step of 1
  // along that axis moves HALF_TILE_WIDTH across the screen.
  const span = spec.panelWidth / TILE_WIDTH;
  const panelTop = spec.legHeight + spec.panelHeight;

  const canvasWidth = spec.panelWidth + BILLBOARD_MARGIN * 2;
  const canvasHeight = TILE_HEIGHT * span + panelTop + BILLBOARD_MARGIN * 2;
  const anchorY = HALF_TILE_HEIGHT * span + BILLBOARD_MARGIN;

  const originX = canvasWidth / 2;
  const originY = canvasHeight - anchorY;

  // Top-left of the artwork, inset from the face's leading edge and top.
  const startAxis = -span + BILLBOARD_FRAME_INSET / HALF_TILE_WIDTH;
  const startZ = panelTop - BILLBOARD_FRAME_INSET;
  const depth = spec.thickness;

  const shear = facing === "left" ? 0.5 : -0.5;
  const offsetX =
    facing === "left"
      ? originX + (startAxis - depth) * HALF_TILE_WIDTH
      : originX + (depth + startAxis) * HALF_TILE_WIDTH;
  const offsetY =
    facing === "left"
      ? originY + (startAxis + depth) * HALF_TILE_HEIGHT - startZ
      : originY + (depth - startAxis) * HALF_TILE_HEIGHT - startZ;

  return {
    canvasWidth,
    canvasHeight,
    contentWidth,
    contentHeight,
    anchorY,
    shear,
    offsetX,
    offsetY,
  };
}

export interface BillboardPlacement {
  slot: BillboardSlot;
  sponsor: Sponsor;
}

/** Repository identity for the airport board. `url` absent means demo mode. */
export interface BillboardRepo {
  owner: string;
  name: string;
  url?: string;
}

/**
 * What a click on a board should open. Only ever produced for a board that has
 * somewhere to go, so the renderer can leave the rest non-interactive.
 */
export type BillboardTarget =
  | { kind: "repo"; url: string }
  | { kind: "ad"; sponsorId: string; url: string };

/**
 * Pairs each slot with a sponsor, deterministically from `seed` (the repo key).
 *
 * Sponsors are drawn without replacement so no repo shows the same advertiser
 * twice; once the roster is exhausted it refills, which only happens if there
 * are ever more boards than sponsors.
 */
export function assignSponsors(
  slots: readonly BillboardSlot[],
  seed: string,
): BillboardPlacement[] {
  const placements: BillboardPlacement[] = [];
  const byId = new Map(SPONSORS.map((s) => [s.id, s]));

  for (const [index, slot] of slots.entries()) {
    let sponsor: Sponsor | undefined;
    if (slot.size === "square" && byId.has("basecamp")) {
      sponsor = byId.get("basecamp");
    } else if (index === 0 && byId.has("pushtoprod")) {
      sponsor = byId.get("pushtoprod");
    } else {
      const choice = pickIndex(hashText(seed, index), SPONSORS.length);
      sponsor = SPONSORS[choice] as Sponsor;
    }
    if (sponsor) {
      placements.push({
        slot: { ...slot, size: sponsor.size ?? slot.size },
        sponsor,
      });
    }
  }

  return placements;
}
