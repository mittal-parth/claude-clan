import { describe, expect, it } from "vitest";
import { resolveTravelSkipProperties } from "./AppHudTeleport";
import type { useGameState } from "@/hooks/use-game-state";

describe("resolveTravelSkipProperties", () => {
  const baseState = {
    activeCityId: "main",
    activeRepoKey: "owner/repo",
    airportTravel: undefined,
    airportArrival: undefined,
    navyTravelRequest: undefined,
    issueTravelRequest: undefined,
    teleportTravelRequest: undefined,
    shipTravelTargetId: undefined,
    activeTravelInfo: undefined,
  } as unknown as ReturnType<typeof useGameState>;

  it("resolves repo_switch when airport travel is in flight", () => {
    const state = {
      ...baseState,
      airportTravel: {
        id: "airport-1",
        sourceKey: "owner/repo-a",
        destinationKey: "owner/repo-b",
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "repo_switch",
      currentCityId: "main",
      repoKey: "owner/repo-a",
      destinationRepoKey: "owner/repo-b",
      travelRequestId: "airport-1",
    });
  });

  it("resolves repo_switch when airport arrival is landing", () => {
    const state = {
      ...baseState,
      airportArrival: {
        id: "airport-2",
        sourceKey: "owner/repo-a",
        destinationKey: "owner/repo-b",
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "repo_switch",
      currentCityId: "main",
      repoKey: "owner/repo-a",
      destinationRepoKey: "owner/repo-b",
      travelRequestId: "airport-2",
    });
  });

  it("resolves pr_attack when deploying to PR review city", () => {
    const state = {
      ...baseState,
      navyTravelRequest: {
        id: "navy-pr-pr-42-12345",
        cityId: "pr-42",
        ship: "navy",
        carriesContainer: false,
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "pr_attack",
      destinationCityId: "pr-42",
      currentCityId: "main",
      repoKey: "owner/repo",
      travelRequestId: "navy-pr-pr-42-12345",
    });
  });

  it("resolves return_home when navy returns home to main", () => {
    const state = {
      ...baseState,
      activeCityId: "pr-42",
      navyTravelRequest: {
        id: "navy-home-pr-42-12345",
        cityId: "main",
        ship: "navy",
        carriesContainer: false,
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "return_home",
      destinationCityId: "main",
      currentCityId: "pr-42",
      repoKey: "owner/repo",
      travelRequestId: "navy-home-pr-42-12345",
    });
  });

  it("resolves worktree when sailing to worktree branch city", () => {
    const state = {
      ...baseState,
      issueTravelRequest: {
        id: "worktree-issue-10-12345",
        cityId: "issue-10",
        ship: "container",
        carriesContainer: true,
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "worktree",
      destinationCityId: "issue-10",
      currentCityId: "main",
      repoKey: "owner/repo",
      travelRequestId: "worktree-issue-10-12345",
    });
  });

  it("resolves return_home when harbour ship returns home from worktree", () => {
    const state = {
      ...baseState,
      activeCityId: "issue-10",
      issueTravelRequest: {
        id: "home-issue-10-12345",
        cityId: "main",
        ship: "container",
        carriesContainer: false,
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "return_home",
      destinationCityId: "main",
      currentCityId: "issue-10",
      repoKey: "owner/repo",
      travelRequestId: "home-issue-10-12345",
    });
  });

  it("resolves teleport when command palette fast travel is requested", () => {
    const state = {
      ...baseState,
      teleportTravelRequest: {
        id: "teleport-city-b-12345",
        cityId: "city-b",
        ship: "teleport",
      },
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "teleport",
      destinationCityId: "city-b",
      currentCityId: "main",
      repoKey: "owner/repo",
      travelRequestId: "teleport-city-b-12345",
    });
  });

  it("resolves ship_travel when sailing between cities", () => {
    const state = {
      ...baseState,
      shipTravelTargetId: "city-c",
    } as unknown as ReturnType<typeof useGameState>;

    const result = resolveTravelSkipProperties(state);
    expect(result).toEqual({
      context: "ship_travel",
      destinationCityId: "city-c",
      currentCityId: "main",
      repoKey: "owner/repo",
    });
  });
});
