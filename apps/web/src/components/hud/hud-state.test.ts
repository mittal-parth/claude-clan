import { describe, expect, it } from "vitest";

import {
  DEFAULT_HUD_STATE,
  HUD_PANEL_IDS,
  parseHudState,
  serializeHudState,
  toggleHudPanel,
  type HudState,
} from "./hud-state";

const EXPANDED: HudState = {
  console: true,
  scan: true,
  order: true,
  inspector: true,
};

describe("toggleHudPanel", () => {
  it("flips only the named panel", () => {
    const before: HudState = { ...EXPANDED };
    const after = toggleHudPanel(before, "scan");

    expect(after.scan).toBe(false);
    expect(after.console).toBe(true);
    expect(after.order).toBe(true);
    expect(after.inspector).toBe(true);
    expect(before).toEqual(EXPANDED);
  });

  it("expands a compact panel again", () => {
    const compact = toggleHudPanel(EXPANDED, "console");
    const reopened = toggleHudPanel(compact, "console");

    expect(compact.console).toBe(false);
    expect(reopened).toEqual(EXPANDED);
  });

  it("covers every panel id", () => {
    for (const id of HUD_PANEL_IDS) {
      const after = toggleHudPanel(EXPANDED, id);
      expect(after[id]).toBe(false);

      const untouched = HUD_PANEL_IDS.filter((other) => other !== id);
      for (const other of untouched) {
        expect(after[other]).toBe(true);
      }
    }
  });
});

describe("parseHudState", () => {
  it("returns the defaults for missing storage", () => {
    expect(parseHudState(null)).toEqual(DEFAULT_HUD_STATE);
    expect(parseHudState(undefined)).toEqual(DEFAULT_HUD_STATE);
    expect(parseHudState("")).toEqual(DEFAULT_HUD_STATE);
  });

  it("returns the defaults for unreadable storage", () => {
    expect(parseHudState("{oops")).toEqual(DEFAULT_HUD_STATE);
    expect(parseHudState("null")).toEqual(DEFAULT_HUD_STATE);
    expect(parseHudState('"scan"')).toEqual(DEFAULT_HUD_STATE);
    expect(parseHudState("[true]")).toEqual(DEFAULT_HUD_STATE);
  });

  it("keeps stored panels and defaults the rest", () => {
    const parsed = parseHudState('{"scan":false,"order":false}');

    expect(parsed).toEqual({
      console: true,
      scan: false,
      order: false,
      inspector: true,
    });
  });

  it("drops unknown panels and non-boolean values", () => {
    const parsed = parseHudState(
      '{"scan":"false","radio":true,"inspector":false,"console":1}',
    );

    expect(parsed).toEqual({
      console: true,
      scan: true,
      order: true,
      inspector: false,
    });
    expect(Object.keys(parsed).sort()).toEqual([...HUD_PANEL_IDS].sort());
  });

  it("round-trips a serialized state", () => {
    const state: HudState = {
      console: false,
      scan: true,
      order: false,
      inspector: true,
    };

    expect(parseHudState(serializeHudState(state))).toEqual(state);
  });
});
