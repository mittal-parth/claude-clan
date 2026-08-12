import {
  GameEventSchema,
  type Building,
  type CitySummary,
  type GameEvent,
  type Issue,
  type PermissionMode,
} from "@sudo-city/protocol";
import { colorToCss } from "@/game/math/palette";
import type { CanvasPointerPosition } from "@/components/GameCanvas";
import { effortLabel, findCrewByModel } from "@/crew/catalog";

export type ConnectionState = "connecting" | "online" | "offline";

export const websocketUrl =
  import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:4100/ws";
export const maxBudgetUsd = Number(import.meta.env.VITE_MAX_BUDGET_USD ?? 1);

/**
 * How long to wait for an edit burst to settle before asking the server to
 * rescan. The agent usually writes several files in a row.
 */
export const RESCAN_DEBOUNCE_MS = 1_200;

export const EVENTS_STORAGE_PREFIX = "sudo-city:events:";
/** The full quest log for a city; generous since each city keeps its own. */
export const EVENTS_PER_CITY_CAP = 200;

/** Two repos can both have a "pr-42" city, so the transcript key is namespaced by repo, not just city id. */
export function eventsStorageKey(repoKey: string, cityId: string): string {
  return `${EVENTS_STORAGE_PREFIX}${repoKey}:${cityId}`;
}

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;

export function promptForIssue(issue: Issue): string {
  return [
    `Fix city issue #${issue.number}: ${issue.title}`,
    issue.body ? `Issue details:\n${issue.body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Basename of a repo path → title case words (claude-clan → Claude Clan). */
export function titleFromRepoPath(repoPath: string): string {
  const base =
    repoPath
      .split(/[/\\]/)
      .filter(Boolean)
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .trim() ?? "";
  if (!base) {
    return "City";
  }
  return base.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Header brand: `{Repo Name} City`, without doubling a trailing City. */
export function cityNameFromRepo(repoPath: string | undefined): string {
  if (!repoPath) {
    return "City";
  }
  const titled = titleFromRepoPath(repoPath);
  if (/\bcity$/i.test(titled)) {
    return titled;
  }
  return `${titled} City`;
}

/**
 * A PR/issue city's `world.repoPath` is its worktree, not the repo root
 * (`worktreePath` in `@sudo-city/cities` nests it under
 * `.sudocity/worktrees/<cityId>`), so its basename is the city id, not the
 * repo name. Strip that suffix so the masthead can show the repo name
 * regardless of which city is active.
 */
export function repoRootPath(
  repoPath: string | undefined,
  cityId: string,
): string | undefined {
  if (!repoPath) return repoPath;
  const suffix = `.sudocity/worktrees/${cityId}`;
  const normalised = repoPath.replace(/\\/g, "/");
  return normalised.endsWith(suffix)
    ? normalised.slice(0, -suffix.length).replace(/\/+$/, "")
    : repoPath;
}

/**
 * How long a site stands after the work on it actually finishes.
 *
 * The site's lifetime is the work's lifetime: it opens when a tool starts on a
 * file and is held open until that tool completes, so a slow edit keeps its
 * crane for as long as it runs. This is only the tail on the end, so a write
 * that takes 40ms still leaves something up long enough to notice.
 */
export const CONSTRUCTION_GRACE_MS = 6_000;

export function fileBasename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export function fileDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : ".";
}

export interface LanguageSummary {
  language: string;
  count: number;
}

export function summarizeLanguages(buildings: Building[]): LanguageSummary[] {
  const counts = new Map<string, number>();
  for (const building of buildings) {
    counts.set(building.language, (counts.get(building.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.language.localeCompare(right.language),
    );
}

export function colorWithAlpha(color: number, alpha: number): string {
  return `${colorToCss(color)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function loadStoredEvents(repoKey: string, cityId: string): GameEvent[] {
  try {
    const raw = localStorage.getItem(eventsStorageKey(repoKey, cityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter(
      (item): item is GameEvent => GameEventSchema.safeParse(item).success,
    );
  } catch {
    return [];
  }
}

export function clearStoredEvents(cityId: string): void {
  localStorage.removeItem(EVENTS_STORAGE_PREFIX + cityId);
}

export function cityLabel(city: CitySummary): string {
  return city.kind === "main" ? "main" : city.title;
}

export function statusLabel(
  status: ConnectionState,
  reconnectAttempt: number,
): string {
  switch (status) {
    case "connecting":
      return "Linking";
    case "online":
      return "Live";
    case "offline":
      return reconnectAttempt > 0 ? "Waking the city…" : "Offline";
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

export function permissionModeLabel(mode: PermissionMode): string {
  return mode === "auto" ? "Don’t Disturb Mayor" : "Mayor approval";
}

export function sessionCrewLabel(model: string, effort: any): string {
  const crew = findCrewByModel(model);
  const name = crew?.name ?? model;
  return `${name} · ${effortLabel(effort)} effort`;
}

export function pointIsInside(
  element: HTMLElement | null,
  position: CanvasPointerPosition,
): boolean {
  if (!element) {
    return false;
  }

  const bounds = element.getBoundingClientRect();
  return (
    position.clientX >= bounds.left &&
    position.clientX <= bounds.right &&
    position.clientY >= bounds.top &&
    position.clientY <= bounds.bottom
  );
}
