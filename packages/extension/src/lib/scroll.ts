/** Geometry of a scroll container, narrowed to what the fade math needs. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Which scroll edges have content hidden beyond them, used to arm the log's
 *  fade mask. A fade is only meaningful when something is actually clipped in
 *  that direction, so a short log that fits without scrolling reports neither. */
export interface ScrollOverflow {
  top: boolean;
  bottom: boolean;
}

// Sub-pixel scroll offsets (fractional scrollTop, rounding) mean "at the edge"
// is never exactly 0, so treat anything within a pixel as touching the edge.
const EDGE_EPSILON = 1;

export function computeScrollOverflow({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollMetrics): ScrollOverflow {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= EDGE_EPSILON) return { top: false, bottom: false };
  return {
    top: scrollTop > EDGE_EPSILON,
    bottom: scrollTop < scrollable - EDGE_EPSILON,
  };
}
