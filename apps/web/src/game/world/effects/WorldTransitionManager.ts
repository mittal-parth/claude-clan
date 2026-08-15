import Phaser from "phaser";
import { SKY_DEPTH, WHITEOUT_ALPHA, WHITEOUT_HOLD_MS } from "../core/worldConstants";
import { randomCloudEdge } from "../core/worldMath";

export class WorldTransitionManager {
  private transitionClouds: Phaser.GameObjects.Graphics[] = [];
  private transitionCloudVeil?: Phaser.GameObjects.Rectangle;

  constructor(private scene: Phaser.Scene) {}

  resizeTravelCover(width: number, height: number): void {
    this.transitionCloudVeil?.setSize(width, height).setDisplaySize(width, height);
  }

  playCoverTransition(): Promise<void> {
    const camera = this.scene.cameras.main;
    this.clearTransitionClouds();

    const veil = this.scene.add
      .rectangle(0, 0, camera.width, camera.height, 0xffffff, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(SKY_DEPTH + 9);
    this.transitionCloudVeil = veil;
    const cloudCount = Phaser.Math.Clamp(
      Math.round((camera.width * camera.height) / 42_000),
      14,
      24,
    );

    return new Promise((resolve) => {
      let finishedClouds = 0;
      let veilFinished = false;
      const finishIfWhite = (): void => {
        if (veilFinished && finishedClouds === cloudCount) {
          resolve();
        }
      };

      this.scene.tweens.add({
        targets: veil,
        alpha: WHITEOUT_ALPHA,
        delay: 320,
        duration: 820,
        ease: "Sine.easeInOut",
        onComplete: () => {
          veilFinished = true;
          finishIfWhite();
        },
      });

      for (let index = 0; index < cloudCount; index += 1) {
        const cloudSize = Phaser.Math.Between(1_500, 3_000);
        const start = randomCloudEdge(camera, cloudSize);
        const cloud = this.createTransitionCloud(
          cloudSize,
          SKY_DEPTH + 10 + index,
        )
          .setPosition(start.x, start.y)
          .setAlpha(0);
        this.transitionClouds.push(cloud);

        const restingX = Phaser.Math.Between(
          -Math.round(cloudSize * 0.25),
          camera.width + Math.round(cloudSize * 0.25),
        );
        const restingY = Phaser.Math.Between(
          -Math.round(cloudSize * 0.2),
          camera.height + Math.round(cloudSize * 0.2),
        );
        this.scene.tweens.add({
          targets: cloud,
          x: restingX,
          y: restingY,
          alpha: Phaser.Math.FloatBetween(0.38, 0.7),
          duration: Phaser.Math.Between(520, 900),
          delay: Phaser.Math.Between(0, 420),
          ease: "Sine.easeOut",
          onComplete: () => {
            finishedClouds += 1;
            finishIfWhite();
          },
        });
      }
    });
  }

  partCloudCover(): Promise<void> {
    const clouds = this.transitionClouds;
    this.transitionClouds = [];
    const veil = this.transitionCloudVeil;
    this.transitionCloudVeil = undefined;
    if (clouds.length === 0 && !veil) {
      return Promise.resolve();
    }

    const camera = this.scene.cameras.main;
    return new Promise((resolve) => {
      let remaining = clouds.length + (veil ? 1 : 0);
      const finishReveal = (): void => {
        remaining -= 1;
        if (remaining === 0) {
          resolve();
        }
      };

      if (veil) {
        this.scene.tweens.add({
          targets: veil,
          alpha: 0,
          duration: 780,
          delay: WHITEOUT_HOLD_MS,
          ease: "Sine.easeInOut",
          onComplete: () => {
            veil.destroy();
            finishReveal();
          },
        });
      }

      clouds.forEach((cloud) => {
        const exit = randomCloudEdge(
          camera,
          cloud.getData("travelSize") as number,
        );
        this.scene.tweens.add({
          targets: cloud,
          x: exit.x,
          y: exit.y,
          alpha: 0,
          duration: Phaser.Math.Between(520, 920),
          delay: WHITEOUT_HOLD_MS + Phaser.Math.Between(0, 260),
          ease: "Sine.easeIn",
          onComplete: () => {
            cloud.destroy();
            finishReveal();
          },
        });
      });
    });
  }

  clearTransitionClouds(): void {
    for (const cloud of this.transitionClouds) {
      this.scene.tweens.killTweensOf(cloud);
      cloud.destroy();
    }
    this.transitionClouds = [];
    if (this.transitionCloudVeil) {
      this.scene.tweens.killTweensOf(this.transitionCloudVeil);
      this.transitionCloudVeil.destroy();
      this.transitionCloudVeil = undefined;
    }
  }

  private createTransitionCloud(
    size: number,
    depth: number,
  ): Phaser.GameObjects.Graphics {
    const cloud = this.scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(depth);
    const puffs = Array.from(
      { length: Phaser.Math.Between(4, 8) },
      () => ({
        x: Phaser.Math.FloatBetween(-size * 0.55, size * 0.55),
        y: Phaser.Math.FloatBetween(-size * 0.18, size * 0.18),
        radius: Phaser.Math.FloatBetween(size * 0.16, size * 0.32),
      }),
    );

    cloud.fillStyle(0xcfe5f7, 0.52);
    for (const puff of puffs) {
      cloud.fillCircle(puff.x + size * 0.035, puff.y + size * 0.06, puff.radius);
    }
    cloud.fillStyle(0xffffff, 0.95);
    for (const puff of puffs) {
      cloud.fillCircle(puff.x, puff.y, puff.radius);
    }
    cloud.setData("travelSize", size);
    return cloud;
  }
}
