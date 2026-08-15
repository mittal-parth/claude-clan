export interface AirportPoint {
  x: number;
  y: number;
}

export type AirportTaxiwayKind = "vertical" | "junction";

export interface AirportTaxiwayTile extends AirportPoint {
  kind: AirportTaxiwayKind;
}

export interface AirportLayout {
  runwayStart: AirportPoint;
  runwayEnd: AirportPoint;
  runwayLength: number;
  runwayWidth: number;
  departureThreshold: AirportPoint;
  terminal: AirportPoint;
  tower: AirportPoint;
  apron: AirportPoint;
  gate: AirportPoint;
  taxiHold: AirportPoint;
  runwayEntry: AirportPoint;
  taxiway: AirportTaxiwayTile[];
  /** Landside road stub; WorldScene extends it to a real generated road cell. */
  accessRoadStart: AirportPoint;
}

/**
 * Half-extents of the terminal's footprint, in tiles. Two consumers have to
 * agree on this rectangle — the placement below, which keeps it off the
 * buildable field, and the bake, which derives every one of its own
 * dimensions from it — so it lives here, on the pure side, rather than as a
 * copy on each. The scene also needs the *front* corner for its depth key.
 */
export const AIRPORT_TERMINAL_HALF_U = 2.6;

export const AIRPORT_TERMINAL_HALF_V = 0.95;

/**
 * Half-extents of the concrete apron, shared with its bake for the same
 * reason. Everything that stands on tarmac — terminal, tower, stand — is
 * placed against these, so a prop can never end up on grass without a test
 * saying so.
 */
export const AIRPORT_APRON_HALF_U = 4.5;

export const AIRPORT_APRON_HALF_V = 1.45;

export const MIN_AIRPORT_RUNWAY_LENGTH = 18;
export const MAX_AIRPORT_RUNWAY_LENGTH = 22;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Reserves a coherent airport campus on the island's southwest edge.
 * Negative x and positive y both move left in the isometric projection, so
 * this remains lower-left without detaching the terminal from the city.
 */
export function createAirportLayout(width: number, height: number): AirportLayout {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const runwayLength = clamp(
    Math.round(safeWidth * 0.4) + 15,
    MIN_AIRPORT_RUNWAY_LENGTH,
    MAX_AIRPORT_RUNWAY_LENGTH,
  );
  const runwayStartX = -4.0;
  const runwayY = safeHeight + 3.2;
  // Keep the apron junction available for arrivals while lengthening the
  // strip on both sides. Departures curve left directly to the threshold.
  const runwayEntryX = runwayStartX + 5.2;

  return {
    runwayStart: { x: runwayStartX, y: runwayY },
    runwayEnd: { x: runwayStartX + runwayLength - 1, y: runwayY },
    runwayLength,
    runwayWidth: 1.44,
    departureThreshold: { x: runwayStartX + 0.42, y: runwayY },
    // The terminal is 5.2 tiles long and drawn from its centre, so its near
    // end reaches x + AIRPORT_TERMINAL_HALF_U. Keeping it south of height - 1
    // or west of x = 0 is what stops the frontage from standing through a building.
    terminal: { x: -1.8, y: safeHeight - 0.12 },
    // Off the terminal's near end, on the extended tarmac. Screen-right means
    // +x, and y stays past the field's last row so the tower is outside the
    // buildable area even though its x is positive.
    tower: { x: 4.2, y: safeHeight + 0.75 },
    // Runs from the tower back past the terminal's far end. The far edge is
    // pinned by the terminal, so the slab is lengthened at the +x end only.
    apron: { x: 0.0, y: safeHeight + 0.96 },
    gate: { x: 0.5, y: safeHeight + 1.28 },
    taxiHold: { x: runwayEntryX, y: runwayY - 0.86 },
    runwayEntry: { x: runwayEntryX, y: runwayY },
    taxiway: [
      { x: runwayEntryX, y: runwayY - 1.42, kind: "vertical" },
      { x: runwayEntryX, y: runwayY - 0.47, kind: "junction" },
    ],
    accessRoadStart: { x: -0.5, y: Math.max(0, safeHeight - 2) },
  };
}

/**
 * Connects the terminal stub to an actual road cell. West-edge roads are
 * preferred so the route stays outside the buildable city until its final
 * tile and cannot cut through a file building. The vertical leg is laid in
 * countryside first, then the short horizontal leg joins the selected road.
 */
export function connectAirportToRoad(
  start: AirportPoint,
  roads: readonly AirportPoint[],
): AirportPoint[] {
  if (roads.length === 0) return [{ x: Math.round(start.x), y: Math.round(start.y) }];

  const roundedStart = { x: Math.round(start.x), y: Math.round(start.y) };
  const westEdge = roads.filter((road) => Math.round(road.x) === 0);
  const candidates = westEdge.length > 0 ? westEdge : roads;
  const target = [...candidates].sort((left, right) => {
    const leftDistance =
      Math.abs(Math.round(left.x) - roundedStart.x) +
      Math.abs(Math.round(left.y) - roundedStart.y);
    const rightDistance =
      Math.abs(Math.round(right.x) - roundedStart.x) +
      Math.abs(Math.round(right.y) - roundedStart.y);
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  })[0]!;
  const roundedTarget = { x: Math.round(target.x), y: Math.round(target.y) };
  const path: AirportPoint[] = [{ ...roundedStart }];
  let cursor = { ...roundedStart };

  while (cursor.y !== roundedTarget.y) {
    cursor = { x: cursor.x, y: cursor.y + Math.sign(roundedTarget.y - cursor.y) };
    path.push(cursor);
  }
  while (cursor.x !== roundedTarget.x) {
    cursor = { x: cursor.x + Math.sign(roundedTarget.x - cursor.x), y: cursor.y };
    path.push(cursor);
  }
  return path;
}

/** Extends a departure beyond the far threshold without changing runway grid-y. */
export function runwayExitPoint(
  layout: AirportLayout,
  tilesBeyondRunway: number,
): AirportPoint {
  return {
    x: layout.runwayEnd.x + Math.max(0, tilesBeyondRunway),
    y: layout.runwayEnd.y,
  };
}

/**
 * The airport's own reserved ground -- runway, apron and terminal are all
 * sprites, not terrain (see CLAUDE.md on the capitol), so nothing otherwise
 * stops the countryside's tree scatter from planting one on the runway
 * threshold or beside the tower. Derived from the real layout rather than a
 * hand-copied box, so a change to the airport's own geometry can't silently
 * leave a new corner of it unreserved.
 *
 * Kept as separate rectangles, one per feature, rather than a single box
 * around all of them: the terminal sits west of the field (negative x) while
 * the apron, tower and runway sit south of it (y past the last row), so a
 * single bounding box spans the corner between the two -- ground that belongs
 * to neither -- and would needlessly clear a strip of the city's own edge.
 */
const RESERVE_MARGIN = 1;

export interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function padded(centreX: number, centreY: number, halfU: number, halfV: number): Rect {
  return {
    minX: centreX - halfU - RESERVE_MARGIN,
    maxX: centreX + halfU + RESERVE_MARGIN,
    minY: centreY - halfV - RESERVE_MARGIN,
    maxY: centreY + halfV + RESERVE_MARGIN,
  };
}

export function airportReservedRects(width: number, height: number): Rect[] {
  const layout = createAirportLayout(width, height);
  const runwayHalfU = (layout.runwayEnd.x - layout.runwayStart.x) / 2;
  const runwayCentreX = (layout.runwayStart.x + layout.runwayEnd.x) / 2;

  return [
    padded(
      layout.terminal.x,
      layout.terminal.y,
      AIRPORT_TERMINAL_HALF_U,
      AIRPORT_TERMINAL_HALF_V,
    ),
    padded(layout.apron.x, layout.apron.y, AIRPORT_APRON_HALF_U, AIRPORT_APRON_HALF_V),
    padded(runwayCentreX, layout.runwayStart.y, runwayHalfU, layout.runwayWidth / 2),
    // The tower stands alone, off the apron's own footprint.
    padded(layout.tower.x, layout.tower.y, 0.6, 0.6),
  ];
}

export function isOnAirportGround(x: number, y: number, width: number, height: number): boolean {
  return airportReservedRects(width, height).some(
    (rect) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY,
  );
}

export function airportLayoutKey(layout: AirportLayout): string {
  return [
    layout.runwayStart.x,
    layout.runwayStart.y,
    layout.runwayLength,
    layout.terminal.x,
    layout.terminal.y,
  ].join(":");
}
