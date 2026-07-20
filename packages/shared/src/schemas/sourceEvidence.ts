import { z } from "zod";
import { Anchor } from "./finding.js";

export const SegmentExtractionStatus = z.enum(["complete", "ocr_required"]);
export type SegmentExtractionStatus = z.infer<typeof SegmentExtractionStatus>;

/**
 * Durable description of a deterministic source segment. Source text is
 * intentionally absent; only bounded finding evidence retains quotations.
 */
export const SourceSegmentDescriptor = z.object({
  segmentKey: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  kind: z.enum(["text", "transcript", "pdf"]),
  anchor: Anchor,
  contentHash: z.string().min(1),
  normalizedLength: z.number().int().nonnegative(),
  normalizationVersion: z.string().min(1),
  segmentationVersion: z.string().min(1),
  extractionStatus: SegmentExtractionStatus.default("complete"),
});
export type SourceSegmentDescriptor = z.infer<typeof SourceSegmentDescriptor>;

export const SourceSegment = SourceSegmentDescriptor.extend({
  id: z.string(),
  sourceFingerprintId: z.string(),
});
export type SourceSegment = z.infer<typeof SourceSegment>;

export const RunSegmentInspection = z.object({
  id: z.string().optional(),
  sourceSegmentId: z.string().optional(),
  segmentKey: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  role: z.enum(["core", "context"]),
  status: z.enum(["pending", "completed", "failed", "cancelled"]),
});
export type RunSegmentInspection = z.infer<typeof RunSegmentInspection>;

export const FindingEvidenceRefInput = z.object({
  findingIndex: z.number().int().nonnegative(),
  segmentKey: z.string().min(1),
  role: z.enum(["basis", "context"]),
  exactQuote: z.string().min(1).max(500),
  quoteHash: z.string().min(1),
  anchor: Anchor,
  relevanceNote: z.string().max(1000).optional(),
});
export type FindingEvidenceRefInput = z.infer<typeof FindingEvidenceRefInput>;

export const FindingEvidenceRef = FindingEvidenceRefInput.omit({ findingIndex: true }).extend({
  id: z.string(),
  sourceSegmentId: z.string(),
});
export type FindingEvidenceRef = z.infer<typeof FindingEvidenceRef>;
