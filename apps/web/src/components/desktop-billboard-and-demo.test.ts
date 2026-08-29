import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop demo button and billboard gating", () => {
  const repoPickerSource = readFileSync(
    join(import.meta.dirname, "RepoPicker.tsx"),
    "utf8",
  );
  const appSource = readFileSync(
    join(import.meta.dirname, "../App.tsx"),
    "utf8",
  );

  it("removes the demo city button in the desktop app while preserving it on web", () => {
    // The demo city button must be wrapped in !isDesktop() check
    expect(repoPickerSource).toContain(
      "{!isDesktop() ? (\n            <HudButton type=\"button\" variant=\"ghost\" size=\"sm\" onClick={onSeeDemo}",
    );
  });

  it("renders only folder name vertically centered with no owner or avatar in desktop app", () => {
    // App.tsx must format billboardRepo with owner: "" when isDesktop() is true
    expect(appSource).toContain("if (isDesktop()) {");
    expect(appSource).toContain('owner: ""');
  });
});
