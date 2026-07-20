import type { ExtractedClaim } from "../../types/claims";
import type { TranscriptSegment } from "../../types/transcript";
import type { LensFinding } from "../types";
import type { PanelSource } from "../types";
import { toClaimCategory } from "../schemas";
import type { LensRunChunk } from "./lens-run-chunks";
import { mergeChunkFindings } from "./lens-run-chunks";

export function canRunClaimExtractor(
  source: PanelSource | null,
  transcript: readonly TranscriptSegment[]
): boolean {
  if (!source) return false;
  if (source.kind === "youtube_video") return transcript.length > 0;
  return source.text.trim().length > 0;
}

export function lensFindingToClaim(finding: LensFinding): ExtractedClaim {
  const verdict = finding.enrichments?.find((entry) => entry.data?.credibility);
  const credibility = verdict?.data?.credibility;
  return {
    claim: finding.text,
    category: toClaimCategory(finding.category),
    timestamp:
      finding.anchor?.kind === "transcript" ? finding.anchor.formatted ?? "--:--" : "--:--",
    ...(finding.anchor?.kind === "pdf"
      ? {
          page: finding.anchor.pageNumber,
          ...(finding.anchor.pageLabel ? { pageLabel: finding.anchor.pageLabel } : {}),
        }
      : {}),
    quotes:
      finding.quotes?.map((quote) => quote.trim()).filter(Boolean) ??
      extractQuotesFromDetail(finding.detail),
    ...(credibility === "low" || credibility === "medium" || credibility === "high"
      ? {
          verification: {
            credibility,
            explanation: verdict?.summary ?? "",
            sources: verdict?.sources ?? [],
          },
        }
      : {}),
  };
}

/** Convert managed lens findings into the transcript-first claims UI contract. */
export function lensFindingsToClaimsForChunk(
  findings: readonly LensFinding[],
  chunk: LensRunChunk
): ExtractedClaim[] {
  const fallbackAnchor = chunk.mappings.find(
    (mapping) => mapping.role === "core" && mapping.anchor.kind === "transcript"
  )?.anchor;

  return findings.map((finding) => {
    const merged = mergeChunkFindings(chunk, [finding])[0] ?? finding;
    const anchored =
      merged.anchor || !fallbackAnchor
        ? merged
        : { ...merged, anchor: fallbackAnchor };
    return lensFindingToClaim(anchored);
  });
}

export function extractQuotesFromDetail(detail: string): string[] {
  const prefix = "Quotes: ";
  if (!detail.startsWith(prefix)) return [];
  return detail
    .slice(prefix.length)
    .split(" | ")
    .map((quote) => quote.trim())
    .filter(Boolean);
}

export function dedupeClaims(
  nextClaims: ExtractedClaim[],
  existing: ExtractedClaim[]
): ExtractedClaim[] {
  const seen = new Set(existing.map((claim) => normalizeClaim(claim.claim)));
  return nextClaims.filter((claim) => {
    const normalized = normalizeClaim(claim.claim);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/\s+/g, " ").trim();
}
