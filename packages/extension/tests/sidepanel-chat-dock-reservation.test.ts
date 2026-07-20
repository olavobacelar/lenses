// The composer can grow to a generous CHAT_INPUT_MAX_HEIGHT and the history can
// collapse to zero, so a tall composer used to overflow the fixed-height panel
// and push its send row off the bottom. accordionCapPx tightens the sections
// above the chat dock so the dock always keeps room for the composer plus a
// MIN_HISTORY_HEIGHT sliver of log — without that, the composer is shoved off.

import { describe, it, expect } from "vitest";
import {
  accordionCapPx,
  ACCORDION_MAX_RATIO,
  DOCK_GAP,
  MIN_HISTORY_HEIGHT,
  PANEL_GAP,
  PANEL_PADDING,
} from "../src/sidepanel/lib/chat-dock-layout";

// A panel whose top sits at y=0, so panelBottom == panelHeight and the accordion
// starts just below a header of `headerHeight` (plus the panel's top padding).
function panel({
  panelHeight,
  headerHeight,
  composerHeight,
  dockHeadHeight = 22,
}: {
  panelHeight: number;
  headerHeight: number;
  composerHeight: number;
  dockHeadHeight?: number;
}) {
  return accordionCapPx({
    panelBottom: panelHeight,
    panelHeight,
    accordionTop: PANEL_PADDING + headerHeight,
    dockHeadHeight,
    composerHeight,
  });
}

const hardCap = (panelHeight: number) =>
  (panelHeight - PANEL_PADDING * 2) * ACCORDION_MAX_RATIO;

describe("accordionCapPx — sections cap so composer + history stay visible", () => {
  it("leaves the accordion at its full share when the composer is short", () => {
    // Tall panel, single-line composer: nothing to reserve, so the cap is the
    // unchanged 42% ceiling.
    const cap = panel({ panelHeight: 800, headerHeight: 60, composerHeight: 92 });
    expect(cap).toBeCloseTo(hardCap(800), 5);
  });

  it("tightens the accordion below 42% once the composer is tall", () => {
    // Moderate panel, paragraph-sized composer: the cap drops below the ceiling
    // to hand the dock its reserve.
    const cap = panel({ panelHeight: 600, headerHeight: 60, composerHeight: 292 });
    expect(cap).toBeLessThan(hardCap(600));
    expect(cap).toBeGreaterThan(0);
  });

  it("reserves exactly composer + MIN_HISTORY for the dock at the boundary", () => {
    // With the accordion at the returned cap, the leftover dock height should be
    // precisely head + gaps + MIN_HISTORY + composer.
    const panelHeight = 600;
    const headerHeight = 60;
    const composerHeight = 292;
    const dockHeadHeight = 22;
    const cap = panel({ panelHeight, headerHeight, composerHeight, dockHeadHeight });
    const accordionTop = PANEL_PADDING + headerHeight;
    const usableBottom = panelHeight - PANEL_PADDING;
    const dockHeight = usableBottom - (accordionTop + cap) - PANEL_GAP;
    const historyLeft = dockHeight - dockHeadHeight - DOCK_GAP * 2 - composerHeight;
    expect(historyLeft).toBeCloseTo(MIN_HISTORY_HEIGHT, 5);
  });

  it("never returns a negative height (sections fully yield in a tiny panel)", () => {
    const cap = panel({ panelHeight: 420, headerHeight: 60, composerHeight: 292 });
    expect(cap).toBe(0);
  });

  it("never exceeds the 42% ceiling", () => {
    const cap = panel({ panelHeight: 900, headerHeight: 40, composerHeight: 40 });
    expect(cap).toBeLessThanOrEqual(hardCap(900) + 1e-9);
  });
});
