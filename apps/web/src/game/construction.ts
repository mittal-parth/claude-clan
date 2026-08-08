/**
 * Construction sites — what the city does while the agent is working.
 *
 * A building the crew is touching gets a tower crane beside it, scaffolding
 * wrapped around it and dust at its feet, so an executing task reads as visible
 * work rather than a quest-log line nobody is watching.
 */

import Phaser from "phaser";
import {
  CABLE_KEY,
  CRANE_CABLE_OFFSET,
  CRANE_KEY,
  HOOK_KEY,
  SCAFFOLD_HEIGHT,
  SCAFFOLD_KEY,
  SMOKE_KEY,
  TILE_ANCHOR_Y,
} from "./textures";

/** Most sites shown at once; an agent editing 200 files should not spawn 200. */
const MAX_SITES = 12;

const HOOK_TRAVEL = 46;
const HOOK_PERIOD = 2_600;

export interface ConstructionTarget {
  path: string;
  /** Screen position of the plot's bottom corner — where sprites anchor. */
  x: number;
  y: number;
  /** Depth of the building being worked on, so the site sorts alongside it. */
  depth: number;
  /** Pixel height of the building, used to size the scaffold. */
  height: number;
}

interface Site {
  crane: Phaser.GameObjects.Sprite;
  cable: Phaser.GameObjects.Sprite;
  hook: Phaser.GameObjects.Sprite;
  scaffold: Phaser.GameObjects.Sprite;
  dust?: Phaser.GameObjects.Particles.ParticleEmitter;
  tweens: Phaser.Tweens.Tween[];
}

export class ConstructionSites {
  private sites = new Map<string, Site>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: boolean,
  ) {}

  /** Diffs the requested set against what is standing; leaves the rest alone. */
  sync(targets: readonly ConstructionTarget[]): void {
    const wanted = new Map(
      targets.slice(0, MAX_SITES).map((target) => [target.path, target]),
    );

    for (const [path, site] of this.sites) {
      if (!wanted.has(path)) {
        this.teardown(site);
        this.sites.delete(path);
      }
    }

    for (const [path, target] of wanted) {
      const existing = this.sites.get(path);
      if (existing) {
        this.reposition(existing, target);
        continue;
      }
      this.sites.set(path, this.build(target));
    }
  }

  clear(): void {
    for (const site of this.sites.values()) {
      this.teardown(site);
    }
    this.sites.clear();
  }

  get size(): number {
    return this.sites.size;
  }

  private build(target: ConstructionTarget): Site {
    const scene = this.scene;

    // The crane stands on the plot and leans its jib out over the building, so
    // it sorts one step in front of what it is working on.
    const crane = scene.add
      .sprite(target.x, target.y, CRANE_KEY)
      .setOrigin(0.5, 1)
      .setDepth(target.depth + 2);

    const scaffold = scene.add
      .sprite(target.x, target.y, SCAFFOLD_KEY)
      .setOrigin(0.5, 1)
      .setDepth(target.depth + 1)
      .setAlpha(0.9);

    const hook = scene.add
      .sprite(0, 0, HOOK_KEY)
      .setOrigin(0.5, 0)
      .setDepth(target.depth + 3);

    const cable = scene.add
      .sprite(0, 0, CABLE_KEY)
      .setOrigin(0.5, 0)
      .setDepth(target.depth + 3);

    const site: Site = { crane, cable, hook, scaffold, tweens: [] };
    this.reposition(site, target);

    if (!this.reducedMotion) {
      site.tweens.push(
        scene.tweens.add({
          targets: hook,
          y: hook.y + HOOK_TRAVEL,
          duration: HOOK_PERIOD,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: () => this.stretchCable(site),
        }),
      );

      site.dust = scene.add.particles(target.x, target.y, SMOKE_KEY, {
        speedY: { min: -14, max: -4 },
        speedX: { min: -12, max: 12 },
        lifespan: 1_400,
        quantity: 1,
        frequency: 420,
        scale: { start: 0.35, end: 0.9 },
        alpha: { start: 0.35, end: 0 },
        tint: 0xd8c9a8,
      });
      site.dust.setDepth(target.depth + 4);
    }

    // Scaffolding goes up rather than popping in.
    scaffold.setScale(1, 0);
    scene.tweens.add({
      targets: scaffold,
      scaleY: this.scaffoldScale(target),
      duration: this.reducedMotion ? 0 : 320,
      ease: "Quad.easeOut",
    });

    return site;
  }

  private reposition(site: Site, target: ConstructionTarget): void {
    site.crane.setPosition(target.x, target.y).setDepth(target.depth + 2);
    site.scaffold
      .setPosition(target.x, target.y)
      .setDepth(target.depth + 1)
      .setScale(1, this.scaffoldScale(target));
    site.dust?.setPosition(target.x, target.y);

    // The trolley's exact position on the jib, so the cable never hangs off
    // the end of the arm.
    const trolleyX = target.x + CRANE_CABLE_OFFSET.x;
    const trolleyY = target.y + CRANE_CABLE_OFFSET.y;
    site.hook
      .setPosition(trolleyX, trolleyY + HOOK_TRAVEL / 2)
      .setDepth(target.depth + 3);
    site.cable.setPosition(trolleyX, trolleyY).setDepth(target.depth + 3);
    this.stretchCable(site);
  }

  /** The cable spans whatever gap the hook's bob has opened up. */
  private stretchCable(site: Site): void {
    site.cable.setDisplaySize(2, Math.max(1, site.hook.y - site.cable.y));
  }

  private scaffoldScale(target: ConstructionTarget): number {
    // Wrap the building a little short of its roof so the roof stays readable.
    const wrapped = Math.max(TILE_ANCHOR_Y, target.height * 0.7);
    return wrapped / SCAFFOLD_HEIGHT;
  }

  private teardown(site: Site): void {
    for (const tween of site.tweens) {
      tween.remove();
    }
    site.dust?.destroy();
    this.scene.tweens.killTweensOf(site.scaffold);

    // Strike the scaffold rather than blinking it away.
    this.scene.tweens.add({
      targets: [site.scaffold, site.crane, site.hook, site.cable],
      alpha: 0,
      duration: this.reducedMotion ? 0 : 260,
      onComplete: () => {
        site.crane.destroy();
        site.cable.destroy();
        site.hook.destroy();
        site.scaffold.destroy();
      },
    });
  }
}

/** Exposed so the scene can report how many sites are live. */
export const CONSTRUCTION_LIMITS = { sites: MAX_SITES } as const;
