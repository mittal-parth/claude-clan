import { GameEventSchema, type GameEvent } from "@sudo-city/protocol";

export const SESSION_STORAGE_PREFIX = "sudo-city:session:";
export const SESSION_STORAGE_VERSION = 2;
export const SESSION_STORAGE_TAIL = 60;

function storage(): Storage | undefined {
  return typeof globalThis.localStorage === "undefined"
    ? undefined
    : globalThis.localStorage;
}

export function sessionStorageKey(repoKey: string, sessionId: string): string {
  return `${SESSION_STORAGE_PREFIX}v${SESSION_STORAGE_VERSION}:${repoKey}:${sessionId}`;
}

export function loadStoredSession(repoKey: string, sessionId: string): GameEvent[] {
  const target = storage();
  if (!target) {
    return [];
  }
  try {
    const raw = target.getItem(sessionStorageKey(repoKey, sessionId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.flatMap((event) => {
      const result = GameEventSchema.safeParse(event);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function storeSessionTail(
  repoKey: string,
  sessionId: string,
  events: readonly GameEvent[],
): void {
  const target = storage();
  if (!target) {
    return;
  }
  try {
    target.setItem(
      sessionStorageKey(repoKey, sessionId),
      JSON.stringify(events.slice(-SESSION_STORAGE_TAIL)),
    );
  } catch {
    // Storage quota is a performance cache failure, not a reason to lose the
    // server-authoritative transcript or interrupt a running session.
  }
}

export function clearStoredSessions(repoKey: string): void {
  const target = storage();
  if (!target) {
    return;
  }
  const prefix = `${SESSION_STORAGE_PREFIX}v${SESSION_STORAGE_VERSION}:${repoKey}:`;
  const keys: string[] = [];
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    target.removeItem(key);
  }
}
