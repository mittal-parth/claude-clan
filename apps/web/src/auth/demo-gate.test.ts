import { describe, expect, it } from "vitest";
import { demoGatedAction } from "./demo-gate";

/**
 * The demo city's gate: what prompts for an account and what stays free. The
 * cost of getting this wrong runs both ways -- gating too much makes the tour
 * useless, gating too little leaves an unauthenticated visitor able to spend
 * money and build worktrees on the server.
 */
describe("demoGatedAction", () => {
  const locked = { demoLocked: true } as const;
  const open = { demoLocked: false } as const;

  it("prompts for sign-in on the three actions that cost something", () => {
    expect(demoGatedAction({ ...locked, action: "dispatch" })).toBe(
      "dispatch a crew",
    );
    expect(demoGatedAction({ ...locked, action: "permit" })).toBe(
      "stamp a permit",
    );
    expect(demoGatedAction({ ...locked, action: "issue" })).toBe(
      "take on an issue",
    );
  });

  it("prompts before building a PR or issue city worktree", () => {
    expect(demoGatedAction({ ...locked, action: "travel", cityId: "pr-42" })).toBe(
      "sail to a pull request city",
    );
    expect(
      demoGatedAction({ ...locked, action: "travel", cityId: "issue-7" }),
    ).toBe("sail to a pull request city");
  });

  it("leaves the main city free to browse, since it is already built", () => {
    expect(
      demoGatedAction({ ...locked, action: "travel", cityId: "main" }),
    ).toBeUndefined();
  });

  it("gates nothing once the visitor has their own repository", () => {
    expect(demoGatedAction({ ...open, action: "dispatch" })).toBeUndefined();
    expect(demoGatedAction({ ...open, action: "permit" })).toBeUndefined();
    expect(demoGatedAction({ ...open, action: "issue" })).toBeUndefined();
    expect(
      demoGatedAction({ ...open, action: "travel", cityId: "pr-42" }),
    ).toBeUndefined();
  });
});
