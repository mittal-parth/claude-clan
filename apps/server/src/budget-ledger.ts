/**
 * Rations one budget ceiling across concurrent session turns.
 *
 * The old server handed every city the settled remainder. That was safe only
 * while a city could run one agent: concurrent starts could each receive the
 * full balance and spend N times the configured ceiling. Reservations are
 * removed as soon as a turn settles, so a slow runner cannot hide money from a
 * second order and a second order cannot oversubscribe the first one's grant.
 */
export const MIN_RESERVATION_USD = 0.05;

export class BudgetLedger {
  private readonly reservations = new Map<string, number>();

  constructor(
    private readonly ceiling: () => number,
    private readonly onSettle: (amountUsd: number) => void,
  ) {}

  available(): number {
    const reserved = [...this.reservations.values()].reduce(
      (total, amount) => total + amount,
      0,
    );
    return Math.max(0, this.ceiling() - reserved);
  }

  reserve(
    sessionId: string,
    requested = Number.POSITIVE_INFINITY,
  ): number {
    const existing = this.reservations.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const granted = Math.min(Math.max(0, requested), this.available());
    this.reservations.set(sessionId, granted);
    return granted;
  }

  settle(sessionId: string, actualUsd: number): void {
    this.reservations.delete(sessionId);
    if (actualUsd > 0) {
      this.onSettle(actualUsd);
    }
  }

  release(sessionId: string): void {
    this.reservations.delete(sessionId);
  }

  canFund(): boolean {
    return this.available() >= MIN_RESERVATION_USD;
  }
}
