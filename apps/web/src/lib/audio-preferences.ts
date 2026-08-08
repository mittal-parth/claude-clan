export const SFX_STORAGE_KEY = "sudo-city:sfx-enabled";

export function readSfxEnabled(): boolean {
  const stored = localStorage.getItem(SFX_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}
