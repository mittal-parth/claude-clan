import type { SessionSummary } from "@sudo-city/protocol";
import { cn } from "@/lib/utils";
import {
  crewSpriteUrl,
  findCrewByModel,
  getCrewMember,
  effortLabel,
} from "@/crew/catalog";
import { presentStatus } from "@/sessions/status";
import { formatUsd } from "./format";
import { SessionStatusLamp } from "./SessionStatusLamp";

export interface SessionRowProps {
  summary: SessionSummary;
  activeCityId: string;
  focused: boolean;
  unread: number;
  onSelect: () => void;
}

export function SessionRow({
  summary,
  activeCityId,
  focused,
  unread,
  onSelect,
}: SessionRowProps) {
  const crew = findCrewByModel(summary.model) ?? getCrewMember("sonnet");
  const presentation = presentStatus(summary.status, summary.lastTurnOutcome);

  return (
    <button
      type="button"
      className={cn(
        "group grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 border-b border-border/40 px-1.5 py-2 text-left transition-colors hover:bg-primary/5",
        focused && "bg-primary/10",
        presentation.urgent && "session-row--urgent",
      )}
      aria-current={focused ? "true" : undefined}
      onClick={onSelect}
    >
      <SessionStatusLamp
        status={summary.status}
        outcome={summary.lastTurnOutcome}
      />
      <img
        src={crewSpriteUrl(crew.id, summary.effort)}
        alt=""
        className="size-6 object-contain [image-rendering:pixelated]"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="retro min-w-0 truncate text-[9px] text-foreground">
            {summary.title}
          </span>
          {summary.cityId !== activeCityId ? (
            <span className="hud-pill shrink-0 px-1 py-0 text-[7px]">
              {summary.cityId}
            </span>
          ) : null}
        </span>
        <span className="retro block truncate text-[8px] text-muted-foreground">
          {summary.activityLine ?? `${crew.name} · ${effortLabel(summary.effort)}`}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span className="flex items-center gap-1">
          <span className="retro text-[7px] text-muted-foreground">
            {presentation.label}
          </span>
          {unread > 0 ? (
            <span className="hud-pill bg-primary px-1 py-0 text-[7px] text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>
        <span className="retro text-[8px] text-muted-foreground">
          {formatUsd(summary.costUsd)}
        </span>
      </span>
    </button>
  );
}
