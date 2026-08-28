import type { CityId, GameEvent } from "@sudo-city/protocol";

export interface EventDeliveryState {
  workspaceKey?: string;
  cityId: CityId;
  subscriptions: ReadonlySet<string>;
}

/**
 * Decide whether a socket should receive one event from a workspace. Modal
 * subscriptions follow a session across cities, while ordinary events still
 * reach the city being viewed so its map can animate without an open modal.
 * Deltas are the exception: broadcasting each token to every standing client
 * wastes socket bandwidth and used to make unrelated city views pay for it.
 */
export function shouldDeliverEvent(
  state: EventDeliveryState,
  workspaceKey: string,
  cityId: CityId,
  sessionId: string,
  event: Pick<GameEvent, "type">,
): boolean {
  if (state.workspaceKey !== workspaceKey) {
    return false;
  }
  const subscribed = state.subscriptions.has(sessionId);
  if (event.type === "session.delta") {
    return subscribed;
  }
  return subscribed || state.cityId === cityId;
}
