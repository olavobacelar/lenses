import { describe, it, expect } from "vitest";
import {
  canPromote,
  customLensCountLabel,
  fallbackLensName,
  lensNameMap,
  newCustomLensId,
  persistedExtraLensIds,
  type ActiveCustomLens,
} from "../src/lib/custom-lens.js";

function activeLens(overrides: Partial<ActiveCustomLens> = {}): ActiveCustomLens {
  return {
    lensId: "custom-abc-123",
    name: "Test Lens",
    instruction: "find things",
    status: "completed",
    createdAt: 0,
    ...overrides,
  };
}

describe("newCustomLensId", () => {
  it("derives a per-creation id under the custom- prefix", () => {
    expect(newCustomLensId(0)).toMatch(/^custom-[0-9a-z]+-[0-9a-z]+$/);
  });

  it("produces distinct ids across creations", () => {
    expect(newCustomLensId(1)).not.toBe(newCustomLensId(1));
  });
});

describe("fallbackLensName", () => {
  it("derives a 2-3 word Title Case name from the instruction", () => {
    expect(fallbackLensName("highlight every date and deadline")).toBe(
      "Highlight Every Date"
    );
  });

  it("falls back to 'Custom Lens' for empty input", () => {
    expect(fallbackLensName("   ")).toBe("Custom Lens");
  });
});

describe("customLensCountLabel", () => {
  it("mirrors built-in run states then shows the finding count", () => {
    expect(customLensCountLabel("naming", undefined)).toBe("Naming…");
    expect(customLensCountLabel("running", undefined)).toBe("Running");
    expect(customLensCountLabel("failed", undefined)).toBe("Failed");
    expect(customLensCountLabel("completed", 3)).toBe("3");
    expect(customLensCountLabel("completed", undefined)).toBe("0");
  });
});

describe("canPromote", () => {
  it("only allows promoting a completed, not-yet-promoted one-off", () => {
    expect(canPromote(null)).toBe(false);
    expect(canPromote(activeLens({ status: "running" }))).toBe(false);
    expect(canPromote(activeLens({ promoted: true }))).toBe(false);
    expect(canPromote(activeLens())).toBe(true);
  });
});

describe("persistedExtraLensIds", () => {
  it("includes promoted user lenses", () => {
    expect(persistedExtraLensIds(null, [{ lensId: "u1", name: "U1" }])).toEqual(["u1"]);
  });

  it("adds the active one-off only once it has completed and is unpromoted", () => {
    expect(persistedExtraLensIds(activeLens({ status: "running" }), [])).toEqual([]);
    expect(persistedExtraLensIds(activeLens(), [])).toEqual(["custom-abc-123"]);
    expect(persistedExtraLensIds(activeLens({ promoted: true }), [])).toEqual([]);
  });

  it("does not duplicate an active lens already in the user list", () => {
    const active = activeLens({ lensId: "u1" });
    expect(persistedExtraLensIds(active, [{ lensId: "u1", name: "U1" }])).toEqual(["u1"]);
  });
});

describe("lensNameMap", () => {
  it("layers user-lens and active-lens names over the built-in labels", () => {
    const map = lensNameMap(
      { "claim-extractor": "Claims" },
      activeLens({ lensId: "custom-x", name: "Dates" }),
      [{ lensId: "u1", name: "Passive Voice" }]
    );
    expect(map).toMatchObject({
      "claim-extractor": "Claims",
      u1: "Passive Voice",
      "custom-x": "Dates",
    });
  });
});
