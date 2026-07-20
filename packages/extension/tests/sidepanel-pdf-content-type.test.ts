// @vitest-environment jsdom

/**
 * PDFs served from extensionless URLs (arXiv's canonical /pdf/<id> links)
 * defeat the .pdf-suffix fast path, so the sidepanel pivots on the content
 * type the content script reports from inside Chrome's PDF embedder page.
 * Pages that yield no text get the load-time error card instead of a silent
 * empty source, and blank titles fall back to a placeholder so the header
 * never renders its reload action beside an empty heading.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPdfSourceMock } = vi.hoisted(() => ({ fetchPdfSourceMock: vi.fn() }));

vi.mock("../src/lib/evidence-bases.js", () => ({
  fingerprintText: vi.fn(async (text: string) => `fingerprint:${text}`),
}));

// Mirrors the real resolver's contract: only URLs with a .pdf suffix resolve;
// arXiv-style extensionless URLs return null and must rely on the pivot.
vi.mock("../src/lib/pdf-source.js", () => ({
  fetchPdfSource: fetchPdfSourceMock,
  resolvePdfUrl: (rawUrl: string | undefined) =>
    rawUrl?.toLowerCase().endsWith(".pdf") ? rawUrl : null,
}));

import { useActiveSource } from "../src/sidepanel/hooks/useActiveSource.js";
import { Header } from "../src/sidepanel/components/Header.js";
import type { PanelSource } from "../src/sidepanel/types.js";

const ARXIV_PDF_URL = "https://arxiv.org/pdf/0806.3414";

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  Reflect.deleteProperty(globalThis, "chrome");
});

describe("content-type PDF pivot", () => {
  beforeEach(() => {
    fetchPdfSourceMock.mockReset();
  });

  it("routes an extensionless PDF URL to PDF ingestion via the reported content type", async () => {
    fetchPdfSourceMock.mockResolvedValue({
      title: "Quantum theory of collective strong coupling",
      text: "[PDF page 1]\nBody text",
      pages: [],
      pageCount: 12,
      fileHash: "hash",
      fingerprint: { contentHash: "hash" },
      ocrRequired: false,
    });
    installChromeMock({
      tab: { id: 7, url: ARXIV_PDF_URL, title: "0806.3414" },
      pageText: {
        text: "",
        sourceTitle: "",
        sourceKey: `url:${ARXIV_PDF_URL}`,
        scope: "page",
        contentType: "application/pdf",
      },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.source?.kind === "pdf");

    expect(fetchPdfSourceMock).toHaveBeenCalledWith(ARXIV_PDF_URL, "0806.3414");
    expect(probe.current.source).toMatchObject({
      key: `pdf:url:${ARXIV_PDF_URL}`,
      kind: "pdf",
      title: "Quantum theory of collective strong coupling",
      url: ARXIV_PDF_URL,
      sourceMetadata: { origin: "url", pageCount: "12" },
    });
    expect(probe.current.sourceError).toBeNull();
    expect(probe.showWarning).not.toHaveBeenCalled();
  });

  it("shows the PDF error card when pivoted ingestion fails", async () => {
    fetchPdfSourceMock.mockRejectedValue(new Error("Could not load PDF (403)."));
    installChromeMock({
      tab: { id: 7, url: ARXIV_PDF_URL, title: "0806.3414" },
      pageText: { text: "", sourceTitle: "", contentType: "application/pdf" },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.sourceError !== null);

    expect(probe.current.sourceError).toEqual({
      kind: "pdf",
      message: "Could not load PDF (403).",
    });
    expect(probe.current.source).toBeNull();
    expect(probe.current.isLoadingSource).toBe(false);
  });

  it("keeps ordinary .pdf URLs on the fast path without waiting for page text", async () => {
    fetchPdfSourceMock.mockResolvedValue({
      title: "A paper",
      text: "[PDF page 1]\nBody",
      pages: [],
      pageCount: 1,
      fileHash: "hash",
      fingerprint: { contentHash: "hash" },
      ocrRequired: false,
    });
    const chromeMock = installChromeMock({
      tab: { id: 7, url: "https://example.org/paper.pdf", title: "paper.pdf" },
      pageText: { text: "ignored" },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.source?.kind === "pdf");

    expect(chromeMock.sentMessages().some((m) => m.type === "get-page-text")).toBe(false);
  });
});

describe("pages with no extractable text", () => {
  it("surfaces the load-time error card instead of a silent empty source", async () => {
    installChromeMock({
      tab: { id: 9, url: "https://example.org/quiet", title: "Quiet page" },
      pageText: { text: "   \n ", sourceTitle: "Quiet page", contentType: "text/html" },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.sourceError !== null);

    expect(probe.current.sourceError).toEqual({
      kind: "page",
      message: "No text could be extracted from this page.",
    });
    expect(probe.current.source).toBeNull();
    expect(probe.current.isLoadingSource).toBe(false);
  });
});

describe("placeholder titles", () => {
  it("falls back to the tab title when the page reports a blank one", async () => {
    installChromeMock({
      tab: { id: 5, url: "https://example.org/a", title: "Tab title" },
      pageText: { text: "Hello world", sourceTitle: "  " },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.source !== null);
    expect(probe.current.source?.title).toBe("Tab title");
  });

  it("falls back to Untitled when neither the page nor the tab has a title", async () => {
    installChromeMock({
      tab: { id: 5, url: "https://example.org/a", title: "" },
      pageText: { text: "Hello world", sourceTitle: "" },
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.source !== null);
    expect(probe.current.source?.title).toBe("Untitled");
  });
});

describe("header title fallbacks", () => {
  const noop = () => {};

  function renderHeader(props: {
    source: PanelSource | null;
    isLoading: boolean;
  }): string {
    return renderToStaticMarkup(
      createElement(Header, {
        source: props.source,
        unsupportedPage: null,
        isLoading: props.isLoading,
        onReload: noop,
      })
    );
  }

  function makeSource(title: string): PanelSource {
    return {
      key: "url:https://example.org",
      kind: "web_page",
      title,
      url: "https://example.org",
      text: "Body",
      scope: "page",
    };
  }

  it("never renders the reload action beside an empty heading", () => {
    const markup = renderHeader({ source: makeSource(""), isLoading: false });
    expect(markup).toContain(">Untitled</h1>");
    expect(markup).toContain('data-tooltip="Reload source"');
  });

  it("says Loading source... only while a source is actually pending", () => {
    expect(renderHeader({ source: null, isLoading: true })).toContain(
      ">Loading source...</h1>"
    );
    expect(renderHeader({ source: null, isLoading: false })).toContain(">Untitled</h1>");
  });

  it("shows the real title when one exists", () => {
    const markup = renderHeader({ source: makeSource("A real title"), isLoading: false });
    expect(markup).toContain(">A real title</h1>");
  });
});

describe("content script wiring", () => {
  it("reports the document content type with page text", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(join(here, "..", "src", "content", "content.ts"), "utf-8");
    expect(content).toContain("contentType: document.contentType");
  });
});

interface ChromeMockConfig {
  tab: { id: number; url: string; title: string };
  pageText: Record<string, unknown>;
}

function installChromeMock({ tab, pageText }: ChromeMockConfig) {
  const sent: Array<{ type?: string; action?: string }> = [];

  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: { lastError: null },
      tabs: {
        query: vi.fn(async () => [tab]),
        sendMessage: vi.fn(
          (
            _tabId: number,
            message: { type?: string; action?: string },
            reply: (value: unknown) => void
          ) => {
            sent.push(message);
            if (message.type === "get-page-text") {
              reply(pageText);
              return;
            }
            reply({});
          }
        ),
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });

  return { sentMessages: () => sent };
}

let root: Root | null = null;

async function mountSource() {
  let current: ReturnType<typeof useActiveSource> | null = null;
  const showWarning = vi.fn();
  const hideWarning = vi.fn();

  function Probe() {
    current = useActiveSource({ showWarning, hideWarning });
    return createElement("div", null, current.source?.title ?? "No source");
  }

  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Probe));
    await nextTask();
  });

  return {
    get current() {
      if (!current) throw new Error("Source probe did not mount");
      return current;
    },
    showWarning,
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error("Timed out waiting for condition");
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
