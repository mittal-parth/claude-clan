import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type CreditMode = "subscription" | "api-key";
export type SettingSource = "user" | "project" | "local";

export interface DesktopConfig {
  creditMode: CreditMode;
  /** Encrypted with safeStorage, base64 encoded; never the raw key. */
  encryptedApiKey?: string;
  perOrderCapUsd?: number;
  monthlyCapUsd?: number;
  claudePath?: string;
  settingSources: SettingSource[];
  recentFolders: { path: string; lastOpenedAt: string }[];
}

const DEFAULTS: DesktopConfig = {
  creditMode: "subscription",
  perOrderCapUsd: 5,
  monthlyCapUsd: 50,
  settingSources: [],
  recentFolders: [],
};
const MAX_RECENT_FOLDERS = 10;

function configPath(): string {
  return join(app.getPath("userData"), "config.json");
}

export function readConfig(): DesktopConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return {
      ...DEFAULTS,
      ...parsed,
      settingSources: Array.isArray(parsed.settingSources)
        ? parsed.settingSources.filter((source): source is SettingSource =>
            source === "user" || source === "project" || source === "local",
          )
        : [...DEFAULTS.settingSources],
      recentFolders: Array.isArray(parsed.recentFolders)
        ? parsed.recentFolders.filter(
            (entry): entry is { path: string; lastOpenedAt: string } =>
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as { path?: unknown }).path === "string" &&
              typeof (entry as { lastOpenedAt?: unknown }).lastOpenedAt === "string",
          )
        : [],
    };
  } catch {
    return {
      ...DEFAULTS,
      settingSources: [...DEFAULTS.settingSources],
      recentFolders: [],
    };
  }
}

export function writeConfig(config: DesktopConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function setApiKey(key: string): void {
  const config = readConfig();
  if (safeStorage.isEncryptionAvailable()) {
    config.encryptedApiKey = safeStorage.encryptString(key).toString("base64");
  } else {
    config.encryptedApiKey = Buffer.from(key).toString("base64");
  }
  config.creditMode = "api-key";
  writeConfig(config);
}

export function clearApiKey(): void {
  const config = readConfig();
  delete config.encryptedApiKey;
  config.creditMode = "subscription";
  writeConfig(config);
}

export function readApiKey(): string | undefined {
  const encrypted = readConfig().encryptedApiKey;
  if (!encrypted) {
    return undefined;
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    }
    return Buffer.from(encrypted, "base64").toString("utf8");
  } catch {
    try {
      return Buffer.from(encrypted, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }
}

export function rememberFolder(path: string): void {
  const config = readConfig();
  config.recentFolders = [
    { path, lastOpenedAt: new Date().toISOString() },
    ...config.recentFolders.filter((entry) => entry.path !== path),
  ].slice(0, MAX_RECENT_FOLDERS);
  writeConfig(config);
}
