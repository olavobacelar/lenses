import { describe, it, expect } from "vitest";
import {
  describePendingAskContext,
  resolveComposerAction,
  pendingAskKey,
  pendingLensRunKey,
  isPendingAskFresh,
  isPendingLensRunFresh,
  parsePendingAsk,
  parsePendingLensRun,
  PENDING_ASK_TTL_MS,
  PENDING_LENS_RUN_TTL_MS,
} from "../src/lib/composer.js";

describe("resolveComposerAction", () => {
  it("treats a blank query as a no-op in both modes", () => {
    expect(resolveComposerAction("lens", "   \n ")).toEqual({
      kind: "noop",
      instruction: "",
    });
    expect(resolveComposerAction("ask", "")).toEqual({
      kind: "noop",
      instruction: "",
    });
  });

  it("trims the instruction and carries the active mode", () => {
    expect(resolveComposerAction("lens", "  find every date  ")).toEqual({
      kind: "lens",
      instruction: "find every date",
    });
    expect(resolveComposerAction("ask", "  what is the thesis?  ")).toEqual({
      kind: "ask",
      instruction: "what is the thesis?",
    });
  });
});

describe("pendingAskKey", () => {
  it("namespaces the key by tab id so tabs do not collide", () => {
    expect(pendingAskKey(7)).toBe("pendingAsk:7");
    expect(pendingAskKey(42)).not.toBe(pendingAskKey(7));
  });
});

describe("pendingLensRunKey", () => {
  it("namespaces the key by tab id so tabs do not collide", () => {
    expect(pendingLensRunKey(7)).toBe("pendingLensRun:7");
    expect(pendingLensRunKey(42)).not.toBe(pendingLensRunKey(7));
  });
});

describe("parsePendingAsk", () => {
  it("returns null for non-object or malformed values", () => {
    expect(parsePendingAsk(null)).toBeNull();
    expect(parsePendingAsk("nope")).toBeNull();
    expect(parsePendingAsk({ question: "hi" })).toBeNull();
    expect(parsePendingAsk({ createdAt: 123 })).toBeNull();
    expect(parsePendingAsk({ question: "   ", createdAt: 123 })).toBeNull();
  });

  it("parses and trims a well-formed pending ask", () => {
    expect(parsePendingAsk({ question: "  hello  ", createdAt: 5 })).toEqual({
      question: "hello",
      createdAt: 5,
    });
  });

  it("parses a pending ask draft for opening the side panel without sending", () => {
    expect(parsePendingAsk({ draft: "  About this:\n\n", createdAt: 5 })).toEqual({
      draft: "  About this:\n\n",
      createdAt: 5,
    });
  });

  it("parses contextual selection asks", () => {
    expect(
      parsePendingAsk({
        question: "  explain it  ",
        displayContent: " Explain the selection ",
        context: {
          kind: "selection",
          selectedText: " selected text ",
          pageContext: " page body ",
          selectionMode: "explain",
        },
        createdAt: 5,
      })
    ).toEqual({
      question: "explain it",
      displayContent: "Explain the selection",
      context: {
        kind: "selection",
        selectedText: "selected text",
        pageContext: "page body",
        selectionMode: "explain",
      },
      createdAt: 5,
    });
  });

  it("parses contextual annotation asks", () => {
    expect(
      parsePendingAsk({
        draft: "About this flag:\n\n",
        targetLensId: " source-tracer ",
        context: {
          kind: "annotations",
          annotations: [
            {
              lensId: "source-tracer",
              label: "Needs source",
              category: "Source",
              text: "A factual claim",
              detail: "No citation",
              confidence: 0.8,
            },
          ],
        },
        createdAt: 5,
      })
    ).toEqual({
      draft: "About this flag:\n\n",
      targetLensId: "source-tracer",
      context: {
        kind: "annotations",
        annotations: [
          {
            lensId: "source-tracer",
            label: "Needs source",
            category: "Source",
            text: "A factual claim",
            detail: "No citation",
            confidence: 0.8,
          },
        ],
      },
      createdAt: 5,
    });
  });
});

describe("parsePendingLensRun", () => {
  it("returns null for non-object or malformed values", () => {
    expect(parsePendingLensRun(null)).toBeNull();
    expect(parsePendingLensRun("nope")).toBeNull();
    expect(parsePendingLensRun({ createdAt: 123 })).toBeNull();
    expect(parsePendingLensRun({ lensIds: [], createdAt: 123 })).toBeNull();
    expect(
      parsePendingLensRun({ customLens: { instruction: "   " }, createdAt: 123 })
    ).toBeNull();
  });

  it("parses and trims built-in lens runs", () => {
    expect(
      parsePendingLensRun({
        lensIds: [" source-tracer ", "", 2, "claim-extractor"],
        storePageLenses: false,
        createdAt: 5,
      })
    ).toEqual({
      lensIds: ["source-tracer", "claim-extractor"],
      storePageLenses: false,
      createdAt: 5,
    });
  });

  it("parses and trims custom lens runs", () => {
    expect(
      parsePendingLensRun({
        customLens: { instruction: "  find every deadline  " },
        createdAt: 5,
      })
    ).toEqual({
      customLens: { instruction: "find every deadline" },
      createdAt: 5,
    });
  });
});

describe("isPendingAskFresh", () => {
  const now = 1_000_000;

  it("accepts an ask created within the TTL window", () => {
    expect(isPendingAskFresh({ question: "q", createdAt: now }, now)).toBe(true);
    expect(
      isPendingAskFresh({ question: "q", createdAt: now - PENDING_ASK_TTL_MS }, now)
    ).toBe(true);
  });

  it("rejects an ask older than the TTL", () => {
    expect(
      isPendingAskFresh(
        { question: "q", createdAt: now - PENDING_ASK_TTL_MS - 1 },
        now
      )
    ).toBe(false);
  });

  it("rejects clock-skewed future timestamps", () => {
    expect(
      isPendingAskFresh({ question: "q", createdAt: now + 5_000 }, now)
    ).toBe(false);
  });
});

describe("isPendingLensRunFresh", () => {
  const now = 1_000_000;

  it("accepts a run created within the TTL window", () => {
    expect(
      isPendingLensRunFresh({ lensIds: ["source-tracer"], createdAt: now }, now)
    ).toBe(true);
    expect(
      isPendingLensRunFresh(
        {
          lensIds: ["source-tracer"],
          createdAt: now - PENDING_LENS_RUN_TTL_MS,
        },
        now
      )
    ).toBe(true);
  });

  it("rejects a run older than the TTL", () => {
    expect(
      isPendingLensRunFresh(
        {
          lensIds: ["source-tracer"],
          createdAt: now - PENDING_LENS_RUN_TTL_MS - 1,
        },
        now
      )
    ).toBe(false);
  });

  it("rejects clock-skewed future timestamps", () => {
    expect(
      isPendingLensRunFresh(
        { lensIds: ["source-tracer"], createdAt: now + 5_000 },
        now
      )
    ).toBe(false);
  });
});

describe("describePendingAskContext", () => {
  const annotation = {
    lensId: "source-tracer",
    label: "Needs source",
    category: "unsourced",
    text: "quoted span",
    detail: "no citation",
    confidence: 0.9,
  };

  it("summarizes a selection with a quoted, whitespace-collapsed snippet", () => {
    const summary = describePendingAskContext({
      kind: "selection",
      selectedText: "  The study\n  found   nothing.  ",
      pageContext: "page text",
    });
    expect(summary.kind).toBe("selection");
    expect(summary.label).toBe("Selection: “The study found nothing.”");
  });

  it("truncates a long selection with an ellipsis", () => {
    const summary = describePendingAskContext({
      kind: "selection",
      selectedText: "x".repeat(200),
      pageContext: "page text",
    });
    expect(summary.label.length).toBeLessThan(80);
    expect(summary.label.endsWith("…”")).toBe(true);
  });

  it("names a single finding by its label", () => {
    const summary = describePendingAskContext({
      kind: "annotations",
      annotations: [annotation],
    });
    expect(summary).toEqual({ kind: "annotations", label: "Finding: Needs source" });
  });

  it("counts multiple findings", () => {
    const summary = describePendingAskContext({
      kind: "annotations",
      annotations: [annotation, { ...annotation, label: "Loaded language" }],
    });
    expect(summary.label).toBe("Findings: 2 highlights");
  });

  it("degrades gracefully when annotations are empty", () => {
    expect(
      describePendingAskContext({ kind: "annotations", annotations: [] }).label
    ).toBe("Highlighted findings");
  });
});
