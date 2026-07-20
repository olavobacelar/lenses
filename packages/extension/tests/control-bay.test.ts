import { describe, it, expect } from "vitest";
import {
  BAY_COMPOSER_COPY,
  BAY_LENS_LABELS,
  BAY_LENS_ORDER,
  CUSTOM_LENS_DOT_COLOR,
  buildLensOptions,
  isUnifiedPanelEnabled,
  orderedSelectedLenses,
  summarizeLensSelection,
  withoutRetiredLensIds,
} from "../src/lib/control-bay.js";

describe("summarizeLensSelection", () => {
  it("reports no lenses for an empty selection", () => {
    expect(summarizeLensSelection([])).toBe("No lenses");
  });

  it("uses the friendly label for a single lens", () => {
    expect(summarizeLensSelection(["claim-extractor"])).toBe("Claims");
    expect(summarizeLensSelection(["source-tracer"])).toBe("Sources");
  });

  it("falls back to a count once more than one lens is chosen", () => {
    expect(summarizeLensSelection(["claim-extractor", "source-tracer"])).toBe(
      "2 lenses"
    );
    expect(summarizeLensSelection([...BAY_LENS_ORDER])).toBe("2 lenses");
  });

  it("ignores unknown and removed ids so stale selections cannot render blank chips", () => {
    expect(summarizeLensSelection(["mystery-lens"])).toBe("No lenses");
    expect(summarizeLensSelection(["mystery-lens", "hedging-detector"])).toBe(
      "No lenses"
    );
    expect(summarizeLensSelection(["emotional-framing"])).toBe("No lenses");
  });
});

describe("orderedSelectedLenses", () => {
  it("returns ids in canonical display order regardless of input order", () => {
    expect(
      orderedSelectedLenses(["source-tracer", "claim-extractor"])
    ).toEqual(["claim-extractor", "source-tracer"]);
  });

  it("drops unknown ids", () => {
    expect(orderedSelectedLenses(["nope", "source-tracer"])).toEqual([
      "source-tracer",
    ]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(orderedSelectedLenses([])).toEqual([]);
  });
});

describe("withoutRetiredLensIds", () => {
  it("drops retired built-ins while preserving current and custom lenses", () => {
    expect(
      withoutRetiredLensIds([
        "custom-x",
        "hedging-detector",
        "emotional-framing",
        "source-tracer",
      ])
    ).toEqual(["custom-x", "source-tracer"]);
  });
});

describe("buildLensOptions", () => {
  it("lists the two built-ins with no inline color", () => {
    const options = buildLensOptions([]);
    expect(options.map((option) => option.id)).toEqual([...BAY_LENS_ORDER]);
    for (const option of options) {
      expect(option.label).toBe(BAY_LENS_LABELS[option.id]);
      expect(option.color).toBeUndefined();
    }
  });

  it("appends promoted user lenses after the built-ins with a dot color", () => {
    const options = buildLensOptions([{ lensId: "custom-x", name: "Dates" }]);
    expect(options).toHaveLength(BAY_LENS_ORDER.length + 1);
    const custom = options[options.length - 1];
    expect(custom).toEqual({ id: "custom-x", label: "Dates", color: CUSTOM_LENS_DOT_COLOR });
  });
});

describe("orderedSelectedLenses with user lenses", () => {
  it("keeps a selected user lens when its id is in the extended order", () => {
    const order = [...BAY_LENS_ORDER, "custom-x"];
    expect(orderedSelectedLenses(["custom-x", "claim-extractor"], order)).toEqual([
      "claim-extractor",
      "custom-x",
    ]);
  });

  it("drops a user lens when the order is the built-in default", () => {
    expect(orderedSelectedLenses(["custom-x"])).toEqual([]);
  });
});

describe("summarizeLensSelection with user lenses", () => {
  it("uses the user lens label for a single selected user lens", () => {
    const order = [...BAY_LENS_ORDER, "custom-x"];
    const labels = { ...BAY_LENS_LABELS, "custom-x": "Dates" };
    expect(summarizeLensSelection(["custom-x"], order, labels)).toBe("Dates");
  });
});

describe("isUnifiedPanelEnabled", () => {
  it("is true only for an explicit boolean true", () => {
    expect(isUnifiedPanelEnabled(true)).toBe(true);
  });

  it("treats anything else as off", () => {
    expect(isUnifiedPanelEnabled(false)).toBe(false);
    expect(isUnifiedPanelEnabled(undefined)).toBe(false);
    expect(isUnifiedPanelEnabled("true")).toBe(false);
    expect(isUnifiedPanelEnabled(1)).toBe(false);
    expect(isUnifiedPanelEnabled(null)).toBe(false);
  });
});

describe("bay constants", () => {
  it("has a label for every lens in display order", () => {
    for (const id of BAY_LENS_ORDER) {
      expect(BAY_LENS_LABELS[id]).toBeTruthy();
    }
  });

  it("provides copy for both composer modes", () => {
    expect(BAY_COMPOSER_COPY.lens.menuLabel).toBe("Lens");
    expect(BAY_COMPOSER_COPY.ask.menuLabel).toBe("Ask");
    for (const mode of ["lens", "ask"] as const) {
      expect(BAY_COMPOSER_COPY[mode].placeholder.length).toBeGreaterThan(0);
    }
    expect(BAY_COMPOSER_COPY.lens.hint).toBeUndefined();
    expect(BAY_COMPOSER_COPY.ask.hint?.length).toBeGreaterThan(0);
  });
});
