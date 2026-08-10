import type { WorldSnapshot } from "@sudo-city/protocol";

/**
 * A minimal square city, big enough that the port frontage tests have a real
 * stretch of east coast to inspect. Only the size and districts matter here —
 * terrain classification outside the city ignores buildings entirely.
 */
export function portFrontageSnapshot(size: number): WorldSnapshot {
  return {
    id: "world:coast-test",
    repoPath: "/fixture",
    revision: "test",
    generatedAt: "2026-08-08T00:00:00.000Z",
    size: { width: size, height: size },
    districts: [{ path: "src", x: 0, y: 0, width: size, height: size, weight: 100 }],
    buildings: [],
  };
}
