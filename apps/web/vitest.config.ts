import { defineConfig } from "vitest/config";

/**
 * Kept separate from vite.config.ts on purpose: vitest ships vite 7's types
 * while the app builds on vite 8, and passing the app's plugins through
 * vitest/config's defineConfig makes the two Plugin types collide.
 *
 * Nothing here needs them — the world model is deliberately free of Phaser,
 * React and CSS, so the tests are plain TypeScript running under node.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
