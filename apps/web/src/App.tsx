import { useMemo } from "react";
import { type RepoSummary } from "@sudo-city/protocol";
import { cn } from "@/lib/utils";
import { type AuthUser } from "@/auth/gate";
import { GameCanvas, type CanvasAirportTravel } from "@/components/GameCanvas";
import { useAudio } from "@/components/audio-provider";
import { useGameState } from "@/hooks/use-game-state";
import { AppHud } from "@/components/hud/AppHud";
import { AppDialogs } from "@/components/hud/AppDialogs";
import { crewSpriteUrl } from "@/crew/catalog";
import type { BillboardRepo, BillboardTarget } from "@/game/layouts/billboards";
import { trackBillboardClicked, trackIssueShopOpened } from "@/lib/analytics";

export interface AppProps {
  /** "demo", or an owner/name repo key the signed-in user imported. */
  activeRepoKey: string;
  /** The imported repo behind activeRepoKey; absent in demo mode. */
  activeRepo?: RepoSummary;
  /** Presence (not the value) drives whether the WS authenticates itself via a ticket; absent in demo mode. */
  user?: AuthUser;
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
  } = props;

  const { sfxEnabled, toggleSfx } = useAudio();
  const state = useGameState(props);

  /**
   * What the airport billboard should say. Memoised because a fresh object
   * every render would churn the scene setter, and split out of activeRepo so
   * the demo city still gets a named board — just one that goes nowhere,
   * since there is no GitHub repository behind it.
   */
  const billboardRepo = useMemo<BillboardRepo>(() => {
    if (activeRepo) {
      return {
        owner: activeRepo.owner,
        name: activeRepo.name,
        url: `https://github.com/${activeRepo.fullName}`,
      };
    }
    const [owner, name] = activeRepoKey.split("/");
    return { owner: name ? (owner ?? "") : "", name: name ?? owner ?? "" };
  }, [activeRepo, activeRepoKey]);

  function openBillboardTarget(target: BillboardTarget): void {
    switch (target.kind) {
      case "ad":
        trackBillboardClicked({
          kind: "ad",
          url: target.url,
          sponsorId: target.sponsorId,
        });
        break;
      case "repo":
        trackBillboardClicked({ kind: "repo", url: target.url });
        break;
      default: {
        const exhaustive: never = target;
        return exhaustive;
      }
    }
    window.open(target.url, "_blank", "noopener,noreferrer");
  }

  const startedSession = state.events
    .slice()
    .reverse()
    .find((event) => event.type === "session.started");
  const activeEffort =
    startedSession?.type === "session.started"
      ? startedSession.effort
      : state.crewSelection.effort;
  const crewSprite = crewSpriteUrl(state.crewSelection.crewId, activeEffort);

  return (
    <div
      className={cn(
        "hud-root",
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
          className="pointer-events-none fixed z-[100] select-none"
          style={{
            left: state.dragPosition.clientX,
            top: state.dragPosition.clientY,
            transform: "translate(-50%, -100%)",
            opacity: 0.48,
            width: 32,
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
        buildingPaths={state.buildingPaths}
        crewSprite={crewSprite}
        issues={state.issues}
        travelRequest={state.navyTravelRequest ?? state.issueTravelRequest}
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
          trackIssueShopOpened();
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
        user={user}
        activeRepoKey={activeRepoKey}
      />

      <AppDialogs state={state} activeRepoKey={activeRepoKey} />
    </div>
  );
}
