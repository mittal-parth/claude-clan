/**
 * Pure classification of a PR overlay into what WorldScene needs to draw --
 * no Phaser import, so this stays unit-testable without a renderer.
 */

import type { ChangedFile, PullRequestOverlay, Plot } from "@sudo-city/protocol";

export interface RubbleMarker {
  path: string;
  plot: Plot;
}

/** Deleted files that carry a plot (main's, since they no longer exist in the PR worktree). */
export function rubbleMarkers(
  overlay: PullRequestOverlay | undefined,
): RubbleMarker[] {
  if (!overlay) {
    return [];
  }
  const markers: RubbleMarker[] = [];
  for (const file of overlay.files) {
    if (file.change === "deleted" && file.plot) {
      markers.push({ path: file.path, plot: file.plot });
    }
  }
  return markers;
}

/** The change kind for a standing building, or undefined if it isn't in the overlay. */
export function markerFor(
  overlay: PullRequestOverlay | undefined,
  path: string,
): ChangedFile["change"] | undefined {
  if (!overlay) {
    return undefined;
  }
  const file = overlay.files.find((entry) => entry.path === path);
  return file && file.change !== "deleted" ? file.change : undefined;
}
