import { randomUUID } from "node:crypto";

/**
 * Single-use, short-lived grants that carry a session id across a hop the
 * session's own httpOnly cookie can't cross -- the GitHub callback landing
 * on the API's own origin (see routes/auth.ts's `/api/auth/finish`), and a
 * WebSocket handshake that isn't behind the same-origin proxy the REST API
 * is. Neither the cookie nor the raw session id is ever readable by page
 * JS; only these narrow, one-shot tickets are.
 */
export class TicketStore {
  private readonly tickets = new Map<string, { sessionId: string; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  create(sessionId: string): string {
    this.sweep();
    const ticket = randomUUID();
    this.tickets.set(ticket, { sessionId, expiresAt: Date.now() + this.ttlMs });
    return ticket;
  }

  /** Returns the session id and burns the ticket, whether or not it was valid. */
  consume(ticket: string): string | undefined {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    this.sweep();
    if (!entry || entry.expiresAt < Date.now()) {
      return undefined;
    }
    return entry.sessionId;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) {
        this.tickets.delete(ticket);
      }
    }
  }
}
