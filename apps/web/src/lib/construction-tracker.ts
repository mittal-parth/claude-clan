/**
 * Tracks which files each crew is working on, and for how long.
 *
 * A site's lifetime is the work's lifetime rather than a fixed guess: each
 * running tool takes a hold on the file it is touching, and the site closes a
 * grace period after the last hold is released. A slow edit keeps its crane for
 * as long as it runs; a 40ms write still leaves one up for the grace period.
 * The session dimension prevents two concurrent crews editing the same path
 * from sharing a crane or accidentally releasing one another's hold.
 */

export type ConstructionSitesBySession = Record<string, string[]>;

export interface ConstructionTrackerOptions {
  /** How long a site stands after the work on it finishes. */
  graceMs: number;
  /** Called whenever the grouped set of active paths changes. */
  onChange: (sitesBySession: ConstructionSitesBySession) => void;
}

interface Site {
  sessionId: string;
  path: string;
  holds: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}

const SITE_KEY_SEPARATOR = "\0";

function siteKey(sessionId: string, path: string): string {
  return `${sessionId}${SITE_KEY_SEPARATOR}${path}`;
}

function holdKey(sessionId: string, holdId: string): string {
  return `${sessionId}${SITE_KEY_SEPARATOR}${holdId}`;
}

export class ConstructionTracker {
  private readonly sites = new Map<string, Site>();
  private readonly holdPaths = new Map<string, string>();

  constructor(private readonly options: ConstructionTrackerOptions) {}

  /**
   * Work has started on `path`. With a `holdId` the site stays open until the
   * matching finish(); without one it winds down after the grace period.
   */
  start(sessionId: string, path: string, holdId?: string): void {
    // Release first: if this id was already holding another file, that file
    // has to wind down, or a hold dropped without a matching finish would
    // strand its site open forever.
    if (holdId) {
      this.release(sessionId, holdId, true);
    }

    const key = siteKey(sessionId, path);
    const site = this.siteFor(sessionId, path);
    clearTimeout(site.timer);
    site.timer = undefined;

    if (holdId) {
      site.holds.add(holdId);
      this.holdPaths.set(holdKey(sessionId, holdId), key);
    }

    this.emit();

    if (!holdId && site.holds.size === 0) {
      this.closeLater(key, site);
    }
  }

  /** The tool behind `holdId` finished for `sessionId`. */
  finish(sessionId: string, holdId: string): void {
    this.release(sessionId, holdId, true);
  }

  /** Active paths grouped in the order work started within each session. */
  get sitesBySession(): ConstructionSitesBySession {
    const grouped: ConstructionSitesBySession = {};
    for (const site of this.sites.values()) {
      (grouped[site.sessionId] ??= []).push(site.path);
    }
    return grouped;
  }

  dispose(): void {
    for (const site of this.sites.values()) {
      clearTimeout(site.timer);
    }
    this.sites.clear();
    this.holdPaths.clear();
  }

  private release(sessionId: string, holdId: string, wind: boolean): void {
    const key = holdKey(sessionId, holdId);
    const pathKey = this.holdPaths.get(key);
    if (!pathKey) {
      return;
    }
    this.holdPaths.delete(key);

    const site = this.sites.get(pathKey);
    if (!site) {
      return;
    }
    site.holds.delete(holdId);
    if (wind && site.holds.size === 0) {
      this.closeLater(pathKey, site);
    }
  }

  private siteFor(sessionId: string, path: string): Site {
    const key = siteKey(sessionId, path);
    const existing = this.sites.get(key);
    if (existing) {
      return existing;
    }
    const site: Site = { sessionId, path, holds: new Set() };
    this.sites.set(key, site);
    return site;
  }

  private closeLater(key: string, site: Site): void {
    clearTimeout(site.timer);
    site.timer = setTimeout(() => {
      this.sites.delete(key);
      this.emit();
    }, this.options.graceMs);
  }

  private emit(): void {
    this.options.onChange(this.sitesBySession);
  }
}
