import type { CitySummary } from "@sudo-city/protocol";
import {
  ArrowRight,
  ExternalLink,
  Search,
  User,
  Anchor
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

export interface PrShopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prs: readonly CitySummary[];
  activeCityId?: string;
  onTakePr: (pr: CitySummary) => void;
}

function prCode(pr: CitySummary): string {
  return `#${pr.number ?? '---'}`.padStart(5, " ");
}

function PrRow({
  pr,
  onTake,
}: {
  pr: CitySummary;
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
        "airport-destination group relative grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden border border-white/10 bg-white/[0.035] p-3 text-left transition-colors hover:border-sky-300/40 hover:bg-sky-400/[0.08]",
      )}
    >
      <span className="airport-destination-code retro text-sky-300" aria-hidden="true">
        {prCode(pr)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="retro truncate text-[10px] text-white">{pr.title}</span>
          {pr.url && (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="text-sky-200/50 hover:text-sky-100"
              onClick={(e) => e.stopPropagation()}
              title="View on GitHub"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <User className="size-3" aria-hidden="true" />
            @{pr.author ?? 'unknown'}
          </span>
          <span aria-hidden="true">•</span>
          <span className="truncate text-slate-400/80">{pr.ref}</span>
        </span>
      </span>
      <span className="flex items-center justify-end">
        <button
          type="button"
          onClick={onTake}
          className="group/btn inline-flex cursor-pointer items-center gap-2 border border-sky-300/30 bg-sky-400/10 px-3 py-1.5 transition-colors hover:border-sky-300 hover:bg-sky-400 hover:text-black"
        >
          <Anchor className="size-3.5 text-sky-300 transition-transform group-hover/btn:-rotate-12 group-hover/btn:text-black" aria-hidden="true" />
          <span className="retro text-[8px] leading-4 text-sky-100 group-hover/btn:text-black">
            ATTACK<br />THIS PR
          </span>
          <ArrowRight className="size-3 text-sky-300/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:text-black" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export default function PrShopDialog({
  open,
  onOpenChange,
  prs,
  activeCityId = "main",
  onTakePr,
}: PrShopDialogProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return prs;
    return prs.filter((pr) => {
      return (
        pr.title.toLowerCase().includes(needle) ||
        `#${pr.number}`.includes(needle) ||
        (pr.author && pr.author.toLowerCase().includes(needle))
      );
    });
  }, [prs, query]);

  function handleTake(pr: CitySummary): void {
    onTakePr(pr);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="airport-board max-h-[92dvh] max-w-2xl overflow-hidden border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none">
        <div className="airport-board-header relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
          <div className="relative z-10 flex items-start justify-between gap-5 pr-8">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className="airport-terminal-code retro text-sky-300 border-sky-300">CITY-PR</span>
                <span className="retro text-[8px] tracking-[0.24em] text-sky-100/55">
                  NAVAL FLEET · TARGETS FOR REVIEW
                </span>
              </div>
              <DialogTitle className="flex items-center gap-2.5 text-left">
                <span className="airport-icon-grid">
                  <Anchor className="size-5 text-sky-300" aria-hidden="true" />
                </span>
                <span className="retro text-sm text-sky-200 sm:text-base">
                  Pick a Pull Request to Attack
                </span>
              </DialogTitle>
              <DialogDescription className="max-w-xl text-xs leading-5 text-sky-100/55">
                Someone else's work, spotted offshore. Send the battleship to blockade its worktree city and put the diff through review — approve it, sink it with changes requested, or just scout the damage.
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
            <span className="sr-only">Search PRs to attack</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH TARGETS BY TITLE, #NUMBER, OR AUTHOR"
              className="retro w-full border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[9px] text-white outline-none placeholder:text-slate-500 focus:border-sky-300/60"
            />
          </label>

          <div className="flex max-h-[23rem] flex-col gap-2 overflow-y-auto pr-1">
            {prs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.025] p-8 text-center">
                <Anchor className="size-6 text-slate-500" aria-hidden="true" />
                <p className="retro text-[9px] text-muted-foreground">
                  No enemy PRs on the horizon. The fleet stands down.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="retro border border-white/10 p-5 text-center text-[9px] text-muted-foreground">
                No target matches “{query}”.
              </p>
            ) : (
              filtered.map((pr) => (
                <PrRow
                  key={pr.id}
                  pr={pr}
                  onTake={() => handleTake(pr)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[8px]">
            <span className="retro text-sky-200/55">
              {prs.length} {prs.length === 1 ? "TARGET" : "TARGETS"} IN RANGE
            </span>
            <HudButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              STAND DOWN
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
