import Phaser from "phaser";
import {
  Baker,
  fillFace,
  HALF_W,
  Point3,
  shade,
  strokeFace,
  TILE_WIDTH,
} from "./core";
import { HALF_TILE_WIDTH } from "../math/iso";
import { TERRAIN_COLORS } from "../math/palette";
import {
  BILLBOARD_FRAME_INSET,
  BILLBOARD_SPECS,
  billboardPanelTransform,
  type BillboardFacing,
  type BillboardSize,
} from "../layouts/billboards";

export const BILLBOARD = {
  post: 0x4a4038,
  postShadow: 0x2b241e,
  frame: 0x6d5f52,
  frameLight: 0x8d7c6b,
  frameEdge: 0x3a312a,
  /** Blank backing, only visible until a sponsor's artwork lands on top. */
  backing: 0x241f1b,
} as const;

export function billboardTextureKey(
  size: BillboardSize,
  facing: BillboardFacing,
): string {
  return `fx:billboard:${size}:${facing}`;
}

/**
 * A billboard turned square to the camera: a plain upright slab on two posts.
 *
 * None of the isometric face machinery applies — the whole point is that this
 * board is off the grid axes — so it is drawn in straight canvas pixels. Its
 * foot sits on the projected tile centre.
 */
export function bakeScreenBillboard(
  baker: Baker,
  size: BillboardSize,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const spec = BILLBOARD_SPECS[size];
  const graphics = baker.graphics;
  const left = (canvasWidth - spec.panelWidth) / 2;
  const top = (canvasWidth - spec.panelWidth) / 2; // BILLBOARD_MARGIN
  const panelBottom = top + spec.panelHeight;
  const ground = panelBottom + spec.legHeight;

  // Ground contact under both posts, so the board doesn't float on the grass.
  graphics.fillStyle(TERRAIN_COLORS.shadow, 0.24);
  graphics.fillEllipse(
    canvasWidth / 2,
    ground,
    spec.panelWidth * 0.5,
    Math.max(4, spec.legHeight * 0.16),
  );

  // Posts, inset so the slab overhangs them a little.
  //
  // Width comes off the panel's shorter side rather than its width: scaling
  // with width made the large board's posts look like telephone poles.
  const postWidth = Math.max(5, Math.round(spec.panelHeight * 0.08));
  const postSpacing = spec.panelWidth * 0.58;
  const postTop = panelBottom - Math.min(10, spec.panelHeight * 0.1);
  for (const side of [-1, 1]) {
    const centre = canvasWidth / 2 + (postSpacing / 2) * side;
    const postLeft = centre - postWidth / 2;
    graphics.fillStyle(BILLBOARD.post, 1);
    graphics.fillRect(
      postLeft,
      postTop,
      postWidth,
      ground - postTop,
    );
    graphics.fillStyle(BILLBOARD.postShadow, 1);
    graphics.fillRect(
      postLeft + postWidth * 0.6,
      postTop,
      postWidth * 0.4,
      ground - postTop,
    );
  }

  // Slab: frame, a bevelled top highlight, and the blank backing face.
  graphics.fillStyle(BILLBOARD.frame, 1);
  graphics.fillRect(left, top, spec.panelWidth, spec.panelHeight);
  graphics.fillStyle(BILLBOARD.frameLight, 1);
  graphics.fillRect(left, top, spec.panelWidth, 3);
  graphics.fillStyle(BILLBOARD.backing, 1);
  graphics.fillRect(
    left + BILLBOARD_FRAME_INSET,
    top + BILLBOARD_FRAME_INSET,
    spec.panelWidth - BILLBOARD_FRAME_INSET * 2,
    spec.panelHeight - BILLBOARD_FRAME_INSET * 2,
  );
  graphics.lineStyle(1, BILLBOARD.frameEdge, 0.85);
  graphics.strokeRect(
    left + BILLBOARD_FRAME_INSET,
    top + BILLBOARD_FRAME_INSET,
    spec.panelWidth - BILLBOARD_FRAME_INSET * 2,
    spec.panelHeight - BILLBOARD_FRAME_INSET * 2,
  );

  baker.finish(billboardTextureKey(size, "screen"), canvasWidth, canvasHeight);
}

/**
 * A billboard: two posts carrying a slab, sized from BILLBOARD_SPECS.
 *
 * Drawn in "board space" — `axis` runs left-to-right along the sign face on
 * screen, `depth` runs into it, `z` is height. Each facing maps that onto the
 * isometric grid differently (a screen-left board lies on a constant-v plane,
 * a screen-right board on a constant-u plane), which `point` below handles, so
 * the geometry itself is written once.
 *
 * The sign face is left blank; artwork arrives as a separate canvas texture
 * laid over it by createBillboardPanelTexture.
 */
export function bakeBillboard(
  baker: Baker,
  size: BillboardSize,
  facing: BillboardFacing,
): void {
  const spec = BILLBOARD_SPECS[size];
  const { canvasWidth, canvasHeight, anchorY } = billboardPanelTransform(
    size,
    facing,
  );
  if (facing === "screen") {
    bakeScreenBillboard(baker, size, canvasWidth, canvasHeight);
    return;
  }
  const originX = canvasWidth / 2;
  const originY = canvasHeight - anchorY;

  const span = spec.panelWidth / TILE_WIDTH;
  const depth = spec.thickness;
  const panelBottom = spec.legHeight;
  const panelTop = panelBottom + spec.panelHeight;
  const inset = BILLBOARD_FRAME_INSET / HALF_TILE_WIDTH;

  /** Board space to grid space. Both facings keep +axis pointing screen-right. */
  const point = (axis: number, into: number, z: number): Point3 =>
    facing === "left" ? [axis, into, z] : [into, -axis, z];

  /**
   * The visible end cap is the one at the far screen-right of the slab. That
   * is +span for a left-facing board; the mapping flips v for the other
   * facing, which puts its visible edge at -span instead.
   */
  const capAxis = facing === "left" ? span : -span;

  const face = (color: number, alpha: number, points: readonly Point3[]): void =>
    fillFace(baker, color, alpha, points, originX, originY);

  // Posts, set in from the ends so the slab overhangs them a little.
  const postAxis = span * 0.58;
  const postHalf = Math.max(0.035, 5 / HALF_TILE_WIDTH);
  const postTop = panelBottom + 10;
  for (const side of [-1, 1]) {
    const centre = postAxis * side;
    // Ground contact, so the post doesn't appear to float on the grass.
    face(TERRAIN_COLORS.shadow, 0.24, [
      point(centre - postHalf * 1.8, -depth * 2.4, 0),
      point(centre + postHalf * 1.8, -depth * 2.4, 0),
      point(centre + postHalf * 1.8, depth * 2.4, 0),
      point(centre - postHalf * 1.8, depth * 2.4, 0),
    ]);
    // Front face, then the sliver of side that gives the post its thickness.
    face(BILLBOARD.post, 1, [
      point(centre - postHalf, depth, postTop),
      point(centre + postHalf, depth, postTop),
      point(centre + postHalf, depth, 0),
      point(centre - postHalf, depth, 0),
    ]);
    face(BILLBOARD.postShadow, 1, [
      point(centre + postHalf, depth, postTop),
      point(centre + postHalf, -depth, postTop),
      point(centre + postHalf, -depth, 0),
      point(centre + postHalf, depth, 0),
    ]);
  }

  // Slab: frame face, blank backing inside it, then the top and end cap that
  // give the sign its depth.
  face(BILLBOARD.frame, 1, [
    point(-span, depth, panelTop),
    point(span, depth, panelTop),
    point(span, depth, panelBottom),
    point(-span, depth, panelBottom),
  ]);

  const backing: Point3[] = [
    point(-span + inset, depth, panelTop - BILLBOARD_FRAME_INSET),
    point(span - inset, depth, panelTop - BILLBOARD_FRAME_INSET),
    point(span - inset, depth, panelBottom + BILLBOARD_FRAME_INSET),
    point(-span + inset, depth, panelBottom + BILLBOARD_FRAME_INSET),
  ];
  face(BILLBOARD.backing, 1, backing);
  strokeFace(baker, BILLBOARD.frameEdge, 0.85, 1, backing, originX, originY);

  // Lit top edge.
  face(BILLBOARD.frameLight, 1, [
    point(-span, -depth, panelTop),
    point(span, -depth, panelTop),
    point(span, depth, panelTop),
    point(-span, depth, panelTop),
  ]);
  face(BILLBOARD.frameEdge, 1, [
    point(capAxis, depth, panelTop),
    point(capAxis, -depth, panelTop),
    point(capAxis, -depth, panelBottom),
    point(capAxis, depth, panelBottom),
  ]);

  baker.finish(billboardTextureKey(size, facing), canvasWidth, canvasHeight);
}

/**
 * Halves an oversized image repeatedly until it is within 2x of the size it
 * will be drawn at.
 *
 * A single drawImage from 1080px down to under 200px aliases badly even with
 * imageSmoothingQuality "high" — the browser samples a sparse subset of source
 * pixels. Successive halving averages all of them, which is what makes fine
 * detail in an ad creative survive the trip onto a small sign.
 */
export function downscaleForPanel(
  source: CanvasImageSource & { width: number; height: number },
  targetWidth: number,
  targetHeight: number,
): CanvasImageSource & { width: number; height: number } {
  let current = source;
  while (current.width > targetWidth * 2 && current.height > targetHeight * 2) {
    const halved = document.createElement("canvas");
    halved.width = Math.max(1, Math.floor(current.width / 2));
    halved.height = Math.max(1, Math.floor(current.height / 2));
    const context = halved.getContext("2d");
    if (!context) {
      return current;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, halved.width, halved.height);
    current = halved;
  }
  return current;
}

/**
 * Builds the artwork layer for one billboard as a canvas texture matching the
 * frame's dimensions, so the two sprites overlay with a shared position.
 *
 * `draw` receives a context already sheared onto the sign face and clipped to
 * the artwork area, with (0, 0) at its top-left — it can work in plain
 * upright pixel coordinates and ignore the projection entirely.
 */
export function createBillboardPanelTexture(
  scene: Phaser.Scene,
  key: string,
  size: BillboardSize,
  facing: BillboardFacing,
  draw: (
    context: CanvasRenderingContext2D,
    area: { width: number; height: number },
  ) => void,
): void {
  const transform = billboardPanelTransform(size, facing);
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }

  const texture = scene.textures.createCanvas(
    key,
    transform.canvasWidth,
    transform.canvasHeight,
  );
  if (!texture) {
    throw new Error(`Unable to allocate billboard panel texture "${key}"`);
  }

  const context = texture.context;
  context.save();
  // The game runs pixelArt: true, which puts every texture on NEAREST. That is
  // right for the hand-baked city, but it would turn a photographic ad creative
  // into a mess of hard pixels, so panels opt out and scale smoothly.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.setTransform(
    1,
    transform.shear,
    0,
    1,
    transform.offsetX,
    transform.offsetY,
  );
  context.beginPath();
  context.rect(0, 0, transform.contentWidth, transform.contentHeight);
  context.clip();
  draw(context, {
    width: transform.contentWidth,
    height: transform.contentHeight,
  });
  context.restore();
  texture.refresh();
  // Same reason, on the GPU side: without this the panel is resampled with
  // NEAREST every time the camera zooms.
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}
