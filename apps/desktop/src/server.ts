import { app, utilityProcess, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { readApiKey, readConfig } from "./config";
import { resolveClaudeBinary } from "./claude-binary";

export interface RunningServer {
  port: number;
  token: string;
  /**
   * Replaces the server process, keeping the same port and token.
   *
   * The server reads its credential and caps from the environment once at boot,
   * so applying a settings change needs a new process. It does *not* need a new
   * app: relaunching Electron made the whole window vanish and reappear every
   * time the mayor toggled credit source, which reads as a crash. Reusing the
   * port and token means the renderer's WebSocket simply drops and its existing
   * reconnect loop picks the new process up -- the HUD shows "Waking the city…"
   * for a moment and nothing else changes.
   */
  restart: () => Promise<void>;
  stop: () => void;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Could not determine a free port")));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

function serverEnvironment(port: number, token: string): Record<string, string> {
  const config = readConfig();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME ?? app.getPath("home"),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    SUDO_CITY_LOCAL: "1",
    SUDO_CITY_PUBLIC_DEPLOYMENT: "0",
    SUDO_CITY_DESKTOP_TOKEN: token,
    SUDO_CITY_CREDIT_MODE: config.creditMode,
    SUDO_CITY_STORE_ROOT: app.getPath("userData"),
    SUDO_CITY_LOCAL_GITHUB_ROOT: join(app.getPath("userData"), "github"),
    SUDO_CITY_WEB_ROOT: join(__dirname, "..", "web"),
  };

  if (config.settingSources.length > 0) {
    env.SUDO_CITY_SETTING_SOURCES = config.settingSources.join(",");
  }
  if (config.creditMode === "api-key") {
    const key = readApiKey();
    if (key) {
      // The server copies this only into per-session Agent SDK options; it is
      // not available to hosted processes and is absent in subscription mode.
      env.ANTHROPIC_API_KEY = key;
    }
    if (config.monthlyCapUsd !== undefined) {
      env.SUDO_CITY_LOCAL_CAP_USD = String(config.monthlyCapUsd);
    }
    if (config.perOrderCapUsd !== undefined) {
      env.SUDO_CITY_LOCAL_ORDER_CAP_USD = String(config.perOrderCapUsd);
    }
  }
  return env;
}

/**
 * Spawns one server process on a fixed port/token. Called again by restart(),
 * so everything that must be re-read from settings on a restart -- the
 * credential, the caps, the claude binary -- has to be resolved in here rather
 * than by the caller.
 */
async function spawnServer(
  port: number,
  token: string,
): Promise<UtilityProcess> {
  const env = serverEnvironment(port, token);
  const binary = await resolveClaudeBinary(readConfig().claudePath);
  if (binary) {
    env.SUDO_CITY_CLAUDE_PATH = binary.path;
  }

  const serverEntry = join(__dirname, "..", "server", "index.js");
  const child: UtilityProcess = utilityProcess.fork(serverEntry, [], {
    env,
    stdio: "pipe",
    serviceName: "claude-city-server",
  });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  await waitForHealth(port, token);
  return child;
}

export async function startServer(): Promise<RunningServer> {
  const port = await freePort();
  const token = randomBytes(32).toString("hex");
  let child = await spawnServer(port, token);
  let stopped = false;
  /** Serialises restarts so a double-click on the credit toggle cannot leave two servers racing for the port. */
  let pending: Promise<void> = Promise.resolve();

  async function replaceChild(): Promise<void> {
    if (stopped) return;
    const previous = child;
    // Wait for the old process to release the port before rebinding it --
    // spawning first would race and the new server would fail with EADDRINUSE.
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      previous.once("exit", done);
      previous.kill();
      // A process that will not die must not wedge the app; the health check
      // below is the real gate on the new one being usable.
      setTimeout(done, 5_000);
    });
    if (stopped) return;
    child = await spawnServer(port, token);
  }

  return {
    port,
    token,
    restart: () => {
      pending = pending.then(replaceChild, replaceChild);
      return pending;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}

async function waitForHealth(port: number, token: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const healthy = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-desktop-token": token },
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local server did not become healthy within 60 seconds");
}
