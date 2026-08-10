import type { CitySummary } from "@sudo-city/protocol";
import {
  ArrowRight,
  ExternalLink,
  GitPullRequest,
  Hammer,
  Search,
  Ship,
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

export interface WorktreeShopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The mayor's own PRs plus any issue worktrees already checked out. */
  items: readonly CitySummary[];
  activeCityId?: string;
  onTakeItem: (item: CitySummary) => void;
}

function itemCode(item: CitySummary): string {
  return `#${item.number ?? "---"}`.padStart(5, " ");
}

function WorktreeRow({
  item,
  onTake,
}: {
  item: CitySummary;
  onTake: () => void;
}) {
  const isPr = item.kind === "pull-request";
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
        {itemCode(item)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="retro truncate text-[10px] text-white">{item.title}</span>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-amber-200/50 hover:text-amber-100"
              onClick={(e) => e.stopPropagation()}
              title="View on GitHub"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            {isPr ? (
              <GitPullRequest className="size-3" aria-hidden="true" />
            ) : (
              <Hammer className="size-3" aria-hidden="true" />
            )}
            {isPr ? "MY PR" : "WORKTREE"}
          </span>
          <span aria-hidden="true">•</span>
          <span className="truncate text-slate-400/80">{item.ref}</span>
        </span>
      </span>
      <span className="flex items-center justify-end">
        <button
          type="button"
          onClick={onTake}
          className="group/btn inline-flex cursor-pointer items-center gap-2 border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 transition-colors hover:border-amber-300 hover:bg-amber-400 hover:text-black"
        >
          <Ship className="size-3.5 text-amber-300 transition-transform group-hover/btn:-rotate-12 group-hover/btn:text-black" aria-hidden="true" />
          <span className="retro text-[8px] leading-4 text-amber-100 group-hover/btn:text-black">
            GET TO<br />WORK
          </span>
          <ArrowRight className="size-3 text-amber-300/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:text-black" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export default function WorktreeShopDialog({
  open,
  onOpenChange,
  items,
  activeCityId = "main",
  onTakeItem,
}: WorktreeShopDialogProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      return (
        item.title.toLowerCase().includes(needle) ||
        `#${item.number}`.includes(needle) ||
        (item.author && item.author.toLowerCase().includes(needle))
      );
    });
  }, [items, query]);

  function handleTake(item: CitySummary): void {
    onTakeItem(item);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="airport-board max-h-[92dvh] max-w-2xl overflow-hidden border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none">
        <div className="airport-board-header relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
          <div className="relative z-10 flex items-start justify-between gap-5 pr-8">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className="airport-terminal-code retro text-amber-300 border-amber-300">MY-WORK</span>
                <span className="retro text-[8px] tracking-[0.24em] text-sky-100/55">
                  HOME FLEET · OWN CARGO ONLY
                </span>
              </div>
              <DialogTitle className="flex items-center gap-2.5 text-left">
                <span className="airport-icon-grid">
                  <Ship className="size-5 text-amber-300" aria-hidden="true" />
                </span>
                <span className="retro text-sm text-sky-200 sm:text-base">
                  Sail Out to Your Own Work
                </span>
              </DialogTitle>
              <DialogDescription className="max-w-xl text-xs leading-5 text-sky-100/55">
                Your own manifest: open pull requests you filed, and issue worktrees you've already got a crew building. Pick one and the feeder ship carries you straight there.
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
            <span className="sr-only">Search your own PRs and worktrees</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH YOUR CARGO BY TITLE OR #NUMBER"
              className="retro w-full border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[9px] text-white outline-none placeholder:text-slate-500 focus:border-amber-300/60"
            />
          </label>

          <div className="flex max-h-[23rem] flex-col gap-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.025] p-8 text-center">
                <Ship className="size-6 text-slate-500" aria-hidden="true" />
                <p className="retro text-[9px] text-muted-foreground">
                  The hold is empty. Fix a city issue or open a PR to load up the manifest.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="retro border border-white/10 p-5 text-center text-[9px] text-muted-foreground">
                Nothing on the manifest matches “{query}”.
              </p>
            ) : (
              filtered.map((item) => (
                <WorktreeRow
                  key={item.id}
                  item={item}
                  onTake={() => handleTake(item)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[8px]">
            <span className="retro text-sky-200/55">
              {items.length} {items.length === 1 ? "JOB" : "JOBS"} ON YOUR MANIFEST
            </span>
            <HudButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              CLOSE MANIFEST
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
