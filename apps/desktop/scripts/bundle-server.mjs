// Bundles the server so packaged Electron builds do not depend on pnpm's
// workspace symlinks. The source uses top-level await, so esbuild emits ESM;
// the small CommonJS wrapper lets utilityProcess.fork load it reliably.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const serverDir = join(here, "..");

await build({
  entryPoints: [join(root, "apps/server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(serverDir, "server", "index.mjs"),
  external: [
    "node:sqlite",
    "@anthropic-ai/claude-agent-sdk",
    "pg",
    "dependency-cruiser",
    "enhanced-resolve/lib/createInnerCallback",
  ],
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __desktopCreateRequire } from "node:module"; const require = __desktopCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

await writeFile(
  join(serverDir, "server", "index.js"),
  "import('./index.mjs').catch((error) => { console.error(error); process.exitCode = 1; });\n",
);
