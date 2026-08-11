/**
 * When the camera is allowed to fly to a new construction site.
 *
 * Split out from WorldScene so the rules can be tested without standing up
 * Phaser — everything here is arithmetic on a camera's world view.
 */

export interface RevealSite {
  x: number;
  y: number;
}

/** The camera's visible world rectangle, plus the zoom it is showing it at. */
export interface RevealView {
  x: number;
  y: number;
  right: number;
  bottom: number;
  zoom: number;
}

export interface RevealRules {
  /** Breathing room required around the site, in world units. */
  margin: number;
  /**
   * Below this zoom a crane is too small to read, so a site being technically
   * on screen is not enough — the camera still goes and gets it.
   */
  legibleZoom: number;
  /** Scene clock, and the last time the player moved the camera themselves. */
  now: number;
  lastCameraInputAt: number;
  /** How long to leave the camera alone after the player touches it. */
  yieldMs: number;
}

/**
 * True when the camera should move to show `site`.
 *
 * The player always wins: touch the camera and nothing auto-moves for a while.
 * Past that, a site is left alone only if it is already framed *and* the world
 * is zoomed in far enough for the crane to be worth looking at.
 */
export function shouldRevealSite(
  site: RevealSite,
  view: RevealView,
  rules: RevealRules,
): boolean {
  if (rules.now - rules.lastCameraInputAt < rules.yieldMs) {
    return false;
  }

  if (view.zoom < rules.legibleZoom) {
    return true;
  }

  const framed =
    site.x > view.x + rules.margin &&
    site.x < view.right - rules.margin &&
    site.y > view.y + rules.margin &&
    site.y < view.bottom - rules.margin;
  return !framed;
}
