import { describe, expect, it } from "vitest";
import {
  SANDBOX_BASELINE_DOMAINS,
  SYSTEM_SECRET_PATHS,
  buildCrewPolicy,
  buildSandboxSettings,
  isPublicDeployment,
} from "../src/policy.js";

/**
 * The policy object is what the HUD renders and what index.ts checks
 * session.open against, so both halves of the restriction live or die on
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

const WORKSPACE = {
  repoPath: "/var/lib/sudocity/clones/7/octocat/hello-world",
  cloneRoot: "/var/lib/sudocity/clones",
};

describe("buildSandboxSettings", () => {
  it("leaves crews unsandboxed locally, where the checkout is your own", () => {
    expect(buildSandboxSettings(WORKSPACE, {})).toBeUndefined();
  });

  it("hides every other mayor's clone while keeping this one readable", () => {
    // Clones are siblings under one root, and everything outside the
    // workspace is read-only but still readable. Verified on a real host:
    // denyRead makes a neighbour's tree vanish, and allowRead wins for the
    // crew's own, including .git.
    const sandbox = buildSandboxSettings(WORKSPACE, {
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
    });

    expect(sandbox?.filesystem?.denyRead).toEqual([
      WORKSPACE.cloneRoot,
      ...SYSTEM_SECRET_PATHS,
    ]);
    expect(sandbox?.filesystem?.allowRead).toEqual([WORKSPACE.repoPath]);
  });

  it("denies reading the server root when configured", () => {
    const sandbox = buildSandboxSettings(
      { ...WORKSPACE, serverRoot: "/opt/claude-clan" },
      { SUDO_CITY_PUBLIC_DEPLOYMENT: "1" },
    );
    expect(sandbox?.filesystem?.denyRead).toEqual([
      WORKSPACE.cloneRoot,
      ...SYSTEM_SECRET_PATHS,
      "/opt/claude-clan",
    ]);
  });

  it("unsets the server's secrets for sandboxed commands", () => {
    const denied = buildSandboxSettings(WORKSPACE, {
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
    })?.credentials?.envVars;

    // Without this a crew can printenv its way to the database, every
    // session token's encryption key, and the shared Anthropic key.
    expect(denied?.map((entry) => entry.name)).toEqual([
      "ANTHROPIC_API_KEY",
      "DATABASE_URL",
      "TOKEN_ENCRYPTION_KEY",
      "SESSION_SECRET",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SESSION_TOKEN",
      "AWS_SSH_PRIVATE_KEY",
      "AWS_KNOWN_HOSTS",
    ]);
    expect(denied?.every((entry) => entry.mode === "deny")).toBe(true);
  });

  it("sandboxes and fails closed on a public deployment", () => {
    const sandbox = buildSandboxSettings(WORKSPACE, { SUDO_CITY_PUBLIC_DEPLOYMENT: "1" });

    expect(sandbox?.enabled).toBe(true);
    // The SDK's own default warns and runs unsandboxed when the platform
    // can't support it, which on a server is a control that silently is not
    // there. This must stay true.
    expect(sandbox?.failIfUnavailable).toBe(true);
  });

  it("allows GitHub with no allowlist configured", () => {
    // An enabled sandbox with no network config is not open egress, it is an
    // empty allowlist -- which blocked a crew from pushing a commit on the
    // deployed server while local dispatches, where the sandbox is off,
    // worked. The baseline is what this app's own workflow needs.
    const network = buildSandboxSettings(WORKSPACE, {
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
    })?.network;

    expect(network?.allowedDomains).toEqual([...SANDBOX_BASELINE_DOMAINS]);
    expect(network?.strictAllowlist).toBe(true);
  });

  it("extends the baseline with a configured allowlist rather than replacing it", () => {
    const sandbox = buildSandboxSettings(WORKSPACE, {
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
      SUDO_CITY_SANDBOX_ALLOWED_DOMAINS: "registry.npmjs.org, github.com ,,pypi.org",
    });

    // github.com is in both and must not appear twice; tuning the list for one
    // repo's registry must not be able to cut a crew off from GitHub.
    expect(sandbox?.network?.allowedDomains).toEqual([
      ...SANDBOX_BASELINE_DOMAINS,
      "registry.npmjs.org",
      "pypi.org",
    ]);
    expect(sandbox?.network?.strictAllowlist).toBe(true);
  });

  it("denies everything outside the allowlist", () => {
    const sandbox = buildSandboxSettings(WORKSPACE, {
      SUDO_CITY_PUBLIC_DEPLOYMENT: "1",
      SUDO_CITY_SANDBOX_ALLOWED_DOMAINS: "registry.npmjs.org",
    });

    expect(sandbox?.network?.allowedDomains).not.toContain("example.com");
    expect(sandbox?.network?.strictAllowlist).toBe(true);
  });

  it("ignores an allowlist when the deployment is not public", () => {
    expect(
      buildSandboxSettings(WORKSPACE, { SUDO_CITY_SANDBOX_ALLOWED_DOMAINS: "github.com" }),
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

  it("treats NODE_ENV=production as public unless explicitly disabled", () => {
    expect(isPublicDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(
      isPublicDeployment({
        NODE_ENV: "production",
        SUDO_CITY_PUBLIC_DEPLOYMENT: "0",
      }),
    ).toBe(false);
  });
});
