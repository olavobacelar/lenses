import { z } from "zod";
import { SourceKind } from "./source.js";
import { Anchor } from "./finding.js";
import {
  FindingEvidenceRef,
  RunSegmentInspection,
  SourceSegment,
} from "./sourceEvidence.js";

export const EvidenceBase = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  guidingQuestion: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  sourceCount: z.number().int().nonnegative().default(0),
  runCount: z.number().int().nonnegative().default(0),
});
export type EvidenceBase = z.infer<typeof EvidenceBase>;

export const SourceFingerprint = z.object({
  id: z.string(),
  sourceId: z.string(),
  contentHash: z.string(),
  fileHash: z.string().optional(),
  hashAlgorithm: z.literal("sha256"),
  extractionVersion: z.string(),
  contentLength: z.number().int().nonnegative(),
  observedAt: z.number(),
});
export type SourceFingerprint = z.infer<typeof SourceFingerprint>;

export const EvidenceBaseFinding = z.object({
  id: z.string(),
  text: z.string().max(2000),
  category: z.string().max(200),
  detail: z.string().max(4000),
  confidence: z.number(),
  sourceSpan: z
    .object({ start: z.number(), end: z.number() })
    .optional(),
  anchor: Anchor.optional(),
  quotes: z.array(z.string().max(500)).max(8).optional(),
  enrichments: z.array(z.record(z.unknown())).optional(),
  evidenceRefs: z.array(FindingEvidenceRef).default([]),
});
export type EvidenceBaseFinding = z.infer<typeof EvidenceBaseFinding>;

export const EvidenceBaseRun = z.object({
  id: z.string(),
  lensId: z.string(),
  lensVersion: z.string().optional(),
  lensMarkdownSnapshot: z.string().optional(),
  chunkingVersion: z.string().optional(),
  sourceFingerprintId: z.string().optional(),
  initiatedFromEvidenceBaseId: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  error: z.string().max(4000).optional(),
  modelUsed: z.string().optional(),
  createdAt: z.number(),
  findings: z.array(EvidenceBaseFinding),
  segmentManifest: z.array(RunSegmentInspection).default([]),
});
export type EvidenceBaseRun = z.infer<typeof EvidenceBaseRun>;

export const EvidenceBaseSource = z.object({
  id: z.string(),
  sourceKey: z.string(),
  kind: SourceKind,
  url: z.string().optional(),
  title: z.string().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  addedAt: z.number(),
  latestFingerprint: SourceFingerprint.optional(),
  fingerprints: z.array(SourceFingerprint).default([]),
  segments: z.array(SourceSegment).default([]),
  runs: z.array(EvidenceBaseRun),
});
export type EvidenceBaseSource = z.infer<typeof EvidenceBaseSource>;

export const EvidenceBaseDetail = EvidenceBase.extend({
  sources: z.array(EvidenceBaseSource),
});
export type EvidenceBaseDetail = z.infer<typeof EvidenceBaseDetail>;

export const EvidenceBaseDeletePreview = z.object({
  evidenceBaseId: z.string(),
  sourceMemberships: z.number().int().nonnegative(),
  initiatedRuns: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  exclusiveSources: z.number().int().nonnegative(),
  sharedSources: z.number().int().nonnegative(),
  sourcesDeleted: z.number().int().nonnegative(),
  runsDeleted: z.number().int().nonnegative(),
  runsRetained: z.number().int().nonnegative(),
  findingsDeleted: z.number().int().nonnegative(),
});
export type EvidenceBaseDeletePreview = z.infer<typeof EvidenceBaseDeletePreview>;

export const EvidenceBaseExport = z.object({
  schemaVersion: z.literal("lenses.evidence-base.v3"),
  exportedAt: z.number(),
  evidenceBase: EvidenceBaseDetail,
});
export type EvidenceBaseExport = z.infer<typeof EvidenceBaseExport>;
