import type { WorldSnapshot } from "@sudo-city/protocol";
import Phaser from "phaser";
import { createIsoProjection } from "./iso";

const TILE_WIDTH = 96;
const TILE_HEIGHT = 48;
const projection = createIsoProjection(TILE_WIDTH, TILE_HEIGHT);

const languageColors: Record<string, number> = {
  JavaScript: 0xf2d34f,
  TypeScript: 0x4f8fe8,
  Python: 0x62c6a6,
  Rust: 0xf0875a,
};

function vector(x: number, y: number): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(x, y);
}

export class WorldScene extends Phaser.Scene {
  private worldLayer?: Phaser.GameObjects.Container;
  private dragOrigin?: { x: number; y: number };

  constructor() {
    super("world");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x101a24);
    this.cameras.main.centerOn(0, 160);
    this.drawGrid();
    this.bindCamera();
  }

  setWorld(snapshot: WorldSnapshot): void {
    if (!this.scene.isActive()) {
      this.events.once(Phaser.Scenes.Events.CREATE, () => this.setWorld(snapshot));
      return;
    }

    this.worldLayer?.destroy(true);
    this.worldLayer = this.add.container(0, 0);

    for (const building of snapshot.buildings) {
      const point = projection.project(building.plot.x, building.plot.y);
      const height = Phaser.Math.Clamp(28 + Math.sqrt(building.loc) * 4, 42, 150);
      const color = languageColors[building.language] ?? 0xa9b4c2;
      const structure = this.createBuilding(point.x, point.y, height, color);
      structure.setDepth(projection.depth(building.plot.x, building.plot.y));
      this.worldLayer.add(structure);
    }
  }

  private drawGrid(): void {
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x284456, 0.72);

    for (let x = -5; x <= 12; x += 1) {
      for (let y = -5; y <= 12; y += 1) {
        const point = projection.project(x, y);
        grid.strokePoints(
          [
            vector(point.x, point.y - TILE_HEIGHT / 2),
            vector(point.x + TILE_WIDTH / 2, point.y),
            vector(point.x, point.y + TILE_HEIGHT / 2),
            vector(point.x - TILE_WIDTH / 2, point.y),
          ],
          true,
        );
      }
    }
  }

  private createBuilding(
    x: number,
    y: number,
    height: number,
    color: number,
  ): Phaser.GameObjects.Container {
    const building = this.add.container(x, y);
    const body = this.add.graphics();

    body.fillStyle(0x182f3a, 1);
    body.fillPoints(
      [
        vector(-32, -height),
        vector(0, -height + 16),
        vector(0, 8),
        vector(-32, -8),
      ],
      true,
    );
    body.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(22).color, 1);
    body.fillPoints(
      [
        vector(0, -height + 16),
        vector(32, -height),
        vector(32, -8),
        vector(0, 8),
      ],
      true,
    );
    body.fillStyle(color, 1);
    body.fillPoints(
      [
        vector(-32, -height),
        vector(0, -height - 16),
        vector(32, -height),
        vector(0, -height + 16),
      ],
      true,
    );
    body.lineStyle(2, 0x0b1118, 0.9);
    body.strokePoints(
      [
        vector(-32, -height),
        vector(0, -height - 16),
        vector(32, -height),
        vector(32, -8),
        vector(0, 8),
        vector(-32, -8),
      ],
      true,
    );

    building.add(body);
    return building;
  }

  private bindCamera(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.dragOrigin = { x: pointer.x, y: pointer.y };
    });
    this.input.on("pointerup", () => {
      this.dragOrigin = undefined;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || !this.dragOrigin) {
        return;
      }
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - this.dragOrigin.x) / camera.zoom;
      camera.scrollY -= (pointer.y - this.dragOrigin.y) / camera.zoom;
      this.dragOrigin = { x: pointer.x, y: pointer.y };
    });
    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _objects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        const camera = this.cameras.main;
        camera.setZoom(Phaser.Math.Clamp(camera.zoom - deltaY * 0.001, 0.45, 2));
      },
    );
  }
}
