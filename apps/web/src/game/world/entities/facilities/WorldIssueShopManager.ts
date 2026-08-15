import Phaser from "phaser";
import type { Issue, WorldSnapshot } from "@sudo-city/protocol";
import { projection } from "../../core/worldConstants";
import { ISSUE_SHOP_ANCHOR_Y, ISSUE_SHOP_KEY } from "../../../textures/buildings";

export class WorldIssueShopManager {
  public issues: Issue[] = [];
  public issueShop?: Phaser.GameObjects.Sprite;

  constructor(
    private scene: Phaser.Scene,
    private getCurrentCityId: () => string | undefined,
    private getSnapshot: () => WorldSnapshot | undefined,
  ) {}

  setIssues(issues: readonly Issue[]): void {
    this.issues = [...issues];
    if (!this.scene.scene?.isActive()) {
      if (this.scene.events) {
        this.scene.events.once(Phaser.Scenes.Events.CREATE, () =>
          this.layoutIssueShop(),
        );
      }
      return;
    }
    this.layoutIssueShop();
  }

  layoutIssueShop(): void {
    // GitHub Issue Shop Commented out, Townhall is used for issues now
    /*
    const currentCityId = this.getCurrentCityId();
    const snapshot = this.getSnapshot();
    if (currentCityId !== "main" || !snapshot) {
      this.issueShop?.destroy();
      this.issueShop = undefined;
      return;
    }
    const { height } = snapshot.size;
    const gx = -2;
    const gy = Math.max(0, height - 7);
    const point = projection.project(gx + 0.5, gy + 0.5);
    if (!this.issueShop) {
      this.issueShop = this.scene.add
        .sprite(point.x, point.y + ISSUE_SHOP_ANCHOR_Y, ISSUE_SHOP_KEY)
        .setOrigin(0.5, 1);
    }
    this.issueShop
      .setPosition(point.x, point.y + ISSUE_SHOP_ANCHOR_Y)
      .setDepth(projection.depth(gx + 1, gy + 1) + 1)
      .setVisible(true);
    this.issueShop.setData("issueCount", this.issues.length);
    */
  }

  clear(): void {
    this.issueShop?.destroy();
    this.issueShop = undefined;
  }
}
