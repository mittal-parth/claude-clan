import type { RepoSummary } from "@sudo-city/protocol";
import { useEffect, useMemo, useState } from "react";

import { githubInstallUrl } from "@/auth/api";
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

export interface RepoPickerProps {
  repos: RepoSummary[];
  loading: boolean;
  error?: string;
  /** repoKey currently cloning, if any, and when the import started. */
  importing?: { repoKey: string; startedAt: number };
  onImportOrSelect: (repo: RepoSummary) => void;
  onSeeDemo: () => void;
  onRefresh: () => void;
  /** Full-page after login (no dialog chrome) vs. a Radix dialog opened from the HUD's SWITCH button. */
  dialog?: { open: boolean; onOpenChange: (open: boolean) => void };
}

/**
 * A large repo's import is a real multi-minute clone-and-scan, with no
 * live progress available client-side (the WebSocket that would carry
 * repo.status updates isn't even connected yet during this screen -- App,
 * which owns that socket, only mounts once a repo is already active). A
 * ticking elapsed time is the most honest signal available: it shows the
 * import is alive without claiming to know a phase it can't observe.
 */
function useElapsedSeconds(startedAt: number | undefined): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === undefined) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return elapsed;
}

function RepoRow({
  repo,
  busySince,
  onClick,
}: {
  repo: RepoSummary;
  busySince?: number;
  onClick: () => void;
}) {
  const busy = busySince !== undefined;
  const elapsed = useElapsedSeconds(busySince);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-4 border-foreground bg-background px-3 py-2 text-left transition-colors dark:border-ring",
        busy ? "opacity-60" : "hover:border-primary/60",
      )}
    >
      <div className="min-w-0">
        <p className="retro truncate text-[10px] text-primary">{repo.fullName}</p>
        <p className="retro text-[8px] text-muted-foreground">
          {repo.private ? "private" : "public"} · {repo.defaultBranch}
        </p>
      </div>
      <span className="retro shrink-0 text-[9px] text-primary">
        {busy ? `importing… ${elapsed}s` : repo.imported ? "SWITCH" : "IMPORT"}
      </span>
    </button>
  );
}

function RepoPickerBody({
  repos,
  loading,
  error,
  importing,
  onImportOrSelect,
  onSeeDemo,
  onRefresh,
}: Omit<RepoPickerProps, "dialog">) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return repos;
    }
    return repos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [repos, query]);

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="search repositories…"
        className="retro border-4 border-foreground bg-background px-3 py-2 text-[9px] outline-none dark:border-ring"
      />

      {error ? (
        <p className="retro text-[9px] text-destructive">{error}</p>
      ) : null}

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {loading ? (
          <p className="retro text-[9px] text-muted-foreground">loading repositories…</p>
        ) : repos.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-4 border-dashed border-foreground/40 px-3 py-4">
            <p className="retro text-[9px] text-muted-foreground">
              You haven't granted this App access to any repositories yet.
            </p>
            <a href={githubInstallUrl()}>
              <HudButton type="button" size="sm">
                GRANT ACCESS TO A REPOSITORY
              </HudButton>
            </a>
          </div>
        ) : filtered.length === 0 ? (
          <p className="retro text-[9px] text-muted-foreground">
            No repositories match "{query}".
          </p>
        ) : (
          filtered.map((repo) => (
            <RepoRow
              key={repo.key}
              repo={repo}
              busySince={importing?.repoKey === repo.key ? importing.startedAt : undefined}
              onClick={() => onImportOrSelect(repo)}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t-4 border-foreground pt-3 dark:border-ring">
        <a
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noreferrer"
          className="retro text-[8px] text-muted-foreground underline underline-offset-2"
        >
          change which repos are shared
        </a>
        <div className="flex gap-2">
          <HudButton type="button" variant="outline" size="sm" onClick={onRefresh}>
            refresh
          </HudButton>
          <HudButton type="button" variant="ghost" size="sm" onClick={onSeeDemo}>
            demo city
          </HudButton>
        </div>
      </div>
    </div>
  );
}

export default function RepoPicker(props: RepoPickerProps) {
  if (props.dialog) {
    const { open, onOpenChange } = props.dialog;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring">
          <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="retro text-sm text-primary">Switch repository</DialogTitle>
              <DialogDescription className="retro text-[9px] text-muted-foreground">
                Pick a repository to render as its own city.
              </DialogDescription>
            </DialogHeader>
          </div>
          <RepoPickerBody {...props} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="hud-root relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="hud-scanline pointer-events-none absolute inset-0" />
      <div className="hud-vignette pointer-events-none absolute inset-0" />
      <div className="relative z-10 w-full max-w-lg border-4 border-foreground bg-card p-0 shadow-none sm:rounded-none dark:border-ring">
        <div className="border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <p className="retro text-sm text-primary">Choose a repository</p>
          <p className="retro mt-1 text-[9px] text-muted-foreground">
            Every repo you granted this App access to.
          </p>
        </div>
        <RepoPickerBody {...props} />
      </div>
    </div>
  );
}
