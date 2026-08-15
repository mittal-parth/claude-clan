import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { WorkspaceManager } from "../workspaces.js";

const execFileAsync = promisify(execFile);
const PICK_TIMEOUT_MS = 90_000;

async function pickFolderViaOsDialog(): Promise<string | undefined> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      const { stdout } = await execFileAsync(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Select a repository folder:")'],
        { timeout: PICK_TIMEOUT_MS },
      );
      const chosen = stdout.trim();
      return chosen ? resolve(chosen) : undefined;
    }

    if (platform === "linux") {
      const { stdout } = await execFileAsync(
        "zenity",
        ["--file-selection", "--directory", "--title=Select a repository folder"],
        { timeout: PICK_TIMEOUT_MS },
      );
      const chosen = stdout.trim();
      return chosen ? resolve(chosen) : undefined;
    }

    if (platform === "win32") {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Select a repository folder'
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          $dialog.SelectedPath
        } else {
          exit 1
        }
      `;
      const { stdout } = await execFileAsync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: PICK_TIMEOUT_MS },
      );
      const chosen = stdout.trim();
      return chosen ? resolve(chosen) : undefined;
    }
  } catch {
    // Non-zero exit, cancelled, timeout, or missing GUI utility
    return undefined;
  }
  return undefined;
}

export function registerLocalRoutes(
  app: FastifyInstance,
  workspaces: WorkspaceManager,
): void {
  app.post("/api/local/pick", async () => {
    const pickedPath = await pickFolderViaOsDialog();
    if (!pickedPath) {
      return { unavailable: true };
    }
    const name = basename(pickedPath) || "repository";
    return { path: pickedPath, name };
  });

  app.post<{ Body: { path?: string } }>("/api/local/open", async (request, reply) => {
    const rawPath = request.body?.path?.trim();
    if (!rawPath) {
      return reply.code(400).send({ error: "path is required" });
    }

    const resolvedPath = resolve(rawPath);
    try {
      const info = await stat(resolvedPath);
      if (!info.isDirectory()) {
        return reply.code(400).send({ error: "Path is not a directory" });
      }
    } catch {
      return reply.code(400).send({ error: "Directory does not exist" });
    }

    try {
      const workspace = await workspaces.openLocal(resolvedPath);
      const name = basename(resolvedPath) || "repository";
      return { repoKey: workspace.key, name };
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : "Failed to open local directory",
      });
    }
  });
}
