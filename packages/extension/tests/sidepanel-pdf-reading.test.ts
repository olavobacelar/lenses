/**
 * The sidepanel's PDF reading experience: page chips on findings that jump the
 * panel's own copy of the text (Chrome's built-in PDF viewer cannot be
 * scrolled), page-grouped source text with inline scanned-page states, the
 * page-count header badge, and the dedicated ingestion-failure state.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FindingView } from "../src/sidepanel/components/FindingView.js";
import { SourceSection } from "../src/sidepanel/components/SourceSection.js";
import { findingAnchorPresentation } from "../src/sidepanel/components/LensSections.js";
import { lensFindingToClaim } from "../src/sidepanel/lib/claims.js";
import type { PdfPageText } from "../src/lib/pdf-source.js";
import type { PanelSource } from "../src/sidepanel/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const sidepanelDir = join(here, "..", "src", "sidepanel");
const read = (path: string) => readFileSync(path, "utf-8");

const noop = () => {};

function makePage(pageNumber: number, bodyText: string, ocrRequired = false): PdfPageText {
  const marker = `[PDF page ${pageNumber}]`;
  const text = `${marker}${bodyText ? `\n${bodyText}` : ""}`;
  return {
    pageNumber,
    text,
    start: 0,
    end: text.length,
    bodyText,
    bodyStart: marker.length + (bodyText ? 1 : 0),
    width: 612,
    height: 792,
    textItems: [],
    ocrRequired,
  };
}

function makePdfSource(pages: PdfPageText[]): PanelSource {
  return {
    key: "pdf:url:https://example.org/paper.pdf",
    kind: "pdf",
    title: "A paper",
    url: "https://example.org/paper.pdf",
    text: pages.map((page) => page.text).join("\n\n"),
    scope: "page",
    sourceMetadata: { origin: "url", pageCount: String(pages.length) },
    pdfPages: pages,
  };
}

function renderSource(source: PanelSource): string {
  return renderToStaticMarkup(
    createElement(SourceSection, {
      source,
      transcript: [],
      currentTime: null,
      isOpen: true,
      onToggle: noop,
      onSeek: noop,
      pdfJump: null,
    })
  );
}

describe("claims carry their PDF page through the finding round-trip", () => {
  it("maps a pdf anchor to page and pageLabel", () => {
    const claim = lensFindingToClaim({
      text: "A page-anchored claim",
      category: "statistic",
      detail: "",
      confidence: 0.9,
      anchor: { kind: "pdf", pageNumber: 4, pageLabel: "iv", start: 0, end: 10 },
    });
    expect(claim.page).toBe(4);
    expect(claim.pageLabel).toBe("iv");
    // The transcript-first timestamp field stays inert for PDF claims.
    expect(claim.timestamp).toBe("--:--");
  });

  it("leaves non-PDF claims without page fields", () => {
    const claim = lensFindingToClaim({
      text: "A timed claim",
      category: "quote",
      detail: "",
      confidence: 0.9,
      anchor: { kind: "transcript", timestamp: 301, formatted: "5:01" },
    });
    expect(claim.page).toBeUndefined();
    expect(claim.pageLabel).toBeUndefined();
    expect(claim.timestamp).toBe("5:01");
  });
});

describe("stacked findings present PDF anchors as chips, not meta text", () => {
  it("moves the page out of the meta line into a chip label", () => {
    const presentation = findingAnchorPresentation({
      text: "An assumption",
      category: "assumption",
      detail: "",
      confidence: 0.82,
      anchor: { kind: "pdf", pageNumber: 3, start: 0, end: 5 },
    });
    expect(presentation.metaLabel).toBe("assumption | 82%");
    expect(presentation.pageNumber).toBe(3);
    expect(presentation.pageLabel).toBe("Page 3");
  });

  it("keeps evidence-bases parity: the printed page label wins over the number", () => {
    const presentation = findingAnchorPresentation({
      text: "Front-matter finding",
      category: "claim",
      detail: "",
      confidence: 0.5,
      anchor: { kind: "pdf", pageNumber: 2, pageLabel: "ii", start: 0, end: 5 },
    });
    expect(presentation.pageLabel).toBe("Page ii");
  });

  it("still folds transcript anchors into the meta line", () => {
    const presentation = findingAnchorPresentation({
      text: "A timed finding",
      category: "claim",
      detail: "",
      confidence: 0.7,
      anchor: { kind: "transcript", timestamp: 12, formatted: "0:12" },
    });
    expect(presentation.metaLabel).toBe("0:12 | claim");
    expect(presentation.seekSeconds).toBe(12);
    expect(presentation.pageLabel).toBeUndefined();
  });
});

describe("FindingView page chips", () => {
  it("renders a compact page chip in the timestamp slot with the stamp styling", () => {
    const html = renderToStaticMarkup(
      createElement(FindingView, {
        variant: "compact",
        text: "A PDF claim",
        category: "statistic",
        pageLabel: "p.4",
        onPageJump: noop,
        onSeek: noop,
        onSendToChat: noop,
      })
    );
    expect(html).toContain('class="claim-stamp"');
    expect(html).toContain(">p.4</button>");
    expect(html).toContain("Jump to p.4 in the source text");
  });

  it("prefers a real timestamp over a page chip if both are ever present", () => {
    const html = renderToStaticMarkup(
      createElement(FindingView, {
        variant: "compact",
        text: "A timed claim",
        timestampLabel: "5:01",
        seekSeconds: 301,
        pageLabel: "p.4",
        onPageJump: noop,
        onSeek: noop,
        onSendToChat: noop,
      })
    );
    expect(html).toContain(">5:01</button>");
    expect(html).not.toContain(">p.4</button>");
  });

  it("renders the stacked chip beside the meta line, next to credibility", () => {
    const html = renderToStaticMarkup(
      createElement(FindingView, {
        text: "A stacked finding",
        metaLabel: "assumption | 82%",
        credibility: "high",
        pageLabel: "Page 3",
        onPageJump: noop,
        onSeek: noop,
        onSendToChat: noop,
      })
    );
    expect(html).toContain("assumption | 82%");
    expect(html).toContain('class="claim-meta-aside"');
    expect(html).toContain(">Page 3</button>");
    expect(html).toContain("high credibility");
  });
});

describe("SourceSection PDF rendering", () => {
  const pages = [
    makePage(1, "First page body text."),
    makePage(2, "", true),
    makePage(3, "Third page body text."),
  ];

  it("shows the page count next to the word count", () => {
    const html = renderSource(makePdfSource(pages));
    expect(html).toContain("3 pages");
    expect(html).toContain("words");
  });

  it("groups the text by page and drops the raw extraction markers", () => {
    const html = renderSource(makePdfSource(pages));
    expect(html).toContain('data-pdf-page="1"');
    expect(html).toContain('data-pdf-page="3"');
    expect(html).toContain(">Page 1</div>");
    expect(html).toContain("First page body text.");
    expect(html).not.toContain("[PDF page");
  });

  it("marks a scanned page inline with a tag and placeholder", () => {
    const html = renderSource(makePdfSource(pages));
    expect(html).toContain('class="pdf-scan-tag"');
    expect(html).toContain("No text layer on this page (scanned image).");
    // One scanned page among readable ones is not a scanned document.
    expect(html).not.toContain('class="pdf-scan-note"');
  });

  it("adds a single summary note when every page is scanned", () => {
    const scanned = [makePage(1, "", true), makePage(2, "", true)];
    const html = renderSource(makePdfSource(scanned));
    expect(html).toContain('class="pdf-scan-note"');
    expect(html.match(/pdf-scan-note/g)).toHaveLength(1);
  });

  it("keeps the flat text blob for non-PDF sources", () => {
    const html = renderSource({
      key: "url:https://example.org",
      kind: "web_page",
      title: "A page",
      url: "https://example.org",
      text: "Ordinary page text.",
      scope: "page",
    });
    expect(html).toContain('class="source-text-content"');
    expect(html).not.toContain("pdf-page");
  });
});

describe("wiring: chips jump the panel, failures get a dedicated state", () => {
  const app = read(join(sidepanelDir, "App.tsx"));
  const sourceHook = read(join(sidepanelDir, "hooks", "useActiveSource.ts"));
  const sourceSection = read(join(sidepanelDir, "components", "SourceSection.tsx"));

  it("opens the source section and hands SourceSection the jump target", () => {
    expect(app).toContain('setOpenSection("source")');
    expect(app).toContain("setPdfJump({ id: Date.now(), pageNumber })");
    expect(app).toContain("pdfJump={pdfJump}");
  });

  it("scrolls only the panel's own text, never the PDF viewer tab", () => {
    expect(sourceSection).toContain("container.scrollTop");
    expect(sourceSection).toContain("pdf-page-flash");
    expect(sourceSection).not.toContain("chrome.tabs");
  });

  it("turns fetchPdfSource failures into a retryable error state", () => {
    expect(sourceHook).toContain("setSourceError({ kind: \"pdf\", message: formatLoadError(error) })");
    expect(app).toContain("SourceErrorState");
    expect(app).toContain("onRetry={reloadSource}");
  });

  it("no longer warns about scanned PDFs from the loader (the section marks pages inline)", () => {
    expect(sourceHook).not.toContain("This PDF appears to be scanned");
  });
});
