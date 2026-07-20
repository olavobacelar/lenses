import { describe, it, expect } from "vitest";
import {
  builtInLenses,
  enrichmentLenses,
  allLenses,
  getBuiltInLens,
  getVisibleLenses,
} from "../src/lenses/registry.js";

describe("lens registry", () => {
  it("exposes exactly the two visible, source-focused lenses in the picker", () => {
    const visible = getVisibleLenses();
    expect(visible.map((lens) => lens.id).sort()).toEqual([
      "claim-extractor",
      "source-tracer",
    ]);
    expect(visible.every((lens) => lens.focus === "source")).toBe(true);
    expect(visible.every((lens) => lens.visible)).toBe(true);
    expect(getBuiltInLens("hedging-detector")).toBeUndefined();
    expect(getBuiltInLens("emotional-framing")).toBeUndefined();
  });

  it("keeps enrichment lenses out of the visible set but resolvable by id", () => {
    expect(enrichmentLenses.every((lens) => lens.visible === false)).toBe(true);
    expect(enrichmentLenses.every((lens) => lens.focus === "finding")).toBe(true);

    // not in the picker
    expect(builtInLenses.map((lens) => lens.id)).not.toContain("verify-claim");
    // but resolvable for the agent / run pipeline
    expect(getBuiltInLens("verify-claim")?.id).toBe("verify-claim");
    expect(allLenses.map((lens) => lens.id)).toContain("verify-claim");
  });

  it("wires each visible lens to its suggested enrichment", () => {
    const byId = Object.fromEntries(allLenses.map((lens) => [lens.id, lens]));

    expect(byId["claim-extractor"].itemNoun).toBe("claim");
    expect(byId["claim-extractor"].runMode).toBe("auto");
    expect(byId["claim-extractor"].suggestedEnrichments).toEqual([
      { lensId: "verify-claim", auto: false },
    ]);
    expect(byId["source-tracer"].suggestedEnrichments[0].lensId).toBe(
      "locate-source"
    );
  });

  it("declares web_search only on the lenses that need it", () => {
    expect(getBuiltInLens("verify-claim")?.tools).toEqual(["web_search"]);
    expect(getBuiltInLens("locate-source")?.tools).toEqual(["web_search"]);
    expect(getBuiltInLens("claim-extractor")?.tools).toEqual([]);
  });

  it("references only enrichment lenses that actually exist", () => {
    const ids = new Set(allLenses.map((lens) => lens.id));
    for (const lens of builtInLenses) {
      for (const suggestion of lens.suggestedEnrichments) {
        expect(ids.has(suggestion.lensId)).toBe(true);
      }
    }
  });
});
