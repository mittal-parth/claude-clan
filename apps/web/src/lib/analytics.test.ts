import { describe, expect, it, vi, beforeEach } from "vitest";
import posthog from "posthog-js";
import {
  initAnalytics,
  isAnalyticsInitialized,
  identifyUser,
  resetUser,
  trackEvent,
  trackPageView,
  trackMayorOrderDispatched,
  trackMayorOrderHalted,
  trackPermitDecision,
  trackRepoSelected,
  trackRepoImported,
  trackBuildingInspected,
  trackBillboardClicked,
  trackWorktreeShopOpened,
  trackPrShopOpened,
  trackDemoSignInPrompted,
  trackAirportOpened,
  trackCityShared,
  trackFastTravelInitiated,
  trackFastTravelSkipped,
  trackRepoImportSucceeded,
  trackRepoImportFailed,
  trackRepoImportRejected,
  trackPrDeployed,
  trackWorktreeDeployed,
  trackSessionArchived,
  trackSessionUnarchived,
  trackSessionRenamed,
  trackSessionConfigured,
  trackSessionTranscriptCopied,
  trackArchivedSessionsOpened,
  trackSessionFocused,
  trackSessionBlurred,
  trackBuildingAttached,
  trackDistrictRescanned,
  trackPrListRefreshed,
  trackFpsToggled,
  trackGithubInstallClicked,
  _resetAnalyticsForTesting,
} from "./analytics.js";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    capture: vi.fn(),
  },
}));

describe("analytics helper", () => {
  const originalKey = import.meta.env.VITE_POSTHOG_KEY;
  const originalHost = import.meta.env.VITE_POSTHOG_HOST;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAnalyticsForTesting();
    delete import.meta.env.VITE_POSTHOG_KEY;
    delete import.meta.env.VITE_POSTHOG_HOST;
  });

  it("safely no-ops tracking when uninitialized", () => {
    initAnalytics();
    expect(isAnalyticsInitialized()).toBe(false);

    identifyUser(123, { login: "test" });
    expect(posthog.identify).not.toHaveBeenCalled();

    trackEvent("custom_event", { foo: "bar" });
    expect(posthog.capture).not.toHaveBeenCalled();

    resetUser();
    expect(posthog.reset).not.toHaveBeenCalled();

    trackPageView("login");
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("initializes and delegates to PostHog when VITE_POSTHOG_KEY is set", () => {
    import.meta.env.VITE_POSTHOG_KEY = "phc_test_key";
    import.meta.env.VITE_POSTHOG_HOST = "https://custom.posthog.com";

    initAnalytics();
    expect(isAnalyticsInitialized()).toBe(true);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        api_host: "https://custom.posthog.com",
        capture_pageview: false,
        autocapture: false,
      }),
    );

    // Identify and reset
    identifyUser(456, { login: "octocat" });
    expect(posthog.identify).toHaveBeenCalledWith("456", { login: "octocat" });

    resetUser();
    expect(posthog.reset).toHaveBeenCalled();

    // Pageview tracking with canonical page protection
    trackPageView("login", { repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("page_viewed", {
      repoKey: "demo",
      page: "login",
    });

    // Caller page property cannot overwrite canonical page
    trackPageView("city", { page: "spoofed", foo: "bar" } as Record<string, unknown>);
    expect(posthog.capture).toHaveBeenCalledWith("page_viewed", {
      page: "city",
      foo: "bar",
    });

    // Domain events
    trackMayorOrderDispatched({ promptLength: 42, effort: "high", sessionId: "sess-1" });
    expect(posthog.capture).toHaveBeenCalledWith("mayor_order_dispatched", {
      promptLength: 42,
      effort: "high",
      sessionId: "sess-1",
    });

    trackMayorOrderHalted({ repoKey: "demo", cityId: "main", sessionId: "sess-1" });
    expect(posthog.capture).toHaveBeenCalledWith("mayor_order_halted", {
      repoKey: "demo",
      cityId: "main",
      sessionId: "sess-1",
    });

    trackPermitDecision({ decision: "allow-always", toolCallId: "permit-1", sessionId: "sess-1" });
    expect(posthog.capture).toHaveBeenCalledWith("permit_decided", {
      decision: "allow-always",
      toolCallId: "permit-1",
      sessionId: "sess-1",
    });

    trackRepoSelected({ repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("repo_selected", { repoKey: "octocat/repo" });

    trackRepoImported({ fullName: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("repo_imported", { fullName: "octocat/repo" });

    trackBuildingInspected({ path: "src/main.ts", lines: 100 });
    expect(posthog.capture).toHaveBeenCalledWith("building_inspected", {
      path: "src/main.ts",
      lines: 100,
    });

    trackBillboardClicked({ kind: "ad", url: "https://pushtoprod.art", sponsorId: "pushtoprod" });
    expect(posthog.capture).toHaveBeenCalledWith("billboard_clicked", {
      kind: "ad",
      url: "https://pushtoprod.art",
      sponsorId: "pushtoprod",
    });

    trackWorktreeShopOpened();
    expect(posthog.capture).toHaveBeenCalledWith("worktree_shop_opened", undefined);

    trackPrShopOpened();
    expect(posthog.capture).toHaveBeenCalledWith("pr_shop_opened", undefined);

    trackDemoSignInPrompted({ action: "dispatch a crew" });
    expect(posthog.capture).toHaveBeenCalledWith("demo_sign_in_prompted", {
      action: "dispatch a crew",
    });

    trackAirportOpened({ repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("airport_opened", { repoKey: "octocat/repo" });

    trackCityShared({ platform: "instagram_post", repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("city_shared", {
      platform: "instagram_post",
      repoKey: "octocat/repo",
    });

    trackFastTravelInitiated({ destinationCityId: "pr-1", via: "ship" });
    expect(posthog.capture).toHaveBeenCalledWith("fast_travel_initiated", {
      destinationCityId: "pr-1",
      via: "ship",
    });

    trackFastTravelSkipped({
      context: "pr_attack",
      destinationCityId: "pr-1",
      currentCityId: "main",
      repoKey: "demo",
    });
    expect(posthog.capture).toHaveBeenCalledWith("fast_travel_skipped", {
      context: "pr_attack",
      destinationCityId: "pr-1",
      currentCityId: "main",
      repoKey: "demo",
    });

    trackRepoImportSucceeded({ fullName: "octocat/repo", repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("repo_import_succeeded", {
      fullName: "octocat/repo",
      repoKey: "octocat/repo",
    });

    trackRepoImportFailed({ fullName: "octocat/repo", error: "Timeout" });
    expect(posthog.capture).toHaveBeenCalledWith("repo_import_failed", {
      fullName: "octocat/repo",
      error: "Timeout",
    });

    trackRepoImportRejected({ fullName: "octocat/repo", maxRepoSizeMb: 150, sizeMb: 200 });
    expect(posthog.capture).toHaveBeenCalledWith("repo_import_rejected", {
      fullName: "octocat/repo",
      maxRepoSizeMb: 150,
      sizeMb: 200,
    });

    trackPrDeployed({ prCityId: "pr-2", repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("pr_deployed", {
      prCityId: "pr-2",
      repoKey: "octocat/repo",
    });

    trackWorktreeDeployed({ worktreeCityId: "worktree-1", repoKey: "octocat/repo" });
    expect(posthog.capture).toHaveBeenCalledWith("worktree_deployed", {
      worktreeCityId: "worktree-1",
      repoKey: "octocat/repo",
    });

    trackSessionArchived({ sessionId: "sess-1", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_archived", {
      sessionId: "sess-1",
      repoKey: "demo",
    });

    trackSessionUnarchived({ sessionId: "sess-1", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_unarchived", {
      sessionId: "sess-1",
      repoKey: "demo",
    });

    trackSessionRenamed({ sessionId: "sess-1", title: "New title", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_renamed", {
      sessionId: "sess-1",
      title: "New title",
      repoKey: "demo",
    });

    trackSessionConfigured({
      sessionId: "sess-1",
      model: "claude-3-7-sonnet",
      effort: "high",
      permissionMode: "auto",
      repoKey: "demo",
    });
    expect(posthog.capture).toHaveBeenCalledWith("session_configured", {
      sessionId: "sess-1",
      model: "claude-3-7-sonnet",
      effort: "high",
      permissionMode: "auto",
      repoKey: "demo",
    });

    trackSessionTranscriptCopied({ sessionId: "sess-1", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_transcript_copied", {
      sessionId: "sess-1",
      repoKey: "demo",
    });

    trackArchivedSessionsOpened({ repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("archived_sessions_opened", {
      repoKey: "demo",
    });

    trackSessionFocused({ sessionId: "sess-1", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_focused", {
      sessionId: "sess-1",
      repoKey: "demo",
    });

    trackSessionBlurred({ sessionId: "sess-1", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("session_blurred", {
      sessionId: "sess-1",
      repoKey: "demo",
    });

    trackBuildingAttached({ path: "src/main.ts", target: "session", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("building_attached", {
      path: "src/main.ts",
      target: "session",
      repoKey: "demo",
    });

    trackDistrictRescanned({ cityId: "main", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("district_rescanned", {
      cityId: "main",
      repoKey: "demo",
    });

    trackPrListRefreshed({ cityId: "main", repoKey: "demo" });
    expect(posthog.capture).toHaveBeenCalledWith("pr_list_refreshed", {
      cityId: "main",
      repoKey: "demo",
    });

    trackFpsToggled({ targetFps: 60 });
    expect(posthog.capture).toHaveBeenCalledWith("fps_toggled", {
      targetFps: 60,
    });

    trackGithubInstallClicked();
    expect(posthog.capture).toHaveBeenCalledWith("github_install_clicked", undefined);
  });
});
