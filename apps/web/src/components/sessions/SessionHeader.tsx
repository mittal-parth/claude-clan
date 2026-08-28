import { ArrowLeft, HardHat } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionSummary } from "@sudo-city/protocol";
import { HudMeter } from "@/components/hud/HudMeter";
import { crewSpriteUrl, findCrewByModel, getCrewMember } from "@/crew/catalog";
import { presentStatus } from "@/sessions/status";
import { formatUsd } from "./format";
import { SessionStatusLamp } from "./SessionStatusLamp";
import { cn } from "@/lib/utils";

export interface SessionHeaderProps {
  summary: SessionSummary;
  activeCityId?: string;
  onRename: (title: string) => void;
  onClose: () => void;
  onCopyTranscript?: () => void;
  onTravel?: (cityId: string) => void;
}

export function SessionHeader({
  summary,
  activeCityId,
  onRename,
  onClose,
  onTravel,
}: SessionHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.title);
  const crew = findCrewByModel(summary.model) ?? getCrewMember("sonnet");
  const presentation = presentStatus(summary.status, summary.lastTurnOutcome);
  const isCurrentCity = !activeCityId || summary.cityId === activeCityId;

  useEffect(() => {
    if (!editing) setDraft(summary.title);
  }, [editing, summary.title]);

  function commitRename(): void {
    const title = draft.trim();
    if (title && title !== summary.title) onRename(title);
    setEditing(false);
  }

  return (
    <header className="relative z-10 grid gap-1.5 border-b-2 border-border/50 bg-background/40 px-2.5 py-2 min-w-0 max-w-full overflow-hidden">
      <div
        aria-hidden="true"
        className="-mx-2.5 -mt-2 h-1 bg-[repeating-linear-gradient(45deg,#f59e0b_0,#f59e0b_6px,#18181b_6px,#18181b_12px)] opacity-75"
      />
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center border border-border/60 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          onClick={onClose}
          title="Back to console"
          aria-label="Back to console"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
        </button>
        <SessionStatusLamp status={summary.status} outcome={summary.lastTurnOutcome} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              className="hud-field__input retro w-full border border-primary px-1 text-[10px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") {
                  setDraft(summary.title);
                  setEditing(false);
                }
              }}
              onBlur={commitRename}
            />
          ) : (
            <button
              type="button"
              className="retro block max-w-full truncate text-left text-[10px] text-foreground hover:text-primary leading-tight"
              onClick={() => setEditing(true)}
              title="Rename order"
            >
              {summary.title}
            </button>
          )}
          <div className="flex items-center gap-1.5 min-w-0 truncate leading-tight mt-0.5">
            <span
              className="retro text-[8px] shrink-0 font-medium"
              style={{ color: `var(${presentation.tone})` }}
            >
              {presentation.label}
            </span>
            <span className="text-[8px] text-muted-foreground shrink-0">·</span>
            {!isCurrentCity && onTravel ? (
              <button
                type="button"
                className="retro text-[8px] truncate inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer transition-colors"
                onClick={() => onTravel(summary.cityId)}
                title={`Teleport to ${summary.cityId}`}
              >
                <HardHat className="size-2.5 shrink-0 text-cyan-400" aria-hidden="true" />
                SITE · {summary.cityId}
              </button>
            ) : (
              <span
                className={cn(
                  "retro text-[8px] truncate inline-flex items-center gap-1",
                  isCurrentCity ? "text-amber-400" : "text-cyan-400",
                )}
              >
                <HardHat
                  className={cn("size-2.5 shrink-0", isCurrentCity ? "text-amber-400" : "text-cyan-400")}
                  aria-hidden="true"
                />
                SITE · {summary.cityId}
              </span>
            )}
            <span className="text-[8px] text-muted-foreground shrink-0">·</span>
            <span className="retro text-[8px] text-muted-foreground shrink-0 whitespace-nowrap">
              {formatUsd(summary.costUsd)}
            </span>
          </div>
        </div>
        <img
          src={crewSpriteUrl(crew.id, summary.effort)}
          alt=""
          className="size-8 shrink-0 object-contain [image-rendering:pixelated]"
        />
      </div>
      <div className="flex items-center gap-1.5 pt-0.5 min-w-0 max-w-full">
        {summary.readOnly ? <span className="hud-pill shrink-0 px-1 py-0 text-[7px] text-primary">Review</span> : null}
        <div className="min-w-0 flex-1">
          <HudMeter
            className="w-full"
            label="Context"
            readout={summary.contextPercent === undefined ? "—" : `${Math.round(summary.contextPercent)}%`}
            value={summary.contextPercent ?? 0}
            tone="#f59e0b"
          />
        </div>
      </div>
    </header>
  );
}
