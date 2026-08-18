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
    trackMayorOrderDispatched({ promptLength: 42, effort: "high" });
    expect(posthog.capture).toHaveBeenCalledWith("mayor_order_dispatched", {
      promptLength: 42,
      effort: "high",
    });

    trackMayorOrderHalted({ repoKey: "demo", cityId: "main" });
    expect(posthog.capture).toHaveBeenCalledWith("mayor_order_halted", {
      repoKey: "demo",
      cityId: "main",
    });

    trackPermitDecision({ decision: "allow-always", toolCallId: "permit-1" });
    expect(posthog.capture).toHaveBeenCalledWith("permit_decided", {
      decision: "allow-always",
      toolCallId: "permit-1",
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
  });
});
