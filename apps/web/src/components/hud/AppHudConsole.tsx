import { Command, LogOut, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useGameState } from "@/hooks/use-game-state";
import { HudWindow } from "./HudWindow";
import { HudMeter } from "./HudMeter";
import { statusLabel, titleFromRepoPath, repoRootPath } from "@/lib/app-utils";
import { getCrewMember, effortLabel, crewSpriteUrl, findCrewByModel } from "@/crew/catalog";
import { useUiClick } from "@/hooks/use-ui-click";
import { trackCommandPaletteOpened } from "@/lib/analytics";
import type { AppHudProps } from "./AppHud";
import { SessionListPanel } from "@/components/sessions/SessionListPanel";

export function AppHudConsole({
  state,
  onSignIn,
  onLogout,
  sfxEnabled,
  toggleSfx,
  targetFps,
  toggleTargetFps,
  user,
}: AppHudProps) {
  const playClick = useUiClick();
  const {
    connection,
    reconnectAttempt,
    activeCityId,
    cities,
    world,
    budget,
    hud,
    crewSelection,
    toggleHud,
    setCommandOpen,
    setArchivedSessionsOpen,
    sessions,
  } = state;

  const activeCity = cities.find((city) => city.id === activeCityId);
  const focusedView = sessions.focusedSessionId
    ? sessions.sessionsById[sessions.focusedSessionId]
    : undefined;
  const totalBudget = budget?.totalBudgetUsd ?? 1;
  const treasuryUsed = budget?.spentUsd ?? 0;
  const treasuryPercent = totalBudget > 0
    ? Math.min(100, Math.round((treasuryUsed / totalBudget) * 100))
    : 0;
  const spentDisplay = treasuryUsed > 0 && treasuryUsed < 0.01
    ? treasuryUsed.toFixed(4)
    : treasuryUsed.toFixed(2);
  const activeCrew = getCrewMember(crewSelection.crewId);
  const activeEffort = focusedView?.summary.effort ?? crewSelection.effort;
  const activeModel = focusedView?.summary.model ?? activeCrew.model;
  const focusedCrew = findCrewByModel(activeModel) ?? activeCrew;
  const crewAvatarSrc = crewSpriteUrl(focusedCrew.id, activeEffort);
  const repoName = titleFromRepoPath(repoRootPath(world?.repoPath, activeCityId) ?? "");
  const branchLabel = activeCity?.status === "building" ? "constructing…" : (activeCity?.ref ?? "main");
  const cityDetail = activeCity && (activeCity.kind === "pull-request" || activeCity.kind === "issue") ? activeCity.title : undefined;

  return (
    <div className="hud-column hud-column--console">
      <HudWindow
        id="hud-console"
        title="Claude City"
        fill
        expanded={hud.console}
        onToggle={() => toggleHud("console")}
        bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5"
        meta={
          <span className={cn("hud-pill", connection !== "online" && "hud-pill--muted")}>
            <span aria-hidden="true" className={cn("hud-dot", connection === "online" && "hud-dot--live")} />
            {statusLabel(connection, reconnectAttempt)}
          </span>
        }
        actions={
          <>
            {user ? (
              <>
                <img src={user.avatarUrl} alt={user.login} title={user.login} className="hud-avatar" />
                <button type="button" className="hud-icon-button" aria-label="Sign out" title="Sign out" onClick={onLogout}>
                  <LogOut className="size-3" aria-hidden="true" />
                </button>
              </>
            ) : (
              <button type="button" className="hud-pill retro" onClick={onSignIn}>SIGN IN</button>
            )}
            <button type="button" className="hud-icon-button" aria-label={sfxEnabled ? "Mute sound" : "Unmute sound"} aria-pressed={!sfxEnabled} title={sfxEnabled ? "Mute sound" : "Unmute sound"} onClick={toggleSfx}>
              {sfxEnabled ? <Volume2 className="size-3" aria-hidden="true" /> : <VolumeX className="size-3" aria-hidden="true" />}
            </button>
            <button type="button" className="hud-icon-button retro gap-0.5 px-1 text-[8px]" aria-label="Open the command palette" title="Command palette (⌘K)" onClick={() => { trackCommandPaletteOpened(); setCommandOpen(true); }}>
              <Command className="size-2.5" aria-hidden="true" />K
            </button>
            {targetFps && toggleTargetFps ? (
              <button type="button" className="hud-icon-button retro px-1.5 text-[8px]" aria-label={`Target framerate: ${targetFps} FPS`} title={`Framerate: ${targetFps} FPS`} onClick={() => { playClick(); toggleTargetFps(); }}>
                {targetFps} FPS
              </button>
            ) : null}
          </>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label">Permits · {focusedView?.summary.permissionMode === "auto" ? "auto" : "mayor"}</span>
            <span className="hud-label">{world?.buildings.length ?? 0} structures</span>
          </div>
        }
      >
        <div className="hud-masthead justify-between">
          <div className="min-w-0">
            <h1 className="hud-masthead__name retro">{repoName}</h1>
            <p className="hud-masthead__sub retro">{branchLabel} City · mayor console</p>
            {cityDetail ? <p className="hud-masthead__detail retro">{cityDetail}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <img src={crewAvatarSrc} alt="" className="hud-crew__portrait" />
          <div className="min-w-0 flex-1">
            <span className="hud-label">{focusedView ? "Focused crew" : "Default crew"}</span>
            <p className="retro truncate text-[11px] text-foreground">{focusedCrew.name}</p>
            <p className="retro truncate text-[9px] text-muted-foreground">
              {focusedView ? `${effortLabel(activeEffort)} effort · ${focusedView.summary.status}` : `${effortLabel(activeEffort)} effort · ready for dispatch`}
            </p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <HudMeter label="Treasury" readout={`$${spentDisplay} / $${totalBudget.toFixed(2)}`} value={treasuryPercent} />
        </div>

        <SessionListPanel
          sessions={sessions.sessions}
          activeCityId={activeCityId}
          focusedSessionId={sessions.focusedSessionId}
          runningCount={sessions.runningCount}
          permitCount={sessions.permitCount}
          unreadFor={sessions.unreadFor}
          onSelect={sessions.focusSession}
          onArchive={sessions.archiveSession}
          onOpenArchived={() => setArchivedSessionsOpen(true)}
        />
      </HudWindow>
    </div>
  );
}
