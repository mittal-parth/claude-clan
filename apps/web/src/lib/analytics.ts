import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

/**
 * Initializes PostHog analytics if `VITE_POSTHOG_KEY` is present.
 * Safe to call multiple times. If key is missing, operations will safely no-op.
 */
export function initAnalytics(): void {
  if (initialized) return;

  if (POSTHOG_KEY) {
    try {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        autocapture: false,
        persistence: "localStorage",
      });
      initialized = true;
    } catch (err) {
      console.warn("Failed to initialize PostHog analytics:", err);
    }
  }
}

/** Returns whether PostHog analytics is actively initialized. */
export function isAnalyticsInitialized(): boolean {
  return initialized;
}

/** Identify user upon login or session recovery. */
export function identifyUser(userId: string | number, traits?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    posthog.identify(String(userId), traits);
  } catch (err) {
    console.warn("PostHog identify failed:", err);
  }
}

/** Clear user session identity on logout. */
export function resetUser(): void {
  if (!initialized) return;
  try {
    posthog.reset();
  } catch (err) {
    console.warn("PostHog reset failed:", err);
  }
}

/** Track generic analytics event. */
export function trackEvent(eventName: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    posthog.capture(eventName, properties);
  } catch (err) {
    console.warn(`PostHog capture failed for '${eventName}':`, err);
  }
}

/** Track page/gate transitions. */
export function trackPageView(page: "login" | "repo_picker" | "city", properties?: Record<string, unknown>): void {
  trackEvent("page_viewed", { page, ...properties });
}

/** Track mayor order dispatch actions. */
export function trackMayorOrderDispatched(properties: {
  promptLength?: number;
  effort?: string;
  model?: string;
  repoKey?: string;
  cityId?: string;
}): void {
  trackEvent("mayor_order_dispatched", properties);
}

/** Track mayor order halt actions. */
export function trackMayorOrderHalted(properties?: { repoKey?: string; cityId?: string }): void {
  trackEvent("mayor_order_halted", properties);
}

/** Track permit decisions (ALLOW or DENY). */
export function trackPermitDecision(properties: {
  decision: "allow" | "deny";
  toolCallId?: string;
  repoKey?: string;
  cityId?: string;
}): void {
  trackEvent("permit_decided", properties);
}

/** Track repository selection / switching. */
export function trackRepoSelected(properties: { repoKey: string; fullName?: string }): void {
  trackEvent("repo_selected", properties);
}

/** Track repository import initiation. */
export function trackRepoImported(properties: { fullName: string }): void {
  trackEvent("repo_imported", properties);
}

/** Track building selection / inspector view. */
export function trackBuildingInspected(properties: { path: string; fileType?: string; lines?: number }): void {
  trackEvent("building_inspected", properties);
}

/** Track when a user takes an issue to fix. */
export function trackIssueTaken(properties: { issueNumber: number; repoKey?: string; cityId?: string }): void {
  trackEvent("issue_taken", properties);
}

/** Track when a user takes a snapshot of their city. */
export function trackCitySnapshotTaken(properties: { repoKey?: string; cityId?: string }): void {
  trackEvent("city_snapshot_taken", properties);
}

/** Track when a user shares their city snapshot to social media. */
export function trackCityShared(properties: { platform: "twitter" | "linkedin" | "copy" | "download"; repoKey?: string; cityId?: string }): void {
  trackEvent("city_shared", properties);
}

/** Track when a user toggles the audio theme. */
export function trackAudioToggled(properties: { enabled: boolean }): void {
  trackEvent("audio_toggled", properties);
}

/** Track when a user changes their active agent crew. */
export function trackCrewChanged(properties: { model: string; prevModel?: string; repoKey?: string }): void {
  trackEvent("crew_changed", properties);
}

/** Track when a WebSocket connection to a city succeeds. */
export function trackCityConnected(properties: { repoKey?: string; cityId: string }): void {
  trackEvent("city_connected", properties);
}

/** Track when a WebSocket connection to a city fails or disconnects unexpectedly. */
export function trackCityConnectionFailed(properties: { repoKey?: string; cityId: string; error?: string }): void {
  trackEvent("city_connection_failed", properties);
}

/** Track when a user initiates the login flow. */
export function trackLoginStarted(): void {
  trackEvent("login_started");
}

/** Track when a user logs out. */
export function trackLogout(): void {
  trackEvent("user_logged_out");
}

/** Track when a user begins the unauthenticated demo. */
export function trackDemoStarted(): void {
  trackEvent("demo_started");
}

/** Track when the command palette is opened. */
export function trackCommandPaletteOpened(): void {
  trackEvent("command_palette_opened");
}

/** Track when the issue shop is opened. */
export function trackIssueShopOpened(): void {
  trackEvent("issue_shop_opened");
}

/** Track when the user hits refresh on the repo list. */
export function trackRepoListRefreshed(): void {
  trackEvent("repo_list_refreshed");
}

/** Track when the user initiates fast travel to a different city. */
export function trackFastTravelInitiated(properties: { destinationCityId: string }): void {
  trackEvent("fast_travel_initiated", properties);
}
