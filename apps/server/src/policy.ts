import type { SandboxSettings } from "@sudo-city/agent";
import type { CrewPolicy, EffortLevel } from "@sudo-city/protocol";

const ALL_MODELS = ["opus", "sonnet", "haiku"] as const;
const ALL_EFFORTS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Opus is off and thinking stops at "high" on a public deployment: every
 * visitor draws on one shared Anthropic ceiling, and Opus at max effort is
 * the most expensive order the HUD can express -- a handful of them empty
 * the treasury for everyone else.
 */
const PUBLIC_MODELS: readonly string[] = ["sonnet", "haiku"];
const PUBLIC_EFFORTS: readonly EffortLevel[] = ["low", "medium", "high"];

/**
 * Set SUDO_CITY_PUBLIC_DEPLOYMENT on a server that strangers can reach.
 * Unset (the local-development default) leaves every crew, every thinking
 * level, and the demo city's orders available, which is the only way `pnpm
 * dev` against your own repo is usable -- locally the demo city is the
 * repository you pointed the server at.
 */
export function isPublicDeployment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.SUDO_CITY_PUBLIC_DEPLOYMENT?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  return value !== "0" && value !== "false" && value !== "no";
}

/**
 * OS-level confinement for the commands a crew runs. Off locally, where the
 * checkout is the developer's own; on for a public deployment, where one box
 * holds every user's clone and `Bash` is otherwise free to walk out of the
 * workspace and read the next mayor's repository -- or the server's own
 * environment.
 *
 * `failIfUnavailable` is the important flag: the SDK's own default is to warn
 * and run *unsandboxed* when the platform can't support it, which on a server
 * is a security control that silently isn't there. Failing the run is the
 * correct trade. It needs `bubblewrap` installed on Linux hosts.
 *
 * Network egress is left open unless SUDO_CITY_SANDBOX_ALLOWED_DOMAINS is set,
 * because a wrong allowlist breaks every crew that installs a dependency or
 * runs a test suite. Tune it against a real dispatch, then set it and get
 * deterministic denial of everything else.
 */
export function buildSandboxSettings(
  env: NodeJS.ProcessEnv = process.env,
): SandboxSettings | undefined {
  if (!isPublicDeployment(env)) {
    return undefined;
  }
  const allowedDomains = (env.SUDO_CITY_SANDBOX_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

  return {
    enabled: true,
    failIfUnavailable: true,
    ...(allowedDomains.length > 0
      ? { network: { allowedDomains, strictAllowlist: true } }
      : {}),
  };
}

export function buildCrewPolicy(
  env: NodeJS.ProcessEnv = process.env,
): CrewPolicy {
  const restricted = isPublicDeployment(env);
  return {
    allowedModels: [...(restricted ? PUBLIC_MODELS : ALL_MODELS)],
    allowedEfforts: [...(restricted ? PUBLIC_EFFORTS : ALL_EFFORTS)],
    // The demo city is one shared workspace on the server's own checkout, and
    // every command reaching it is unauthenticated -- nobody signs in to get
    // there. A public deployment keeps `main` browsable but takes away the
    // three things that spend money or do work on the server's behalf:
    // dispatching a crew, stamping its permits, and building a worktree by
    // travelling to a PR or issue city.
    demoInteractive: !restricted,
  };
}
