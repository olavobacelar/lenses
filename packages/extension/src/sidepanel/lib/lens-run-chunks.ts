import type { FindingEvidenceRefInput } from "@lenses/shared";
import type { TranscriptSegment } from "../../types/transcript";
import {
  groundFindingsInSource,
  mergeFindingsFromExecutionChunk,
  prepareSegmentedSource,
  type ExecutionChunk,
  type PreparedSegmentedSource,
} from "../../lib/source-segments";
import { fingerprintText } from "../../lib/evidence-bases";
import type { LensFinding, PanelSource } from "../types";

export type LensRunChunk = ExecutionChunk;
export type PreparedLensRunSource = PreparedSegmentedSource;

export interface LensRunChunkRawResponse {
  chunkIndex: number;
  rawResponse: string;
}

export function serializeChunkRawResponses(
  responses: readonly LensRunChunkRawResponse[],
  totalChunks: number
): string | undefined {
  if (responses.length === 0) return undefined;
  if (totalChunks === 1 && responses.length === 1 && responses[0].chunkIndex === 0) {
    return responses[0].rawResponse;
  }
  return JSON.stringify({
    format: "lenses.chunked-raw-response.v1",
    totalChunks,
    chunks: responses,
  });
}

export async function prepareSourceForLensRuns(
  source: PanelSource,
  transcript: readonly TranscriptSegment[]
): Promise<PreparedLensRunSource> {
  const fingerprint = source.fingerprint ?? (await fingerprintText(source.text));
  return prepareSegmentedSource(
    {
      kind: source.kind,
      text: source.text,
      fingerprint,
      pdfPages: source.pdfPages,
    },
    transcript
  );
}

export function mergeChunkFindings(
  chunk: LensRunChunk,
  findings: readonly LensFinding[]
): LensFinding[] {
  return mergeFindingsFromExecutionChunk(chunk, findings);
}

export async function groundLensFindings(
  findings: readonly LensFinding[],
  prepared: PreparedLensRunSource
): Promise<{ findings: LensFinding[]; evidenceRefs: FindingEvidenceRefInput[] }> {
  return groundFindingsInSource(findings, prepared);
}

export function dedupeChunkFindings(findings: readonly LensFinding[]): LensFinding[] {
  const seen = new Set<string>();
  const result: LensFinding[] = [];

  for (const finding of findings) {
    const key = dedupeKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }

  return result;
}

function dedupeKey(finding: LensFinding): string {
  const anchor = finding.anchor;
  const location = finding.sourceSpan
    ? `${finding.sourceSpan.start}:${finding.sourceSpan.end}`
    : anchor?.kind === "transcript"
      ? `t:${anchor.timestamp}`
      : anchor?.kind === "pdf"
        ? `p:${anchor.pageNumber}:${anchor.start}:${anchor.end}`
        : finding.text;
  return `${finding.category}|${normalizeText(finding.text)}|${location}`;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
