import type {
  Anchor,
  FindingEvidenceRefInput,
  SourceSegmentDescriptor,
} from "@lenses/shared";
import type { TranscriptSegment } from "../types/transcript";
import type { PdfPageText, PdfTextItemSpan } from "./pdf-source";
import {
  normalizeFingerprintText,
  sha256Hex,
  type SourceFingerprintInput,
} from "./evidence-bases";

export const SOURCE_SEGMENT_NORMALIZATION_VERSION = "lenses-segment-normalization-v1";
export const SOURCE_SEGMENTATION_VERSION = "lenses-source-segmentation-v1";
export const EXECUTION_CHUNKING_VERSION = "lenses-owned-core-v1";

const CORE_CHAR_LIMIT = 12_000;
const CONTEXT_CHAR_LIMIT = 1_000;
const MAX_STRUCTURAL_SEGMENT_CHARS = 2_000;
const TRANSCRIPT_CORE_SECONDS = 300;
const TRANSCRIPT_CONTEXT_SECONDS = 60;
const MAX_EVIDENCE_QUOTE_CHARS = 500;

export interface SegmentableSource {
  kind: "web_page" | "youtube_video" | "pdf";
  text: string;
  fingerprint: SourceFingerprintInput;
  pdfPages?: PdfPageText[];
}

export interface RuntimeSourceSegment {
  descriptor: SourceSegmentDescriptor;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  inputStart: number;
  inputEnd: number;
}

export interface ExecutionSegmentMapping {
  segmentKey: string;
  role: "core" | "context";
  sourceStart: number;
  sourceEnd: number;
  chunkStart: number;
  chunkEnd: number;
  anchor: Anchor;
}

export interface ExecutionChunk {
  chunkIndex: number;
  text: string;
  sourceOffset: number;
  coreSourceStart: number;
  coreSourceEnd: number;
  coreSegmentKeys: string[];
  contextSegmentKeys: string[];
  mappings: ExecutionSegmentMapping[];
}

export interface PreparedSegmentedSource {
  sourceText: string;
  fingerprint: SourceFingerprintInput;
  segments: RuntimeSourceSegment[];
  descriptors: SourceSegmentDescriptor[];
  chunks: ExecutionChunk[];
  chunkingVersion: string;
}

export interface GroundableFinding {
  text: string;
  detail?: string;
  sourceSpan?: { start: number; end: number };
  anchor?: Anchor;
  quotes?: string[];
}

export async function prepareSegmentedSource(
  source: SegmentableSource,
  transcript: readonly TranscriptSegment[] = []
): Promise<PreparedSegmentedSource> {
  const sourceText = source.text;
  const drafts =
    source.kind === "youtube_video" && transcript.length > 0
      ? transcriptSegmentDrafts(sourceText, transcript)
      : source.kind === "pdf" && source.pdfPages?.length
        ? pdfSegmentDrafts(source.pdfPages, source.fingerprint.extractionVersion)
        : textSegmentDrafts(sourceText);
  const segments = await materializeSegments(drafts, source.fingerprint);
  const chunks =
    source.kind === "youtube_video" && transcript.length > 0
      ? planTranscriptChunks(sourceText, segments)
      : planTextChunks(sourceText, segments);

  return {
    sourceText,
    fingerprint: source.fingerprint,
    segments,
    descriptors: segments.map((segment) => segment.descriptor),
    chunks,
    chunkingVersion: EXECUTION_CHUNKING_VERSION,
  };
}

export function chunkInspectionPlan(chunks: readonly ExecutionChunk[]) {
  return chunks.flatMap((chunk) =>
    chunk.mappings.map((mapping) => ({
      segmentKey: mapping.segmentKey,
      chunkIndex: chunk.chunkIndex,
      role: mapping.role,
    }))
  );
}

export function sourceSpanForFinding(
  chunk: ExecutionChunk,
  finding: GroundableFinding
): { start: number; end: number } | undefined {
  const supplied = validRange(finding.sourceSpan, chunk.text.length);
  if (supplied) {
    const absolute = {
      start: supplied.start + chunk.sourceOffset,
      end: supplied.end + chunk.sourceOffset,
    };
    if (findingBelongsToChunk(chunk, absolute)) return absolute;
  }

  for (const exact of evidenceCandidates(finding)) {
    const localStart = nearestOwnedExactIndex(chunk, exact, supplied?.start);
    if (localStart >= 0) {
      return {
        start: localStart + chunk.sourceOffset,
        end: localStart + chunk.sourceOffset + exact.length,
      };
    }
  }

  return supplied
    ? {
        start: supplied.start + chunk.sourceOffset,
        end: supplied.end + chunk.sourceOffset,
      }
    : undefined;
}

export function findingBelongsToChunk(
  chunk: ExecutionChunk,
  sourceSpan: { start: number; end: number } | undefined
): boolean {
  if (!sourceSpan) return chunk.chunkIndex === 0;
  return chunk.mappings.some(
    (mapping) =>
      mapping.role === "core" &&
      sourceSpan.start >= mapping.sourceStart &&
      sourceSpan.start < mapping.sourceEnd
  );
}

export function transcriptTimestampBelongsToChunk(
  chunk: ExecutionChunk,
  timestamp: number
): boolean {
  if (!Number.isFinite(timestamp) || timestamp < 0) return false;
  return chunk.mappings.some((mapping) => {
    if (mapping.role !== "core" || mapping.anchor.kind !== "transcript") return false;
    const start = mapping.anchor.timestamp;
    const end = start + (mapping.anchor.duration ?? 0);
    return timestamp === start || (end > start && timestamp >= start && timestamp < end);
  });
}

export function mergeFindingsFromExecutionChunk<T extends GroundableFinding>(
  chunk: ExecutionChunk,
  findings: readonly T[]
): T[] {
  return findings.flatMap((finding) => {
    const sourceSpan = sourceSpanForFinding(chunk, finding);
    if (!findingBelongsToChunk(chunk, sourceSpan)) return [];
    const mapping = sourceSpan
      ? chunk.mappings.find(
          (candidate) =>
            sourceSpan.start >= candidate.sourceStart &&
            sourceSpan.start < candidate.sourceEnd
        ) ??
        chunk.mappings.find((candidate) =>
          rangesOverlap(
            sourceSpan.start,
            sourceSpan.end,
            candidate.sourceStart,
            candidate.sourceEnd
          )
        )
      : undefined;
    return [
      {
        ...finding,
        sourceSpan,
        anchor:
          mapping && sourceSpan
            ? anchorForSourceRange(
                {
                  descriptor: { anchor: mapping.anchor },
                  sourceStart: mapping.sourceStart,
                  sourceEnd: mapping.sourceEnd,
                },
                sourceSpan
              )
            : finding.anchor,
      },
    ];
  });
}

export function anchorForSourceRange(
  segment: {
    descriptor: { anchor: Anchor };
    sourceStart: number;
    sourceEnd: number;
  },
  range: { start: number; end: number }
): Anchor {
  const anchor = segment.descriptor.anchor;
  if (anchor.kind === "text") {
    return { kind: "text", start: range.start, end: range.end };
  }
  if (anchor.kind === "transcript") {
    return {
      ...anchor,
      start: range.start,
      end: range.end,
    };
  }
  if (anchor.kind === "pdf") {
    const localStart = anchor.start + Math.max(0, range.start - segment.sourceStart);
    const localEnd = Math.min(
      anchor.end,
      localStart + Math.max(0, range.end - range.start)
    );
    return {
      ...anchor,
      start: localStart,
      end: Math.max(localStart, localEnd),
    };
  }
  return anchor;
}

export async function groundFindingsInSource<T extends GroundableFinding>(
  findings: readonly T[],
  prepared: PreparedSegmentedSource
): Promise<{ findings: T[]; evidenceRefs: FindingEvidenceRefInput[] }> {
  const groundedFindings: T[] = [];
  const evidenceRefs: FindingEvidenceRefInput[] = [];

  for (let findingIndex = 0; findingIndex < findings.length; findingIndex += 1) {
    const finding = findings[findingIndex];
    const ranges = verifiedEvidenceRanges(finding, prepared);
    const quotes: string[] = [];
    const seenRefs = new Set<string>();

    for (const range of ranges) {
      const exactQuote = prepared.sourceText
        .slice(range.start, range.end)
        .slice(0, MAX_EVIDENCE_QUOTE_CHARS);
      if (!exactQuote.trim()) continue;
      const quoteEnd = range.start + exactQuote.length;
      const matchingSegments = prepared.segments.filter(
        (segment) =>
          segment.descriptor.extractionStatus === "complete" &&
          rangesOverlap(range.start, quoteEnd, segment.sourceStart, segment.sourceEnd)
      );

      for (const segment of matchingSegments) {
        const refStart = Math.max(range.start, segment.sourceStart);
        const refEnd = Math.min(quoteEnd, segment.sourceEnd);
        const segmentQuote = prepared.sourceText.slice(refStart, refEnd);
        if (!segmentQuote.trim()) continue;
        const quoteHash = await hashText(segmentQuote);
        const refKey = `${segment.descriptor.segmentKey}:${quoteHash}`;
        if (seenRefs.has(refKey)) continue;
        seenRefs.add(refKey);
        evidenceRefs.push({
          findingIndex,
          segmentKey: segment.descriptor.segmentKey,
          role: "basis",
          exactQuote: segmentQuote,
          quoteHash,
          anchor: anchorForSourceRange(segment, {
            start: refStart,
            end: refEnd,
          }),
        });
      }

      if (
        matchingSegments.length > 0 &&
        !quotes.includes(exactQuote)
      ) {
        quotes.push(exactQuote);
      }
    }

    const primaryRef = evidenceRefs.find((ref) => ref.findingIndex === findingIndex);
    groundedFindings.push({
      ...finding,
      ...(quotes.length > 0 ? { quotes } : { quotes: undefined }),
      ...(primaryRef ? { anchor: primaryRef.anchor } : {}),
    });
  }

  return { findings: groundedFindings, evidenceRefs };
}

interface SegmentDraft {
  kind: "text" | "transcript" | "pdf";
  text: string;
  sourceStart: number;
  sourceEnd: number;
  inputStart: number;
  inputEnd: number;
  anchor: Anchor;
  extractionStatus: "complete" | "ocr_required";
}

function textSegmentDrafts(text: string): SegmentDraft[] {
  return structuralRanges(text).map((range) => ({
    kind: "text",
    text: text.slice(range.start, range.end),
    sourceStart: range.start,
    sourceEnd: range.end,
    inputStart: range.start,
    inputEnd: range.end,
    anchor: { kind: "text", start: range.start, end: range.end },
    extractionStatus: "complete",
  }));
}

function transcriptSegmentDrafts(
  sourceText: string,
  transcript: readonly TranscriptSegment[]
): SegmentDraft[] {
  const drafts: SegmentDraft[] = [];
  let cursor = 0;

  for (const segment of transcript) {
    const line = `[${segment.formatted}] ${segment.text}`;
    const lineStart = sourceText.indexOf(line, cursor);
    const fallbackStart = sourceText.indexOf(segment.text, cursor);
    if (lineStart < 0 && fallbackStart < 0) continue;
    const inputStart = lineStart >= 0 ? lineStart : fallbackStart;
    const sourceStart = lineStart >= 0
      ? lineStart + line.indexOf(segment.text)
      : fallbackStart;
    const sourceEnd = sourceStart + segment.text.length;
    const inputEnd = lineStart >= 0 ? lineStart + line.length : sourceEnd;
    cursor = Math.max(cursor, inputEnd);
    drafts.push({
      kind: "transcript",
      text: segment.text,
      sourceStart,
      sourceEnd,
      inputStart,
      inputEnd,
      anchor: {
        kind: "transcript",
        timestamp: segment.start,
        duration: segment.duration,
        formatted: segment.formatted,
        start: sourceStart,
        end: sourceEnd,
      },
      extractionStatus: "complete",
    });
  }

  return drafts;
}

function pdfSegmentDrafts(
  pages: readonly PdfPageText[],
  extractionVersion: string
): SegmentDraft[] {
  const drafts: SegmentDraft[] = [];

  for (const page of pages) {
    const bodyText = page.bodyText ?? pdfBodyFromPageText(page.text);
    const markerLength = page.text.length - bodyText.length;
    const bodyStart = page.bodyStart ?? page.start + markerLength;
    const ranges = structuralRanges(bodyText);

    if (ranges.length === 0) {
      drafts.push({
        kind: "pdf",
        text: "",
        sourceStart: bodyStart,
        sourceEnd: bodyStart,
        inputStart: page.start,
        inputEnd: page.end,
        anchor: pdfAnchor(page, 0, 0, [], extractionVersion),
        extractionStatus: "ocr_required",
      });
      continue;
    }

    for (const range of ranges) {
      drafts.push({
        kind: "pdf",
        text: bodyText.slice(range.start, range.end),
        sourceStart: bodyStart + range.start,
        sourceEnd: bodyStart + range.end,
        inputStart: bodyStart + range.start,
        inputEnd: bodyStart + range.end,
        anchor: pdfAnchor(
          page,
          range.start,
          range.end,
          rectsForRange(page.textItems ?? [], range.start, range.end),
          extractionVersion
        ),
        extractionStatus: page.ocrRequired ? "ocr_required" : "complete",
      });
    }
  }

  return drafts;
}

function pdfAnchor(
  page: PdfPageText,
  start: number,
  end: number,
  rects: ReturnType<typeof rectsForRange>,
  extractionVersion: string
): Anchor {
  return {
    kind: "pdf",
    pageNumber: page.pageNumber,
    start,
    end,
    rects: rects.length > 0 ? rects.slice(0, 64) : undefined,
    pageWidth: page.width,
    pageHeight: page.height,
    extractionVersion,
  };
}

function rectsForRange(items: readonly PdfTextItemSpan[], start: number, end: number) {
  return items
    .filter((item) => rangesOverlap(start, end, item.start, item.end))
    .map((item) => item.rect);
}

async function materializeSegments(
  drafts: readonly SegmentDraft[],
  fingerprint: SourceFingerprintInput
): Promise<RuntimeSourceSegment[]> {
  return Promise.all(
    drafts.map(async (draft, ordinal) => {
      const normalized = normalizeSegmentText(draft.text);
      const contentHash = await hashText(normalized);
      const segmentKey = await hashText(
        [
          fingerprint.contentHash,
          SOURCE_SEGMENTATION_VERSION,
          String(ordinal),
          draft.kind,
          contentHash,
        ].join(":")
      );
      return {
        descriptor: {
          segmentKey,
          ordinal,
          kind: draft.kind,
          anchor: draft.anchor,
          contentHash,
          normalizedLength: normalized.length,
          normalizationVersion: SOURCE_SEGMENT_NORMALIZATION_VERSION,
          segmentationVersion: SOURCE_SEGMENTATION_VERSION,
          extractionStatus: draft.extractionStatus,
        },
        text: draft.text,
        sourceStart: draft.sourceStart,
        sourceEnd: draft.sourceEnd,
        inputStart: draft.inputStart,
        inputEnd: draft.inputEnd,
      };
    })
  );
}

function planTextChunks(
  sourceText: string,
  allSegments: readonly RuntimeSourceSegment[]
): ExecutionChunk[] {
  const segments = allSegments.filter(
    (segment) => segment.text.length > 0 && segment.descriptor.extractionStatus === "complete"
  );
  const coreGroups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;

  while (groupStart < segments.length) {
    let groupEnd = groupStart + 1;
    while (
      groupEnd < segments.length &&
      segments[groupEnd].inputEnd - segments[groupStart].inputStart <= CORE_CHAR_LIMIT
    ) {
      groupEnd += 1;
    }
    coreGroups.push({ start: groupStart, end: groupEnd });
    groupStart = groupEnd;
  }

  return coreGroups.map((group, chunkIndex) =>
    executionChunk(sourceText, segments, group.start, group.end, chunkIndex, (index) => {
      if (index < group.start) {
        return segments[group.start].inputStart - segments[index].inputStart <= CONTEXT_CHAR_LIMIT;
      }
      if (index >= group.end) {
        return segments[index].inputEnd - segments[group.end - 1].inputEnd <= CONTEXT_CHAR_LIMIT;
      }
      return true;
    })
  );
}

function planTranscriptChunks(
  sourceText: string,
  allSegments: readonly RuntimeSourceSegment[]
): ExecutionChunk[] {
  const segments = allSegments.filter((segment) => segment.text.length > 0);
  const coreGroups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;

  while (groupStart < segments.length) {
    const anchor = segments[groupStart].descriptor.anchor;
    const startTime = anchor.kind === "transcript" ? anchor.timestamp : 0;
    let groupEnd = groupStart + 1;
    while (groupEnd < segments.length) {
      const nextAnchor = segments[groupEnd].descriptor.anchor;
      if (
        nextAnchor.kind !== "transcript" ||
        nextAnchor.timestamp >= startTime + TRANSCRIPT_CORE_SECONDS
      ) {
        break;
      }
      groupEnd += 1;
    }
    coreGroups.push({ start: groupStart, end: groupEnd });
    groupStart = groupEnd;
  }

  return coreGroups.map((group, chunkIndex) => {
    const firstAnchor = segments[group.start].descriptor.anchor;
    const lastAnchor = segments[group.end - 1].descriptor.anchor;
    const coreStartTime = firstAnchor.kind === "transcript" ? firstAnchor.timestamp : 0;
    const coreEndTime =
      lastAnchor.kind === "transcript"
        ? lastAnchor.timestamp + (lastAnchor.duration ?? 0)
        : coreStartTime;
    return executionChunk(sourceText, segments, group.start, group.end, chunkIndex, (index) => {
      const anchor = segments[index].descriptor.anchor;
      if (anchor.kind !== "transcript") return false;
      if (index < group.start) {
        return anchor.timestamp >= coreStartTime - TRANSCRIPT_CONTEXT_SECONDS;
      }
      if (index >= group.end) {
        return anchor.timestamp < coreEndTime + TRANSCRIPT_CONTEXT_SECONDS;
      }
      return true;
    });
  });
}

function executionChunk(
  sourceText: string,
  segments: readonly RuntimeSourceSegment[],
  coreStartIndex: number,
  coreEndIndex: number,
  chunkIndex: number,
  include: (index: number) => boolean
): ExecutionChunk {
  let selectedStart = coreStartIndex;
  let selectedEnd = coreEndIndex;
  while (selectedStart > 0 && include(selectedStart - 1)) selectedStart -= 1;
  while (selectedEnd < segments.length && include(selectedEnd)) selectedEnd += 1;

  const inputStart = segments[selectedStart].inputStart;
  const inputEnd = segments[selectedEnd - 1].inputEnd;
  const mappings = segments.slice(selectedStart, selectedEnd).map((segment, offset) => {
    const absoluteIndex = selectedStart + offset;
    return {
      segmentKey: segment.descriptor.segmentKey,
      role:
        absoluteIndex >= coreStartIndex && absoluteIndex < coreEndIndex
          ? ("core" as const)
          : ("context" as const),
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      chunkStart: Math.max(0, segment.sourceStart - inputStart),
      chunkEnd: Math.max(0, segment.sourceEnd - inputStart),
      anchor: segment.descriptor.anchor,
    };
  });

  return {
    chunkIndex,
    text: sourceText.slice(inputStart, inputEnd),
    sourceOffset: inputStart,
    coreSourceStart: segments[coreStartIndex].sourceStart,
    coreSourceEnd: segments[coreEndIndex - 1].sourceEnd,
    coreSegmentKeys: mappings
      .filter((mapping) => mapping.role === "core")
      .map((mapping) => mapping.segmentKey),
    contextSegmentKeys: mappings
      .filter((mapping) => mapping.role === "context")
      .map((mapping) => mapping.segmentKey),
    mappings,
  };
}

function structuralRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const linePattern = /[^\n]+/g;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text))) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = match.index + leading;
    const end = match.index + raw.length - trailing;
    if (end <= start) continue;
    ranges.push(...splitLargeRange(text, start, end));
  }

  return ranges;
}

function splitLargeRange(
  text: string,
  start: number,
  end: number
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;
  while (end - cursor > MAX_STRUCTURAL_SEGMENT_CHARS) {
    const target = cursor + MAX_STRUCTURAL_SEGMENT_CHARS;
    const boundary = boundaryBefore(text, target, cursor + Math.floor(MAX_STRUCTURAL_SEGMENT_CHARS * 0.65));
    ranges.push({ start: cursor, end: boundary });
    cursor = boundary;
    while (cursor < end && /\s/.test(text[cursor] ?? "")) cursor += 1;
  }
  if (cursor < end) ranges.push({ start: cursor, end });
  return ranges;
}

function boundaryBefore(text: string, target: number, minimum: number): number {
  const sentence = Math.max(
    text.lastIndexOf(". ", target),
    text.lastIndexOf("? ", target),
    text.lastIndexOf("! ", target)
  );
  if (sentence >= minimum) return sentence + 1;
  const space = text.lastIndexOf(" ", target);
  return space >= minimum ? space : target;
}

function verifiedEvidenceRanges(
  finding: GroundableFinding,
  prepared: PreparedSegmentedSource
): Array<{ start: number; end: number }> {
  const sourceText = prepared.sourceText;
  const ranges: Array<{ start: number; end: number }> = [];
  const candidates = evidenceCandidates(finding).slice(0, 8);
  const preferredStart = preferredGroundingStart(finding, prepared);

  for (const candidate of candidates) {
    const start = nearestExactIndex(sourceText, candidate, preferredStart);
    if (start < 0) continue;
    ranges.push({ start, end: start + Math.min(candidate.length, MAX_EVIDENCE_QUOTE_CHARS) });
  }

  if (ranges.length === 0) {
    const sourceSpan = validRange(finding.sourceSpan, sourceText.length);
    if (sourceSpan) {
      ranges.push({
        start: sourceSpan.start,
        end: Math.min(sourceSpan.end, sourceSpan.start + MAX_EVIDENCE_QUOTE_CHARS),
      });
    }
  }

  return ranges.filter(
    (range, index) =>
      ranges.findIndex((candidate) => candidate.start === range.start && candidate.end === range.end) ===
      index
  );
}

function evidenceCandidates(finding: GroundableFinding): string[] {
  const seen = new Set<string>();
  return [...(finding.quotes ?? []), finding.text]
    .map((quote) => quote.trim())
    .filter((quote) => {
      if (!quote || seen.has(quote)) return false;
      seen.add(quote);
      return true;
    });
}

function nearestOwnedExactIndex(
  chunk: ExecutionChunk,
  exact: string,
  preferredStart?: number
): number {
  let nearest = -1;
  let cursor = chunk.text.indexOf(exact);
  while (cursor >= 0) {
    const absolute = {
      start: cursor + chunk.sourceOffset,
      end: cursor + chunk.sourceOffset + exact.length,
    };
    if (
      findingBelongsToChunk(chunk, absolute) &&
      (nearest < 0 ||
        preferredStart == null ||
        Math.abs(cursor - preferredStart) < Math.abs(nearest - preferredStart))
    ) {
      nearest = cursor;
      if (preferredStart == null || cursor === preferredStart) break;
    }
    cursor = chunk.text.indexOf(exact, cursor + 1);
  }
  return nearest;
}

function preferredGroundingStart(
  finding: GroundableFinding,
  prepared: PreparedSegmentedSource
): number | undefined {
  const sourceSpan = validRange(finding.sourceSpan, prepared.sourceText.length);
  if (sourceSpan) return sourceSpan.start;

  const anchor = finding.anchor;
  if (!anchor || anchor.kind === "none") return undefined;
  if (anchor.kind === "text") return anchor.start;
  if (anchor.kind === "transcript") {
    if (anchor.start != null && anchor.start < prepared.sourceText.length) return anchor.start;
    const matching = prepared.segments
      .filter((segment) => segment.descriptor.anchor.kind === "transcript")
      .sort((left, right) => {
        const leftAnchor = left.descriptor.anchor;
        const rightAnchor = right.descriptor.anchor;
        if (leftAnchor.kind !== "transcript" || rightAnchor.kind !== "transcript") return 0;
        return (
          Math.abs(leftAnchor.timestamp - anchor.timestamp) -
          Math.abs(rightAnchor.timestamp - anchor.timestamp)
        );
      })[0];
    return matching?.sourceStart;
  }

  const matching = prepared.segments
    .filter((segment) => {
      const segmentAnchor = segment.descriptor.anchor;
      return segmentAnchor.kind === "pdf" && segmentAnchor.pageNumber === anchor.pageNumber;
    })
    .sort((left, right) => {
      const leftAnchor = left.descriptor.anchor;
      const rightAnchor = right.descriptor.anchor;
      if (leftAnchor.kind !== "pdf" || rightAnchor.kind !== "pdf") return 0;
      return Math.abs(leftAnchor.start - anchor.start) - Math.abs(rightAnchor.start - anchor.start);
    })[0];
  if (!matching || matching.descriptor.anchor.kind !== "pdf") return undefined;
  return matching.sourceStart + Math.max(0, anchor.start - matching.descriptor.anchor.start);
}

function nearestExactIndex(text: string, exact: string, preferredStart?: number): number {
  if (preferredStart != null && text.slice(preferredStart, preferredStart + exact.length) === exact) {
    return preferredStart;
  }
  const first = text.indexOf(exact);
  if (first < 0 || preferredStart == null) return first;
  let nearest = first;
  let cursor = first;
  while ((cursor = text.indexOf(exact, cursor + 1)) >= 0) {
    if (Math.abs(cursor - preferredStart) < Math.abs(nearest - preferredStart)) nearest = cursor;
  }
  return nearest;
}

function validRange(
  range: { start: number; end: number } | undefined,
  textLength: number
): { start: number; end: number } | undefined {
  if (!range) return undefined;
  const start = Math.max(0, Math.floor(range.start));
  const end = Math.min(textLength, Math.floor(range.end));
  return end > start ? { start, end } : undefined;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function normalizeSegmentText(text: string): string {
  return normalizeFingerprintText(text).replace(/[\t ]+/g, " ");
}

function pdfBodyFromPageText(text: string): string {
  return text.replace(/^\[PDF page \d+\](?:\n)?/, "");
}

async function hashText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}
