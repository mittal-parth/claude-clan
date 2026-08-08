export const METER_SEGMENTS = 20;

/**
 * Lit cells for a percentage. Clamped rather than trusted: a treasury can run
 * past its budget, and a bar that overflows its track reads worse than a full
 * one. A missing or negative reading lights nothing rather than guessing.
 */
export function filledSegments(
  value: number,
  segments: number = METER_SEGMENTS,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(segments, Math.round((value / 100) * segments));
}
