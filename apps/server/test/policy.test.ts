import { describe, expect, it } from "vitest";
import {
  buildCrewPolicy,
  buildSandboxSettings,
  isPublicDeployment,
} from "../src/policy.js";

/**
 * The policy object is what the HUD renders and what index.ts checks
 * session.prompt against, so both halves of the restriction live or die on
 * these lists being exactly right.
 */
describe("buildCrewPolicy", () => {
  it("leaves every crew and thinking level on duty when the flag is unset", () => {
    const policy = buildCrewPolicy({});

    expect(policy.allowedModels).toEqual(["opus", "sonnet", "haiku"]);
    expect(policy.allowedEfforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(policy.demoInteractive).toBe(true);
  });

  it("drops opus, xhigh, max and demo orders on a public deployment", () => {
    const policy = buildCrewPolicy({ SUDO_CITY_PUBLIC_DEPLOYMENT: "1" });

    expect(policy.allowedModels).toEqual(["sonnet", "haiku"]);
    expect(policy.allowedModels).not.toContain("opus");
    expect(policy.allowedEfforts).toEqual(["low", "medium", "high"]);
    expect(policy.allowedEfforts).not.toContain("xhigh");
    expect(policy.allowedEfforts).not.toContain("max");
    expect(policy.demoInteractive).toBe(false);
  });

  it("does not leak the module's arrays into the returned policy", () => {
    const first = buildCrewPolicy({});
    first.allowedModels.push("mystery-crew");

    expect(buildCrewPolicy({}).allowedModels).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
  });
});

describe("buildSandboxSettings", () => {
  it("leaves crews unsandboxed locally, where the checkout is your own", () => {
    expect(buildSandboxSettings({})).toBeUndefined();
  });

  it("sandboxes and fails closed on a public deployment", () => {
    const sandbox = buildSandboxSettings({ SUDO_CITY_PUBLIC_DEPLOYMENT: "1" });

    expect(sandbox?.enabled).toBe(true);
    // The SDK's own default warns and runs unsandboxed when the platform
    // can't support it, which on a server is a control that silently is not
    // there. This must stay true.
    expect(sandbox?.failIfUnavailable).toBe(true);
  });

  it("leaves egress open until an allowlist is configured", () => {
    // A wrong allowlist breaks every crew that installs a dependency or runs
    // a test suite, so this is opt-in rather than guessed at.
    expect(
      buildSandboxSettings({ SUDO_CITY_PUBLIC_DEPLOYMENT: "1" }).network,
    ).toBeUndefined();
  });

  it("denies everything outside the allowlist once one is set", () => {
    const sandbox = buildSandboxSettings({
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
      SUDO_CITY_SANDBOX_ALLOWED_DOMAINS: "github.com, api.github.com ,,registry.npmjs.org",
    });

    expect(sandbox?.network?.allowedDomains).toEqual([
      "github.com",
      "api.github.com",
      "registry.npmjs.org",
    ]);
    expect(sandbox?.network?.strictAllowlist).toBe(true);
  });

  it("ignores an allowlist when the deployment is not public", () => {
    expect(
      buildSandboxSettings({ SUDO_CITY_SANDBOX_ALLOWED_DOMAINS: "github.com" }),
    ).toBeUndefined();
  });
});

describe("isPublicDeployment", () => {
  it.each(["1", "true", "yes", "TRUE", " 1 "])(
    "treats %j as public",
    (value) => {
      expect(isPublicDeployment({ SUDO_CITY_PUBLIC_DEPLOYMENT: value })).toBe(
        true,
      );
    },
  );

  // An empty assignment in a .env file is the common way to "leave it off",
  // and "0"/"false" are the common ways to write it out.
  it.each(["", "  ", "0", "false", "no", undefined])(
    "treats %j as local",
    (value) => {
      expect(isPublicDeployment({ SUDO_CITY_PUBLIC_DEPLOYMENT: value })).toBe(
        false,
      );
    },
  );
});
