import { Check, Copy, MoreHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionSummary } from "@sudo-city/protocol";
import { HudButton } from "@/components/hud/HudButton";
import { HudMeter } from "@/components/hud/HudMeter";
import { crewSpriteUrl, findCrewByModel, getCrewMember, effortLabel } from "@/crew/catalog";
import { presentStatus } from "@/sessions/status";
import { formatUsd } from "./format";
import { SessionStatusLamp } from "./SessionStatusLamp";

export interface SessionHeaderProps {
  summary: SessionSummary;
  onRename: (title: string) => void;
  onClose: () => void;
  onCopyTranscript: () => void;
}

export function SessionHeader({
  summary,
  onRename,
  onClose,
  onCopyTranscript,
}: SessionHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.title);
  const crew = findCrewByModel(summary.model) ?? getCrewMember("sonnet");
  const presentation = presentStatus(summary.status, summary.lastTurnOutcome);

  useEffect(() => {
    if (!editing) setDraft(summary.title);
  }, [editing, summary.title]);

  function commitRename(): void {
    const title = draft.trim();
    if (title && title !== summary.title) onRename(title);
    setEditing(false);
  }

  return (
    <header className="grid gap-2 border-b-2 border-border/60 bg-background/70 px-3 py-2">
      <div className="flex items-start gap-2">
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
              className="retro block max-w-full truncate text-left text-[11px] text-foreground hover:text-primary"
              onClick={() => setEditing(true)}
              title="Rename session"
            >
              {summary.title}
            </button>
          )}
          <span className="retro text-[8px] text-muted-foreground">
            {presentation.label} · {crew.name} · {summary.model} · {effortLabel(summary.effort)}
          </span>
        </div>
        <img
          src={crewSpriteUrl(crew.id, summary.effort)}
          alt=""
          className="size-9 object-contain [image-rendering:pixelated]"
        />
        <details className="relative">
          <summary className="flex size-6 cursor-pointer list-none items-center justify-center border border-border/60 text-muted-foreground hover:border-primary hover:text-primary">
            <MoreHorizontal className="size-3" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-7 z-10 grid min-w-36 gap-1 border border-border bg-background p-1 shadow-xl">
            <button type="button" className="retro px-2 py-1 text-left text-[8px] hover:bg-primary/10" onClick={() => setEditing(true)}>
              Rename
            </button>
            <button type="button" className="retro flex items-center gap-1 px-2 py-1 text-left text-[8px] hover:bg-primary/10" onClick={onCopyTranscript}>
              <Copy className="size-2.5" aria-hidden="true" /> Copy transcript
            </button>
            <button type="button" className="retro flex items-center gap-1 px-2 py-1 text-left text-[8px] text-destructive hover:bg-destructive/10" onClick={onClose}>
              <X className="size-2.5" aria-hidden="true" /> Close session
            </button>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-pill">{summary.cityId}</span>
        {summary.readOnly ? <span className="hud-pill text-primary">Review only</span> : null}
        <HudMeter
          className="min-w-32 flex-1"
          label="Context"
          readout={summary.contextPercent === undefined ? "—" : `${Math.round(summary.contextPercent)}%`}
          value={summary.contextPercent ?? 0}
          tone={`var(${presentation.tone})`}
        />
        <span className="retro text-[8px] text-muted-foreground">
          {formatUsd(summary.costUsd)}
        </span>
      </div>
    </header>
  );
}
