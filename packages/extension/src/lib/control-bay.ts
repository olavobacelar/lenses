// Pure, DOM-free helpers for the side panel's experimental "control bay" — the
// foldable zone that ports the popup's lens picker + composer into the panel.
// Keeping the labels and summary/copy rules here lets them be unit-tested
// without chrome APIs or the DOM (the wiring lives in the sidepanel React app).

import type { ComposerMode } from "./composer";

// The built-in page lenses, in display order. The labels mirror the chip
// text in sidepanel.html and the dot palette in sidepanel.css.
export const BAY_LENS_ORDER = ["claim-extractor", "source-tracer"] as const;

export const BAY_LENS_LABELS: Record<string, string> = {
  "claim-extractor": "Claims",
  "source-tracer": "Sources",
};

const RETIRED_LENS_IDS: ReadonlySet<string> = new Set([
  "hedging-detector",
  "emotional-framing",
]);

export function withoutRetiredLensIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !RETIRED_LENS_IDS.has(id));
}

// Promoted user lenses share one indigo dot (mirrors --custom-lens in the
// stylesheet); built-in dots get their per-id color from CSS instead.
export const CUSTOM_LENS_DOT_COLOR = "#4f8df9";

export interface BayLensOption {
  id: string;
  label: string;
  // Only set for user lenses — they have no per-id rule in sidepanel.css, so
  // the chip/summary dot is colored inline. Built-ins leave this undefined.
  color?: string;
}

// The selectable chips: the built-ins first, then every promoted user lens
// in the order the backend returned them. Surfacing user lenses here is what
// lets a promoted one-off be re-selected and re-run from the bay.
export function buildLensOptions(
  userLenses: readonly { lensId: string; name: string }[]
): BayLensOption[] {
  const builtIns: BayLensOption[] = BAY_LENS_ORDER.map((id) => ({
    id,
    label: BAY_LENS_LABELS[id],
  }));
  const custom: BayLensOption[] = userLenses.map((lens) => ({
    id: lens.lensId,
    label: lens.name,
    color: CUSTOM_LENS_DOT_COLOR,
  }));
  return [...builtIns, ...custom];
}

// Collapsed-bar copy for the chosen lenses. A single name reads friendlier than
// a bare count; past one, the overlapping summary dots already convey "which",
// so a count keeps the bar from wrapping. Ids outside `order` are ignored so a
// stale stored selection can't render a blank chip. `order`/`labels` default to
// the built-ins; callers pass an extended order + labels to also summarize
// promoted user lenses.
export function summarizeLensSelection(
  ids: readonly string[],
  order: readonly string[] = BAY_LENS_ORDER,
  labels: Record<string, string> = BAY_LENS_LABELS
): string {
  const selected = order.filter((id) => ids.includes(id));
  if (selected.length === 0) return "No lenses";
  if (selected.length === 1) return labels[selected[0]] ?? "1 lens";
  return `${selected.length} lenses`;
}

// The chosen lens ids in canonical display order — drives both the summary dots
// and the Run payload, so they always agree regardless of click order. `order`
// defaults to the built-ins; pass [...BAY_LENS_ORDER, ...userLensIds] to keep
// selected promoted lenses instead of dropping them.
export function orderedSelectedLenses(
  ids: readonly string[],
  order: readonly string[] = BAY_LENS_ORDER
): string[] {
  return order.filter((id) => ids.includes(id));
}

// Mode-specific composer copy. "Ask" answers in the panel's own chat (right
// below the bay), so the hint says "below" rather than the popup's "side panel".
export const BAY_COMPOSER_COPY: Record<
  ComposerMode,
  { placeholder: string; hint?: string; menuLabel: string }
> = {
  lens: {
    placeholder: "Run a lens or ask about this page…",
    menuLabel: "Lens",
  },
  ask: {
    placeholder: "Ask a question about this page…",
    hint: "Answers below using the whole page as context.",
    menuLabel: "Ask",
  },
};

// The setting is opt-in; treat anything other than an explicit `true` as off so
// a missing/garbage stored value falls back to the popup behavior.
export function isUnifiedPanelEnabled(value: unknown): boolean {
  return value === true;
}
