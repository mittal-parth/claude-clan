import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Three controls in the console toolbar now behave differently on desktop: the
 * framerate button moves into City hall, SIGN IN gives way to the gh avatar,
 * and the "Live" pill is hidden while the socket is healthy. Each is a change
 * the hosted build must not see.
 *
 * This reads the source rather than rendering it, because the console reaches
 * Phaser through use-game-state and this suite runs Phaser-free under node.
 * What it pins is the shape of each condition, which is what a stray edit
 * would break.
 */
const source = readFileSync(
  join(import.meta.dirname, "AppHudConsole.tsx"),
  "utf8",
);

describe("console toolbar desktop gating", () => {
  it("keeps the framerate button on the hosted build only", () => {
    // The hosted build has no settings modal to hold this, so removing the
    // button without the isDesktop() guard would leave web visitors no way to
    // change framerate at all.
    expect(source).toContain("targetFps && toggleTargetFps && !isDesktop()");
  });

  it("keeps SIGN IN reachable for hosted visitors", () => {
    // The desktop branch has to be the last fallback, after user and localUser,
    // or a hosted visitor loses the button along with it. Matches the JSX text
    // node, not the label, so a comment mentioning it cannot satisfy this.
    const signIn = source.indexOf(">SIGN IN<");
    const desktopFallback = source.indexOf("isDesktop() ? null");
    expect(signIn).toBeGreaterThan(-1);
    expect(desktopFallback).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(desktopFallback);
  });

  it("shows the gh avatar without a sign-out control", () => {
    // There is no hosted session to end on desktop, so offering sign-out would
    // be a button that cannot do anything.
    const localBranch = source.slice(
      source.indexOf("localUser ? ("),
      source.indexOf("isDesktop() ? null"),
    );
    expect(localBranch).toContain("localUser.avatarUrl");
    expect(localBranch).not.toContain("onLogout");
  });

  it("hides the live pill only on desktop, and only while online", () => {
    // Both halves matter: dropping the online check would hide reconnect
    // feedback during the settings-triggered server restart, and dropping
    // isDesktop() would strip the pill from the hosted HUD entirely.
    expect(source).toContain('isDesktop() && connection === "online" ? null');
  });

  it("still renders pill markup for the states that signal trouble", () => {
    expect(source).toContain("statusLabel(connection, reconnectAttempt)");
    expect(source).toContain("hud-dot--live");
  });

  it("strictly guards the terminal button behind desktop with terminal bridge", () => {
    // The web/hosted build must NEVER show a terminal button or attempt to trigger a terminal.
    expect(source).toContain("isDesktop() && desktop()?.terminal && onToggleTerminal ? (");
  });

  it("renders 5-hour window and weekly limit meters in subscription mode", () => {
    expect(source).toContain('label="5-hour window"');
    expect(source).toContain('label="Weekly limit"');
    expect(source).toContain("isSubscription ? (");
  });
});
