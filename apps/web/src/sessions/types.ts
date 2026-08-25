import type {
  FileChangeKind,
  GameEvent,
  SessionSummary,
  TurnOutcome,
} from "@sudo-city/protocol";

/** A derived transcript row. The server event stream remains the source of truth. */
export type ChatItem =
  | { kind: "mayor"; id: string; sequence: number; text: string; contextPaths: string[] }
  | { kind: "crew"; id: string; sequence: number; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; sequence: number; text: string; streaming: boolean }
  | { kind: "notice"; id: string; sequence: number; text: string; tone: "info" | "error" }
  | {
      kind: "tool";
      id: string;
      sequence: number;
      toolCallId: string;
      tool: string;
      target?: string;
      title?: string;
      input?: Record<string, unknown>;
      status: "running" | "success" | "error" | "denied" | "interrupted";
      durationMs?: number;
      resultPreview?: string;
    }
  | {
      kind: "permit";
      id: string;
      sequence: number;
      toolCallId: string;
      tool: string;
      message: string;
      input: Record<string, unknown>;
      decision?: "allow" | "allow-always" | "deny" | "expired";
    }
  | {
      kind: "turn";
      id: string;
      sequence: number;
      outcome: TurnOutcome;
      costUsd: number;
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
      detail?: string;
    }
  | {
      kind: "compaction";
      id: string;
      sequence: number;
      preTokens?: number;
      postTokens?: number;
    }
  | { kind: "file"; id: string; sequence: number; path: string; change: FileChangeKind }
  | { kind: "subagent"; id: string; sequence: number; agentType: string; running: boolean }
  | { kind: "task"; id: string; sequence: number; subject: string; done: boolean };

export interface PendingSessionMessage {
  id: string;
  text: string;
  contextPaths: string[];
}

export interface SessionView {
  summary: SessionSummary;
  events: GameEvent[];
  streaming: Record<string, string>;
  seenSequence: number;
  hydrated: boolean;
  pending: PendingSessionMessage[];
  /** True when the in-memory cap or a server page omitted older events. */
  trimmed: boolean;
  /** Internal dedupe set kept outside the serialised event arrays. */
  eventIds: Set<string>;
}
