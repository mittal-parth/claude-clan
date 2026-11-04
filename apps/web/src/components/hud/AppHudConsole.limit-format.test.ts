import { describe, expect, it } from "vitest";
import {
  formatLimitReadout,
  formatResetTime,
} from "./AppHudConsole";

describe("formatResetTime", () => {
  const baseTime = 1724968800000; // fixed now timestamp

  it("returns undefined for missing or invalid dates", () => {
    expect(formatResetTime(undefined, baseTime)).toBeUndefined();
    expect(formatResetTime("not-a-date", baseTime)).toBeUndefined();
  });

  it("formats minutes remaining when under 1 hour", () => {
    const target = new Date(baseTime + 25 * 60_000).toISOString();
    expect(formatResetTime(target, baseTime)).toBe("resets in 25m");
  });

  it("formats hours and minutes when under 24 hours", () => {
    const target = new Date(baseTime + (2 * 3600_000 + 15 * 60_000)).toISOString();
    expect(formatResetTime(target, baseTime)).toBe("resets in 2h 15m");
  });

  it("formats days when 24 hours or more", () => {
    const target = new Date(baseTime + 3 * 86400_000).toISOString();
    expect(formatResetTime(target, baseTime)).toBe("resets in 3d");
  });

  it("returns 'resets soon' when past or zero", () => {
    const past = new Date(baseTime - 1000).toISOString();
    expect(formatResetTime(past, baseTime)).toBe("resets soon");
  });
});

describe("formatLimitReadout", () => {
  const baseTime = 1724968800000;

  it("returns default label when window is undefined", () => {
    const result = formatLimitReadout(undefined, "Available", baseTime);
    expect(result).toEqual({
      text: "Available",
      percent: 0,
      isUnmetered: true,
      tone: undefined,
    });
  });

  it("formats normal utilization with percentage and reset countdown", () => {
    const target = new Date(baseTime + 2 * 3600_000).toISOString();
    const result = formatLimitReadout(
      { utilization: 35, resetsAt: target, status: "allowed" },
      "Available",
      baseTime,
    );
    expect(result.text).toBe("35% · resets in 2h 0m");
    expect(result.percent).toBe(35);
    expect(result.isUnmetered).toBe(false);
    expect(result.tone).toBeUndefined();
  });

  it("normalizes fraction 0..1 to percentage 0..100", () => {
    const result = formatLimitReadout(
      { utilization: 0.42, status: "allowed" },
      "Available",
      baseTime,
    );
    expect(result.text).toBe("42% used");
    expect(result.percent).toBe(42);
    expect(result.isUnmetered).toBe(false);
  });

  it("shifts tone to warning amber when approaching limit (>80% or status warning)", () => {
    const result = formatLimitReadout(
      { utilization: 85, status: "allowed_warning" },
      "Available",
      baseTime,
    );
    expect(result.text).toBe("85% used");
    expect(result.percent).toBe(85);
    expect(result.tone).toBe("#f59e0b");
  });

  it("shifts tone to danger red when near exhaustion (>=95%)", () => {
    const result = formatLimitReadout(
      { utilization: 98, status: "allowed_warning" },
      "Available",
      baseTime,
    );
    expect(result.percent).toBe(98);
    expect(result.tone).toBe("#ef4444");
  });

  it("handles rejected/exhausted status with danger red", () => {
    const target = new Date(baseTime + 45 * 60_000).toISOString();
    const result = formatLimitReadout(
      { status: "rejected", resetsAt: target },
      "Available",
      baseTime,
    );
    expect(result.text).toBe("Exhausted · resets in 45m");
    expect(result.percent).toBe(100);
    expect(result.isUnmetered).toBe(false);
    expect(result.tone).toBe("#ef4444");
  });
});
