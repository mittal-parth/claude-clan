import type { GameEvent, MayorCommand, SessionSummary } from "@sudo-city/protocol";
import type { PendingSessionMessage, SessionView } from "./types";

export const EVENTS_PER_SESSION_CAP = 400;

export interface SessionsState {
  /** Session id → view, including sessions in cities other than the active one. */
  byId: Record<string, SessionView>;
  /** Awaiting permits first, then newest activity. */
  order: string[];
  focusedSessionId?: string;
  /** Events may arrive before the roster summary which introduces their session. */
  holding: Record<string, GameEvent[]>;
}

export type SessionsAction =
  | { type: "roster"; sessions: SessionSummary[] }
  | { type: "summary"; session: SessionSummary }
  | { type: "event"; event: GameEvent }
  | {
      type: "transcript";
      sessionId: string;
      fromSequence: number;
      events: GameEvent[];
      hasMore: boolean;
    }
  | { type: "stored"; sessionId: string; events: GameEvent[] }
  | { type: "focus"; sessionId?: string }
  | { type: "seen"; sessionId: string }
  | { type: "optimistic"; sessionId: string; id: string; text: string; contextPaths: string[] }
  | { type: "reset" };

export const initialSessionsState: SessionsState = {
  byId: {},
  order: [],
  holding: {},
};

function isWorldSession(sessionId: string): boolean {
  return sessionId.startsWith("world:");
}

function orderSessions(byId: Record<string, SessionView>): string[] {
  return Object.values(byId)
    .sort((left, right) => {
      const leftUrgent = left.summary.status === "awaiting-permit" ? 1 : 0;
      const rightUrgent = right.summary.status === "awaiting-permit" ? 1 : 0;
      return rightUrgent - leftUrgent ||
        right.summary.updatedAt.localeCompare(left.summary.updatedAt);
    })
    .map((view) => view.summary.sessionId);
}

function createView(summary: SessionSummary): SessionView {
  return {
    summary,
    events: [],
    streaming: {},
    seenSequence: 0,
    hydrated: false,
    pending: [],
    trimmed: false,
    eventIds: new Set(),
  };
}

function cloneView(view: SessionView): SessionView {
  return {
    ...view,
    events: [...view.events],
    streaming: { ...view.streaming },
    pending: [...view.pending],
    eventIds: new Set(view.eventIds),
  };
}

function eventExists(view: SessionView, event: GameEvent): boolean {
  return view.eventIds.has(event.id);
}

function mergeEvents(
  view: SessionView,
  incoming: readonly GameEvent[],
  replace: boolean,
): SessionView {
  const next = cloneView(view);
  if (replace) {
    next.events = [];
    next.eventIds.clear();
  }
  for (const event of incoming) {
    if (event.type === "session.delta") {
      if (eventExists(next, event)) {
        continue;
      }
      next.eventIds.add(event.id);
      next.streaming[event.messageId] = `${next.streaming[event.messageId] ?? ""}${event.text}`;
      continue;
    }
    if (eventExists(next, event)) {
      continue;
    }
    next.eventIds.add(event.id);
    next.events.push(event);
    if (event.type === "session.message") {
      delete next.streaming[event.messageId];
      delete next.streaming[`${event.messageId}:thinking`];
      if (event.role === "mayor") {
        next.pending = next.pending.filter((pending) => pending.text !== event.text);
      }
    }
  }
  next.events.sort((left, right) => left.sequence - right.sequence);
  if (next.events.length > EVENTS_PER_SESSION_CAP) {
    next.events = next.events.slice(-EVENTS_PER_SESSION_CAP);
    next.trimmed = true;
  }
  next.seenSequence = Math.max(
    next.seenSequence,
    ...next.events.map((event) => event.sequence),
  );
  return next;
}

function applyHeld(
  byId: Record<string, SessionView>,
  holding: Record<string, GameEvent[]>,
  sessionId: string,
): void {
  const view = byId[sessionId];
  const events = holding[sessionId];
  if (!view || !events) {
    return;
  }
  byId[sessionId] = mergeEvents(view, events, false);
  delete holding[sessionId];
}

function withOrder(state: SessionsState, byId: Record<string, SessionView>): SessionsState {
  return { ...state, byId, order: orderSessions(byId) };
}

export function sessionsReducer(
  state: SessionsState,
  action: SessionsAction,
): SessionsState {
  switch (action.type) {
    case "reset":
      return initialSessionsState;
    case "roster": {
      const byId: Record<string, SessionView> = {};
      for (const summary of action.sessions) {
        if (!isWorldSession(summary.sessionId)) {
          const existing = state.byId[summary.sessionId];
          byId[summary.sessionId] = existing
            ? { ...existing, summary }
            : createView(summary);
        }
      }
      const holding = { ...state.holding };
      for (const sessionId of Object.keys(byId)) {
        applyHeld(byId, holding, sessionId);
      }
      return withOrder({ ...state, holding }, byId);
    }
    case "summary": {
      if (isWorldSession(action.session.sessionId)) {
        return state;
      }
      const byId = { ...state.byId };
      const existing = byId[action.session.sessionId];
      byId[action.session.sessionId] = existing
        ? { ...existing, summary: action.session }
        : createView(action.session);
      const holding = { ...state.holding };
      applyHeld(byId, holding, action.session.sessionId);
      return withOrder({ ...state, holding }, byId);
    }
    case "event": {
      const { event } = action;
      if (isWorldSession(event.sessionId)) {
        return state;
      }
      const existing = state.byId[event.sessionId];
      if (!existing) {
        const holdingEvents = [...(state.holding[event.sessionId] ?? [])];
        if (!holdingEvents.some((held) => held.id === event.id)) {
          holdingEvents.push(event);
        }
        return {
          ...state,
          holding: { ...state.holding, [event.sessionId]: holdingEvents },
        };
      }
      const view = mergeEvents(existing, [event], false);
      return withOrder(
        state,
        { ...state.byId, [event.sessionId]: view },
      );
    }
    case "transcript": {
      if (isWorldSession(action.sessionId)) {
        return state;
      }
      const existing = state.byId[action.sessionId];
      if (!existing) {
        return {
          ...state,
          holding: {
            ...state.holding,
            [action.sessionId]: [
              ...(state.holding[action.sessionId] ?? []),
              ...action.events,
            ],
          },
        };
      }
      const view = mergeEvents(existing, action.events, action.fromSequence === 0);
      view.hydrated = true;
      view.trimmed = view.trimmed || action.hasMore;
      return withOrder(
        state,
        { ...state.byId, [action.sessionId]: view },
      );
    }
    case "stored": {
      const existing = state.byId[action.sessionId];
      if (!existing || isWorldSession(action.sessionId)) {
        return state;
      }
      const view = mergeEvents(existing, action.events, false);
      return { ...state, byId: { ...state.byId, [action.sessionId]: view } };
    }
    case "focus":
      return { ...state, focusedSessionId: action.sessionId };
    case "seen": {
      const view = state.byId[action.sessionId];
      if (!view) {
        return state;
      }
      const next = cloneView(view);
      next.seenSequence = next.events.at(-1)?.sequence ?? next.seenSequence;
      return { ...state, byId: { ...state.byId, [action.sessionId]: next } };
    }
    case "optimistic": {
      const view = state.byId[action.sessionId];
      if (!view) {
        return state;
      }
      const next = cloneView(view);
      const pending: PendingSessionMessage = {
        id: action.id,
        text: action.text,
        contextPaths: [...action.contextPaths],
      };
      next.pending.push(pending);
      return { ...state, byId: { ...state.byId, [action.sessionId]: next } };
    }
  }
}

export function sessionCommands(
  send: (command: MayorCommand) => void,
  state: SessionsState,
) {
  return {
    send,
    state,
  };
}
