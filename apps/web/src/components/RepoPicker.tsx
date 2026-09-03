import type { LocalFolderSummary, RepoSummary } from "@sudo-city/protocol";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Download,
  Command,
  FolderOpen,
  Globe2,
  GitBranch,
  Lock,
  MapPin,
  Plane,
  Radio,
  RefreshCw,
  Search,
} from "lucide-react";
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
import { desktop, isDesktop } from "@/lib/desktop";

export interface RepoPickerProps {
  repos: RepoSummary[];
  loading: boolean;
  error?: string;
  /** repoKey currently cloning, if any, and when the import started. */
  importing?: { repoKey: string; startedAt: number; message?: string };
  maxRepoSizeMb?: number;
  onImportOrSelect: (repo: RepoSummary) => void;
  onSeeDemo: () => void;
  onRefresh: () => void;
  /** The city currently on screen, so it cannot be chosen as a destination. */
  activeRepoKey?: string;
  authenticationRequired?: boolean;
  onSignIn?: () => void;
  /** Full-page after login vs. the in-world airport departures board. */
  dialog?: { open: boolean; onOpenChange: (open: boolean) => void };
  localFolders?: LocalFolderSummary[];
  localGithubRepos?: RepoSummary[];
  localGithubLoading?: boolean;
  localGithubError?: string;
  onOpenLocalFolder?: (path: string) => void;
  onSelectLocalGithub?: (repo: RepoSummary) => void;
  onRefreshLocalGithub?: () => void;
}

function useElapsedSeconds(startedAt: number | undefined): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === undefined) {
      setElapsed(0);
      return;
    }
    const update = (): void => setElapsed(Math.floor((Date.now() - startedAt) / 1_000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return elapsed;
}

function destinationCode(repo: RepoSummary): string {
  const compact = repo.name.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (compact.slice(0, 3) || "CITY").padEnd(3, "X");
}

function RepoRow({
  repo,
  busySince,
  busyMessage,
  active,
  blocked,
  airport,
  onClick,
}: {
  repo: RepoSummary;
  busySince?: number;
  busyMessage?: string;
  active?: boolean;
  blocked?: boolean;
  airport: boolean;
  onClick: () => void;
}) {
  const busy = busySince !== undefined;
  const elapsed = useElapsedSeconds(busySince);
  const disabled = busy || active || blocked;

  if (!airport) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-3 border-4 border-foreground bg-background px-3 py-1.5 text-left transition-colors dark:border-ring",
          disabled ? "opacity-55" : "hover:border-primary/60",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="retro truncate text-[10px] text-primary">{repo.fullName}</p>
          <p className="retro truncate text-[8px] text-muted-foreground">
            {repo.private ? "private" : "public"} · {repo.defaultBranch}
            {repo.size !== undefined ? ` · ${(repo.size / 1024).toFixed(1)} MB` : ""}
          </p>
        </div>
        <span className="retro shrink-0 text-right text-[9px] text-primary">
          {busy ? (busyMessage ? busyMessage : `importing… ${elapsed}s`) : repo.imported ? "OPEN" : "IMPORT"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "airport-destination group relative grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden border border-white/10 bg-white/[0.035] px-3 py-1.5 text-left",
        active && "airport-destination--active",
        busy && "airport-destination--busy",
        disabled && !active && !busy && "opacity-45",
      )}
    >
      <span className="airport-destination-code retro" aria-hidden="true">
        {destinationCode(repo)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="retro truncate text-[10px] text-white">{repo.fullName}</span>
          {repo.private ? (
            <Lock className="size-3 shrink-0 text-sky-200/65" aria-label="Private repository" />
          ) : (
            <Globe2 className="size-3 shrink-0 text-sky-200/65" aria-label="Public repository" />
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Command className="size-3" aria-hidden="true" />
            {repo.defaultBranch}
          </span>
          <span aria-hidden="true">•</span>
          <span>
            {repo.imported
              ? "city mapped"
              : repo.size !== undefined
                ? `${(repo.size / 1024).toFixed(1)} MB`
                : "survey required"}
          </span>
        </span>
      </span>
      <span className="flex min-w-[7.2rem] items-center justify-end gap-2">
        {busy ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5 text-amber-300">
              <Clock className="size-3.5 animate-pulse" aria-hidden="true" />
              <span className="retro text-[8px] leading-none">IMPORTING</span>
            </div>
            <span className="retro text-right text-[8px] text-amber-200/80">
              {busyMessage ? busyMessage : `${elapsed}s`}
            </span>
          </div>
        ) : active ? (
          <>
            <MapPin className="size-3.5 text-emerald-300" aria-hidden="true" />
            <span className="retro text-[8px] text-emerald-200">YOU ARE HERE</span>
          </>
        ) : (
          <>
            {repo.imported ? (
              <Plane className="size-4 text-amber-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-1" aria-hidden="true" />
            ) : (
              <Download className="size-4 text-sky-300" aria-hidden="true" />
            )}
            <span className="retro text-[8px] leading-4 text-amber-100">
              {repo.imported ? "BOARD" : "IMPORT"}<br />
              {repo.imported ? "FLIGHT" : "& BOARD"}
            </span>
            <ArrowRight className="size-3 text-white/35 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </>
        )}
      </span>
    </button>
  );
}

/**
 * A folder on this Mac, in the picker.
 *
 * Two render paths like RepoRow, for the same reason: the full-page picker uses
 * the semantic tokens (`primary`, `muted-foreground`, `border-foreground`) and
 * the in-world departures board uses the airport palette. Styling one variant
 * and tinting it with a flag leaves emerald borders sitting in the amber
 * full-page picker, which is what this looked like before.
 */
function LocalFolderRow({
  folder,
  active,
  airport,
  onClick,
}: {
  folder: LocalFolderSummary;
  active?: boolean;
  airport: boolean;
  onClick: () => void;
}) {
  const status = active ? "HERE" : "OPEN";
  const detail = folder.isGitRepo ? "git repository" : "plain folder";

  if (!airport) {
    return (
      <button
        type="button"
        disabled={active}
        onClick={onClick}
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-3 border-2 border-foreground bg-background px-3 py-1.5 text-left transition-colors hover:border-primary/60 dark:border-ring",
          active && "opacity-55",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <FolderOpen
            className="size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="retro block truncate text-[10px] text-primary">
              {folder.name}
            </span>
            <span className="retro block truncate text-[8px] text-muted-foreground">
              {detail} · {folder.path}
            </span>
          </span>
        </span>
        <span className="retro shrink-0 text-right text-[9px] text-primary">
          {status}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={active}
      onClick={onClick}
      className={cn(
        "airport-destination group relative flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden border border-white/10 bg-white/[0.035] px-3 py-1.5 text-left",
        active && "airport-destination--active opacity-55",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <FolderOpen
          className="size-4 shrink-0 text-emerald-300"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="retro block truncate text-[10px] text-white">
            {folder.name}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-slate-400">
            {detail} · {folder.path}
          </span>
        </span>
      </span>
      <span className="retro shrink-0 text-[8px] text-emerald-200">
        {status}
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
  activeRepoKey,
  airport,
  localFolders = [],
  localGithubRepos = [],
  localGithubLoading = false,
  localGithubError,
  onOpenLocalFolder,
  onSelectLocalGithub,
  onRefreshLocalGithub,
}: Omit<RepoPickerProps, "dialog"> & { airport: boolean }) {
  const [query, setQuery] = useState("");
  const [showAllLocalFolders, setShowAllLocalFolders] = useState(false);
  const [showAllLocalGithub, setShowAllLocalGithub] = useState(false);
  const [showAllRepos, setShowAllRepos] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? repos.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : repos;
  }, [repos, query]);

  const filteredLocalFolders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? localFolders.filter(
          (folder) =>
            folder.name.toLowerCase().includes(needle) ||
            folder.path.toLowerCase().includes(needle),
        )
      : localFolders;
  }, [localFolders, query]);

  const filteredLocalGithub = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? localGithubRepos.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : localGithubRepos;
  }, [localGithubRepos, query]);

  const visibleLocalFolders = showAllLocalFolders
    ? filteredLocalFolders
    : filteredLocalFolders.slice(0, 4);

  const visibleLocalGithub = showAllLocalGithub
    ? filteredLocalGithub
    : filteredLocalGithub.slice(0, 4);

  const visibleRepos = showAllRepos ? filtered : filtered.slice(0, 4);

  const anotherImportIsActive = Boolean(importing);

  async function chooseLocalFolder(): Promise<void> {
    const path = await desktop()?.pickFolder();
    if (path) onOpenLocalFolder?.(path);
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto airport-scrollbar", airport ? "gap-3 p-4 sm:p-5 pr-2.5 sm:pr-3.5" : "gap-4 px-5 py-4")}>
      <label className={cn("relative block min-w-0 shrink-0", airport && "airport-search")}>
        <Search
          className={cn(
            "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2",
            airport ? "size-4 text-sky-200/55" : "size-3.5 text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="sr-only">Search repository destinations</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={airport ? "SEARCH DESTINATIONS OR REPOSITORIES" : "search repositories…"}
          className={cn(
            "retro w-full outline-none",
            airport
              ? "border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[9px] text-white placeholder:text-slate-500 focus:border-amber-300/60"
              : "border-4 border-foreground bg-background py-2 pl-9 pr-3 text-[9px] dark:border-ring",
          )}
        />
      </label>

      {isDesktop() ? (
        <section
          className={cn(
            "grid min-w-0 shrink-0 gap-2 p-3",
            airport
              ? "border border-white/10 bg-white/[0.025]"
              : "border-2 border-foreground dark:border-ring",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className={cn("hud-label shrink-0", airport && "text-sky-200/70")}>
              Local folders
            </p>
            <HudButton
              type="button"
              size="sm"
              className="retro shrink-0 text-[8px]"
              onClick={() => void chooseLocalFolder()}
              disabled={!onOpenLocalFolder}
            >
              <FolderOpen className="mr-1 size-3" aria-hidden="true" /> open
              folder
            </HudButton>
          </div>
          {filteredLocalFolders.length > 0 ? (
            <div className="grid min-w-0 gap-2">
              {visibleLocalFolders.map((folder) => (
                <LocalFolderRow
                  key={folder.key}
                  folder={folder}
                  active={folder.key === activeRepoKey}
                  airport={airport}
                  onClick={() => onOpenLocalFolder?.(folder.path)}
                />
              ))}
              {filteredLocalFolders.length > 4 ? (
                <button
                  type="button"
                  onClick={() => setShowAllLocalFolders((v) => !v)}
                  className={cn(
                    "retro mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[8px] transition-colors cursor-pointer",
                    airport
                      ? "border border-white/10 bg-white/[0.02] text-sky-200/70 hover:border-amber-300/40 hover:bg-amber-400/[0.06] hover:text-amber-200"
                      : "border-2 border-foreground bg-background text-primary hover:border-primary/60 dark:border-ring",
                  )}
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      showAllLocalFolders && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {showAllLocalFolders
                      ? "SHOW LESS"
                      : `SHOW MORE (${filteredLocalFolders.length - 4} MORE)`}
                  </span>
                </button>
              ) : null}
            </div>
          ) : (
            <p
              className={cn(
                "retro text-[8px] leading-relaxed",
                airport ? "text-sky-100/55" : "text-muted-foreground",
              )}
            >
              Drop a folder anywhere in the window, or choose one above.
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <div className={cn("retro shrink-0 text-[9px] text-destructive", airport && "border border-red-400/30 bg-red-950/25 p-2.5 text-red-200")}>
          {error}
        </div>
      ) : null}

      <div className={cn("flex min-w-0 flex-col", airport ? "gap-2" : "gap-2")}>
        {isDesktop() ? (
          <>
            {localGithubLoading ? (
              <div
                className={cn(
                  "retro p-3 text-[9px]",
                  airport
                    ? "border border-white/10 text-sky-100/70"
                    : "border-2 border-foreground text-muted-foreground dark:border-ring",
                )}
              >
                CHECKING THE GITHUB CLI…
              </div>
            ) : null}
            {localGithubError ? (
              <div
                className={cn(
                  "grid min-w-0 gap-1 p-3",
                  airport
                    ? "border border-amber-300/25 bg-amber-300/[0.05]"
                    : "border-2 border-foreground dark:border-ring",
                )}
              >
                <p
                  className={cn(
                    "hud-label",
                    airport ? "text-amber-200" : "text-primary",
                  )}
                >
                  GitHub CLI import unavailable
                </p>
                <p
                  className={cn(
                    "retro text-[8px] leading-relaxed",
                    airport ? "text-amber-100/65" : "text-muted-foreground",
                  )}
                >
                  {localGithubError}
                </p>
              </div>
            ) : null}
            {filteredLocalGithub.length > 0 ? (
              <section className="grid min-w-0 gap-2">
                <p
                  className={cn(
                    "hud-label flex items-center gap-1.5",
                    airport && "text-sky-200/70",
                  )}
                >
                  <GitBranch className="size-3" aria-hidden="true" /> GitHub
                  repositories
                </p>
                {visibleLocalGithub.map((repo) => (
                  <RepoRow
                    key={repo.key}
                    repo={repo}
                    busySince={importing?.repoKey === repo.key ? importing.startedAt : undefined}
                    busyMessage={importing?.repoKey === repo.key ? importing.message : undefined}
                    active={repo.key === activeRepoKey}
                    blocked={anotherImportIsActive && importing?.repoKey !== repo.key}
                    airport={airport}
                    onClick={() => onSelectLocalGithub?.(repo)}
                  />
                ))}
                {filteredLocalGithub.length > 4 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllLocalGithub((v) => !v)}
                    className={cn(
                      "retro mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[8px] transition-colors cursor-pointer",
                      airport
                        ? "border border-white/10 bg-white/[0.02] text-sky-200/70 hover:border-amber-300/40 hover:bg-amber-400/[0.06] hover:text-amber-200"
                        : "border-2 border-foreground bg-background text-primary hover:border-primary/60 dark:border-ring",
                    )}
                  >
                    <ChevronDown
                      className={cn(
                        "size-3 transition-transform",
                        showAllLocalGithub && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                    <span>
                      {showAllLocalGithub
                        ? "SHOW LESS"
                        : `SHOW MORE (${filteredLocalGithub.length - 4} MORE)`}
                    </span>
                  </button>
                ) : null}
              </section>
            ) : null}
            {!localGithubLoading && !localGithubError && localGithubRepos.length === 0 ? (
              <p
                className={cn(
                  "retro p-3 text-[8px] leading-relaxed",
                  airport
                    ? "border border-white/10 text-sky-100/55"
                    : "border-2 border-foreground text-muted-foreground dark:border-ring",
                )}
              >
                No GitHub repositories found. Install gh and run gh auth login
                to import one.
              </p>
            ) : null}
          </>
        ) : null}

        {!isDesktop() && loading ? (
          <div className={cn("retro text-[9px] text-muted-foreground", airport && "airport-loading border border-white/10 p-5 text-center text-sky-100/65")}>
            CONTACTING DEPARTURE CONTROL…
          </div>
        ) : null}
        {!isDesktop() && !loading && repos.length === 0 ? (
          <div className={cn("flex flex-col items-start gap-3 border-4 border-dashed border-foreground/40 px-3 py-4", airport && "border border-white/15 bg-white/[0.025]")}>
            <p className="retro text-[9px] text-muted-foreground">
              You haven't granted this App access to any repositories yet.
            </p>
            <a href={githubInstallUrl()}>
              <HudButton type="button" size="sm">GRANT REPOSITORY ACCESS</HudButton>
            </a>
          </div>
        ) : null}
        {!isDesktop() && !loading && repos.length > 0 && filtered.length === 0 ? (
          <p className="retro border border-white/10 p-5 text-center text-[9px] text-muted-foreground">
            No destination matches “{query}”.
          </p>
        ) : null}
        {!isDesktop() && !loading && filtered.length > 0 ? (
          <>
            {visibleRepos.map((repo) => (
              <RepoRow
                key={repo.key}
                repo={repo}
                busySince={importing?.repoKey === repo.key ? importing.startedAt : undefined}
                busyMessage={importing?.repoKey === repo.key ? importing.message : undefined}
                active={repo.key === activeRepoKey}
                blocked={anotherImportIsActive && importing?.repoKey !== repo.key}
                airport={airport}
                onClick={() => onImportOrSelect(repo)}
              />
            ))}
            {filtered.length > 4 ? (
              <button
                type="button"
                onClick={() => setShowAllRepos((v) => !v)}
                className={cn(
                  "retro mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[8px] transition-colors cursor-pointer",
                  airport
                    ? "border border-white/10 bg-white/[0.02] text-sky-200/70 hover:border-amber-300/40 hover:bg-amber-400/[0.06] hover:text-amber-200"
                    : "border-2 border-foreground bg-background text-primary hover:border-primary/60 dark:border-ring",
                )}
              >
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    showAllRepos && "rotate-180",
                  )}
                  aria-hidden="true"
                />
                <span>
                  {showAllRepos
                    ? "SHOW LESS"
                    : `SHOW MORE (${filtered.length - 4} MORE)`}
                </span>
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3", airport ? "border-t border-white/10 pt-3" : "border-t-4 border-foreground pt-3 dark:border-ring")}>
        {isDesktop() ? (
          <span className="retro text-[8px] text-muted-foreground">Local imports use your gh login and stay on this Mac.</span>
        ) : (
          <a
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noreferrer"
            className={cn("retro text-[8px] underline underline-offset-2", airport ? "text-sky-200/55 hover:text-sky-100" : "text-muted-foreground")}
          >
            manage shared repositories
          </a>
        )}
        <div className="flex gap-2">
          <HudButton type="button" variant="outline" size="sm" onClick={isDesktop() ? onRefreshLocalGithub : onRefresh} disabled={anotherImportIsActive}>
            <RefreshCw className="mr-1 size-3" aria-hidden="true" /> refresh
          </HudButton>
          {!isDesktop() ? (
            <HudButton type="button" variant="ghost" size="sm" onClick={onSeeDemo} disabled={anotherImportIsActive || activeRepoKey === "demo"}>
              demo city
            </HudButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function RepoPicker(props: RepoPickerProps) {
  if (props.dialog) {
    const { open, onOpenChange } = props.dialog;
    const activeRepo = props.repos.find((repo) => repo.key === props.activeRepoKey);
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="airport-board flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden border border-sky-100/20 bg-[#081923] p-0 text-white shadow-2xl sm:rounded-none">
          <div className="airport-board-header shrink-0 relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
            <div className="relative z-10 flex items-start justify-between gap-5 pr-8">
              <DialogHeader className="space-y-2 text-left">
                <div className="flex items-center gap-2">
                  <span className="airport-terminal-code retro">CCX</span>
                  <span className="retro text-[8px] tracking-[0.24em] text-sky-100/55">TERMINAL 01 · REPOSITORY TRANSIT</span>
                </div>
                <DialogTitle className="flex items-center gap-2.5 text-left">
                  <span className="airport-icon-grid"><Plane className="size-5" aria-hidden="true" /></span>
                  <span className="retro text-sm text-amber-200 sm:text-base">Choose your destination</span>
                </DialogTitle>
                <DialogDescription className="max-w-xl text-xs leading-5 text-sky-100/55">
                  {props.authenticationRequired
                    ? "Repository flights are available after GitHub sign-in. The demo city remains open behind this departures board."
                    : isDesktop()
                      ? "Open a folder from this Mac or import one of your gh repositories. Your projects never leave this machine."
                      : "Select a repository city. Unmapped destinations are imported before boarding; departure begins automatically when ground control clears the flight."}
                </DialogDescription>
              </DialogHeader>
              <span className="hidden items-center gap-2 border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-2 sm:flex">
                <Radio className="size-3.5 text-emerald-300" aria-hidden="true" />
                <span className="retro text-[7px] leading-3 text-emerald-200">TOWER<br />ONLINE</span>
              </span>
            </div>

            <div className="relative z-10 mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="min-w-0">
                <span className="retro block text-[7px] text-sky-200/45">DEPARTING</span>
                <span className="retro mt-1 block truncate text-[9px] text-white">
                  {activeRepo?.fullName ?? props.activeRepoKey ?? "CURRENT CITY"}
                </span>
              </div>
              <div className="airport-route-line flex items-center gap-2 text-amber-300" aria-hidden="true">
                <span />
                <Plane className="size-4" />
                <span />
              </div>
              <div className="min-w-0 text-right">
                <span className="retro block text-[7px] text-sky-200/45">ARRIVING</span>
                <span className="retro mt-1 block text-[9px] text-amber-200">
                  {props.authenticationRequired ? "SIGN IN TO BOARD" : "SELECT BELOW"}
                </span>
              </div>
            </div>
          </div>
          {props.authenticationRequired ? (
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center border border-emerald-300/25 bg-emerald-300/10 text-emerald-300">
                  <Check className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="retro text-[10px] text-white">UNLOCK REPOSITORY DESTINATIONS</p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-sky-100/55">
                    Sign in to see repositories shared with Claude City, import a destination, and watch your flight depart this terminal.
                  </p>
                </div>
              </div>
              <HudButton type="button" onClick={props.onSignIn}>
                <Command className="mr-1.5 size-3.5" aria-hidden="true" /> SIGN IN TO BOARD
              </HudButton>
            </div>
          ) : (
            <RepoPickerBody {...props} airport />
          )}
          <div className="airport-runway-bar shrink-0" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-city-overlay" aria-hidden="true" />
      <div className="hud-scanline pointer-events-none absolute inset-0 z-[1]" />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden border-4 border-foreground bg-card p-0 shadow-2xl sm:rounded-none dark:border-ring">
        <div className="shrink-0 border-b-4 border-foreground bg-primary/10 px-5 py-4 dark:border-ring">
          <p className="retro text-sm text-primary">Choose a repository</p>
          <p className="retro mt-1 text-[9px] text-muted-foreground">Every repository you granted this App access to.</p>
        </div>
        <RepoPickerBody {...props} airport={false} />
      </div>
    </div>
  );
}
