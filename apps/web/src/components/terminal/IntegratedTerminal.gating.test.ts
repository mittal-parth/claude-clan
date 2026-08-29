import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("IntegratedTerminal desktop-only gating", () => {
  const terminalSource = readFileSync(
    join(import.meta.dirname, "IntegratedTerminal.tsx"),
    "utf8",
  );
  const appSource = readFileSync(
    join(import.meta.dirname, "../../App.tsx"),
    "utf8",
  );

  it("never attaches keyboard shortcut listeners when not running on desktop with terminal bridge", () => {
    // The keydown listener must bail out immediately if not in desktop mode
    expect(terminalSource).toContain(
      "if (!isDesktop() || !desktop()?.terminal) return;",
    );
  });

  it("returns null immediately on render when running in a web/hosted environment", () => {
    // Under no circumstance should the terminal DOM render without desktop and terminal bridge
    expect(terminalSource).toContain(
      "if (!isDesktop() || !desktop()?.terminal || !open) {",
    );
  });

  it("gates mounting inside App.tsx with isDesktop()", () => {
    // In App.tsx, IntegratedTerminal is strictly gated behind isDesktop()
    expect(appSource).toContain(
      "{isDesktop() ? (\n        <IntegratedTerminal",
    );
  });
});
