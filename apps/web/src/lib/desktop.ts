export interface DesktopSettings {
  creditMode: "subscription" | "api-key";
  hasApiKey: boolean;
  perOrderCapUsd?: number;
  monthlyCapUsd?: number;
  settingSources: ("user" | "project" | "local")[];
  recentFolders: { path: string; lastOpenedAt: string }[];
  claude?: { path: string; version: string; source: "user" | "bundled" };
}

export interface DesktopBridge {
  isDesktop: true;
  port?: number;
  token?: string;
  pathForFile: (file: File) => string;
  pickFolder: () => Promise<string | undefined>;
  rememberFolder: (path: string) => Promise<void>;
  readSettings: () => Promise<DesktopSettings>;
  writeSettings: (patch: {
    creditMode?: DesktopSettings["creditMode"];
    perOrderCapUsd?: number | null;
    monthlyCapUsd?: number | null;
    settingSources?: DesktopSettings["settingSources"];
  }) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  restartServer: () => Promise<void>;
  onOpenFolder: (handler: (path: string) => void) => void;
  terminal?: {
    create: (options: { id: string; cwd?: string; cols?: number; rows?: number }) => Promise<void>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    destroy: (id: string) => Promise<void>;
    onData: (callback: (payload: { id: string; data: string }) => void) => () => void;
    onExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void;
  };
}

declare global {
  interface Window {
    claudeCity?: DesktopBridge;
  }
}

export function desktop(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.claudeCity;
}

export function isDesktop(): boolean {
  return desktop() !== undefined;
}

if (typeof document !== "undefined" && isDesktop()) {
  document.documentElement.classList.add("is-desktop");
}
