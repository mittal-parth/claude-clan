import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/budget-ledger.js";

describe("BudgetLedger, uncapped", () => {
  it("declares no ceiling and always funds", () => {
    const ledger = new BudgetLedger(() => 0, () => undefined, true);

    expect(ledger.available()).toBe(Number.POSITIVE_INFINITY);
    expect(ledger.reserve("s1")).toBeUndefined();
    expect(ledger.canFund()).toBe(true);
  });

  it("still reports settled spend", () => {
    let settled = 0;
    const ledger = new BudgetLedger(
      () => 0,
      (amount) => {
        settled += amount;
      },
      true,
    );

    ledger.reserve("s1");
    ledger.settle("s1", 0.42);
    expect(settled).toBeCloseTo(0.42);
  });

  it("defaults to capped, so hosted behavior is unchanged", () => {
    const ledger = new BudgetLedger(() => 1, () => undefined);

    expect(ledger.reserve("s1", 0.5)).toBe(0.5);
    expect(ledger.canFund()).toBe(true);
  });
});
