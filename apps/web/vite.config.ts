import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Mirrors the same-origin proxy production sits behind (see
    // apps/web/vercel.json): the httpOnly session cookie is only ever set
    // for the app's own origin, so local dev must also reach the API
    // through this origin rather than the API's own 127.0.0.1:4100.
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/auth": "http://127.0.0.1:4100",
      "/health": "http://127.0.0.1:4100",
    },
  },
});
