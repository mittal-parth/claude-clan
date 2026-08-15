/**
 * Which demo-city actions ask the visitor to sign in, free of React and the
 * DOM so the rules are testable on their own -- the same split as gate.ts.
 *
 * The demo city is reached without signing in, so these are the commands an
 * anonymous visitor could otherwise use to spend the shared Anthropic budget
 * or make the server do work. `main` stays browsable: it is already built,
 * and the tour is the point.
 */
export type DemoAction =
  | { action: "dispatch" }
  | { action: "permit" }
  | { action: "issue" }
  | { action: "travel"; cityId: string };

export type DemoGateInput = DemoAction & { demoLocked: boolean };

/**
 * The phrase to show in the sign-in modal ("Sign in to <this>"), or undefined
 * when the action should go ahead.
 */
export function demoGatedAction(input: DemoGateInput): string | undefined {
  if (!input.demoLocked) {
    return undefined;
  }
  switch (input.action) {
    case "dispatch":
      return "dispatch a crew";
    case "permit":
      return "stamp a permit";
    case "issue":
      return "take on an issue";
    case "travel":
      // Only PR and issue cities cost anything: each is a git worktree plus a
      // repository scan, built the first time someone sails there.
      return input.cityId === "main"
        ? undefined
        : "sail to a pull request city";
    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}
