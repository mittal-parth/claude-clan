import { afterEach, describe, expect, it } from "vitest";
import type { GameEvent } from "@sudo-city/protocol";
import {
  SESSION_STORAGE_PREFIX,
  clearStoredSessions,
  loadStoredSession,
  sessionStorageKey,
  storeSessionTail,
} from "./storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
const event: GameEvent = {
  id: "event-1",
  cityId: "main",
  sessionId: "session-1",
  sequence: 1,
  timestamp: "2026-08-25T12:00:00.000Z",
  type: "session.message",
  messageId: "message-1",
  role: "agent",
  kind: "text",
  text: "hello",
  contextPaths: [],
};

afterEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: undefined,
  });
});

describe("session storage", () => {
  it("round-trips a validated session tail", () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    storeSessionTail("repo-a", "session-1", [event]);

    expect(loadStoredSession("repo-a", "session-1")).toEqual([event]);
  });

  it("clears every cached session for one repo without touching another", () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    storeSessionTail("repo-a", "session-1", [event]);
    storeSessionTail("repo-a", "session-2", [{ ...event, sessionId: "session-2", id: "event-2" }]);
    storeSessionTail("repo-b", "session-1", [{ ...event, sessionId: "session-1", id: "event-3" }]);

    clearStoredSessions("repo-a");

    expect(storage.getItem(sessionStorageKey("repo-a", "session-1"))).toBeNull();
    expect(storage.getItem(sessionStorageKey("repo-a", "session-2"))).toBeNull();
    expect(storage.getItem(sessionStorageKey("repo-b", "session-1"))).not.toBeNull();
    expect([...Array.from({ length: storage.length }, (_, index) => storage.key(index))].every((key) => !key?.startsWith(`${SESSION_STORAGE_PREFIX}v2:repo-a:`))).toBe(true);
  });
});
