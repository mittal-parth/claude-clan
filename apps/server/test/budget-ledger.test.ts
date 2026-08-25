import { describe, expect, it } from "vitest";
import { BudgetLedger, MIN_RESERVATION_USD } from "../src/budget-ledger.js";

describe("BudgetLedger", () => {
  it("never grants concurrent reservations above the ceiling", () => {
    const ledger = new BudgetLedger(() => 1, () => undefined);
    const first = ledger.reserve("first");
    const second = ledger.reserve("second");

    expect(first + second).toBeLessThanOrEqual(1);
    expect(ledger.available()).toBe(0);
  });

  it("does not double-reserve an existing session", () => {
    const ledger = new BudgetLedger(() => 1, () => undefined);

    expect(ledger.reserve("session")).toBe(1);
    expect(ledger.reserve("session")).toBe(1);
    expect(ledger.available()).toBe(0);
  });

  it("settles actual spend and returns the unused grant", () => {
    const settled: number[] = [];
    const ledger = new BudgetLedger(() => 1, (amount) => settled.push(amount));
    ledger.reserve("session");
    ledger.settle("session", 0.25);

    expect(settled).toEqual([0.25]);
    expect(ledger.available()).toBe(1);
  });

  it("cannot fund a new turn below the minimum reservation", () => {
    const ledger = new BudgetLedger(() => MIN_RESERVATION_USD, () => undefined);
    ledger.reserve("session");

    expect(ledger.canFund()).toBe(false);
  });

  it("respects a ceiling that shrinks between reservations", () => {
    let ceiling = 1;
    const ledger = new BudgetLedger(() => ceiling, () => undefined);
    ledger.reserve("first", 0.75);
    ceiling = 0.5;

    expect(ledger.available()).toBe(0);
    expect(ledger.reserve("second")).toBe(0);
  });
});
