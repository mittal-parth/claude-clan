import { Zap } from "lucide-react";
import type { useGameState } from "@/hooks/use-game-state";
import { HudButton } from "./HudButton";
import {
  trackFastTravelSkipped,
  type FastTravelSkippedProperties,
} from "@/lib/analytics";

export interface AppHudTeleportProps {
  state: ReturnType<typeof useGameState>;
}

export function resolveTravelSkipProperties(
  state: ReturnType<typeof useGameState>,
): FastTravelSkippedProperties {
  const {
    activeCityId,
    activeRepoKey,
    airportTravel,
    airportArrival,
    navyTravelRequest,
    issueTravelRequest,
    teleportTravelRequest,
    shipTravelTargetId,
    activeTravelInfo,
  } = state;

  if (airportTravel || airportArrival) {
    return {
      context: "repo_switch",
      currentCityId: activeCityId,
      repoKey:
        airportTravel?.sourceKey ??
        airportArrival?.sourceKey ??
        activeRepoKey,
      destinationRepoKey:
        airportTravel?.destinationKey ?? airportArrival?.destinationKey,
      travelRequestId: airportTravel?.id ?? airportArrival?.id,
    };
  }

  if (navyTravelRequest) {
    const isPr =
      navyTravelRequest.id.startsWith("navy-pr-") ||
      navyTravelRequest.cityId !== "main";
    return {
      context: isPr ? "pr_attack" : "return_home",
      destinationCityId: navyTravelRequest.cityId,
      currentCityId: activeCityId,
      repoKey: activeRepoKey,
      travelRequestId: navyTravelRequest.id,
    };
  }

  if (issueTravelRequest) {
    const isWorktree =
      issueTravelRequest.id.startsWith("worktree-") ||
      issueTravelRequest.cityId !== "main";
    return {
      context: isWorktree ? "worktree" : "return_home",
      destinationCityId: issueTravelRequest.cityId,
      currentCityId: activeCityId,
      repoKey: activeRepoKey,
      travelRequestId: issueTravelRequest.id,
    };
  }

  if (teleportTravelRequest) {
    return {
      context: "teleport",
      destinationCityId: teleportTravelRequest.cityId,
      currentCityId: activeCityId,
      repoKey: activeRepoKey,
      travelRequestId: teleportTravelRequest.id,
    };
  }

  if (shipTravelTargetId) {
    return {
      context: "ship_travel",
      destinationCityId: shipTravelTargetId,
      currentCityId: activeCityId,
      repoKey: activeRepoKey,
    };
  }

  if (activeTravelInfo) {
    return {
      context: activeTravelInfo.context,
      destinationCityId: activeTravelInfo.destinationCityId,
      currentCityId: activeCityId,
      repoKey: activeRepoKey,
      destinationRepoKey: activeTravelInfo.destinationRepoKey,
      travelRequestId: activeTravelInfo.travelRequestId,
    };
  }

  return {
    context: "ship_travel",
    currentCityId: activeCityId,
    repoKey: activeRepoKey,
  };
}

export function AppHudTeleport({ state }: AppHudTeleportProps) {
  const { shipTransitioning, canvasRef } = state;

  if (!shipTransitioning) {
    return null;
  }

  return (
    <div className="absolute bottom-6 right-6 z-50">
      <HudButton
        type="button"
        variant="primary"
        size="auto"
        onClick={() => {
          trackFastTravelSkipped(resolveTravelSkipProperties(state));
          canvasRef.current?.skipTransition();
        }}
        className="flex items-center gap-2 px-6 py-3.5 shadow-xl"
      >
        <span className="retro text-[11px] tracking-wider uppercase">
          Teleport instantly
        </span>
        <Zap
          className="size-3 shrink-0 fill-current"
          strokeLinejoin="miter"
          strokeLinecap="square"
          strokeWidth={1}
          aria-hidden="true"
        />
      </HudButton>
    </div>
  );
}
