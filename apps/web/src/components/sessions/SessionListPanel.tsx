import { Archive } from "lucide-react";
import type { SessionSummary } from "@sudo-city/protocol";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionRow } from "./SessionRow";

export interface SessionListPanelProps {
  sessions: SessionSummary[];
  activeCityId: string;
  focusedSessionId?: string;
  runningCount: number;
  permitCount: number;
  unreadFor: (sessionId: string) => number;
  onSelect: (sessionId: string) => void;
  onArchive: (sessionId: string) => void;
  onOpenArchived: () => void;
}

export function SessionListPanel({
  sessions,
  activeCityId,
  focusedSessionId,
  runningCount,
  permitCount,
  unreadFor,
  onSelect,
  onArchive,
  onOpenArchived,
}: SessionListPanelProps) {
  const counts = [
    runningCount > 0 ? `${runningCount} running` : undefined,
    permitCount > 0 ? `${permitCount} permit` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border/50 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label">Orders</span>
        <div className="flex items-center gap-2">
          {counts ? <span className="hud-pill">{counts}</span> : null}
          {permitCount > 0 ? (
            <span className="hud-pill bg-primary text-primary-foreground">
              {permitCount} waiting
            </span>
          ) : null}
          <button
            type="button"
            className="retro inline-flex cursor-pointer items-center gap-1 text-[8px] uppercase text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary"
            onClick={onOpenArchived}
            title="Open archived orders"
          >
            <Archive className="size-3" aria-hidden="true" />
            Archive
          </button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 pr-1">
        {sessions.length > 0 ? (
          <div>
            {sessions.map((summary) => (
              <SessionRow
                key={summary.sessionId}
                summary={summary}
                activeCityId={activeCityId}
                focused={summary.sessionId === focusedSessionId}
                unread={unreadFor(summary.sessionId)}
                action="archive"
                onSelect={() => onSelect(summary.sessionId)}
                onAction={() => onArchive(summary.sessionId)}
              />
            ))}
          </div>
        ) : (
          <p className="retro px-1 py-4 text-center text-[8px] text-muted-foreground">
            No crews on duty.
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
