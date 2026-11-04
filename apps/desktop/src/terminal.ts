import type { BrowserWindow } from "electron";
import * as pty from "node-pty";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

interface ActiveTerminal {
  id: string;
  process: pty.IPty;
}

const activeTerminals = new Map<string, ActiveTerminal>();

function ensureExecutable(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      if ((stat.mode & 0o111) !== 0o111) {
        chmodSync(filePath, 0o755);
      }
    }
  } catch {
    // Ignore
  }
}

function fixSpawnHelperPermissions(): void {
  try {
    const ptyPkgDir = dirname(require.resolve("node-pty/package.json"));
    const prebuildsDir = join(ptyPkgDir, "prebuilds");
    if (existsSync(prebuildsDir)) {
      const arches = readdirSync(prebuildsDir);
      for (const arch of arches) {
        ensureExecutable(join(prebuildsDir, arch, "spawn-helper"));
      }
    }
    const buildRelease = join(ptyPkgDir, "build", "Release");
    if (existsSync(buildRelease)) {
      ensureExecutable(join(buildRelease, "spawn-helper"));
    }
  } catch {
    // Ignore
  }
}

// Fix permissions on module load
fixSpawnHelperPermissions();

export function createTerminal(
  options: TerminalCreateOptions,
  window: BrowserWindow,
): void {
  const { id, cols = 80, rows = 24 } = options;

  if (activeTerminals.has(id)) {
    destroyTerminal(id);
  }

  fixSpawnHelperPermissions();

  const isWindows = process.platform === "win32";
  const shell =
    process.env.SHELL ||
    (isWindows ? "powershell.exe" : "/bin/zsh");
  const args = isWindows ? [] : ["-l"];

  let cwd = options.cwd;
  if (!cwd || !existsSync(cwd)) {
    cwd = homedir() || process.cwd();
  }

  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
  } as Record<string, string>;

  try {
    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: Math.max(10, cols),
      rows: Math.max(5, rows),
      cwd,
      env,
    });

    activeTerminals.set(id, { id, process: ptyProcess });

    ptyProcess.onData((data: string) => {
      if (!window.isDestroyed()) {
        window.webContents.send("claude-city:terminal-data", { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      activeTerminals.delete(id);
      if (!window.isDestroyed()) {
        window.webContents.send("claude-city:terminal-exit", { id, exitCode });
      }
    });
  } catch (error) {
    if (!window.isDestroyed()) {
      window.webContents.send("claude-city:terminal-data", {
        id,
        data: `\r\n\x1b[31mFailed to launch terminal process: ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`,
      });
      window.webContents.send("claude-city:terminal-exit", { id, exitCode: 1 });
    }
  }
}

export function writeTerminal(id: string, data: string): void {
  const term = activeTerminals.get(id);
  if (term) {
    term.process.write(data);
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const term = activeTerminals.get(id);
  if (term && cols > 0 && rows > 0) {
    try {
      term.process.resize(cols, rows);
    } catch {
      // Process might have terminated
    }
  }
}

export function destroyTerminal(id: string): void {
  const term = activeTerminals.get(id);
  if (term) {
    activeTerminals.delete(id);
    try {
      term.process.kill();
    } catch {
      // Process might already be dead
    }
  }
}

export function destroyAllTerminals(): void {
  for (const [id, term] of activeTerminals) {
    try {
      term.process.kill();
    } catch {
      // Process might already be dead
    }
  }
  activeTerminals.clear();
}
