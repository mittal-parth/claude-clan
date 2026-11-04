import { describe, expect, it } from "vitest";
import {
  buildCrewPolicy,
  buildSandboxSettings,
  isPublicDeployment,
} from "../src/policy.js";

describe("local deployment policy", () => {
  it("keeps production restrictive without the local flag", () => {
    const policy = buildCrewPolicy({ NODE_ENV: "production" });

    expect(policy.allowedModels).not.toContain("opus");
    expect(policy.allowedEfforts).not.toContain("max");
    expect(policy.demoInteractive).toBe(false);
  });

  it("allows all crews in local mode even with NODE_ENV=production", () => {
    const env = { NODE_ENV: "production", SUDO_CITY_LOCAL: "1" };
    const policy = buildCrewPolicy(env);

    expect(policy.allowedModels).toContain("opus");
    expect(policy.allowedEfforts).toContain("max");
    expect(policy.demoInteractive).toBe(true);
    expect(isPublicDeployment(env)).toBe(false);
  });

  it("leaves the sandbox off in local mode", () => {
    expect(buildSandboxSettings(
      { repoPath: "/Users/me/project", cloneRoot: "/tmp/clones" },
      { NODE_ENV: "production", SUDO_CITY_LOCAL: "1" },
    )).toBeUndefined();
  });

  it("keeps the sandbox fail-closed for a public deployment", () => {
    const settings = buildSandboxSettings(
      { repoPath: "/srv/clones/1/a/b", cloneRoot: "/srv/clones" },
      { NODE_ENV: "production" },
    );

    expect(settings?.enabled).toBe(true);
    expect(settings?.failIfUnavailable).toBe(true);
  });
});
