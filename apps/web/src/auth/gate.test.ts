import { describe, expect, it } from "vitest";
import {
  clearStoredActiveRepo,
  gateFor,
  readSessionFromHash,
  readStoredActiveRepo,
  writeStoredActiveRepo,
} from "./gate.js";

describe("gateFor", () => {
  it("shows the city once a repo is active, regardless of auth", () => {
    expect(gateFor({ authenticated: false }, "demo")).toBe("city");
    expect(
      gateFor(
        { authenticated: true, user: { id: 1, login: "octocat", avatarUrl: "" } },
        "octocat/hello-world",
      ),
    ).toBe("city");
  });

  it("shows login when signed out with no active repo", () => {
    expect(gateFor({ authenticated: false }, undefined)).toBe("login");
  });

  it("shows the repo picker when signed in with no active repo", () => {
    expect(
      gateFor({ authenticated: true, user: { id: 1, login: "octocat", avatarUrl: "" } }, undefined),
    ).toBe("repos");
  });
});

describe("readSessionFromHash", () => {
  it("reports a session error", () => {
    expect(readSessionFromHash("#session-error=1")).toEqual({ error: true });
  });

  it("returns nothing for an unrelated hash", () => {
    expect(readSessionFromHash("#foo=bar")).toEqual({});
    expect(readSessionFromHash("")).toEqual({});
  });
});

describe("stored active repo guards", () => {
  it("round-trips demo and user-bound repo selections", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    try {
      writeStoredActiveRepo("demo");
      expect(readStoredActiveRepo()).toEqual({ repoKey: "demo" });

      writeStoredActiveRepo("octocat/hello-world", 42);
      expect(readStoredActiveRepo()).toEqual({
        repoKey: "octocat/hello-world",
        userId: 42,
      });

      clearStoredActiveRepo();
      expect(readStoredActiveRepo()).toBeUndefined();
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, "localStorage", previous);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });
});