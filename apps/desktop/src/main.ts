import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import {
  clearApiKey,
  readConfig,
  rememberFolder,
  setApiKey,
  writeConfig,
} from "./config";
import { resolveClaudeBinary } from "./claude-binary";
import { startServer, type RunningServer } from "./server";
import {
  createTerminal,
  destroyAllTerminals,
  destroyTerminal,
  resizeTerminal,
  writeTerminal,
  type TerminalCreateOptions,
} from "./terminal";

let server: RunningServer | undefined;
let window: BrowserWindow | undefined;
let pendingFolder: string | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const path = commandLine.find((argument) => argument.startsWith("/"));
    if (path) {
      pendingFolder = path;
      window?.webContents.send("claude-city:open-folder", path);
    }
    window?.show();
    window?.focus();
  });
}

async function createWindow(): Promise<void> {
  server = await startServer();
  const iconPath = join(__dirname, "../build/icon.png");
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch {
      // Ignore if icon setting fails in dev mode
    }
  }
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#101820",
    titleBarStyle: "hiddenInset",
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [
        `--claude-city-port=${server.port}`,
        `--claude-city-token=${server.token}`,
      ],
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  await window.loadURL(`http://127.0.0.1:${server.port}/`);
  if (pendingFolder) {
    window.webContents.send("claude-city:open-folder", pendingFolder);
    pendingFolder = undefined;
  }
}

void app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Claude City could not start",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  destroyAllTerminals();
  server?.stop();
  app.quit();
});
app.on("before-quit", () => {
  destroyAllTerminals();
  server?.stop();
});
app.on("open-file", (event, path) => {
  event.preventDefault();
  pendingFolder = path;
  window?.webContents.send("claude-city:open-folder", path);
});

ipcMain.handle("claude-city:terminal-create", (_event, options: unknown) => {
  if (!window || typeof options !== "object" || !options) return;
  const config = options as TerminalCreateOptions;
  createTerminal(config, window);
});

ipcMain.on("claude-city:terminal-write", (_event, payload: unknown) => {
  if (typeof payload === "object" && payload) {
    const { id, data } = payload as { id?: string; data?: string };
    if (id && typeof data === "string") {
      writeTerminal(id, data);
    }
  }
});

ipcMain.on("claude-city:terminal-resize", (_event, payload: unknown) => {
  if (typeof payload === "object" && payload) {
    const { id, cols, rows } = payload as { id?: string; cols?: number; rows?: number };
    if (id && typeof cols === "number" && typeof rows === "number") {
      resizeTerminal(id, cols, rows);
    }
  }
});

ipcMain.handle("claude-city:terminal-destroy", (_event, payload: unknown) => {
  if (typeof payload === "object" && payload) {
    const { id } = payload as { id?: string };
    if (id) {
      destroyTerminal(id);
    }
  }
});

ipcMain.handle("claude-city:pick-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    message: "Choose a project to render as a city",
  });
  const path = result.canceled ? undefined : result.filePaths[0];
  if (path) rememberFolder(path);
  return path;
});

ipcMain.handle("claude-city:remember-folder", (_event, path: unknown) => {
  if (typeof path === "string" && path.startsWith("/")) {
    rememberFolder(path);
  }
});

ipcMain.handle("claude-city:read-settings", async () => {
  const config = readConfig();
  const binary = await resolveClaudeBinary(config.claudePath);
  return {
    creditMode: config.creditMode,
    hasApiKey: Boolean(config.encryptedApiKey),
    perOrderCapUsd: config.perOrderCapUsd,
    monthlyCapUsd: config.monthlyCapUsd,
    settingSources: config.settingSources,
    recentFolders: config.recentFolders,
    claude: binary
      ? { path: binary.path, version: binary.version, source: binary.source }
      : undefined,
  };
});

ipcMain.handle("claude-city:write-settings", (_event, patch: unknown) => {
  if (!patch || typeof patch !== "object") return;
  const input = patch as Record<string, unknown>;
  const config = readConfig();
  if (input.creditMode === "subscription" || input.creditMode === "api-key") {
    config.creditMode = input.creditMode;
  }
  for (const field of ["perOrderCapUsd", "monthlyCapUsd"] as const) {
    const value = input[field];
    if (value === null) {
      delete config[field];
    } else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      config[field] = value;
    }
  }
  if (Array.isArray(input.settingSources)) {
    config.settingSources = input.settingSources.filter(
      (value): value is "user" | "project" | "local" =>
        value === "user" || value === "project" || value === "local",
    );
  }
  writeConfig(config);
});

ipcMain.handle("claude-city:set-api-key", (_event, key: unknown) => {
  if (typeof key !== "string" || key.trim().length < 10) {
    throw new Error("That does not look like an API key");
  }
  setApiKey(key.trim());
});
ipcMain.handle("claude-city:clear-api-key", () => clearApiKey());
ipcMain.handle("claude-city:restart-server", async () => {
  // Restarts the server process only. Relaunching the whole app here made the
  // window disappear and come back on every credit-source toggle, which looks
  // exactly like a crash; the port and token survive, so the renderer's own
  // WebSocket reconnect covers the gap.
  await server?.restart();
});
