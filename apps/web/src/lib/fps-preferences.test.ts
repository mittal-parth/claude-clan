import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  FPS_STORAGE_KEY,
  DEFAULT_TARGET_FPS,
  readTargetFps,
  writeTargetFps,
} from "./fps-preferences";

describe("fps-preferences", () => {
  let values: Map<string, string>;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  beforeEach(() => {
    values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  afterEach(() => {
    if (previous) {
      Object.defineProperty(globalThis, "localStorage", previous);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("defaults to 30 FPS when storage is empty", () => {
    expect(readTargetFps()).toBe(DEFAULT_TARGET_FPS);
    expect(readTargetFps()).toBe(30);
  });

  it("reads 60 FPS when stored", () => {
    localStorage.setItem(FPS_STORAGE_KEY, "60");
    expect(readTargetFps()).toBe(60);
  });

  it("falls back to 30 FPS when invalid value is stored", () => {
    localStorage.setItem(FPS_STORAGE_KEY, "invalid");
    expect(readTargetFps()).toBe(30);
  });

  it("writes target FPS to storage", () => {
    writeTargetFps(60);
    expect(localStorage.getItem(FPS_STORAGE_KEY)).toBe("60");
    expect(readTargetFps()).toBe(60);

    writeTargetFps(30);
    expect(localStorage.getItem(FPS_STORAGE_KEY)).toBe("30");
    expect(readTargetFps()).toBe(30);
  });

  it("handles storage exceptions gracefully", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("SecurityError: Access denied");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });

    expect(readTargetFps()).toBe(30);
    expect(() => writeTargetFps(60)).not.toThrow();
  });
});
