import type { SessionStatus, TurnOutcome } from "@sudo-city/protocol";
import { cn } from "@/lib/utils";
import { presentStatus } from "@/sessions/status";

export interface SessionStatusLampProps {
  status: SessionStatus;
  outcome?: TurnOutcome;
  className?: string;
}

export function SessionStatusLamp({
  status,
  outcome,
  className,
}: SessionStatusLampProps) {
  const presentation = presentStatus(status, outcome);
  return (
    <span
      aria-label={presentation.label}
      className={cn(
        "inline-block size-2 shrink-0 border border-foreground/40",
        presentation.live && "hud-dot--live",
        className,
      )}
      data-urgent={presentation.urgent || undefined}
      style={{ backgroundColor: `var(${presentation.tone})` }}
      title={presentation.label}
    />
  );
}
