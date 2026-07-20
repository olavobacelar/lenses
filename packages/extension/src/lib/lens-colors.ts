export const BUILT_IN_LENS_COLORS: Record<
  string,
  Record<string, { color: string; label: string }>
> = {
  "claim-extractor": {
    empirical: { color: "#629b64", label: "Empirical claim" },
    causal: { color: "#498dc3", label: "Causal claim" },
    comparative: { color: "#904c9c", label: "Comparative claim" },
    predictive: { color: "#ca8e36", label: "Predictive claim" },
    normative: { color: "#c35d55", label: "Normative claim" },
  },
  "source-tracer": {
    primary: { color: "#629b64", label: "Primary source" },
    secondary: { color: "#498dc3", label: "Secondary source" },
    unsourced: { color: "#c35d55", label: "Needs source" },
    self_referential: { color: "#ca8e36", label: "Self-referential" },
  },
};

export const CUSTOM_LENS_CATEGORY = "match";
export const CUSTOM_LENS_COLOR = "#4f8df9";
export const CUSTOM_LENS_COLORS: Record<string, { color: string; label: string }> = {
  [CUSTOM_LENS_CATEGORY]: { color: CUSTOM_LENS_COLOR, label: "Match" },
};

export function colorsForLens(lensId: string): Record<string, { color: string; label: string }> {
  return BUILT_IN_LENS_COLORS[lensId] ?? CUSTOM_LENS_COLORS;
}
