import { Command, LogOut, Settings as SettingsIcon, Terminal as TerminalIcon, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { useGameState } from "@/hooks/use-game-state";
import { HudWindow } from "./HudWindow";
import { HudMeter } from "./HudMeter";
import { statusLabel, titleFromRepoPath, repoRootPath } from "@/lib/app-utils";
import { creditModeOf, type PlanUsageWindow } from "@sudo-city/protocol";
import { getCrewMember, effortLabel, crewSpriteUrl, findCrewByModel } from "@/crew/catalog";
import { useUiClick } from "@/hooks/use-ui-click";
import type { AppHudProps } from "./AppHud";
import { SessionListPanel } from "@/components/sessions/SessionListPanel";
import DesktopSettingsDialog from "@/components/DesktopSettingsDialog";
import DesktopOnboarding from "@/components/DesktopOnboarding";
import { desktop, isDesktop } from "@/lib/desktop";

export function formatResetTime(isoDate?: string, now = Date.now()): string | undefined {
  if (!isoDate) return undefined;
  const target = new Date(isoDate).getTime();
  if (isNaN(target)) return undefined;
  const diffMs = target - now;
  if (diffMs <= 0) return "resets soon";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  if (hours < 24) return `resets in ${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  return `resets in ${days}d`;
}

export function formatLimitReadout(
  window?: PlanUsageWindow,
  defaultLabel = "Available",
  now = Date.now(),
): { text: string; percent: number; isUnmetered: boolean; tone?: string } {
  if (!window) {
    return { text: defaultLabel, percent: 0, isUnmetered: true };
  }
  const resetStr = formatResetTime(window.resetsAt, now);
  const util = window.utilization;
  if (window.status === "rejected") {
    return {
      text: resetStr ? `Exhausted · ${resetStr}` : "Limit reached",
      percent: 100,
      isUnmetered: false,
      tone: "#ef4444",
    };
  }
  if (typeof util === "number") {
    const rawPct = util <= 1 && util > 0 ? util * 100 : util;
    const pct = Math.min(100, Math.max(0, Math.round(rawPct)));
    const text = resetStr ? `${pct}% · ${resetStr}` : `${pct}% used`;
    const tone =
      window.status === "allowed_warning" || pct >= 80
        ? pct >= 95
          ? "#ef4444"
          : "#f59e0b"
        : undefined;
    return { text, percent: pct, isUnmetered: false, tone };
  }
  if (window.status === "allowed_warning") {
    return {
      text: resetStr ? `Warning · ${resetStr}` : "Approaching limit",
      percent: 85,
      isUnmetered: false,
      tone: "#f59e0b",
    };
  }
  if (resetStr) {
    return { text: `Active · ${resetStr}`, percent: 0, isUnmetered: true };
  }
  return { text: defaultLabel, percent: 0, isUnmetered: true };
}

export function AppHudConsole({
  state,
  onSignIn,
  onLogout,
  sfxEnabled,
  toggleSfx,
  targetFps,
  toggleTargetFps,
  user,
  localUser,
  terminalOpen,
  onToggleTerminal,
}: AppHudProps) {
  const playClick = useUiClick();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const authSource = focusedView?.summary.apiKeySource;
  const creditMode = budget ? creditModeOf(budget) : "api-key";
  const isSubscription = creditMode === "subscription";
  const subscriptionAuth =
    authSource === "oauth" ||
    authSource?.toLowerCase().includes("login managed") ||
    (authSource === undefined && isSubscription);
  const authLabel = subscriptionAuth
    ? "Paid by your Claude subscription"
    : authSource === "user" || (!isSubscription && isDesktop())
      ? "Paid per-token via your API key"
      : undefined;
  const fiveHourInfo = formatLimitReadout(budget?.fiveHourLimit, "Available");
  const weeklyInfo = formatLimitReadout(budget?.weeklyLimit, "Available");
  const uncapped = Boolean(
    budget &&
      (creditMode === "subscription" || budget.totalBudgetUsd === undefined),
  );
  const totalBudget = budget?.totalBudgetUsd ?? 1;
  const treasuryUsed = budget?.spentUsd ?? 0;
  const treasuryPercent = uncapped
    ? 0
    : totalBudget > 0
      ? Math.min(100, Math.round((treasuryUsed / totalBudget) * 100))
      : 0;
  const treasuryLabel =
    creditMode === "subscription" ? "Funded by your Claude plan" : "Treasury";
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
          // The hosted build keeps the pill in every state: a stranger on a
          // flaky network needs to see "Live" to trust the city is current.
          // The desktop build talks to a server on loopback, so a steady "Live"
          // is noise -- but it still surfaces trouble, because the settings
          // dialog restarts that server underneath the window and a silent
          // dead socket would look like a hang.
          isDesktop() && connection === "online" ? null : (
            <span className={cn("hud-pill", connection !== "online" && "hud-pill--muted")}>
              <span aria-hidden="true" className={cn("hud-dot", connection === "online" && "hud-dot--live")} />
              {statusLabel(connection, reconnectAttempt)}
            </span>
          )
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
            ) : localUser ? (
              // Desktop identity comes from gh, so there is nothing to sign in
              // or out of -- showing SIGN IN here offered a hosted OAuth flow
              // the local app never uses. Avatar only, no sign-out control.
              <img
                src={localUser.avatarUrl}
                alt={localUser.login}
                title={localUser.name ? `${localUser.name} (${localUser.login}) · via GitHub CLI` : `${localUser.login} · via GitHub CLI`}
                className="hud-avatar"
              />
            ) : isDesktop() ? null : (
              <button type="button" className="hud-pill retro" onClick={onSignIn}>SIGN IN</button>
            )}
            {isDesktop() ? (
              <button type="button" className="hud-icon-button" aria-label="Open desktop settings" title="Desktop settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon className="size-3" aria-hidden="true" />
              </button>
            ) : null}
            {isDesktop() && desktop()?.terminal && onToggleTerminal ? (
              <button
                type="button"
                className={cn(
                  "hud-icon-button",
                  terminalOpen && "text-primary border-primary bg-primary/10",
                )}
                aria-label="Toggle terminal (Ctrl+`)"
                title="Toggle terminal (Ctrl+`)"
                onClick={() => {
                  playClick();
                  onToggleTerminal();
                }}
              >
                <TerminalIcon className="size-3" aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="hud-icon-button" aria-label={sfxEnabled ? "Mute sound" : "Unmute sound"} aria-pressed={!sfxEnabled} title={sfxEnabled ? "Mute sound" : "Unmute sound"} onClick={toggleSfx}>
              {sfxEnabled ? <Volume2 className="size-3" aria-hidden="true" /> : <VolumeX className="size-3" aria-hidden="true" />}
            </button>
            <button type="button" className="hud-icon-button retro gap-0.5 px-1 text-[8px]" aria-label="Open the command palette" title="Command palette (⌘K)" onClick={() => setCommandOpen(true)}>
              <Command className="size-2.5" aria-hidden="true" />K
            </button>
            {targetFps && toggleTargetFps && !isDesktop() ? (
              // On desktop this lives in City hall's Display section instead.
              // The hosted build has no settings modal to hold it, so the
              // toolbar button has to stay there or the control disappears.
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
            {authLabel ? <p className="retro truncate text-[8px] text-primary">{authLabel}</p> : null}
          </div>
        </div>

        {isSubscription ? (
          <div className="grid gap-2">
            <HudMeter
              label="5-hour window"
              readout={fiveHourInfo.text}
              value={fiveHourInfo.percent}
              unmetered={fiveHourInfo.isUnmetered}
              tone={fiveHourInfo.tone}
            />
            <HudMeter
              label="Weekly limit"
              readout={weeklyInfo.text}
              value={weeklyInfo.percent}
              unmetered={weeklyInfo.isUnmetered}
              tone={weeklyInfo.tone}
            />
          </div>
        ) : (
          <div className="grid gap-1.5">
            <HudMeter
              label={treasuryLabel}
              readout={
                uncapped
                  ? `$${spentDisplay} spent`
                  : `$${spentDisplay} / $${totalBudget.toFixed(2)}`
              }
              value={treasuryPercent}
              unmetered={uncapped}
            />
          </div>
        )}

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
      {isDesktop() ? (
        <DesktopSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          state={state}
        />
      ) : null}
      {isDesktop() ? (
        <DesktopOnboarding onUseApiKey={() => setSettingsOpen(true)} />
      ) : null}
    </div>
  );
}
