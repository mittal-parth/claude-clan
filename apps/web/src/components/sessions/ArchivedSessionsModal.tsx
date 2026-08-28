import { useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "@sudo-city/protocol";
import { ArrowLeft, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { findCrewByModel } from "@/crew/catalog";
import { SessionRow } from "./SessionRow";

export interface ArchivedSessionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionSummary[];
  activeCityId: string;
  unreadFor: (sessionId: string) => number;
  onUnarchive: (sessionId: string) => void;
}

export function filterArchivedSessions(
  sessions: readonly SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter((summary) => {
    const crew = findCrewByModel(summary.model);
    return (
      summary.title.toLowerCase().includes(needle) ||
      summary.cityId.toLowerCase().includes(needle) ||
      summary.sessionId.toLowerCase().includes(needle) ||
      summary.model.toLowerCase().includes(needle) ||
      (crew?.name ? crew.name.toLowerCase().includes(needle) : false) ||
      (summary.activityLine ? summary.activityLine.toLowerCase().includes(needle) : false)
    );
  });
}

export function ArchivedSessionsModal({
  open,
  onOpenChange,
  sessions,
  activeCityId,
  unreadFor,
  onUnarchive,
}: ArchivedSessionsModalProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const filteredSessions = useMemo(
    () => filterArchivedSessions(sessions, query),
    [sessions, query],
  );

  function restore(sessionId: string): void {
    onOpenChange(false);
    onUnarchive(sessionId);
  }

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="right"
        hideCloseButton
        hideOverlay
        className="grid-rows-[auto_minmax(0,1fr)] gap-0"
      >
        <span aria-hidden="true" className="hud-window__frame" />
        <header className="relative z-10 grid gap-2 border-b-2 border-border/50 bg-background/40 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center border border-border/60 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={() => onOpenChange(false)}
              title="Back to console"
              aria-label="Back to console"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <DialogTitle className="retro text-[9px] text-foreground uppercase tracking-wide">
                  Archived orders
                </DialogTitle>
                {sessions.length > 0 ? (
                  <span className="hud-pill text-[7px]">
                    {query.trim()
                      ? `${filteredSessions.length}/${sessions.length}`
                      : `${sessions.length}`}
                  </span>
                ) : null}
              </div>
              <DialogDescription className="retro text-[7.5px] text-muted-foreground block truncate">
                Restore an order to return it to the live roster.
              </DialogDescription>
            </div>
          </div>
          <div className="hud-field flex items-center gap-1.5">
            <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="Search archived orders..."
              className="hud-field__input retro text-[8px] placeholder:text-[8px]"
              aria-label="Search archived orders"
            />
            {query ? (
              <button
                type="button"
                className="flex size-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </header>
        <div className="relative min-h-0 overflow-y-auto px-2.5 py-2">
          {sessions.length === 0 ? (
            <p className="retro px-2 py-8 text-center text-[9px] text-muted-foreground">
              No archived orders.
            </p>
          ) : filteredSessions.length === 0 ? (
            <p className="retro px-2 py-8 text-center text-[9px] text-muted-foreground">
              No archived orders match “{query}”.
            </p>
          ) : (
            <div>
              {filteredSessions.map((summary) => (
                <SessionRow
                  key={summary.sessionId}
                  summary={summary}
                  activeCityId={activeCityId}
                  focused={false}
                  unread={unreadFor(summary.sessionId)}
                  action="unarchive"
                  onSelect={() => restore(summary.sessionId)}
                  onAction={() => restore(summary.sessionId)}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
