// Local BYOK selection/annotation chat streams with the same behavior as the
// managed pipeline: same prompt flavors and per-lens settings, web tools,
// structured verdict header, and the standard port event contract. These tests
// pin the prompt builder, the header-stripping segment math, the meta-aware
// callback wrapper, and the service-worker wiring.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalAskFindingPrompt,
  makeLocalFindingCallbacks,
  stripLeadingCharsFromSegments,
  type LocalFindingStreamRequest,
} from "../src/background/local-finding-stream.js";
import type { TextSegment } from "../src/types/ai-content.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) =>
  readFileSync(join(here, "..", "src", ...parts), "utf-8");

const annotation = {
  lensId: "claim-extractor",
  label: "Empirical claim",
  category: "empirical",
  text: "a flagged span",
  detail: "states a measurable fact",
  confidence: 0.8,
};

function selectionRequest(
  overrides: Partial<LocalFindingStreamRequest> = {}
): LocalFindingStreamRequest {
  return {
    question: "Is this claim accurate?",
    sourceUrl: "https://example.com/a",
    annotations: [],
    selectionText: "The study proves the effect.",
    pageContext: "Full page text here.",
    selectionMode: "truth",
    ...overrides,
  };
}

describe("buildLocalAskFindingPrompt", () => {
  it("gives selection chat web search with required inline citations", () => {
    const prompt = buildLocalAskFindingPrompt(selectionRequest());
    expect(prompt.webSearch).toBe(true);
    expect(prompt.systemPrompt).toContain("selected a passage");
    expect(prompt.systemPrompt).toContain("inline citations");
    expect(prompt.contextMessage).toContain("Selected text from the page:");
    expect(prompt.contextMessage).toContain("The study proves the effect.");
    expect(prompt.contextMessage).toContain("Page text (extracted");
  });

  it("appends the verdict header instruction only for the truth mode", () => {
    const truth = buildLocalAskFindingPrompt(selectionRequest({ selectionMode: "truth" }));
    expect(truth.systemPrompt).toContain('"verdict"');
    expect(truth.systemPrompt).toContain("do not restate it in prose");

    const explain = buildLocalAskFindingPrompt(
      selectionRequest({ selectionMode: "explain" })
    );
    expect(explain.systemPrompt).not.toContain('"verdict"');
  });

  it("keeps default annotation chat offline and conversational", () => {
    const prompt = buildLocalAskFindingPrompt({
      question: "Why was this flagged?",
      annotations: [annotation],
    });
    expect(prompt.webSearch).toBe(false);
    expect(prompt.systemPrompt).toContain("highlighted issues");
    expect(prompt.systemPrompt).not.toContain("web search");
    expect(prompt.contextMessage).toContain("Annotation context:");
    expect(prompt.contextMessage).toContain("Lens: claim-extractor");
  });

  it("turns on web search with a brief style for source-tracer findings", () => {
    const prompt = buildLocalAskFindingPrompt({
      question: "Find the original source.",
      annotations: [{ ...annotation, lensId: "source-tracer" }],
    });
    expect(prompt.webSearch).toBe(true);
    expect(prompt.systemPrompt).toContain("no more than 8 short sentences");
    expect(prompt.systemPrompt).toContain("surfacing the sources and evidence");
  });

  it("falls back to the first annotation's lens when no target lens is given", () => {
    const viaTarget = buildLocalAskFindingPrompt({
      question: "q",
      targetLensId: "source-tracer",
      annotations: [annotation],
    });
    expect(viaTarget.webSearch).toBe(true);
  });

  it("bounds the page context so a huge page cannot bloat the request", () => {
    const prompt = buildLocalAskFindingPrompt(
      selectionRequest({ pageContext: "x".repeat(80_000) })
    );
    expect(prompt.contextMessage.length).toBeLessThan(60_000);
  });
});

describe("stripLeadingCharsFromSegments", () => {
  const segments: TextSegment[] = [
    { text: "HEADER\n", citations: [] },
    {
      text: "prose with citation",
      citations: [{ type: "web", url: "https://e.com", title: "E", citedText: "" }],
    },
  ];

  it("passes through for a zero count", () => {
    expect(stripLeadingCharsFromSegments(segments, 0)).toBe(segments);
  });

  it("drops whole leading segments and trims across the boundary", () => {
    const stripped = stripLeadingCharsFromSegments(segments, 7 + 6);
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.text).toBe("with citation");
    expect(stripped[0]?.citations).toHaveLength(1);
  });

  it("returns nothing when the count covers everything", () => {
    expect(stripLeadingCharsFromSegments(segments, 999)).toEqual([]);
  });
});

interface PortEvent {
  type: string;
  [key: string]: unknown;
}

function makeFakePort(): { port: chrome.runtime.Port; events: PortEvent[] } {
  const events: PortEvent[] = [];
  const port = {
    postMessage: (event: PortEvent) => {
      events.push(event);
    },
  } as unknown as chrome.runtime.Port;
  return { port, events };
}

function segmentsFor(text: string): TextSegment[] {
  return [{ text, citations: [] }];
}

describe("makeLocalFindingCallbacks — verdict header extraction", () => {
  it("withholds the header, emits one meta event, and reports prose only", () => {
    const { port, events } = makeFakePort();
    const { callbacks, finalize } = makeLocalFindingCallbacks(port, "truth", true);

    const header = '{"verdict": "mixed"}\n\n';
    let raw = "";
    const push = (text: string) => {
      raw += text;
      callbacks.onChunk(text, segmentsFor(raw));
    };

    push('{"verdict": ');
    push('"mixed"}\n\n');
    push("Partly supported.");

    const metaEvents = events.filter((event) => event.type === "meta");
    expect(metaEvents).toEqual([{ type: "meta", meta: { verdict: "mixed" } }]);

    const chunkEvents = events.filter((event) => event.type === "chunk");
    const streamedProse = chunkEvents.map((event) => event.text).join("");
    expect(streamedProse).toBe("Partly supported.");
    for (const chunk of chunkEvents) {
      const segments = chunk.textSegments as TextSegment[];
      expect(segments.map((segment) => segment.text).join("")).not.toContain("verdict");
    }

    const result = finalize(raw);
    expect(result.meta).toEqual({ verdict: "mixed" });
    expect(result.fullText).toBe("Partly supported.");
    expect(result.textSegments.map((segment) => segment.text).join("")).toBe(
      "Partly supported."
    );
    expect(raw).toBe(`${header}Partly supported.`);
  });

  it("treats a response without a header as plain prose", () => {
    const { port, events } = makeFakePort();
    const { callbacks, finalize } = makeLocalFindingCallbacks(port, "truth", true);

    callbacks.onChunk("Just an answer, ", segmentsFor("Just an answer, "));
    callbacks.onChunk("no header.", segmentsFor("Just an answer, no header."));

    expect(events.filter((event) => event.type === "meta")).toEqual([]);
    const result = finalize("Just an answer, no header.");
    expect(result.meta).toBeNull();
    expect(result.fullText).toBe("Just an answer, no header.");
  });

  it("flushes a buffered partial header as prose when the stream ends", () => {
    const { port, events } = makeFakePort();
    const { callbacks, finalize } = makeLocalFindingCallbacks(port, "truth", true);

    // Looks like a header start but the stream dies before a newline.
    callbacks.onChunk('{"verdict": "tr', segmentsFor('{"verdict": "tr'));
    expect(events.filter((event) => event.type === "chunk")).toEqual([]);

    const result = finalize('{"verdict": "tr');
    expect(result.meta).toBeNull();
    expect(result.fullText).toBe('{"verdict": "tr');
    // The flush emitted the buffered text so the user still sees it.
    expect(events.filter((event) => event.type === "chunk")).toHaveLength(1);
  });

  it("is a pure passthrough for modes without a schema", () => {
    const { port, events } = makeFakePort();
    const { callbacks, finalize } = makeLocalFindingCallbacks(port, "explain", true);

    callbacks.onChunk("Answer text", segmentsFor("Answer text"));
    expect(events).toEqual([
      { type: "chunk", text: "Answer text", textSegments: segmentsFor("Answer text") },
    ]);
    expect(finalize("Answer text").fullText).toBe("Answer text");
  });
});

describe("BYOK finding-stream wiring", () => {
  it("routes the local branch of the finding stream through the streaming module", () => {
    const serviceWorker = read("background", "service-worker.ts");
    expect(serviceWorker).toContain("streamLocalAskFindingOverPort");
    // The non-streaming ask path is a separate feature and may keep the
    // simple call; the *stream* branch must not use it.
    const streamBranch = serviceWorker.slice(
      serviceWorker.indexOf("async function streamAskFindingOverPort")
    );
    expect(streamBranch).not.toContain("askLocalFindingQuestion(");
  });

  it("streams with web tools for both providers", () => {
    const module = read("background", "local-finding-stream.ts");
    expect(module).toContain("readStreamingResponse");
    expect(module).toContain("readOpenAIStreamingResponse");
    expect(module).toContain("web_search_20250305");
    expect(module).toContain("web_fetch_20250910");
    expect(module).toContain("MetaHeaderExtractor");
  });
});
