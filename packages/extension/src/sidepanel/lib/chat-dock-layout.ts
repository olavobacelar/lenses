// Keeps the chat composer fully on screen AND a glimpse of chat history visible,
// by capping how tall the sections (accordion) above the chat dock may grow.
//
// The panel is a fixed-height flex column: header → accordion → chat dock
// (history + composer). The composer never shrinks (`flex: 0 0 auto`) and can
// grow to CHAT_INPUT_MAX_HEIGHT, while the history is free to collapse to zero
// (`min-height: 0`). With only those rules, a tall composer plus an open
// accordion overflows the panel and pushes the composer's send row off the
// bottom. Rather than floor the history (which would re-shove the composer off),
// we tighten the accordion's max-height so the dock always retains room for the
// composer plus MIN_HISTORY_HEIGHT of log. The cap only bites once the composer
// is tall enough to need it; a short composer leaves the accordion at its full
// ACCORDION_MAX_RATIO share.

// Geometry constants mirror sidepanel.css and must move in lockstep with it:
// `.panel-shell` padding (12px) and gap (10px), and `.chat-dock` gap (8px).
export const PANEL_PADDING = 12;
export const PANEL_GAP = 10;
export const DOCK_GAP = 8;

// The chat log never collapses past this — always at least a sliver of the
// conversation stays visible above the composer. "Doesn't have to be much":
// roughly one message line plus the log's own padding.
export const MIN_HISTORY_HEIGHT = 48;

// Upper bound on the sections, matching `.accordion { max-height: 42% }`. The
// dynamic cap only ever tightens below this; it never lets the accordion grow
// past the static rule.
export const ACCORDION_MAX_RATIO = 0.42;

export interface AccordionCapMetrics {
  /** Client-space bottom edge of `.panel-shell` (e.g. rect.bottom). */
  panelBottom: number;
  /** Border-box height of `.panel-shell`. */
  panelHeight: number;
  /** Client-space top edge of `.accordion` — captures all header/banner height above it. */
  accordionTop: number;
  /** Height of `.chat-dock-head` (the "Chat" / Clear row). */
  dockHeadHeight: number;
  /** Current height of `.chat-form`; grows with the textarea. */
  composerHeight: number;
}

/**
 * The accordion's allowed max-height (px) given the live composer height.
 * Returns a value in [0, ACCORDION_MAX_RATIO × panel content height].
 */
export function accordionCapPx(metrics: AccordionCapMetrics): number {
  const usableBottom = metrics.panelBottom - PANEL_PADDING;
  const spaceBelowAccordionTop = usableBottom - metrics.accordionTop;
  // Space the chat dock must keep: its header, the two internal gaps, a minimum
  // slice of history, and the whole composer.
  const dockReserve =
    metrics.dockHeadHeight + DOCK_GAP * 2 + MIN_HISTORY_HEIGHT + metrics.composerHeight;
  const cap = spaceBelowAccordionTop - PANEL_GAP - dockReserve;
  const hardCap = (metrics.panelHeight - PANEL_PADDING * 2) * ACCORDION_MAX_RATIO;
  return Math.max(0, Math.min(cap, hardCap));
}
