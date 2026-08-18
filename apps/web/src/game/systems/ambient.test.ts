import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

// Mock window and matchMedia globally
const matchMediaMock = vi.fn();
vi.stubGlobal("matchMedia", matchMediaMock);
vi.stubGlobal("window", { matchMedia: matchMediaMock });

import { prefersReducedMotion } from "./ambient";

describe("prefersReducedMotion", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', { value: 8, configurable: true });
    Object.defineProperty(globalThis.navigator, 'deviceMemory', { value: 8, configurable: true });
    matchMediaMock.mockReturnValue({ matches: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns true if OS prefers reduced motion", () => {
    matchMediaMock.mockReturnValue({ matches: true });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false for high-end devices without motion preference", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns true if hardwareConcurrency is 4 or less", () => {
    Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', { value: 4, configurable: true });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns true if deviceMemory is 4 or less", () => {
    Object.defineProperty(globalThis.navigator, 'deviceMemory', { value: 4, configurable: true });
    expect(prefersReducedMotion()).toBe(true);
  });
});
