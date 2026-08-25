import type { SessionStatus, TurnOutcome } from "@sudo-city/protocol";

export interface StatusPresentation {
  label: string;
  tone: string;
  live: boolean;
  urgent: boolean;
}

export function presentStatus(
  status: SessionStatus,
  outcome?: TurnOutcome,
): StatusPresentation {
  switch (status) {
    case "starting":
      return { label: "WAKING", tone: "--color-ink-muted", live: true, urgent: false };
    case "thinking":
      return { label: "THINKING", tone: "--color-accent", live: true, urgent: false };
    case "working":
      return { label: "RUNNING", tone: "--color-accent", live: true, urgent: false };
    case "awaiting-permit":
      return { label: "PERMIT", tone: "--color-accent-strong", live: true, urgent: true };
    case "compacting":
      return { label: "PACKING", tone: "--color-ink-muted", live: true, urgent: false };
    case "idle":
      if (outcome === "success") {
        return { label: "DONE", tone: "--color-signal", live: false, urgent: false };
      }
      if (outcome === "max-turns") {
        return { label: "PAUSED", tone: "--color-accent", live: false, urgent: false };
      }
      return { label: "IDLE", tone: "--color-ink-muted", live: false, urgent: false };
    case "failed":
      return { label: "FAILED", tone: "--color-danger", live: false, urgent: false };
    case "interrupted":
      return { label: "HALTED", tone: "--color-ink-muted", live: false, urgent: false };
    case "closed":
      return { label: "CLOSED", tone: "--color-rule", live: false, urgent: false };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
