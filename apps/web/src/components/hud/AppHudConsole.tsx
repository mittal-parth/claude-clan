import { cn } from "@/lib/utils";

import type { useGameState } from "@/hooks/use-game-state";
import { LogOut, Volume2, VolumeX, Command, ShieldAlert } from "lucide-react";
import { HudWindow } from "./HudWindow";
import { HudMeter } from "./HudMeter";
import { HudButton } from "./HudButton";
import QuestLog from "@/components/ui/8bit/blocks/quest-log";
import {
  statusLabel,
  titleFromRepoPath,
  repoRootPath,
} from "@/lib/app-utils";
import { getCrewMember, effortLabel, crewSpriteUrl } from "@/crew/catalog";
import { eventsToQuests, findPendingPermit } from "@/lib/quest-utils";
import { useUiClick } from "@/hooks/use-ui-click";
import type { AppHudProps } from "./AppHud";

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
    events,
    budget,
    hud,
    crewSelection,
    orderPermissionMode,
    toggleHud,
    setCommandOpen,
    send,
    clearTransmissions,
    resolvePermit,
  } = state;

  const activeCity = cities.find((city) => city.id === activeCityId);
  const pendingPermit = findPendingPermit(events);

  const totalBudget = budget?.totalBudgetUsd ?? 1;
  const treasuryUsed = budget?.spentUsd ?? 0;
  const treasuryPercent = totalBudget > 0
    ? Math.min(100, Math.round((treasuryUsed / totalBudget) * 100))
    : 0;
  const spentDisplay =
    treasuryUsed > 0 && treasuryUsed < 0.01
      ? treasuryUsed.toFixed(4)
      : treasuryUsed.toFixed(2);

  const startedSession = events
    .slice()
    .reverse()
    .find((event) => event.type === "session.started");
  const activeCrew = getCrewMember(crewSelection.crewId);
  const activeEffort =
    startedSession?.type === "session.started"
      ? startedSession.effort
      : crewSelection.effort;
  const crewAvatarSrc = crewSpriteUrl(activeCrew.id, activeEffort);
  const crewStatus = pendingPermit
    ? "Awaiting permit stamp"
    : `${effortLabel(activeEffort)} effort · ${activeCrew.title}`;

  const quests = eventsToQuests(events);
  const activeQuestCount = quests.filter(
    (quest) => quest.status === "active",
  ).length;
  const repoName = titleFromRepoPath(
    repoRootPath(world?.repoPath, activeCityId) ?? "",
  );
  const branchLabel =
    activeCity?.status === "building"
      ? "constructing…"
      : (activeCity?.ref ?? "main");
  const cityDetail =
    activeCity &&
    (activeCity.kind === "pull-request" || activeCity.kind === "issue")
      ? activeCity.title
      : undefined;

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
          <span
            className={cn(
              "hud-pill",
              connection !== "online" && "hud-pill--muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "hud-dot",
                connection === "online" && "hud-dot--live",
              )}
            />
            {statusLabel(connection, reconnectAttempt)}
          </span>
        }
        actions={
          <>
            {user ? (
              <>
                <img
                  src={user.avatarUrl}
                  alt={user.login}
                  title={user.login}
                  className="hud-avatar"
                />
                <button
                  type="button"
                  className="hud-icon-button"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={onLogout}
                >
                  <LogOut className="size-3" aria-hidden="true" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="hud-pill retro"
                onClick={onSignIn}
              >
                SIGN IN
              </button>
            )}
            <button
              type="button"
              className="hud-icon-button"
              aria-label={sfxEnabled ? "Mute sound" : "Unmute sound"}
              aria-pressed={!sfxEnabled}
              title={sfxEnabled ? "Mute sound" : "Unmute sound"}
              onClick={toggleSfx}
            >
              {sfxEnabled ? (
                <Volume2 className="size-3" aria-hidden="true" />
              ) : (
                <VolumeX className="size-3" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="hud-icon-button retro gap-0.5 px-1 text-[8px]"
              aria-label="Open the command palette"
              title="Command palette (⌘K)"
              onClick={() => setCommandOpen(true)}
            >
              <Command className="size-2.5" aria-hidden="true" />K
            </button>
            {targetFps && toggleTargetFps ? (
              <button
                type="button"
                className="hud-icon-button retro px-1.5 text-[8px]"
                aria-label={`Target framerate: ${targetFps} FPS. Click to switch to ${targetFps === 30 ? 60 : 30} FPS`}
                title={`Framerate: ${targetFps} FPS (click to switch to ${targetFps === 30 ? 60 : 30} FPS)`}
                onClick={() => {
                  playClick();
                  toggleTargetFps();
                }}
              >
                {targetFps} FPS
              </button>
            ) : null}
          </>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label">
              Permits · {orderPermissionMode === "auto" ? "auto" : "mayor"}
            </span>
            <span className="hud-label">
              {world?.buildings.length ?? 0} structures
            </span>
          </div>
        }
      >
        <div className="hud-masthead justify-between">
          <div className="min-w-0">
            <h1 className="hud-masthead__name retro">{repoName}</h1>
            <p className="hud-masthead__sub retro">
              {branchLabel} City · mayor console
            </p>
            {cityDetail ? (
              <p className="hud-masthead__detail retro">{cityDetail}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <img src={crewAvatarSrc} alt="" className="hud-crew__portrait" />
          <div className="min-w-0 flex-1">
            <span className="hud-label">Crew on duty</span>
            <p className="retro truncate text-[11px] text-foreground">
              {activeCrew.name}
            </p>
            <p className="retro truncate text-[9px] text-muted-foreground">
              {crewStatus}
            </p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <HudMeter
            label="Context stamina"
            readout="100%"
            value={100}
            tone="var(--color-signal, oklch(0.74 0.16 155))"
          />
          <HudMeter
            label="Treasury"
            readout={`$${spentDisplay} / $${totalBudget.toFixed(2)}`}
            value={treasuryPercent}
          />
        </div>

        {pendingPermit ? (
          <div className="hud-permit grid gap-2">
            <div className="flex items-center gap-1.5">
              <ShieldAlert
                className="size-3 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="hud-label truncate text-primary">
                Permit · {pendingPermit.tool}
              </span>
            </div>
            <p className="retro text-[9px] leading-relaxed text-foreground">
              {pendingPermit.message}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <HudButton
                type="button"
                size="sm"
                onClick={() => resolvePermit(pendingPermit.toolCallId, "allow")}
              >
                Stamp
              </HudButton>
              <HudButton
                type="button"
                size="sm"
                variant="danger"
                onClick={() => resolvePermit(pendingPermit.toolCallId, "deny")}
              >
                Deny
              </HudButton>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border/50 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label">Transmissions</span>
            <div className="flex items-center gap-2">
              {quests.length > 0 ? (
                <button
                  type="button"
                  className="retro text-[8px] uppercase text-muted-foreground transition-colors hover:text-foreground"
                  onClick={clearTransmissions}
                >
                  Clear
                </button>
              ) : null}
              {activeQuestCount > 0 ? (
                <span className="hud-pill">{activeQuestCount} active</span>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <QuestLog
              variant="bare"
              quests={quests}
              emptyStateMessage="The radio is quiet."
            />
          </div>
        </div>
      </HudWindow>
    </div>
  );
}
