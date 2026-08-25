import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  CityId,
  EffortLevel,
  GameEvent,
  MayorCommand,
  PermissionMode,
  ServerMessage,
  SessionSummary,
} from "@sudo-city/protocol";
import type { ConnectionState } from "@/lib/app-utils";
import {
  initialSessionsState,
  sessionsReducer,
  type SessionsAction,
  type SessionsState,
} from "@/sessions/store";
import { loadStoredSession, storeSessionTail } from "@/sessions/storage";

export interface UseSessionsOptions {
  send: (command: MayorCommand) => void;
  activeRepoKey: string;
  connection: ConnectionState;
  demoLocked?: boolean;
  onDemoGate?: (action: "dispatch" | "permit") => void;
}

export function useSessions({
  send,
  activeRepoKey,
  connection,
  demoLocked = false,
  onDemoGate,
}: UseSessionsOptions) {
  const [state, dispatch] = useReducer(sessionsReducer, initialSessionsState);
  const focusNextOpenedSessionRef = useRef(false);

  const dispatchAction = useCallback((action: SessionsAction) => {
    dispatch(action);
  }, []);

  const handleServerMessage = useCallback((message: ServerMessage): void => {
    switch (message.kind) {
      case "sessions":
        dispatch({ type: "roster", sessions: message.sessions });
        for (const session of message.sessions) {
          dispatch({
            type: "stored",
            sessionId: session.sessionId,
            events: loadStoredSession(activeRepoKey, session.sessionId),
          });
        }
        break;
      case "session":
        dispatch({ type: "summary", session: message.session });
        dispatch({
          type: "stored",
          sessionId: message.session.sessionId,
          events: loadStoredSession(activeRepoKey, message.session.sessionId),
        });
        if (focusNextOpenedSessionRef.current) {
          focusNextOpenedSessionRef.current = false;
          dispatch({ type: "focus", sessionId: message.session.sessionId });
        }
        break;
      case "transcript":
        dispatch({
          type: "transcript",
          sessionId: message.sessionId,
          fromSequence: message.fromSequence,
          events: message.events,
          hasMore: message.hasMore,
        });
        break;
      case "event":
        dispatch({ type: "event", event: message.event });
        break;
      default:
        break;
    }
  }, [activeRepoKey]);

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [activeRepoKey]);

  useEffect(() => {
    for (const view of Object.values(state.byId)) {
      storeSessionTail(activeRepoKey, view.summary.sessionId, view.events);
    }
  }, [activeRepoKey, state.byId]);

  useEffect(() => {
    if (connection !== "online") {
      return;
    }
    send({ type: "session.list" });
  }, [connection, send]);

  useEffect(() => {
    if (connection !== "online" || !state.focusedSessionId) {
      return;
    }
    const view = state.byId[state.focusedSessionId];
    send({
      type: "session.subscribe",
      sessionId: state.focusedSessionId,
      afterSequence: view?.events.at(-1)?.sequence,
    });
  }, [connection, send, state.focusedSessionId]);

  const focusSession = useCallback((sessionId: string): void => {
    const view = state.byId[sessionId];
    if (!view) {
      return;
    }
    dispatch({ type: "focus", sessionId });
    dispatch({ type: "seen", sessionId });
    send({
      type: "session.subscribe",
      sessionId,
      afterSequence: view.events.at(-1)?.sequence,
    });
  }, [send, state.byId]);

  const blurSession = useCallback((): void => {
    const sessionId = state.focusedSessionId;
    if (!sessionId) {
      return;
    }
    send({ type: "session.unsubscribe", sessionId });
    dispatch({ type: "seen", sessionId });
    dispatch({ type: "focus" });
  }, [send, state.focusedSessionId]);

  const openSession = useCallback((
    cityId: CityId,
    prompt: string,
    options: {
      model?: string;
      effort?: EffortLevel;
      permissionMode?: PermissionMode;
      contextPaths?: string[];
      title?: string;
    } = {},
  ): void => {
    if (demoLocked) {
      onDemoGate?.("dispatch");
      return;
    }
    focusNextOpenedSessionRef.current = true;
    send({ type: "session.open", cityId, prompt, ...options });
  }, [demoLocked, onDemoGate, send]);

  const sendToSession = useCallback((
    sessionId: string,
    prompt: string,
    contextPaths: string[] = [],
  ): void => {
    dispatch({
      type: "optimistic",
      sessionId,
      id: `pending:${Date.now()}:${Math.random()}`,
      text: prompt,
      contextPaths,
    });
    send({ type: "session.send", sessionId, prompt, contextPaths });
  }, [send]);

  const interruptSession = useCallback((sessionId: string): void => {
    send({ type: "session.interrupt", sessionId });
  }, [send]);

  const renameSession = useCallback((sessionId: string, title: string): void => {
    send({ type: "session.rename", sessionId, title });
  }, [send]);

  const configureSession = useCallback((
    sessionId: string,
    changes: { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode },
  ): void => {
    send({ type: "session.configure", sessionId, ...changes });
  }, [send]);

  const closeSession = useCallback((sessionId: string): void => {
    send({ type: "session.close", sessionId });
    if (state.focusedSessionId === sessionId) {
      dispatch({ type: "focus" });
    }
  }, [send, state.focusedSessionId]);

  const resolvePermit = useCallback((
    sessionId: string,
    toolCallId: string,
    decision: "allow" | "allow-always" | "deny",
  ): void => {
    if (demoLocked) {
      onDemoGate?.("permit");
      return;
    }
    send({ type: "permit.resolve", sessionId, toolCallId, decision });
  }, [demoLocked, onDemoGate, send]);

  const summaries = useMemo(
    () => state.order.flatMap((sessionId) => {
      const summary = state.byId[sessionId]?.summary;
      return summary ? [summary] : [];
    }),
    [state.byId, state.order],
  );

  const sessionsById = state.byId;
  const runningCount = summaries.filter((summary) =>
    ["starting", "thinking", "working", "compacting"].includes(summary.status),
  ).length;
  const permitCount = summaries.reduce(
    (count, summary) => count + summary.pendingPermitCount,
    0,
  );

  return {
    state,
    dispatch: dispatchAction,
    handleServerMessage,
    sessions: summaries,
    sessionsById,
    focusedSessionId: state.focusedSessionId,
    openSession,
    sendToSession,
    interruptSession,
    renameSession,
    configureSession,
    closeSession,
    focusSession,
    blurSession,
    resolvePermit,
    runningCount,
    permitCount,
    unreadFor: (sessionId: string) => {
      const view = sessionsById[sessionId];
      return view ? Math.max(0, view.summary.lastSequence - view.seenSequence) : 0;
    },
  };
}
