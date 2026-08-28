import { Archive, ArchiveRestore, HardHat } from "lucide-react";
import type { SessionSummary } from "@sudo-city/protocol";
import { crewSpriteUrl, findCrewByModel, getCrewMember } from "@/crew/catalog";
import { presentStatus } from "@/sessions/status";
import { formatUsd } from "./format";
import { cn } from "@/lib/utils";

export type SessionRowAction = "archive" | "unarchive";

export interface SessionRowProps {
  summary: SessionSummary;
  activeCityId: string;
  focused: boolean;
  unread: number;
  action: SessionRowAction;
  onSelect: () => void;
  onAction: () => void;
}

export function SessionRow({
  summary,
  activeCityId,
  focused,
  unread,
  action,
  onSelect,
  onAction,
}: SessionRowProps) {
  const crew = findCrewByModel(summary.model) ?? getCrewMember("sonnet");
  const presentation = presentStatus(summary.status, summary.lastTurnOutcome);
  const ActionIcon = action === "archive" ? Archive : ArchiveRestore;
  const actionLabel = action === "archive" ? "Archive order" : "Unarchive order";
  const isCurrentCity = summary.cityId === activeCityId;

  return (
    <div
      className={cn(
        "group relative w-full cursor-pointer border-b border-border/40 px-1.5 py-2 transition-colors hover:bg-primary/5",
        focused && "bg-primary/10",
        presentation.urgent && "session-row--urgent",
      )}
    >
      <button
        type="button"
        className="pointer-events-none absolute left-1.5 top-1/2 flex size-4 -translate-x-2 -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-label={`${actionLabel}: ${summary.title}`}
        title={actionLabel}
        onClick={onAction}
      >
        <ActionIcon className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="grid w-full min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 pl-0 text-left transition-[padding-left] duration-150 ease-out group-hover:pl-6 group-focus-within:pl-6"
        aria-current={focused ? "true" : undefined}
        onClick={onSelect}
      >
        <img
          src={crewSpriteUrl(crew.id, summary.effort)}
          alt=""
          className="size-6 object-contain [image-rendering:pixelated]"
        />
        <span className="min-w-0">
          <span className="retro block truncate text-[9px] text-foreground transition-colors group-hover:text-primary group-focus-within:text-primary">
            {summary.title}
          </span>
          <span
            className={cn(
              "retro flex items-center gap-1 truncate text-[8px]",
              isCurrentCity ? "text-amber-400" : "text-cyan-400",
            )}
          >
            <HardHat
              className={cn("size-2.5 shrink-0", isCurrentCity ? "text-amber-400" : "text-cyan-400")}
              aria-hidden="true"
            />
            <span className="truncate">SITE · {summary.cityId}</span>
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
    </div>
  );
}
