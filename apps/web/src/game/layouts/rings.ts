/**
 * The island's rings, as plain numbers with no dependencies at all.
 *
 * These live apart from terrain.ts because coast.ts needs them and terrain.ts
 * needs coast.ts, by way of the dock road. Left in terrain.ts that is a cycle,
 * and a cycle here does not fail loudly: the bundler hands the half-initialised
 * module `undefined` instead of throwing, so a module-level `Math.round(...)`
 * of one of these quietly becomes NaN and every loop bounded by it runs zero
 * times. The dock road's spine vanished exactly like that, leaving the link to
 * the city dead-ending in a field.
 *
 * terrain.ts re-exports all four, so they keep their long-standing import site.
 */

export const COUNTRYSIDE_RING = 6;
export const COAST_RING = 2;
export const OCEAN_RING = 12;
export const OUTER_RING = COUNTRYSIDE_RING + COAST_RING + OCEAN_RING;
