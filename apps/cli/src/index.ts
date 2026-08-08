#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoPath = resolve(process.argv[2] ?? process.cwd());
const url = "http://127.0.0.1:5173";
const childEnvironment = {
  ...process.env,
  SUDO_CITY_REPO: repoPath,
};

const server = spawn(
  "pnpm",
  ["--filter", "@sudo-city/server", "start"],
  {
    env: childEnvironment,
    stdio: "inherit",
  },
);

const web = spawn("pnpm", ["--filter", "@sudo-city/web", "dev"], {
  env: childEnvironment,
  stdio: "inherit",
});

function openBrowser(): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  if (process.platform === "linux") {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  process.stderr.write(
    `Open ${url} manually (unsupported platform: ${process.platform}).\n`,
  );
}

const browserTimer = setTimeout(openBrowser, 1_200);

function shutdown(): void {
  clearTimeout(browserTimer);
  server.kill("SIGTERM");
  web.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("exit", (code) => {
  if (code && code !== 0) {
    process.exitCode = code;
    shutdown();
  }
});

web.on("exit", (code) => {
  if (code && code !== 0) {
    process.exitCode = code;
    shutdown();
  }
});
