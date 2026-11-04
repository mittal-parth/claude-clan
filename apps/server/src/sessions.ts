import {
  RUNNING_SESSION_STATUSES,
  SESSION_TITLE_LIMIT,
  type CityId,
  type EffortLevel,
  type PermissionMode,
  type SessionStatus,
  type SessionSummary,
  type TurnOutcome,
} from "@sudo-city/protocol";
import type { SessionRunner } from "@sudo-city/agent";
import type { SessionRecord } from "@sudo-city/world";

export const MAX_RUNNING_SESSIONS_PER_WORKSPACE = 3;
export const MAX_SESSIONS_PER_CITY = 25;

export interface QueuedTurn {
  prompt: string;
  contextPaths: string[];
}

export interface SessionState {
  readonly sessionId: string;
  readonly cityId: CityId;
  readonly readOnly: boolean;
  title: string;
  autoTitled: boolean;
  model: string;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  status: SessionStatus;
  lastTurnOutcome?: TurnOutcome;
  sequence: number;
  turnCount: number;
  costUsd: number;
  apiKeySource?: string;
  apiProvider?: string;
  contextPercent?: number;
  pendingPermits: Set<string>;
  activityLine?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  queued: QueuedTurn[];
  runner?: SessionRunner;
}

/**
 * The title shown in the roster is the first useful line of the order. It is
 * clipped at a word boundary because a prompt pasted from a ticket should not
 * turn a compact HUD row into a paragraph.
 */
export function autoTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return "Untitled order";
  }
  if (firstLine.length <= SESSION_TITLE_LIMIT) {
    return firstLine;
  }
  const clipped = firstLine.slice(0, SESSION_TITLE_LIMIT);
  const lastSpace = clipped.lastIndexOf(" ");
  const title = lastSpace > SESSION_TITLE_LIMIT / 2
    ? clipped.slice(0, lastSpace)
    : clipped;
  return `${title.trimEnd()}…`;
}

export function sessionToRecord(session: SessionState): SessionRecord {
  return {
    sessionId: session.sessionId,
    cityId: session.cityId,
    title: session.title,
    autoTitled: session.autoTitled,
    model: session.model,
    effort: session.effort,
    permissionMode: session.permissionMode,
    status: session.status,
    lastTurnOutcome: session.lastTurnOutcome,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.turnCount,
    costUsd: session.costUsd,
    sequence: session.sequence,
    readOnly: session.readOnly,
    closedAt: session.closedAt,
  };
}

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionState>();

  add(state: SessionState): void {
    if (this.sessions.has(state.sessionId)) {
      throw new Error(`Session ${state.sessionId} already exists`);
    }
    this.sessions.set(state.sessionId, state);
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  list(cityId?: CityId): SessionState[] {
    return [...this.sessions.values()]
      .filter((session) => cityId === undefined || session.cityId === cityId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  runningCount(): number {
    return this.list().filter((session) =>
      (RUNNING_SESSION_STATUSES as readonly string[]).includes(session.status),
    ).length;
  }

  countForCity(cityId: CityId): number {
    return this.list(cityId).length;
  }

  summaries(cityId?: CityId): SessionSummary[] {
    return this.list(cityId).map((session) => ({
      sessionId: session.sessionId,
      cityId: session.cityId,
      title: session.title,
      autoTitled: session.autoTitled,
      status: session.status,
      lastTurnOutcome: session.lastTurnOutcome,
      model: session.model,
      effort: session.effort,
      permissionMode: session.permissionMode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
      costUsd: session.costUsd,
      ...(session.apiKeySource ? { apiKeySource: session.apiKeySource } : {}),
      ...(session.apiProvider ? { apiProvider: session.apiProvider } : {}),
      contextPercent: session.contextPercent,
      pendingPermitCount: session.pendingPermits.size,
      queuedCount: session.queued.length,
      live: session.runner?.isLive() ?? false,
      readOnly: session.readOnly,
      activityLine: session.activityLine,
      lastSequence: session.sequence,
    }));
  }
}
