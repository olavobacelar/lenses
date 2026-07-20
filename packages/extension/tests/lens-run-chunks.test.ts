import { describe, expect, it } from "vitest";
import {
  dedupeChunkFindings,
  groundLensFindings,
  mergeChunkFindings,
  prepareSourceForLensRuns,
  serializeChunkRawResponses,
} from "../src/sidepanel/lib/lens-run-chunks.js";
import { transcriptTimestampBelongsToChunk } from "../src/lib/source-segments.js";
import type { PanelSource } from "../src/sidepanel/types.js";
import type { TranscriptSegment } from "../src/types/transcript.js";

function source(text: string, kind: PanelSource["kind"] = "youtube_video"): PanelSource {
  return {
    key: "source:1",
    kind,
    title: "Source",
    url: "https://example.com",
    text,
    scope: kind === "youtube_video" ? "transcript" : "page",
  };
}

describe("prepareSourceForLensRuns", () => {
  it("creates timed transcript segments and non-overlapping owned cores", async () => {
    const transcript: TranscriptSegment[] = [
      { text: "first", start: 0, duration: 10, formatted: "00:00" },
      { text: "second", start: 301, duration: 10, formatted: "05:01" },
    ];
    const prepared = await prepareSourceForLensRuns(
      source("[00:00] first\n[05:01] second"),
      transcript
    );

    expect(prepared.chunks).toHaveLength(2);
    expect(prepared.descriptors.map((segment) => segment.anchor)).toEqual([
      expect.objectContaining({ kind: "transcript", timestamp: 0, duration: 10 }),
      expect.objectContaining({ kind: "transcript", timestamp: 301, duration: 10 }),
    ]);
    const ownedKeys = prepared.chunks.flatMap((chunk) => chunk.coreSegmentKeys);
    expect(new Set(ownedKeys).size).toBe(ownedKeys.length);
  });

  it("keeps persistent descriptors text-free and deterministic", async () => {
    const text = "Heading\nA short paragraph.\nAnother paragraph.";
    const first = await prepareSourceForLensRuns(source(text, "web_page"), []);
    const second = await prepareSourceForLensRuns(source(text, "web_page"), []);

    expect(first.descriptors).toEqual(second.descriptors);
    expect(first.descriptors.every((descriptor) => !("text" in descriptor))).toBe(true);
    expect(first.descriptors.map((descriptor) => descriptor.ordinal)).toEqual([0, 1, 2]);
  });

  it("packs structural segments into bounded cores with context halos", async () => {
    const text = [
      ...Array.from({ length: 6 }, (_, index) => String.fromCharCode(97 + index).repeat(1_950)),
      "g".repeat(500),
      "h".repeat(1_950),
    ].join("\n");
    const prepared = await prepareSourceForLensRuns(source(text, "web_page"), []);

    expect(prepared.chunks.length).toBeGreaterThan(1);
    expect(
      prepared.chunks.every(
        (chunk) => chunk.coreSourceEnd - chunk.coreSourceStart <= 12_000
      )
    ).toBe(true);
    expect(prepared.chunks.some((chunk) => chunk.contextSegmentKeys.length > 0)).toBe(true);
  });

  it("stores PDF offsets per page and carries text geometry", async () => {
    const text = "[PDF page 1]\nAlpha\n\n[PDF page 2]\nBeta";
    const prepared = await prepareSourceForLensRuns(
      {
        ...source(text, "pdf"),
        pdfPages: [
          {
            pageNumber: 1,
            text: "[PDF page 1]\nAlpha",
            start: 0,
            end: 18,
            bodyText: "Alpha",
            bodyStart: 13,
            width: 612,
            height: 792,
            textItems: [{ start: 0, end: 5, rect: { x: 20, y: 30, width: 40, height: 10 } }],
            ocrRequired: false,
          },
          {
            pageNumber: 2,
            text: "[PDF page 2]\nBeta",
            start: 20,
            end: 37,
            bodyText: "Beta",
            bodyStart: 33,
            width: 612,
            height: 792,
            textItems: [{ start: 0, end: 4, rect: { x: 20, y: 30, width: 35, height: 10 } }],
            ocrRequired: false,
          },
        ],
      },
      []
    );

    expect(prepared.descriptors.map((descriptor) => descriptor.anchor)).toEqual([
      expect.objectContaining({ kind: "pdf", pageNumber: 1, start: 0, end: 5 }),
      expect.objectContaining({
        kind: "pdf",
        pageNumber: 2,
        start: 0,
        end: 4,
        rects: [{ x: 20, y: 30, width: 35, height: 10 }],
      }),
    ]);
  });

  it("records OCR-required PDF pages without pretending they were inspected", async () => {
    const prepared = await prepareSourceForLensRuns(
      {
        ...source("[PDF page 1]", "pdf"),
        pdfPages: [
          {
            pageNumber: 1,
            text: "[PDF page 1]",
            start: 0,
            end: 12,
            bodyText: "",
            bodyStart: 12,
            width: 612,
            height: 792,
            textItems: [],
            ocrRequired: true,
          },
        ],
      },
      []
    );

    expect(prepared.descriptors).toHaveLength(1);
    expect(prepared.descriptors[0].extractionStatus).toBe("ocr_required");
    expect(prepared.chunks).toHaveLength(0);
  });
});

describe("mergeChunkFindings", () => {
  it("maps chunk-local spans to source offsets and accepts only the owning core", async () => {
    const text = `${"context ".repeat(300)}\nOwned exact evidence.\n${"tail ".repeat(3000)}`;
    const prepared = await prepareSourceForLensRuns(source(text, "web_page"), []);
    const owningChunk = prepared.chunks.find((chunk) => chunk.text.includes("Owned exact evidence."));
    expect(owningChunk).toBeDefined();
    const localStart = owningChunk!.text.indexOf("Owned exact evidence.");
    const findings = mergeChunkFindings(owningChunk!, [
      {
        text: "Owned exact evidence.",
        category: "claim",
        detail: "Exact",
        confidence: 0.9,
        sourceSpan: { start: localStart, end: localStart + 21 },
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].sourceSpan?.start).toBe(text.indexOf("Owned exact evidence."));
    expect(findings[0].anchor).toEqual({
      kind: "text",
      start: text.indexOf("Owned exact evidence."),
      end: text.indexOf("Owned exact evidence.") + 21,
    });
  });

  it("prefers a repeated exact match in the owned core over the context halo", async () => {
    const repeated = "Repeated evidence.";
    const text = [
      ...Array.from({ length: 6 }, (_, index) => String.fromCharCode(97 + index).repeat(1_950)),
      repeated,
      "x".repeat(300),
      repeated,
      "tail",
    ].join("\n");
    const prepared = await prepareSourceForLensRuns(source(text, "web_page"), []);
    const ownedOccurrence = text.lastIndexOf(repeated);
    const chunk = prepared.chunks.find(
      (candidate) =>
        candidate.contextSegmentKeys.length > 0 &&
        candidate.text.indexOf(repeated) !== candidate.text.lastIndexOf(repeated) &&
        ownedOccurrence >= candidate.coreSourceStart &&
        ownedOccurrence < candidate.coreSourceEnd
    );
    expect(chunk).toBeDefined();

    const findings = mergeChunkFindings(chunk!, [
      {
        text: repeated,
        category: "claim",
        detail: "Owned occurrence",
        confidence: 0.9,
        sourceSpan: { start: chunk!.text.indexOf(repeated), end: chunk!.text.indexOf(repeated) + repeated.length },
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].sourceSpan?.start).toBe(ownedOccurrence);
  });

  it("uses an exact evidence quote to locate a paraphrased finding in its owned core", async () => {
    const quote = "The trial did not establish a mortality benefit.";
    const text = `${"context ".repeat(1_500)}\n${quote}\nConclusion`;
    const prepared = await prepareSourceForLensRuns(source(text, "web_page"), []);
    const chunk = prepared.chunks.find((candidate) =>
      candidate.coreSegmentKeys.some((key) =>
        prepared.segments.some(
          (segment) => segment.descriptor.segmentKey === key && segment.text === quote
        )
      )
    );
    expect(chunk).toBeDefined();

    const findings = mergeChunkFindings(chunk!, [
      {
        text: "No mortality benefit was demonstrated.",
        category: "claim",
        detail: "Paraphrase",
        confidence: 0.9,
        quotes: [quote],
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].sourceSpan).toEqual({
      start: text.indexOf(quote),
      end: text.indexOf(quote) + quote.length,
    });
  });

  it("dedupes overlap duplicates by span without dropping repeated text elsewhere", () => {
    const findings = dedupeChunkFindings([
      {
        text: "maybe",
        category: "qualifier",
        detail: "First",
        confidence: 0.8,
        sourceSpan: { start: 10, end: 15 },
      },
      {
        text: "maybe",
        category: "qualifier",
        detail: "Duplicate",
        confidence: 0.8,
        sourceSpan: { start: 10, end: 15 },
      },
      {
        text: "maybe",
        category: "qualifier",
        detail: "Later repeat",
        confidence: 0.8,
        sourceSpan: { start: 100, end: 105 },
      },
    ]);

    expect(findings).toHaveLength(2);
  });
});

describe("groundLensFindings", () => {
  it("persists only quotations verified against the transient source", async () => {
    const prepared = await prepareSourceForLensRuns(
      source("Alpha is observed. Beta is only hypothesized.", "web_page"),
      []
    );
    const grounded = await groundLensFindings(
      [
        {
          text: "Beta is only hypothesized.",
          category: "claim",
          detail: "Grounded",
          confidence: 0.9,
          quotes: ["Beta is only hypothesized."],
        },
        {
          text: "Fabricated sentence.",
          category: "claim",
          detail: "Ungrounded",
          confidence: 0.2,
          quotes: ["This never appears."],
        },
      ],
      prepared
    );

    expect(grounded.findings[0].quotes).toEqual(["Beta is only hypothesized."]);
    expect(grounded.evidenceRefs).toHaveLength(1);
    expect(grounded.evidenceRefs[0]).toMatchObject({
      findingIndex: 0,
      role: "basis",
      exactQuote: "Beta is only hypothesized.",
    });
    expect(grounded.findings[1].quotes).toBeUndefined();
  });

  it("splits a cross-segment quotation into references whose text matches each anchor", async () => {
    const text = "Alpha evidence\nBeta evidence";
    const prepared = await prepareSourceForLensRuns(source(text, "web_page"), []);
    const grounded = await groundLensFindings(
      [
        {
          text: "Combined evidence",
          category: "claim",
          detail: "Uses adjacent passages",
          confidence: 0.9,
          quotes: [text],
        },
      ],
      prepared
    );

    expect(grounded.evidenceRefs.map((ref) => ref.exactQuote)).toEqual([
      "Alpha evidence",
      "Beta evidence",
    ]);
    expect(grounded.evidenceRefs.map((ref) => ref.anchor)).toEqual([
      { kind: "text", start: 0, end: 14 },
      { kind: "text", start: 15, end: 28 },
    ]);
    expect(grounded.findings[0].quotes).toEqual([text]);
  });

  it("uses a transcript timestamp to disambiguate repeated evidence", async () => {
    const transcript: TranscriptSegment[] = [
      { text: "Repeated evidence", start: 0, duration: 10, formatted: "00:00" },
      { text: "Repeated evidence", start: 301, duration: 10, formatted: "05:01" },
    ];
    const prepared = await prepareSourceForLensRuns(
      source("[00:00] Repeated evidence\n[05:01] Repeated evidence"),
      transcript
    );
    const grounded = await groundLensFindings(
      [
        {
          text: "Repeated evidence",
          category: "claim",
          detail: "Second occurrence",
          confidence: 0.9,
          anchor: { kind: "transcript", timestamp: 301, formatted: "05:01" },
          quotes: ["Repeated evidence"],
        },
      ],
      prepared
    );

    expect(grounded.evidenceRefs).toHaveLength(1);
    expect(grounded.evidenceRefs[0].anchor).toMatchObject({
      kind: "transcript",
      timestamp: 301,
    });
  });
});

describe("transcriptTimestampBelongsToChunk", () => {
  it("accepts context timestamps only in the chunk that owns their cue", async () => {
    const transcript: TranscriptSegment[] = [
      { text: "opening", start: 0, duration: 10, formatted: "00:00" },
      { text: "first", start: 250, duration: 10, formatted: "04:10" },
      { text: "second", start: 301, duration: 10, formatted: "05:01" },
    ];
    const prepared = await prepareSourceForLensRuns(
      source("[00:00] opening\n[04:10] first\n[05:01] second"),
      transcript
    );

    expect(prepared.chunks).toHaveLength(2);
    expect(transcriptTimestampBelongsToChunk(prepared.chunks[0], 301)).toBe(false);
    expect(transcriptTimestampBelongsToChunk(prepared.chunks[1], 301)).toBe(true);
  });
});

describe("serializeChunkRawResponses", () => {
  it("preserves a single model response verbatim", () => {
    const rawResponse = "  [\n  {\"text\":\"exact\"}\n]  ";
    expect(serializeChunkRawResponses([{ chunkIndex: 0, rawResponse }], 1)).toBe(rawResponse);
  });

  it("stores every chunk response in a versioned envelope", () => {
    const serialized = serializeChunkRawResponses(
      [
        { chunkIndex: 0, rawResponse: '[{"text":"first"}]' },
        { chunkIndex: 1, rawResponse: '{"claims":[{"claim":"second"}]}' },
      ],
      2
    );

    expect(JSON.parse(serialized ?? "null")).toEqual({
      format: "lenses.chunked-raw-response.v1",
      totalChunks: 2,
      chunks: [
        { chunkIndex: 0, rawResponse: '[{"text":"first"}]' },
        { chunkIndex: 1, rawResponse: '{"claims":[{"claim":"second"}]}' },
      ],
    });
  });
});
