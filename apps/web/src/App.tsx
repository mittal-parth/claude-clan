import { useCallback, useMemo, useState } from "react";
import { type RepoSummary, RUNNING_SESSION_STATUSES } from "@sudo-city/protocol";
import { cn } from "@/lib/utils";
import { type AuthUser } from "@/auth/gate";
import { GameCanvas, type CanvasAirportTravel } from "@/components/GameCanvas";
import { useAudio } from "@/components/audio-provider";
import { useFps } from "@/components/fps-provider";
import { useGameState } from "@/hooks/use-game-state";
import { AppHud } from "@/components/hud/AppHud";
import { AppDialogs } from "@/components/hud/AppDialogs";
import { IntegratedTerminal } from "@/components/terminal/IntegratedTerminal";
import { crewSpriteUrl, findCrewByModel, getCrewMember } from "@/crew/catalog";
import type { BillboardRepo, BillboardTarget } from "@/game/layouts/billboards";
import { isDesktop } from "@/lib/desktop";

export interface AppProps {
  /** "demo", or an owner/name repo key the signed-in user imported. */
  activeRepoKey: string;
  /** The imported repo behind activeRepoKey; absent in demo mode. */
  activeRepo?: RepoSummary;
  /** Presence (not the value) drives whether the WS authenticates itself via a ticket; absent in demo mode. */
  user?: AuthUser;
  /** The gh account behind the desktop build; never set on the hosted build. */
  localUser?: { login: string; avatarUrl: string; name?: string };
  repoConnectionGeneration: number;
  /** Keeps the real demo canvas mounted behind the login card. */
  loginBackground?: boolean;
  /** Keeps the city visually staged while the login cover hands off to it. */
  initialReveal?: boolean;
  onInitialRevealReady?: () => void;
  onInitialRevealComplete?: () => void;
  airportTravel?: CanvasAirportTravel;
  airportArrival?: CanvasAirportTravel;
  onOpenAirport: () => void;
  onAirportTravelCovered: (travel: CanvasAirportTravel) => void;
  onAirportArrivalComplete: (travel: CanvasAirportTravel) => void;
  onRetryAirportArrival: (travel: CanvasAirportTravel) => void;
  onLogout: () => void;
  onSignIn: () => void;
}

export default function App(props: AppProps) {
  const {
    activeRepoKey,
    activeRepo,
    loginBackground = false,
    initialReveal = false,
    airportTravel,
    airportArrival,
    onOpenAirport,
    onAirportTravelCovered,
    onAirportArrivalComplete,
    onLogout,
    onSignIn,
    user,
    localUser,
  } = props;

  const { sfxEnabled, toggleSfx } = useAudio();
  const { targetFps, toggleTargetFps } = useFps();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | undefined>();

  const handleOpenTerminal = useCallback((command?: string) => {
    setTerminalOpen(true);
    if (command) {
      setPendingTerminalCommand(command);
    }
  }, []);

  const state = useGameState({
    ...props,
    onOpenTerminal: handleOpenTerminal,
  });

  const terminalCwd = useMemo(() => {
    if (activeRepoKey.startsWith("local:")) {
      return activeRepoKey.slice("local:".length);
    }
    if (state.world?.repoPath) {
      return state.world.repoPath;
    }
    return undefined;
  }, [activeRepoKey, state.world?.repoPath]);

  /**
   * What the airport billboard should say. Memoised because a fresh object
   * every render would churn the scene setter, and split out of activeRepo so
   * the demo city still gets a named board — just one that goes nowhere,
   * since there is no GitHub repository behind it.
   */
  const billboardRepo = useMemo<BillboardRepo>(() => {
    if (isDesktop()) {
      if (activeRepoKey.startsWith("local:")) {
        const folderPath = activeRepoKey.slice("local:".length);
        const folderName =
          folderPath.split("/").filter(Boolean).pop() || folderPath;
        return {
          owner: "",
          name: folderName,
        };
      }
      if (activeRepo) {
        return {
          owner: "",
          name: activeRepo.name,
        };
      }
      if (state.world?.repoPath) {
        const folderName =
          state.world.repoPath.split("/").filter(Boolean).pop() ||
          state.world.repoPath;
        return {
          owner: "",
          name: folderName,
        };
      }
      const [, name] = activeRepoKey.split("/");
      return {
        owner: "",
        name: name || activeRepoKey,
      };
    }

    if (activeRepo) {
      return {
        owner: activeRepo.owner,
        name: activeRepo.name,
        url: `https://github.com/${activeRepo.fullName}`,
      };
    }
    const [owner, name] = activeRepoKey.split("/");
    return { owner: name ? (owner ?? "") : "", name: name ?? owner ?? "" };
  }, [activeRepo, activeRepoKey, state.world?.repoPath]);

  function openBillboardTarget(target: BillboardTarget): void {
    window.open(target.url, "_blank", "noopener,noreferrer");
  }

  const activeCrews = state.sessions.sessions
    .filter((summary) => {
      if (summary.cityId !== state.activeCityId) return false;
      const hasSites = (state.constructionBySession[summary.sessionId]?.length ?? 0) > 0;
      const running = RUNNING_SESSION_STATUSES.includes(
        summary.status as (typeof RUNNING_SESSION_STATUSES)[number],
      );
      return running || hasSites;
    })
    .map((summary) => {
      const crew = findCrewByModel(summary.model) ?? getCrewMember("sonnet");
      return {
        sessionId: summary.sessionId,
        sprite: crewSpriteUrl(crew.id, summary.effort),
        paths: state.constructionBySession[summary.sessionId] ?? [],
      };
    });
  const focusedMapSessionId = state.sessions.focusedSessionId
    ?? state.sessions.sessions.find(
      (summary) =>
        summary.cityId === state.activeCityId &&
        RUNNING_SESSION_STATUSES.includes(summary.status as (typeof RUNNING_SESSION_STATUSES)[number]),
    )?.sessionId;

  return (
    <div
      className={cn(
        "hud-root",
        isDesktop() && "is-desktop",
        loginBackground && "hud-root--login-background",
        state.initialRevealComplete && "hud-root--reveal-complete",
        initialReveal &&
          !state.initialRevealReady &&
          "hud-root--handoff-loading",
        initialReveal && state.initialRevealReady && "hud-root--initializing",
        initialReveal &&
          state.initialRevealReady &&
          state.world &&
          "hud-root--revealing",
      )}
    >
      {state.draggingBuilding && state.dragPreview && state.dragPosition ? (
        <img
          src={state.dragPreview.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none fixed z-[100] select-none drop-shadow-md"
          style={{
            left: state.dragPosition.clientX,
            top: state.dragPosition.clientY,
            transform: "translate(-50%, -100%)",
            opacity: 0.7,
            width: 34,
            height: "auto",
            imageRendering: "pixelated",
          }}
        />
      ) : null}

      <GameCanvas
        ref={state.canvasRef}
        cityId={state.activeCityId}
        worldKey={activeRepoKey}
        world={state.world}
        targetFps={targetFps}
        onInitialWorldReady={
          initialReveal ? state.notifyInitialRevealReady : undefined
        }
        overlay={state.overlay}
        travelCityId={state.shipTravelTargetId}
        travelWorld={
          state.shipTravelTargetId
            ? state.worldByCity[state.shipTravelTargetId]
            : undefined
        }
        travelOverlay={
          state.shipTravelTargetId
            ? state.overlayByCity[state.shipTravelTargetId]
            : undefined
        }
        fileChange={state.fileChange}
        cities={state.cities}
        crews={activeCrews}
        focusedSessionId={focusedMapSessionId}
        issues={state.issues}
        travelRequest={
          state.teleportTravelRequest ??
          state.navyTravelRequest ??
          state.issueTravelRequest
        }
        airportTravel={airportTravel}
        airportArrival={airportArrival}
        repo={billboardRepo}
        onTravelRequest={state.requestShipTravel}
        onTravelComplete={state.completeShipTravel}
        onTravelTransitionChange={state.setShipTransitioning}
        onAirportTravelCovered={onAirportTravelCovered}
        onAirportArrivalComplete={onAirportArrivalComplete}
        onAirportClick={() => {
          if (!state.shipTransitioning) onOpenAirport();
        }}
        onAirportHover={state.setShipHover}
        onIssueShopClick={() => {
          state.setSelected(undefined);
          state.setDiff(undefined);
          state.setIssueShopOpen(true);
        }}
        onBillboardClick={openBillboardTarget}
        onHarbourShipClick={state.handleHarbourShipClick}
        onNavyShipClick={state.handleNavyShipClick}
        onShipHover={state.setShipHover}
        onSelectBuilding={state.selectBuilding}
        onBuildingDragStart={state.handleBuildingDragStart}
        onBuildingDragMove={state.handleBuildingDragMove}
        onBuildingDragEnd={state.handleBuildingDrop}
      />

      {state.shipHover ? (
        <div
          className="pointer-events-none absolute z-30 min-w-max -translate-x-1/2 -translate-y-full border border-white/20 bg-[#081923]/95 px-3 py-2 text-left text-white shadow-xl backdrop-blur-sm"
          style={{ left: state.shipHover.screenX, top: state.shipHover.screenY - 12 }}
        >
          <span className="retro block text-[8px] text-amber-200">{state.shipHover.title}</span>
          <span className="mt-1 block text-[10px] text-sky-100/65">{state.shipHover.action}</span>
        </div>
      ) : null}

      <div aria-hidden="true" className="hud-vignette" />

      <AppHud
        state={state}
        onSignIn={onSignIn}
        onLogout={onLogout}
        sfxEnabled={sfxEnabled}
        toggleSfx={toggleSfx}
        targetFps={targetFps}
        toggleTargetFps={toggleTargetFps}
        user={user}
        localUser={localUser}
        activeRepoKey={activeRepoKey}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
      />

      <AppDialogs
        state={state}
        activeRepoKey={activeRepoKey}
        user={user}
        onOpenAirport={onOpenAirport}
      />

      {isDesktop() ? (
        <IntegratedTerminal
          open={terminalOpen}
          onOpenChange={setTerminalOpen}
          cwd={terminalCwd}
          repoName={activeRepo?.name ?? (activeRepoKey.startsWith("local:") ? activeRepoKey.slice("local:".length).split("/").pop() : activeRepoKey)}
          command={pendingTerminalCommand}
          onCommandExecuted={() => setPendingTerminalCommand(undefined)}
        />
      ) : null}
    </div>
  );
}
