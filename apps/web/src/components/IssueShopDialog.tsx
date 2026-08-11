import type { Issue } from "@sudo-city/protocol";
import {
  ArrowRight,
  ExternalLink,
  Hammer,
  Search,
  User,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import HudButton from "@/components/hud/HudButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/ui/8bit/styles/retro.css";
import { cn } from "@/lib/utils";

export interface IssueShopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: readonly Issue[];
  activeCityId?: string;
  onTakeIssue: (issue: Issue) => void;
}

function truncatePreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function issueCode(issue: Issue): string {
  return `#${issue.number}`.padStart(4, " ");
}

function FixButton({ onTake }: { onTake: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTake();
      }}
      className="group/btn inline-flex shrink-0 cursor-pointer items-center gap-2 border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 transition-colors hover:border-amber-300 hover:bg-amber-400 hover:text-black"
    >
      <Wrench className="size-3.5 text-amber-300 transition-transform group-hover/btn:rotate-45 group-hover/btn:text-black" aria-hidden="true" />
      <span className="retro text-[8px] leading-4 text-amber-100 group-hover/btn:text-black">
        FIX ISSUE<br />IN CITY
      </span>
      <ArrowRight className="size-3 text-amber-300/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:text-black" aria-hidden="true" />
    </button>
  );
}

function IssueRow({
  issue,
  onTake,
}: {
  issue: Issue;
  onTake: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTake}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onTake();
        }
      }}
      className={cn(
        "airport-destination group relative grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden border border-white/10 bg-white/[0.035] p-3 text-left transition-colors hover:border-amber-300/40 hover:bg-amber-400/[0.08]",
      )}
    >
      <span className="airport-destination-code retro text-amber-300" aria-hidden="true">
        {issueCode(issue)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="retro truncate text-[10px] text-white">{issue.title}</span>
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="text-sky-200/50 hover:text-sky-100"
            onClick={(e) => e.stopPropagation()}
            title="View on GitHub"
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <User className="size-3" aria-hidden="true" />
            @{issue.author}
          </span>
          {issue.body ? (
            <>
              <span aria-hidden="true">•</span>
              <span className="truncate text-slate-400/80">{truncatePreview(issue.body, 90)}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="flex items-center justify-end">
        <FixButton onTake={onTake} />
      </span>
    </div>
  );
}

export default function IssueShopDialog({
  open,
  onOpenChange,
  issues,
  activeCityId = "main",
  onTakeIssue,
}: IssueShopDialogProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return issues;
    return issues.filter((issue) => {
      return (
        issue.title.toLowerCase().includes(needle) ||
        `#${issue.number}`.includes(needle) ||
        issue.author.toLowerCase().includes(needle) ||
        (issue.body && issue.body.toLowerCase().includes(needle))
      );
    });
  }, [issues, query]);

  function handleTake(issue: Issue): void {
    onTakeIssue(issue);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="airport-board max-h-[92dvh] max-w-2xl overflow-hidden border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none">
        <div className="airport-board-header relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
          <div className="relative z-10 flex items-start justify-between gap-5 pr-8">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className="airport-terminal-code retro">CITY-ISSUE</span>
                <span className="retro text-[8px] tracking-[0.24em] text-sky-100/55">
                  CITY ISSUE BAZAAR
                </span>
              </div>
              <DialogTitle className="flex items-center gap-2.5 text-left">
                <span className="airport-icon-grid">
                  <Wrench className="size-5" aria-hidden="true" />
                </span>
                <span className="retro text-sm text-amber-200 sm:text-base">
                  Choose a city issue to fix
                </span>
              </DialogTitle>
              <DialogDescription className="max-w-xl text-xs leading-5 text-sky-100/55">
                Select an open city issue to read the full report, then send it to the mayor's order box to dispatch a fix.
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <label className="airport-search relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sky-200/55"
              aria-hidden="true"
            />
            <span className="sr-only">Search open city issues</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH ISSUES BY TITLE, #NUMBER, OR AUTHOR"
              className="retro w-full border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[9px] text-white outline-none placeholder:text-slate-500 focus:border-amber-300/60"
            />
          </label>

          <div className="flex max-h-[23rem] flex-col gap-2 overflow-y-auto pr-1">
            {issues.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.025] p-8 text-center">
                <Hammer className="size-6 text-slate-500" aria-hidden="true" />
                <p className="retro text-[9px] text-muted-foreground">
                  No open city issues found for this repository.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="retro border border-white/10 p-5 text-center text-[9px] text-muted-foreground">
                No issue matches “{query}”.
              </p>
            ) : (
              filtered.map((issue) => (
                <IssueRow
                  key={issue.number}
                  issue={issue}
                  onTake={() => handleTake(issue)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[8px]">
            <span className="retro text-sky-200/55">
              {issues.length} OPEN {issues.length === 1 ? "ISSUE" : "ISSUES"} AVAILABLE
            </span>
            <HudButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              CLOSE BOARD
            </HudButton>
          </div>
        </div>

        <div className="airport-runway-bar" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
      </DialogContent>
    </Dialog>
  );
}
