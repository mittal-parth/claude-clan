import { describe, expect, it } from "vitest";
import type { GameEvent, SessionSummary } from "@sudo-city/protocol";
import {
  EVENTS_PER_SESSION_CAP,
  initialSessionsState,
  sessionsReducer,
} from "./store";

const CREATED_AT = "2026-08-25T12:00:00.000Z";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "session-1",
    cityId: "main",
    title: "First order",
    autoTitled: true,
    status: "idle",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    turnCount: 0,
    costUsd: 0,
    pendingPermitCount: 0,
    queuedCount: 0,
    live: false,
    readOnly: false,
    lastSequence: 0,
    ...overrides,
  };
}

function event(
  sequence: number,
  type: GameEvent["type"],
  extra: Record<string, unknown> = {},
): GameEvent {
  return {
    id: `event-${sequence}-${String(type)}`,
    cityId: "main",
    sessionId: "session-1",
    sequence,
    timestamp: CREATED_AT,
    type,
    ...extra,
  } as GameEvent;
}

function withSummary(nextSummary = summary()) {
  return sessionsReducer(initialSessionsState, {
    type: "summary",
    session: nextSummary,
  });
}

describe("sessionsReducer", () => {
  it("holds events that arrive before their session summary", () => {
    const held = sessionsReducer(initialSessionsState, {
      type: "event",
      event: event(0, "session.message", {
        messageId: "message-1",
        role: "mayor",
        text: "start",
      }),
    });

    const introduced = sessionsReducer(held, {
      type: "summary",
      session: summary(),
    });

    expect(introduced.byId["session-1"]?.events).toHaveLength(1);
    expect(introduced.holding).toEqual({});
  });

  it("ignores synthetic world sessions", () => {
    const worldSummary = summary({ sessionId: "world:main" });
    const afterSummary = sessionsReducer(initialSessionsState, {
      type: "summary",
      session: worldSummary,
    });
    const afterEvent = sessionsReducer(afterSummary, {
      type: "event",
      event: { ...event(0, "world.ready"), sessionId: "world:main" },
    });

    expect(afterSummary.byId).toEqual({});
    expect(afterEvent.holding).toEqual({});
  });

  it("deduplicates by event id and keeps sequence order", () => {
    let state = withSummary();
    const later = event(2, "session.message", {
      messageId: "message-2",
      role: "agent",
      text: "later",
    });
    const earlier = event(1, "session.message", {
      id: "event-1",
      messageId: "message-1",
      role: "agent",
      text: "earlier",
    });
    state = sessionsReducer(state, { type: "event", event: later });
    state = sessionsReducer(state, { type: "event", event: earlier });
    state = sessionsReducer(state, { type: "event", event: later });

    expect(state.byId["session-1"]?.events.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("keeps background events unread until the session is seen", () => {
    let state = withSummary(summary({ lastSequence: 7 }));
    state = sessionsReducer(state, {
      type: "event",
      event: event(8, "session.message", {
        messageId: "message-8",
        role: "agent",
        text: "background update",
      }),
    });
    state = sessionsReducer(state, {
      type: "summary",
      session: summary({ lastSequence: 8 }),
    });

    expect(state.byId["session-1"]?.seenSequence).toBe(7);

    state = sessionsReducer(state, { type: "seen", sessionId: "session-1" });

    expect(state.byId["session-1"]?.seenSequence).toBe(8);
  });

  it("marks incoming events as seen while the session is focused", () => {
    let state = withSummary();
    state = sessionsReducer(state, { type: "focus", sessionId: "session-1" });
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.message", {
        messageId: "message-1",
        role: "agent",
        text: "focused update",
      }),
    });

    expect(state.byId["session-1"]?.seenSequence).toBe(1);
  });

  it("marks the latest summary sequence as seen even before transcript hydration", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "summary",
      session: summary({ lastSequence: 9 }),
    });
    state = sessionsReducer(state, { type: "seen", sessionId: "session-1" });

    expect(state.byId["session-1"]?.seenSequence).toBe(9);
  });

  it("accumulates deltas outside the durable event list", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.delta", { messageId: "message-1", text: "hel" }),
    });
    state = sessionsReducer(state, {
      type: "event",
      event: event(2, "session.delta", { messageId: "message-1", text: "lo" }),
    });

    expect(state.byId["session-1"]?.events).toEqual([]);
    expect(state.byId["session-1"]?.streaming).toEqual({ "message-1": "hello" });
  });

  it("clears streaming text when its final message arrives", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.delta", { messageId: "message-1", text: "hello" }),
    });
    state = sessionsReducer(state, {
      type: "event",
      event: event(2, "session.message", {
        messageId: "message-1",
        role: "agent",
        text: "hello",
      }),
    });
    state = sessionsReducer(state, {
      type: "event",
      event: event(3, "session.message", {
        messageId: "message-1:thinking",
        role: "agent",
        kind: "thinking",
        text: "thought",
      }),
    });

    expect(state.byId["session-1"]?.streaming).toEqual({});
  });

  it("replaces a first transcript page and merges later pages", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "transcript",
      sessionId: "session-1",
      fromSequence: 0,
      events: [event(4, "session.message", { messageId: "m4", role: "agent", text: "four" })],
      hasMore: true,
    });
    state = sessionsReducer(state, {
      type: "transcript",
      sessionId: "session-1",
      fromSequence: 4,
      events: [event(5, "session.message", { messageId: "m5", role: "agent", text: "five" })],
      hasMore: false,
    });

    expect(state.byId["session-1"]?.events.map((item) => item.sequence)).toEqual([4, 5]);
    expect(state.byId["session-1"]?.hydrated).toBe(true);
    expect(state.byId["session-1"]?.trimmed).toBe(true);
  });

  it("removes an optimistic pending message when the server confirms it", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "optimistic",
      sessionId: "session-1",
      id: "pending-1",
      text: "follow up",
      contextPaths: ["src/index.ts"],
    });
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.message", {
        messageId: "m1",
        role: "mayor",
        text: "follow up",
        contextPaths: ["src/index.ts"],
      }),
    });

    expect(state.byId["session-1"]?.pending).toEqual([]);
  });

  it("puts permit sessions first, then newest activity", () => {
    let state = sessionsReducer(initialSessionsState, {
      type: "roster",
      sessions: [
        summary({ sessionId: "old", updatedAt: "2026-08-25T12:00:00.000Z" }),
        summary({ sessionId: "new", updatedAt: "2026-08-25T13:00:00.000Z" }),
        summary({ sessionId: "permit", status: "awaiting-permit", updatedAt: "2026-08-25T11:00:00.000Z" }),
      ],
    });

    expect(state.order).toEqual(["permit", "new", "old"]);
  });

  it("resets every session and held event", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.message", { messageId: "m1", role: "agent", text: "hello" }),
    });
    state = sessionsReducer(state, { type: "reset" });

    expect(state).toEqual(initialSessionsState);
  });

  it("trims the front per session and records that older history is missing", () => {
    let state = withSummary();
    for (let sequence = 0; sequence < EVENTS_PER_SESSION_CAP + 1; sequence += 1) {
      state = sessionsReducer(state, {
        type: "event",
        event: event(sequence, "session.message", {
          messageId: `message-${sequence}`,
          role: "agent",
          text: String(sequence),
        }),
      });
    }

    const view = state.byId["session-1"];
    expect(view?.events).toHaveLength(EVENTS_PER_SESSION_CAP);
    expect(view?.events[0]?.sequence).toBe(1);
    expect(view?.trimmed).toBe(true);
  });

  it("accumulates multiple deltas under the same messageId into a single string", () => {
    let state = withSummary();
    const msgId = "msg_011CeVKL7iwyLEUSK3vPKYsd:thinking";
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.delta", {
        messageId: msgId,
        kind: "thinking",
        text: "The user wants ",
      }),
    });
    state = sessionsReducer(state, {
      type: "event",
      event: event(2, "session.delta", {
        messageId: msgId,
        kind: "thinking",
        text: "to edit README.",
      }),
    });

    const view = state.byId["session-1"];
    expect(Object.keys(view?.streaming ?? {})).toHaveLength(1);
    expect(view?.streaming[msgId]).toBe("The user wants to edit README.");
  });

  it("clears streaming thinking when tool.started arrives", () => {
    let state = withSummary();
    const thinkingId = "msg_1:thinking";
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.delta", {
        messageId: thinkingId,
        kind: "thinking",
        text: "Let me check the files",
      }),
    });
    expect(state.byId["session-1"]?.streaming[thinkingId]).toBe("Let me check the files");

    state = sessionsReducer(state, {
      type: "event",
      event: event(2, "tool.started", {
        toolCallId: "tool-1",
        tool: "Read",
        target: "README.md",
      }),
    });
    expect(state.byId["session-1"]?.streaming[thinkingId]).toBeUndefined();
  });

  it("clears all streaming buffers when turn.completed or idle status arrives", () => {
    let state = withSummary();
    state = sessionsReducer(state, {
      type: "event",
      event: event(1, "session.delta", {
        messageId: "msg_1",
        kind: "text",
        text: "Some trailing stream",
      }),
    });
    expect(state.byId["session-1"]?.streaming["msg_1"]).toBe("Some trailing stream");

    state = sessionsReducer(state, {
      type: "event",
      event: event(2, "turn.completed", {
        turnId: "turn-1",
        outcome: "success",
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }),
    });
    expect(state.byId["session-1"]?.streaming).toEqual({});
  });
});
