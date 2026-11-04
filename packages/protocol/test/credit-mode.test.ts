import { describe, expect, it } from "vitest";
import {
  BudgetInfoSchema,
  MayorCommandSchema,
  creditModeOf,
  isLocalRepoKey,
} from "../src/index.js";

describe("BudgetInfoSchema", () => {
  it("leaves mode absent for a hosted message", () => {
    const parsed = BudgetInfoSchema.parse({
      totalBudgetUsd: 1,
      spentUsd: 0,
      remainingBudgetUsd: 1,
    });

    expect(parsed.mode).toBeUndefined();
    expect(creditModeOf(parsed)).toBe("api-key");
  });

  it("accepts a subscription budget with no ceilings", () => {
    const parsed = BudgetInfoSchema.parse({ mode: "subscription", spentUsd: 2.5 });

    expect(creditModeOf(parsed)).toBe("subscription");
    expect(parsed.totalBudgetUsd).toBeUndefined();
    expect(parsed.remainingBudgetUsd).toBeUndefined();
  });

  it("accepts fiveHourLimit and weeklyLimit in subscription mode", () => {
    const parsed = BudgetInfoSchema.parse({
      mode: "subscription",
      spentUsd: 0,
      fiveHourLimit: {
        utilization: 24,
        resetsAt: "2026-08-29T22:00:00.000Z",
        status: "allowed",
      },
      weeklyLimit: {
        utilization: 45,
        resetsAt: "2026-08-31T00:00:00.000Z",
        status: "allowed",
      },
    });

    expect(creditModeOf(parsed)).toBe("subscription");
    expect(parsed.fiveHourLimit?.utilization).toBe(24);
    expect(parsed.fiveHourLimit?.resetsAt).toBe("2026-08-29T22:00:00.000Z");
    expect(parsed.weeklyLimit?.utilization).toBe(45);
  });

  it("still rejects a negative spend", () => {
    expect(() => BudgetInfoSchema.parse({ spentUsd: -1 })).toThrow();
  });
});

describe("local repository protocol", () => {
  it("parses the desktop local-folder command and namespaces its key", () => {
    expect(MayorCommandSchema.parse({
      type: "repo.openLocal",
      path: "/Users/me/project",
    })).toEqual({ type: "repo.openLocal", path: "/Users/me/project" });
    expect(isLocalRepoKey("local:/Users/me/project")).toBe(true);
    expect(isLocalRepoKey("octocat/hello-world")).toBe(false);
  });
});
