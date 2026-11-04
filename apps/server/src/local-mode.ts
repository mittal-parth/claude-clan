import type { CreditMode } from "@sudo-city/protocol";

/**
 * The single gate between hosted and desktop behavior. Only explicit truthy
 * values enable local mode; malformed or missing values remain hosted.
 */
export function isLocalMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SUDO_CITY_LOCAL?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function shouldLoadRepositoryEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isLocalMode(env) && !env.ANTHROPIC_API_KEY;
}

/**
 * Build only the credential environment a local Agent SDK child should see.
 * Subscription mode deliberately returns undefined even if the parent shell
 * exported a key; otherwise Claude Code silently chooses API billing.
 */
export function localAgentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (!isLocalMode(env) || creditMode(env) !== "api-key") {
    return undefined;
  }
  const key = env.ANTHROPIC_API_KEY;
  return key ? { ANTHROPIC_API_KEY: key } : undefined;
}

/** Hosted deployments always use the existing API-key path. */
export function creditMode(env: NodeJS.ProcessEnv = process.env): CreditMode {
  if (!isLocalMode(env)) {
    return "api-key";
  }
  return env.SUDO_CITY_CREDIT_MODE?.trim().toLowerCase() === "api-key"
    ? "api-key"
    : "subscription";
}

/** A blank or invalid local cap means the user deliberately chose no ceiling. */
export function localCapUsd(env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!isLocalMode(env) || creditMode(env) !== "api-key") {
    return undefined;
  }
  const raw = env.SUDO_CITY_LOCAL_CAP_USD?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Local mode must fail closed rather than serving an unauthenticated write API. */
export function requireDesktopToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.SUDO_CITY_DESKTOP_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new Error(
      "SUDO_CITY_DESKTOP_TOKEN must be set to at least 32 characters in local mode",
    );
  }
  return token;
}

/** Optional setting sources are explicit because user hooks alter agent behavior. */
export function localSettingSources(
  env: NodeJS.ProcessEnv = process.env,
): readonly ("user" | "project" | "local")[] | undefined {
  if (!isLocalMode(env)) {
    return undefined;
  }
  const raw = env.SUDO_CITY_SETTING_SOURCES?.trim();
  if (!raw) {
    return undefined;
  }
  const allowed = new Set(["user", "project", "local"]);
  const sources = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value): value is "user" | "project" | "local" => allowed.has(value),
    );
  return sources.length > 0 ? sources : undefined;
}

export const LOCAL_KEY_PREFIX = "local:";

export function localWorkspaceKey(absolutePath: string): string {
  return `${LOCAL_KEY_PREFIX}${absolutePath}`;
}

export function isLocalWorkspaceKey(key: string): boolean {
  return key.startsWith(LOCAL_KEY_PREFIX);
}

/** Per-order BYOK ceiling; unlike the monthly cap this is sent to each SDK turn. */
export function localOrderCapUsd(env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!isLocalMode(env) || creditMode(env) !== "api-key") {
    return undefined;
  }
  const raw = env.SUDO_CITY_LOCAL_ORDER_CAP_USD?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
