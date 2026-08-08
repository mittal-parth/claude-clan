/**
 * Which floating windows are expanded.
 *
 * The world fills the viewport and every panel floats over it, so the only
 * layout state worth keeping is whether each window shows its body. It is kept
 * here, free of React and the DOM, so the rules are testable on their own.
 */

export const HUD_PANEL_IDS = [
  "console",
  "scan",
  "order",
  "inspector",
] as const;

export type HudPanelId = (typeof HUD_PANEL_IDS)[number];

/** `true` means the window shows its body; `false` means it is compact. */
export type HudState = Record<HudPanelId, boolean>;

export const HUD_STORAGE_KEY = "sudo-city:hud";

export const DEFAULT_HUD_STATE: HudState = {
  console: true,
  scan: true,
  order: true,
  inspector: true,
};

function isHudPanelId(value: string): value is HudPanelId {
  return (HUD_PANEL_IDS as readonly string[]).includes(value);
}

export function toggleHudPanel(state: HudState, id: HudPanelId): HudState {
  return { ...state, [id]: !state[id] };
}

/**
 * Reads a stored state, keeping only known panels with boolean values. Anything
 * else falls back to the default for that panel, so a stale or hand-edited
 * entry can never leave a window in an unreachable state.
 */
export function parseHudState(raw: string | null | undefined): HudState {
  if (!raw) {
    return { ...DEFAULT_HUD_STATE };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_HUD_STATE };
  }

  if (typeof decoded !== "object" || decoded === null) {
    return { ...DEFAULT_HUD_STATE };
  }

  const state = { ...DEFAULT_HUD_STATE };
  for (const [key, value] of Object.entries(decoded)) {
    if (isHudPanelId(key) && typeof value === "boolean") {
      state[key] = value;
    }
  }
  return state;
}

export function serializeHudState(state: HudState): string {
  return JSON.stringify(state);
}

/**
 * Storage can be unavailable (private mode, a locked-down browser) and a lost
 * panel preference is not worth failing the app over — the defaults are always
 * a usable layout.
 */
export function readHudState(): HudState {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_HUD_STATE };
  }

  try {
    return parseHudState(localStorage.getItem(HUD_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_HUD_STATE };
  }
}

export function writeHudState(state: HudState): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(HUD_STORAGE_KEY, serializeHudState(state));
  } catch {
    // A rejected write only costs the preference, not the session.
  }
}
