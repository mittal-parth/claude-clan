/**
 * Deterministic hashing for world decoration.
 *
 * Every variant choice in the city — building archetype, tree placement, roof
 * jitter — must come from here rather than Math.random(). Snapshots arrive
 * repeatedly and the scene diffs them, so a cell has to decide the same way
 * every time or the city reshuffles under the player.
 */

/** murmur3 finalizer: cheap, and mixes low bits well enough for grid coords. */
function mix(value: number): number {
  let hashed = value | 0;
  hashed ^= hashed >>> 16;
  hashed = Math.imul(hashed, 0x85ebca6b);
  hashed ^= hashed >>> 13;
  hashed = Math.imul(hashed, 0xc2b2ae35);
  hashed ^= hashed >>> 16;
  return hashed >>> 0;
}

export function hashCoords(x: number, y: number, salt = 0): number {
  return mix(Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b) ^ mix(salt));
}

export function hashText(value: string, salt = 0): number {
  let hashed = 0x811c9dc5 ^ (salt | 0);
  for (let index = 0; index < value.length; index += 1) {
    hashed = Math.imul(hashed ^ value.charCodeAt(index), 0x01000193);
  }
  return mix(hashed);
}

/** Maps a hash to [0, 1). */
export function unitFloat(seed: number): number {
  return (seed >>> 0) / 0x1_0000_0000;
}

/** Maps a hash to [0, length). */
export function pickIndex(seed: number, length: number): number {
  return Math.min(length - 1, Math.floor(unitFloat(seed) * length));
}

export function pick<Item>(items: readonly Item[], seed: number): Item {
  return items[pickIndex(seed, items.length)] as Item;
}

/** True for roughly `probability` of the seed space. */
export function chance(seed: number, probability: number): boolean {
  return unitFloat(seed) < probability;
}

/** Positive modulo — grid offsets can be negative outside the city. */
export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
