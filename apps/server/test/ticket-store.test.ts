import { describe, expect, it, vi } from "vitest";
import { TicketStore } from "../src/ticket-store.js";

describe("TicketStore", () => {
  it("consumes a ticket exactly once", () => {
    const store = new TicketStore(60_000);
    const ticket = store.create("session-a");

    expect(store.consume(ticket)).toBe("session-a");
    expect(store.consume(ticket)).toBeUndefined();
  });

  it("rejects a ticket that never existed", () => {
    const store = new TicketStore(60_000);
    expect(store.consume("not-a-real-ticket")).toBeUndefined();
  });

  it("expires a ticket after its TTL", () => {
    vi.useFakeTimers();
    try {
      const store = new TicketStore(1_000);
      const ticket = store.create("session-a");

      vi.advanceTimersByTime(1_001);

      expect(store.consume(ticket)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues distinct tickets for repeated creates against the same session", () => {
    const store = new TicketStore(60_000);
    const first = store.create("session-a");
    const second = store.create("session-a");

    expect(first).not.toBe(second);
    expect(store.consume(first)).toBe("session-a");
    expect(store.consume(second)).toBe("session-a");
  });
});
