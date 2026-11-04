// Pure rule for whether the transcript should keep following the newest text.
// No DOM import, so it is unit-testable in plain node.

export const PIN_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Decide the pinned flag after a scroll event.
 *
 * Distance from the bottom alone is not enough: a streamed paragraph can add
 * more than the threshold in a single frame, and the scroll event for our own
 * catch-up write fires after that growth. Judging by distance alone read the
 * growth as "the user scrolled away", dropped the pin, and the transcript
 * stopped following mid-stream. So only an upward movement of `scrollTop`
 * unpins -- content growing underneath a stationary viewport never does.
 */
export function nextPinned(
  wasPinned: boolean,
  metrics: ScrollMetrics,
  previousScrollTop: number,
): boolean {
  const distance =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  if (distance < PIN_THRESHOLD_PX) return true;
  if (metrics.scrollTop < previousScrollTop) return false;
  return wasPinned;
}
