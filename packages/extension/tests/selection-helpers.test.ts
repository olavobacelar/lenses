import { describe, it, expect } from "vitest";
import {
  MIN_SELECTION_CHARS,
  SELECTION_SNIPPET_MAX,
  buildTextIndex,
  buildTextAnchor,
  computeSelectionTriggerPosition,
  computeSourceCalloutLayout,
  findFindingTextAnchor,
  findTextAnchor,
  formatSelectionSnippet,
  isSelectionLongEnough,
  splitQuoteForReferences,
} from "../src/content/selection-helpers.js";

const VIEWPORT = { width: 1280, height: 800 };
const BUTTON = { width: 120, height: 32 };

describe("isSelectionLongEnough", () => {
  it("rejects whitespace-only selections", () => {
    expect(isSelectionLongEnough("")).toBe(false);
    expect(isSelectionLongEnough("   \n  ")).toBe(false);
  });

  it("accepts any non-empty selection after trimming", () => {
    const exactly = "a".repeat(MIN_SELECTION_CHARS);
    expect(isSelectionLongEnough(exactly)).toBe(true);
    expect(isSelectionLongEnough(`   ${exactly}   `)).toBe(true);
    expect(isSelectionLongEnough("x")).toBe(true);
    expect(isSelectionLongEnough("hello")).toBe(true);
    expect(isSelectionLongEnough("This sentence is plenty long.")).toBe(true);
  });
});

describe("formatSelectionSnippet", () => {
  it("wraps text in curly quotes and collapses whitespace", () => {
    expect(formatSelectionSnippet("  hello\n\n  world  ")).toBe("“hello world”");
  });

  it("truncates with an ellipsis past the snippet max", () => {
    const long = "x".repeat(SELECTION_SNIPPET_MAX + 50);
    const out = formatSelectionSnippet(long);
    expect(out.startsWith("“")).toBe(true);
    expect(out.endsWith("…”")).toBe(true);
    // Total length is the snippet max + the two wrapping quote chars + the ellipsis,
    // minus one because the last visible char is replaced by the ellipsis.
    expect(out.length).toBeLessThanOrEqual(SELECTION_SNIPPET_MAX + 2);
  });

  it("does not truncate when text fits exactly", () => {
    const exact = "y".repeat(SELECTION_SNIPPET_MAX);
    expect(formatSelectionSnippet(exact)).toBe(`“${exact}”`);
  });
});

describe("splitQuoteForReferences", () => {
  it("returns a single text segment when there are no references", () => {
    expect(splitQuoteForReferences("plain headline")).toEqual([
      { kind: "text", value: "plain headline" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(splitQuoteForReferences("")).toEqual([]);
  });

  it("extracts a single bracketed reference", () => {
    expect(splitQuoteForReferences("hello [1] world")).toEqual([
      { kind: "text", value: "hello " },
      { kind: "ref", value: "1" },
      { kind: "text", value: " world" },
    ]);
  });

  it("extracts multiple inline references in order", () => {
    const input = "“Sondagem: PS lidera[2] e AD cai[3]”";
    expect(splitQuoteForReferences(input)).toEqual([
      { kind: "text", value: "“Sondagem: PS lidera" },
      { kind: "ref", value: "2" },
      { kind: "text", value: " e AD cai" },
      { kind: "ref", value: "3" },
      { kind: "text", value: "”" },
    ]);
  });

  it("handles consecutive references with no text between", () => {
    expect(splitQuoteForReferences("foo[1][2]")).toEqual([
      { kind: "text", value: "foo" },
      { kind: "ref", value: "1" },
      { kind: "ref", value: "2" },
    ]);
  });

  it("ignores brackets that are not pure numeric references", () => {
    // Should not match: non-numeric, too long, or empty brackets.
    expect(splitQuoteForReferences("see [note] and [1234]")).toEqual([
      { kind: "text", value: "see [note] and [1234]" },
    ]);
  });

  it("treats a reference at the start without leading text", () => {
    expect(splitQuoteForReferences("[7] opening note")).toEqual([
      { kind: "ref", value: "7" },
      { kind: "text", value: " opening note" },
    ]);
  });
});

describe("computeSelectionTriggerPosition", () => {
  it("places the button above the selection when there is room", () => {
    const rect = { top: 400, bottom: 420, left: 600, width: 80 };
    const pos = computeSelectionTriggerPosition(rect, VIEWPORT, BUTTON.width, BUTTON.height);
    expect(pos.placement).toBe("above");
    expect(pos.top).toBe(400 - BUTTON.height - 8);
    // Centered horizontally on the selection
    expect(pos.left).toBe(600 + 80 / 2 - BUTTON.width / 2);
  });

  it("flips below when the selection is too close to the top edge", () => {
    const rect = { top: 4, bottom: 30, left: 100, width: 200 };
    const pos = computeSelectionTriggerPosition(rect, VIEWPORT, BUTTON.width, BUTTON.height);
    expect(pos.placement).toBe("below");
    expect(pos.top).toBe(30 + 8);
  });

  it("clamps a left-edge selection so the button stays on screen", () => {
    const rect = { top: 200, bottom: 220, left: -50, width: 60 };
    const pos = computeSelectionTriggerPosition(rect, VIEWPORT, BUTTON.width, BUTTON.height);
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });

  it("clamps a right-edge selection so the button stays on screen", () => {
    const rect = { top: 200, bottom: 220, left: VIEWPORT.width - 20, width: 100 };
    const pos = computeSelectionTriggerPosition(rect, VIEWPORT, BUTTON.width, BUTTON.height);
    expect(pos.left + BUTTON.width).toBeLessThanOrEqual(VIEWPORT.width - 8 + 0.001);
  });

  it("clamps a below-flip near the bottom edge", () => {
    const rect = { top: 4, bottom: VIEWPORT.height + 20, left: 100, width: 50 };
    const pos = computeSelectionTriggerPosition(rect, VIEWPORT, BUTTON.width, BUTTON.height);
    expect(pos.placement).toBe("below");
    expect(pos.top + BUTTON.height).toBeLessThanOrEqual(VIEWPORT.height - 8 + 0.001);
  });
});

describe("computeSourceCalloutLayout", () => {
  it("places the panel in the right margin when the article leaves enough room", () => {
    const layout = computeSourceCalloutLayout({
      articleRect: { left: 300, right: 900 },
      viewportWidth: 1440,
    });
    // gap=16 → left = 916, available right = 1440 - 900 - 16 - 12 = 512, capped to maxWidth=360.
    expect(layout.left).toBe(916);
    expect(layout.width).toBe(360);
  });

  it("uses the available width when it is between min and max", () => {
    const layout = computeSourceCalloutLayout({
      articleRect: { left: 200, right: 900 },
      viewportWidth: 1180,
    });
    // available right = 1180 - 900 - 16 - 12 = 252 (between minWidth=200 and maxWidth=360).
    expect(layout.left).toBe(916);
    expect(layout.width).toBe(252);
  });

  it("falls back to the left margin when the article hugs the right edge", () => {
    const layout = computeSourceCalloutLayout({
      articleRect: { left: 320, right: 1280 },
      viewportWidth: 1300,
    });
    // available right = 1300 - 1280 - 16 - 12 = -8 (< minWidth), so switch to left side.
    // available left = 320 - 16 - 12 = 292; width capped to maxWidth=360 → 292.
    expect(layout.left).toBe(12);
    expect(layout.width).toBe(292);
  });

  it("falls back to a right-aligned overlay when no article rect is given", () => {
    const layout = computeSourceCalloutLayout({
      articleRect: null,
      viewportWidth: 1280,
    });
    expect(layout.width).toBe(360);
    expect(layout.left).toBe(1280 - 12 - 360);
  });

  it("never lets the panel start at a negative left coordinate", () => {
    const layout = computeSourceCalloutLayout({
      articleRect: { left: 0, right: 320 },
      viewportWidth: 360,
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
  });
});

describe("text anchors", () => {
  it("builds a searchable text index for selections spanning text blocks", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const index = buildTextIndex([
      { node: first, text: "First paragraph.", startsNewTextBlock: false },
      { node: second, text: "Second paragraph.", startsNewTextBlock: true },
    ]);

    expect(index.text).toBe("First paragraph. Second paragraph.");
    expect(index.pieces).toEqual([
      { node: first, start: 0, end: 16 },
      { node: second, start: 17, end: 34 },
    ]);

    const anchor = buildTextAnchor(index.text, "First paragraph.\n\nSecond paragraph.");
    expect(findTextAnchor(index.text, anchor)).toEqual({
      start: 0,
      end: 34,
      kind: "normalized",
    });
  });

  it("does not add text index separators inside one inline text flow", () => {
    const index = buildTextIndex([
      { node: "first", text: "inter", startsNewTextBlock: false },
      { node: "second", text: "national", startsNewTextBlock: false },
    ]);

    expect(index.text).toBe("international");
    expect(index.pieces).toEqual([
      { node: "first", start: 0, end: 5 },
      { node: "second", start: 5, end: 13 },
    ]);
  });

  it("does not duplicate existing whitespace between text blocks", () => {
    const index = buildTextIndex([
      { node: "first", text: "First paragraph. ", startsNewTextBlock: false },
      { node: "second", text: "Second paragraph.", startsNewTextBlock: true },
    ]);

    expect(index.text).toBe("First paragraph. Second paragraph.");
    expect(index.pieces).toEqual([
      { node: "first", start: 0, end: 17 },
      { node: "second", start: 17, end: 34 },
    ]);
  });

  it("finds the exact selected text", () => {
    const page = "Before the selected passage after.";
    const anchor = buildTextAnchor(page, "selected passage");

    expect(findTextAnchor(page, anchor)).toEqual({
      start: 11,
      end: 27,
      kind: "exact",
    });
  });

  it("prefers stored offset for short repeated selections", () => {
    const page = "alpha NATO beta NATO gamma";
    const anchor = buildTextAnchor(page, "NATO");
    anchor.textStart = 16;
    anchor.textEnd = 20;

    expect(findTextAnchor(page, anchor)).toEqual({
      start: 16,
      end: 20,
      kind: "exact",
    });
  });

  it("matches when whitespace changes", () => {
    const anchor = buildTextAnchor("Before the selected passage after.", "selected passage");
    const changed = "Before the selected\n\npassage after.";

    expect(findTextAnchor(changed, anchor)).toMatchObject({
      start: 11,
      end: 28,
      kind: "normalized",
    });
  });

  it("anchors to changed text between stable context", () => {
    const anchor = buildTextAnchor(
      "The report said alpha teams arrived before sunset and then left.",
      "alpha teams arrived"
    );
    const changed = "The report said beta teams arrived before sunset and then left.";

    const match = findTextAnchor(changed, anchor);

    expect(match).toMatchObject({ kind: "context" });
    expect(changed.slice(match!.start, match!.end)).toBe("beta teams arrived");
  });
});

describe("finding anchors", () => {
  it("uses page source spans for page-scoped lens findings", () => {
    const page = "Intro. Alpha beta gamma delta. Outro.";
    const match = findFindingTextAnchor(page, "", "Alpha beta gamma delta", {
      start: 7,
      end: 29,
    });

    expect(match).toEqual({
      start: 7,
      end: 29,
      kind: "source_span",
    });
  });

  it("ignores stale page source spans when the text no longer matches", () => {
    const page = "Intro. Alpha beta gamma delta. Outro.";
    const match = findFindingTextAnchor(page, "", "Missing page text", {
      start: 7,
      end: 29,
    });

    expect(match).toBeNull();
  });

  it("uses source text spans when page-scoped finding text does not match the DOM index", () => {
    const page = "Intro. Alpha beta gamma delta. Outro.";
    const sourceText = "Alpha beta gamma delta.";
    const match = findFindingTextAnchor(
      page,
      "",
      "paraphrased finding",
      {
        start: 0,
        end: sourceText.length,
      },
      { sourceText }
    );

    expect(match).toEqual({
      start: page.indexOf(sourceText),
      end: page.indexOf(sourceText) + sourceText.length,
      kind: "source_span",
    });
  });

  it("uses citation source spans when the model text is not an exact page substring", () => {
    const selected = "Based on the parameters, it may have been a combat drone.";
    const page = `Before. ${selected} After.`;
    const match = findFindingTextAnchor(page, selected, "possibly a drone", {
      start: 0,
      end: selected.length,
    });

    expect(match).toEqual({
      start: 8,
      end: 8 + selected.length,
      kind: "source_span",
    });
  });

  it("maps citation source spans to substrings inside the selected text", () => {
    const selected = "Alpha beta gamma delta";
    const page = `Before ${selected} after`;
    const match = findFindingTextAnchor(page, selected, "paraphrased finding", {
      start: 6,
      end: 16,
    });

    expect(match).toEqual({
      start: 13,
      end: 23,
      kind: "source_span",
    });
    expect(page.slice(match!.start, match!.end)).toBe("beta gamma");
  });

  it("falls back to finding text within the selected text when no source span is available", () => {
    const selected = "Alpha beta gamma delta";
    const page = `Before ${selected} after`;
    const match = findFindingTextAnchor(page, selected, "beta gamma");

    expect(match).toMatchObject({
      start: 13,
      end: 23,
    });
  });

  it("matches smart quotes and dashes against plain punctuation", () => {
    const selected =
      "Based on the parameters we saw, it’s most likely either a combat drone. The counter-measures can’t tell.";
    const page = `Before ${selected} after`;
    const match = findFindingTextAnchor(
      page,
      selected,
      "it's most likely either a combat drone. The counter-measures can't tell"
    );

    expect(match).toMatchObject({
      start: 39,
      end: 110,
      kind: "normalized",
    });
    expect(page.slice(match!.start, match!.end)).toBe(
      "it’s most likely either a combat drone. The counter-measures can’t tell"
    );
  });

  it("can fall back to the selected passage when no exact finding anchor exists", () => {
    const selected = "Alpha beta gamma delta";
    const page = `Before ${selected} after`;
    const match = findFindingTextAnchor(
      page,
      selected,
      "a paraphrase that is not on the page",
      undefined,
      { fallbackToSelection: true }
    );

    expect(match).toEqual({
      start: 7,
      end: 7 + selected.length,
      kind: "selection_fallback",
    });
  });

  it("does not fall back to the selected passage unless requested", () => {
    const selected = "Alpha beta gamma delta";
    const page = `Before ${selected} after`;
    const match = findFindingTextAnchor(page, selected, "a paraphrase that is not on the page");

    expect(match).toBeNull();
  });
});
