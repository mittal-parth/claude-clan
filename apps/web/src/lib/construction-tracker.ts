/**
 * Tracks which files the crew is working on, and for how long.
 *
 * A site's lifetime is the work's lifetime rather than a fixed guess: each
 * running tool takes a hold on the file it is touching, and the site closes a
 * grace period after the last hold is released. A slow edit keeps its crane for
 * as long as it runs; a 40ms write still leaves one up for the grace period.
 */

export interface ConstructionTrackerOptions {
  /** How long a site stands after the work on it finishes. */
  graceMs: number;
  /** Called whenever the set of active paths changes. */
  onChange: (paths: string[]) => void;
}

interface Site {
  holds: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}

export class ConstructionTracker {
  private readonly sites = new Map<string, Site>();
  private readonly holdPaths = new Map<string, string>();

  constructor(private readonly options: ConstructionTrackerOptions) {}

  /**
   * Work has started on `path`. With a `holdId` the site stays open until the
   * matching finish(); without one it winds down after the grace period.
   */
  start(path: string, holdId?: string): void {
    // Release first: if this id was already holding another file, that file
    // has to wind down, or a hold dropped without a matching finish would
    // strand its site open forever.
    if (holdId) {
      this.release(holdId, true);
    }

    const site = this.siteFor(path);
    clearTimeout(site.timer);
    site.timer = undefined;

    if (holdId) {
      site.holds.add(holdId);
      this.holdPaths.set(holdId, path);
    }

    this.emit();

    if (!holdId && site.holds.size === 0) {
      this.closeLater(path, site);
    }
  }

  /** The tool behind `holdId` finished. */
  finish(holdId: string): void {
    this.release(holdId, true);
  }

  /** Active paths, in the order work started on them. */
  get paths(): string[] {
    return [...this.sites.keys()];
  }

  dispose(): void {
    for (const site of this.sites.values()) {
      clearTimeout(site.timer);
    }
    this.sites.clear();
    this.holdPaths.clear();
  }

  private release(holdId: string, wind: boolean): void {
    const path = this.holdPaths.get(holdId);
    if (!path) {
      return;
    }
    this.holdPaths.delete(holdId);

    const site = this.sites.get(path);
    if (!site) {
      return;
    }
    site.holds.delete(holdId);
    if (wind && site.holds.size === 0) {
      this.closeLater(path, site);
    }
  }

  private siteFor(path: string): Site {
    const existing = this.sites.get(path);
    if (existing) {
      return existing;
    }
    const site: Site = { holds: new Set() };
    this.sites.set(path, site);
    return site;
  }

  private closeLater(path: string, site: Site): void {
    clearTimeout(site.timer);
    site.timer = setTimeout(() => {
      this.sites.delete(path);
      this.emit();
    }, this.options.graceMs);
  }

  private emit(): void {
    this.options.onChange(this.paths);
  }
}
