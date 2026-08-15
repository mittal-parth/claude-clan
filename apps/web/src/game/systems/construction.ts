/**
 * Construction sites — what the city does while the agent is working.
 *
 * A building the crew is touching gets a tower crane beside it, scaffolding
 * wrapped around it and dust at its feet, so an executing task reads as visible
 * work rather than a quest-log line nobody is watching.
 */

import Phaser from "phaser";
import { CABLE_KEY, CRANE_KEY, HOOK_KEY } from "../textures/crane";
import { CRANE_CABLE_OFFSET } from "../layouts/crane";
import { SCAFFOLD_HEIGHT, SCAFFOLD_KEY } from "../textures/scaffold";
import { SMOKE_KEY } from "../textures/effects";
import { TILE_ANCHOR_Y } from "../textures/core";

/** Most sites shown at once; an agent editing 200 files should not spawn 200. */
const MAX_SITES = 12;

const HOOK_TRAVEL = 46;
const HOOK_PERIOD = 2_600;

/**
 * The crew member standing on the plot. Portraits arrive at wildly different
 * pixel sizes, so they are scaled to a fixed height instead of a fixed scale —
 * a person should read as a person whichever one is on shift.
 */
const CREW_HEIGHT = 64;
/** Just off the west edge of the plot, clear of the scaffold. */
const CREW_OFFSET_X = -44;
const CREW_OFFSET_Y = -10;
const CREW_BOB = 3;
const CREW_BOB_PERIOD = 2_200;

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
  /** Absent until a crew portrait has finished loading. */
  crew?: Phaser.GameObjects.Sprite;
  crewBob?: Phaser.Tweens.Tween;
  dust?: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Kept so a portrait arriving mid-session can be placed without a resync. */
  target: ConstructionTarget;
  tweens: Phaser.Tweens.Tween[];
}

export class ConstructionSites {
  private sites = new Map<string, Site>();
  private crewTexture?: string;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: boolean,
  ) {}

  /**
   * Who is on shift. The texture is loaded by the scene, so this only ever
   * receives a key that is ready to draw. Sites already standing pick the new
   * crew up immediately rather than waiting for the next file to be touched.
   */
  setCrewTexture(key?: string): void {
    if (this.crewTexture === key) {
      return;
    }

    this.crewTexture = key;
    for (const site of this.sites.values()) {
      this.dismissCrew(site);
      this.attachCrew(site);
    }
  }

  /** Stands a crew member on the plot, if we have a portrait for them yet. */
  private attachCrew(site: Site): void {
    if (!this.crewTexture) {
      return;
    }

    const crew = this.scene.add
      .sprite(0, 0, this.crewTexture)
      .setOrigin(0.5, 1);
    crew.setScale(CREW_HEIGHT / crew.height);
    site.crew = crew;
    this.placeCrew(site);
  }

  private dismissCrew(site: Site): void {
    site.crewBob?.remove();
    site.crewBob = undefined;
    site.crew?.destroy();
    site.crew = undefined;
  }

  /**
   * Puts the crew member where the plot is and restarts their idle bob around
   * that spot. Only called when the plot has actually moved — the bob tweens
   * `y`, so replacing it on every sync would leave them standing perfectly
   * still.
   */
  private placeCrew(site: Site): void {
    const crew = site.crew;
    if (!crew) {
      return;
    }

    site.crewBob?.remove();
    crew
      .setPosition(site.target.x + CREW_OFFSET_X, site.target.y + CREW_OFFSET_Y)
      .setDepth(site.target.depth + 4);

    site.crewBob = this.reducedMotion
      ? undefined
      : this.scene.tweens.add({
          targets: crew,
          y: crew.y - CREW_BOB,
          duration: CREW_BOB_PERIOD,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
  }

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

    const site: Site = { crane, cable, hook, scaffold, target, tweens: [] };
    this.reposition(site, target);
    this.attachCrew(site);

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
    const moved =
      site.target.x !== target.x ||
      site.target.y !== target.y ||
      site.target.depth !== target.depth;
    site.target = target;
    if (moved) {
      this.placeCrew(site);
    }

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
    site.crewBob?.remove();
    site.crewBob = undefined;
    site.dust?.destroy();
    this.scene.tweens.killTweensOf(site.scaffold);

    // The crew walk off with the scaffold rather than blinking away.
    const struck = [site.scaffold, site.crane, site.hook, site.cable];
    const crew = site.crew;
    if (crew) {
      struck.push(crew);
    }

    this.scene.tweens.add({
      targets: struck,
      alpha: 0,
      duration: this.reducedMotion ? 0 : 260,
      onComplete: () => {
        site.crane.destroy();
        site.cable.destroy();
        site.hook.destroy();
        site.scaffold.destroy();
        crew?.destroy();
      },
    });
    site.crew = undefined;
  }
}

/** Exposed so the scene can report how many sites are live. */
export const CONSTRUCTION_LIMITS = { sites: MAX_SITES } as const;
