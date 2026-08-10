import { writeFileSync } from "node:fs";
import type { Scene } from "phaser";
import { it, vi } from "vitest";

vi.mock("phaser", () => {
  class Vector2 {
    constructor(public x: number, public y: number) {}
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  class Color {
    constructor(public color: number) {}
    private map(f: (c: number) => number): Color {
      const r = f((this.color >> 16) & 255);
      const g = f((this.color >> 8) & 255);
      const b = f(this.color & 255);
      return new Color((clamp(r) << 16) | (clamp(g) << 8) | clamp(b));
    }
    lighten(amount: number): Color {
      return this.map((c) => c + (255 - c) * (amount / 100));
    }
    darken(amount: number): Color {
      return this.map((c) => c * (1 - amount / 100));
    }
  }
  return {
    default: {
      Math: { Vector2 },
      Display: { Color: { IntegerToColor: (v: number) => new Color(v) } },
    },
  };
});

const parts: string[] = [];
let fill = { color: 0, alpha: 1 };
let line = { color: 0, alpha: 1, width: 1 };
let size = { width: 0, height: 0 };
const hex = (c: number) => `#${(c >>> 0).toString(16).padStart(6, "0").slice(-6)}`;

function scene(): Scene {
  const g: any = {
    fillStyle: (color: number, alpha = 1) => ((fill = { color, alpha }), g),
    lineStyle: (width: number, color: number, alpha = 1) => ((line = { color, alpha, width }), g),
    fillPoints: (pts: any[]) => {
      parts.push(`<polygon points="${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}" fill="${hex(fill.color)}" fill-opacity="${fill.alpha}"/>`);
      return g;
    },
    strokePoints: (pts: any[]) => {
      parts.push(`<polygon points="${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}" fill="none" stroke="${hex(line.color)}" stroke-opacity="${line.alpha}" stroke-width="${line.width}"/>`);
      return g;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(fill.color)}" fill-opacity="${fill.alpha}"/>`);
      return g;
    },
    lineBetween: (x1: number, y1: number, x2: number, y2: number) => {
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${hex(line.color)}" stroke-opacity="${line.alpha}" stroke-width="${line.width}"/>`);
      return g;
    },
    generateTexture: (_k: string, width: number, height: number) => ((size = { width, height }), g),
    clear: () => g,
    destroy: () => undefined,
  };
  return { make: { graphics: () => g }, textures: { exists: () => false, remove: () => undefined } } as unknown as Scene;
}

it("renders", async () => {
  const { bakeCapitol } = await import(
    "./capitolTextures"
  );
  bakeCapitol(scene());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}"><rect width="100%" height="100%" fill="#5bbf3e"/>${parts.join("")}</svg>`;
  writeFileSync(
    "/private/tmp/claude-501/-Users-arjun-Desktop-claude-clan-multi-city/39c2c6ca-bdb1-45af-b4af-b9818d5367e8/scratchpad/capitol.svg",
    svg,
  );
  console.log("canvas", size);
});
