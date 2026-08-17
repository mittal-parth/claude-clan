import Phaser from "phaser";
import type { WorldSnapshot } from "@sudo-city/protocol";
import { playUiClickSound } from "@/lib/play-ui-click";
import { projection } from "../../core/worldConstants";
import {
  adBillboardSlots,
  assignSponsors,
  billboardPanelTransform,
  repoBillboardSlot,
  type BillboardRepo,
  type BillboardSlot,
  type BillboardTarget,
  type Sponsor,
} from "../../../layouts/billboards";
import {
  billboardTextureKey,
  createBillboardPanelTexture,
  downscaleForPanel,
} from "../../../textures/billboards";

type DrawableSource = HTMLImageElement | HTMLCanvasElement;

function drawableSource(
  texture: Phaser.Textures.Texture,
): DrawableSource | undefined {
  const source = texture.getSourceImage();
  return source instanceof HTMLImageElement ||
    source instanceof HTMLCanvasElement
    ? source
    : undefined;
}

/**
 * Shrinks the context's current font until `value` fits `maxWidth`.
 *
 * Repository names run from "web" to "some-organisation/really-long-service",
 * and a board that clips its own text is worse than one that sets it small.
 */
function fitText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): void {
  const match = /^(.*?)(\d+(?:\.\d+)?)px(.*)$/.exec(context.font);
  if (!match || maxWidth <= 0) {
    return;
  }
  const [, prefix, sizeText, suffix] = match;
  let size = Number(sizeText);
  while (size > 6 && context.measureText(value).width > maxWidth) {
    size -= 1;
    context.font = `${prefix}${size}px${suffix}`;
  }
}

export class WorldBillboardManager {
  /**
   * Roadside signage. Frames are baked sprites; panels are per-board canvas
   * textures composited once their artwork (or webfont) has resolved, so the
   * two are tracked separately and keyed by the same board id.
   */
  private billboardFrames = new Map<string, Phaser.GameObjects.Sprite>();
  private billboardPanels = new Map<string, Phaser.GameObjects.Sprite>();
  private billboardClickListener?: (target: BillboardTarget) => void;
  private repoIdentity?: BillboardRepo;

  constructor(
    private scene: Phaser.Scene,
    private isTravelTransitionActive: () => boolean,
  ) {}

  setBillboardClickListener(listener: (target: BillboardTarget) => void): void {
    this.billboardClickListener = listener;
  }

  /** Names the repo on the airport billboard. Undefined in demo mode. */
  setRepoIdentity(
    repo?: BillboardRepo,
    snapshot?: WorldSnapshot,
    currentCityId?: string,
    currentWorldKey?: string,
  ): void {
    if (
      this.repoIdentity?.owner === repo?.owner &&
      this.repoIdentity?.name === repo?.name &&
      this.repoIdentity?.url === repo?.url
    ) {
      return;
    }
    this.repoIdentity = repo;
    // When the repo identity updates after initial render, update the billboard.
    // If the board is already painted, remove its panel so ensureRepoPanel redraws it.
    this.billboardPanels.get("repo")?.destroy();
    this.billboardPanels.delete("repo");
    if (!this.scene.scene?.isActive()) {
      return;
    }
    this.layoutBillboards(snapshot, currentCityId, currentWorldKey);
  }

  /**
   * Sits signage in the world.
   *
   * Only "main" gets billboards: a PR city is a proposal, not a place, and its
   * ships and scaffolding already carry the story.
   */
  layoutBillboards(
    snapshot?: WorldSnapshot,
    currentCityId?: string,
    currentWorldKey?: string,
  ): void {
    if (currentCityId !== "main" || !snapshot) {
      this.clearBillboards();
      return;
    }

    const { width, height } = snapshot.size;
    const live = new Set<string>();

    const repoSlot = repoBillboardSlot(height);
    const repoUrl = this.repoIdentity?.url;
    live.add("repo");
    this.placeBillboard(
      "repo",
      repoSlot,
      repoUrl ? { kind: "repo", url: repoUrl } : undefined,
    );
    this.ensureRepoPanel(repoSlot, currentWorldKey);

    const placements = assignSponsors(
      adBillboardSlots(width, height),
      currentWorldKey ?? "",
    );
    for (const { slot, sponsor } of placements) {
      const id = `ad:${sponsor.id}`;
      live.add(id);
      this.placeBillboard(
        id,
        slot,
        sponsor.url
          ? { kind: "ad", sponsorId: sponsor.id, url: sponsor.url }
          : undefined,
      );
      this.ensureAdPanel(id, slot, sponsor);
    }

    // Switching repositories reshuffles which sponsors are on show, which can
    // orphan a board from the previous arrangement.
    for (const id of [...this.billboardFrames.keys()]) {
      if (!live.has(id)) {
        this.destroyBillboard(id);
      }
    }
  }

  /** Creates or repositions one board's frame, and its click target. */
  private placeBillboard(
    id: string,
    slot: BillboardSlot,
    target: BillboardTarget | undefined,
  ): void {
    const { anchorY } = billboardPanelTransform(slot.size, slot.facing);
    const point = projection.project(slot.x + 0.5, slot.y + 0.5);
    const depth = projection.depth(slot.x, slot.y) + 1;
    const textureKey = billboardTextureKey(slot.size, slot.facing);

    let frame = this.billboardFrames.get(id);
    if (!frame) {
      frame = this.scene.add.sprite(point.x, point.y + anchorY, textureKey);
      this.billboardFrames.set(id, frame);
    }
    frame
      .setTexture(textureKey)
      .setOrigin(0.5, 1)
      .setPosition(point.x, point.y + anchorY)
      .setDepth(depth)
      .setVisible(true);

    // A board with nowhere to go must not offer a hand cursor.
    frame.removeAllListeners("pointerdown");
    if (target) {
      frame.setInteractive({ pixelPerfect: true, useHandCursor: true });
      frame.on("pointerdown", () => {
        if (this.isTravelTransitionActive()) return;
        playUiClickSound();
        this.billboardClickListener?.(target);
      });
    } else {
      frame.disableInteractive();
    }

    this.billboardPanels
      .get(id)
      ?.setPosition(point.x, point.y + anchorY)
      .setDepth(depth + 1);
  }

  /**
   * Paints the repository's name onto its board.
   *
   * The webfont must be resolved first: canvas text drawn before it lands
   * silently renders in a fallback face and the board is baked wrong for the
   * rest of the session.
   */
  private ensureRepoPanel(slot: BillboardSlot, currentWorldKey?: string): void {
    const repo = this.repoIdentity;
    let owner = repo?.owner ?? "";
    let name = repo?.name ?? currentWorldKey ?? "";

    if (owner === "" && name === "demo") {
      owner = "DEMO";
      name = "claude city";
    }

    if (!name) {
      return;
    }

    const key = `billboard:panel:repo:${owner}/${name}:${slot.size}:${slot.facing}`;
    if (this.scene.textures.exists(key)) {
      this.attachBillboardPanel("repo", key);
      return;
    }

    const font = '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
    const avatarKey = `repo-avatar:${owner}`;
    // GitHub serves an owner's avatar at /<login>.png, and the CDN it redirects
    // to allows cross-origin reads, so the canvas stays untainted.
    const fetchAvatar = owner && owner.toLowerCase() !== "demo";
    const avatar = fetchAvatar
      ? this.loadImageTexture(
          avatarKey,
          `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=200`,
          "anonymous",
        )
      : Promise.resolve(false);

    void Promise.all([
      document.fonts.load(`700 32px ${font}`).catch(() => undefined),
      avatar,
    ]).then(([, hasAvatar]) => {
      // The scene may have been torn down, or moved to a PR city, while the
      // font and avatar were resolving.
      if (!this.scene.scene?.isActive() || !this.billboardFrames.has("repo")) {
        return;
      }
      if (owner && !hasAvatar) {
        console.error(`Owner avatar failed to load for "${owner}"`);
      }

      createBillboardPanelTexture(
        this.scene,
        key,
        slot.size,
        slot.facing,
        (context, area) => {
          context.fillStyle = "#141b26";
          context.fillRect(0, 0, area.width, area.height);

          // Two compositions, because the demo city has no owner and no
          // avatar: with a portrait the text sets beside it, without one it
          // centres and takes the whole board rather than hugging one edge and
          // leaving the sign looking half-printed.
          const pad = Math.round(area.height * 0.12);
          const portrait = hasAvatar ? area.height * 0.35 : 0;
          const ownerLeft = hasAvatar ? pad * 1.5 + portrait : pad;
          const ownerWidth = area.width - ownerLeft - pad;

          if (hasAvatar) {
            const source = drawableSource(this.scene.textures.get(avatarKey));
            const image = source
              ? downscaleForPanel(source, portrait, portrait)
              : undefined;
            
            const centerX = pad + portrait / 2;
            const centerY = pad + portrait / 2;

            context.save();
            context.beginPath();
            context.arc(centerX, centerY, portrait / 2, 0, Math.PI * 2);
            context.clip();
            if (image) {
              context.drawImage(image, pad, pad, portrait, portrait);
            }
            context.restore();

            context.beginPath();
            context.arc(centerX, centerY, portrait / 2, 0, Math.PI * 2);
            context.strokeStyle = "#2b3a4f";
            context.lineWidth = Math.max(1, Math.round(area.height * 0.02));
            context.stroke();
          }

          context.textBaseline = "alphabetic";

          if (owner) {
            context.textAlign = hasAvatar ? "left" : "center";
            const ownerAnchor = hasAvatar ? ownerLeft : area.width / 2;
            context.fillStyle = "#8fa3bf";
            context.font = `400 ${Math.round(area.height * 0.15)}px ${font}`;
            fitText(context, owner, hasAvatar ? ownerWidth : area.width - pad * 2);
            const ownerY = hasAvatar ? pad + portrait * 0.7 : area.height * 0.42;
            context.fillText(owner, ownerAnchor, ownerY);
          }

          context.textAlign = "center";
          context.fillStyle = "#ffd166";
          const nameScale = owner ? 0.28 : 0.36;
          context.font = `700 ${Math.round(area.height * nameScale)}px ${font}`;
          fitText(context, name, area.width - pad * 2);
          const nameY = owner ? area.height * 0.82 : area.height * 0.62;
          context.fillText(name, area.width / 2, nameY);
        },
      );
      this.attachBillboardPanel("repo", key);
    });
  }

  /**
   * Loads an image into the texture manager once, resolving true on success.
   *
   * `crossOrigin` matters for the owner avatar: without it the browser taints
   * the panel canvas and uploading it to WebGL throws. With it, a host that
   * refuses CORS simply fails the load, which we can handle.
   */
  private loadImageTexture(
    key: string,
    url: string,
    crossOrigin?: string,
  ): Promise<boolean> {
    if (this.scene.textures.exists(key)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        this.scene.load.off(`filecomplete-image-${key}`, succeeded);
        this.scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, failed);
        this.scene.load.off(Phaser.Loader.Events.COMPLETE, drained);
        resolve(loaded);
      };
      const succeeded = (): void => finish(true);
      const failed = (file: Phaser.Loader.File): void => {
        if (file.key === key) finish(false);
      };
      // Backstop: the loader draining without our texture means the request
      // died in a way that produced no per-file error. Without this the
      // caller's promise would never settle and the sprite would never paint.
      const drained = (): void => finish(this.scene.textures.exists(key));

      this.scene.load.on(`filecomplete-image-${key}`, succeeded);
      // Phaser has no per-file error event; failures arrive on "loaderror"
      // for every file, so the key has to be matched by hand.
      this.scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, failed);
      this.scene.load.on(Phaser.Loader.Events.COMPLETE, drained);

      const previousCrossOrigin = this.scene.load.crossOrigin;
      this.scene.load.crossOrigin = crossOrigin ?? "";
      this.scene.load.image(key, url);
      this.scene.load.crossOrigin = previousCrossOrigin;
      this.scene.load.start();
    });
  }

  /** Loads a sponsor's creative, then composites it onto its board. */
  private ensureAdPanel(
    id: string,
    slot: BillboardSlot,
    sponsor: Sponsor,
  ): void {
    const key = `billboard:panel:${sponsor.id}:${slot.size}:${slot.facing}`;
    if (this.scene.textures.exists(key)) {
      this.attachBillboardPanel(id, key);
      return;
    }

    const artworkKey = `ad:${sponsor.id}`;
    const paint = (): void => {
      if (!this.scene.scene?.isActive() || !this.billboardFrames.has(id)) {
        return;
      }
      const artwork = drawableSource(this.scene.textures.get(artworkKey));
      if (!artwork) {
        console.error(`Billboard artwork is not drawable for "${sponsor.id}"`);
        return;
      }
      createBillboardPanelTexture(
        this.scene,
        key,
        slot.size,
        slot.facing,
        (context, area) => {
          // The creatives are posters, not logos, and their aspect rarely
          // matches the board's. Fit rather than crop, and let the sponsor's
          // own background colour fill the letterbox so the board still reads
          // as one printed sheet.
          context.fillStyle = sponsor.background;
          context.fillRect(0, 0, area.width, area.height);
          const scale = Math.min(
            area.width / artwork.width,
            area.height / artwork.height,
          );
          const drawWidth = artwork.width * scale;
          const drawHeight = artwork.height * scale;
          const resampled = downscaleForPanel(artwork, drawWidth, drawHeight);
          context.drawImage(
            resampled,
            (area.width - drawWidth) / 2,
            (area.height - drawHeight) / 2,
            drawWidth,
            drawHeight,
          );
        },
      );
      this.attachBillboardPanel(id, key);
    };

    void this.loadImageTexture(artworkKey, sponsor.artwork).then((loaded) => {
      if (!loaded) {
        // Leave the board blank rather than substituting something else, and
        // say so — a missing asset is a build problem, not a runtime state.
        console.error(
          `Billboard artwork failed to load for "${sponsor.id}": ${sponsor.artwork}`,
        );
        return;
      }
      paint();
    });
  }

  /** Hangs a finished panel texture on its board, fading it in over the frame. */
  private attachBillboardPanel(id: string, key: string): void {
    const frame = this.billboardFrames.get(id);
    if (!frame) {
      return;
    }

    let panel = this.billboardPanels.get(id);
    if (!panel) {
      panel = this.scene.add
        .sprite(frame.x, frame.y, key)
        .setOrigin(0.5, 1)
        .setAlpha(0);
      this.billboardPanels.set(id, panel);
      this.scene.tweens.add({ targets: panel, alpha: 1, duration: 240 });
    }
    panel
      .setTexture(key)
      .setPosition(frame.x, frame.y)
      .setDepth(frame.depth + 1)
      .setVisible(true);
  }

  private destroyBillboard(id: string): void {
    this.billboardFrames.get(id)?.destroy();
    this.billboardFrames.delete(id);
    const panel = this.billboardPanels.get(id);
    if (panel) {
      this.scene.tweens.killTweensOf(panel);
      panel.destroy();
    }
    this.billboardPanels.delete(id);
  }

  clearBillboards(): void {
    for (const id of [...this.billboardFrames.keys()]) {
      this.destroyBillboard(id);
    }
  }
}
