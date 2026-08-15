import type { PullRequestOverlay } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { markerFor, rubbleMarkers } from "./overlay";

const overlay: PullRequestOverlay = {
  cityId: "pr-42",
  baseRef: "main",
  headSha: "abc123",
  files: [
    { path: "src/new.ts", change: "added", additions: 10, deletions: 0 },
    { path: "src/edited.ts", change: "modified", additions: 3, deletions: 1 },
    {
      path: "src/gone.ts",
      change: "deleted",
      additions: 0,
      deletions: 8,
      plot: { x: 3, y: 5 },
    },
    // Deleted with no plot -- possible if main never had the file scanned,
    // e.g. it was gitignored. Must not produce a rubble marker with no
    // coordinates to place it at.
    { path: "src/never-scanned.ts", change: "deleted", additions: 0, deletions: 2 },
  ],
};

describe("rubbleMarkers", () => {
  it("returns only deleted files that carry a plot", () => {
    expect(rubbleMarkers(overlay)).toEqual([
      { path: "src/gone.ts", plot: { x: 3, y: 5 } },
    ]);
  });

  it("returns nothing when there is no overlay", () => {
    expect(rubbleMarkers(undefined)).toEqual([]);
  });
});

describe("markerFor", () => {
  it("classifies added and modified files", () => {
    expect(markerFor(overlay, "src/new.ts")).toBe("added");
    expect(markerFor(overlay, "src/edited.ts")).toBe("modified");
  });

  it("never marks a deleted file as a standing-building marker", () => {
    expect(markerFor(overlay, "src/gone.ts")).toBeUndefined();
  });

  it("returns undefined for a file not in the overlay, or with no overlay at all", () => {
    expect(markerFor(overlay, "untouched.ts")).toBeUndefined();
    expect(markerFor(undefined, "src/new.ts")).toBeUndefined();
  });
});
