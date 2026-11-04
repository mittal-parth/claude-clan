import { contextBridge, ipcRenderer, webUtils } from "electron";

function argumentValue(prefix: string): string | undefined {
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

const portValue = argumentValue("--claude-city-port=");
const token = argumentValue("--claude-city-token=");

contextBridge.exposeInMainWorld("claudeCity", {
  isDesktop: true,
  port: portValue ? Number(portValue) : undefined,
  token,
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickFolder: (): Promise<string | undefined> =>
    ipcRenderer.invoke("claude-city:pick-folder"),
  rememberFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("claude-city:remember-folder", path),
  readSettings: (): Promise<unknown> =>
    ipcRenderer.invoke("claude-city:read-settings"),
  writeSettings: (patch: unknown): Promise<void> =>
    ipcRenderer.invoke("claude-city:write-settings", patch),
  setApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke("claude-city:set-api-key", key),
  clearApiKey: (): Promise<void> =>
    ipcRenderer.invoke("claude-city:clear-api-key"),
  restartServer: (): Promise<void> =>
    ipcRenderer.invoke("claude-city:restart-server"),
  onOpenFolder: (handler: (path: string) => void): void => {
    ipcRenderer.on("claude-city:open-folder", (_event, path: string) => handler(path));
  },
  terminal: {
    create: (options: { id: string; cwd?: string; cols?: number; rows?: number }): Promise<void> =>
      ipcRenderer.invoke("claude-city:terminal-create", options),
    write: (id: string, data: string): void => {
      ipcRenderer.send("claude-city:terminal-write", { id, data });
    },
    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send("claude-city:terminal-resize", { id, cols, rows });
    },
    destroy: (id: string): Promise<void> =>
      ipcRenderer.invoke("claude-city:terminal-destroy", { id }),
    onData: (callback: (payload: { id: string; data: string }) => void): (() => void) => {
      const handler = (_event: unknown, payload: { id: string; data: string }) => callback(payload);
      ipcRenderer.on("claude-city:terminal-data", handler);
      return () => {
        ipcRenderer.removeListener("claude-city:terminal-data", handler);
      };
    },
    onExit: (callback: (payload: { id: string; exitCode: number }) => void): (() => void) => {
      const handler = (_event: unknown, payload: { id: string; exitCode: number }) => callback(payload);
      ipcRenderer.on("claude-city:terminal-exit", handler);
      return () => {
        ipcRenderer.removeListener("claude-city:terminal-exit", handler);
      };
    },
  },
});
