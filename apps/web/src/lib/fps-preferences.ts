export const FPS_STORAGE_KEY = "sudo-city:target-fps";

export type TargetFps = 30 | 60;
export const DEFAULT_TARGET_FPS: TargetFps = 30;

/**
 * Reads the user's preferred framerate cap from storage.
 * Storage can be unavailable (private browsing, locked-down cookies) so any
 * storage error safely falls back to DEFAULT_TARGET_FPS (30).
 */
export function readTargetFps(): TargetFps {
  if (typeof localStorage === "undefined") {
    return DEFAULT_TARGET_FPS;
  }
  try {
    const stored = localStorage.getItem(FPS_STORAGE_KEY);
    if (stored === "60") {
      return 60;
    }
    return DEFAULT_TARGET_FPS;
  } catch {
    return DEFAULT_TARGET_FPS;
  }
}

/**
 * Persists the preferred target framerate to storage.
 */
export function writeTargetFps(fps: TargetFps): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(FPS_STORAGE_KEY, String(fps));
  } catch {
    // A rejected write only costs the preference, not the session.
  }
}

