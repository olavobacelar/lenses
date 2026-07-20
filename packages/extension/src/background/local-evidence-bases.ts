import {
  Anchor,
  type Anchor as AnchorType,
  EvidenceBase,
  EvidenceBaseDeletePreview,
  EvidenceBaseDetail,
  EvidenceBaseExport,
} from "@lenses/shared";
import {
  localDb,
  type LocalEvidenceBaseRow,
  type LocalSourceFingerprintRow,
} from "../lib/local-db";
import type { EvidenceSourceCaptureInput } from "../lib/evidence-bases";

export interface LocalEvidenceSourceCaptureResult {
  sourceId: string;
  sourceFingerprintId: string;
  evidenceBaseSourceId: string;
  added: boolean;
}

export async function createLocalEvidenceBase(input: {
  title: string;
  description?: string;
  guidingQuestion?: string;
}): Promise<{ id: string }> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  const id = makeId("evidence_base");
  const now = Date.now();
  await localDb.evidenceBases.add({
    id,
    title: title.slice(0, 160),
    description: cleanOptional(input.description, 2000),
    guidingQuestion: cleanOptional(input.guidingQuestion, 1000),
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateLocalEvidenceBase(input: {
  evidenceBaseId: string;
  title: string;
  description?: string;
  guidingQuestion?: string;
}): Promise<{ id: string }> {
  const existing = await localDb.evidenceBases.get(input.evidenceBaseId);
  if (!existing) throw new Error("Evidence base not found");
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  await localDb.evidenceBases.update(input.evidenceBaseId, {
    title: title.slice(0, 160),
    description: cleanOptional(input.description, 2000),
    guidingQuestion: cleanOptional(input.guidingQuestion, 1000),
    updatedAt: Date.now(),
  });
  return { id: input.evidenceBaseId };
}

export async function listLocalEvidenceBases(): Promise<EvidenceBase[]> {
  const rows = (await localDb.evidenceBases.toArray()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  return Promise.all(rows.map(localEvidenceBaseSummary));
}

export async function captureLocalEvidenceSourceInCurrentTransaction(
  input: EvidenceSourceCaptureInput
): Promise<LocalEvidenceSourceCaptureResult> {
  const evidenceBase = await localDb.evidenceBases.get(input.evidenceBaseId);
  if (!evidenceBase) throw new Error("Evidence base not found");
  const now = Date.now();
  let source = await localDb.sources.where("sourceKey").equals(input.sourceKey).first();
  if (source) {
    source = {
      ...source,
      kind: input.kind,
      url: cleanSourceUrl(input.url, input.kind),
      title: cleanOptional(input.title, 500),
      externalId: cleanOptional(input.externalId, 500),
      metadata: boundedMetadata(input.metadata),
      updatedAt: now,
    };
    await localDb.sources.put(source);
  } else {
    source = {
      id: makeId("source"),
      sourceKey: input.sourceKey,
      kind: input.kind,
      url: cleanSourceUrl(input.url, input.kind),
      title: cleanOptional(input.title, 500),
      externalId: cleanOptional(input.externalId, 500),
      metadata: boundedMetadata(input.metadata),
      createdAt: now,
      updatedAt: now,
    };
    await localDb.sources.add(source);
  }

  let fingerprint = await localDb.sourceFingerprints
    .where("[sourceId+contentHash]")
    .equals([source.id, input.fingerprint.contentHash])
    .first();
  if (!fingerprint) {
    fingerprint = {
      id: makeId("fingerprint"),
      sourceId: source.id,
      contentHash: input.fingerprint.contentHash,
      fileHash: input.fingerprint.fileHash,
      hashAlgorithm: "sha256",
      extractionVersion: input.fingerprint.extractionVersion,
      contentLength: input.fingerprint.contentLength,
      observedAt: input.fingerprint.observedAt,
    };
    await localDb.sourceFingerprints.add(fingerprint);
  }

  let membership = await localDb.evidenceBaseSources
    .where("[evidenceBaseId+sourceId]")
    .equals([input.evidenceBaseId, source.id])
    .first();
  const added = !membership;
  if (membership) {
    membership = {
      ...membership,
      latestFingerprintId: fingerprint.id,
      updatedAt: now,
    };
    await localDb.evidenceBaseSources.put(membership);
  } else {
    membership = {
      id: makeId("membership"),
      evidenceBaseId: input.evidenceBaseId,
      sourceId: source.id,
      latestFingerprintId: fingerprint.id,
      addedAt: now,
      updatedAt: now,
    };
    await localDb.evidenceBaseSources.add(membership);
  }

  await localDb.evidenceBases.update(input.evidenceBaseId, { updatedAt: now });
  return {
    sourceId: source.id,
    sourceFingerprintId: fingerprint.id,
    evidenceBaseSourceId: membership.id,
    added,
  };
}

export async function localEvidenceBaseHasSource(
  evidenceBaseId: string,
  sourceKey: string
): Promise<boolean> {
  const source = await localDb.sources.where("sourceKey").equals(sourceKey).first();
  if (!source) return false;
  const membership = await localDb.evidenceBaseSources
    .where("[evidenceBaseId+sourceId]")
    .equals([evidenceBaseId, source.id])
    .first();
  return !!membership;
}

export async function getLocalEvidenceBaseDetail(
  evidenceBaseId: string
): Promise<EvidenceBaseDetail> {
  const row = await localDb.evidenceBases.get(evidenceBaseId);
  if (!row) throw new Error("Evidence base not found");
  const summary = await localEvidenceBaseSummary(row);
  const memberships = (
    await localDb.evidenceBaseSources.where("evidenceBaseId").equals(evidenceBaseId).toArray()
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const sources = [];

  for (const membership of memberships) {
    const source = await localDb.sources.get(membership.sourceId);
    if (!source) continue;
    const fingerprint = membership.latestFingerprintId
      ? await localDb.sourceFingerprints.get(membership.latestFingerprintId)
      : undefined;
    const fingerprints = await localDb.sourceFingerprints
      .where("sourceId")
      .equals(source.id)
      .sortBy("observedAt");
    const segments = (await localDb.sourceSegments.where("sourceId").equals(source.id).toArray())
      .sort((a, b) =>
        a.sourceFingerprintId === b.sourceFingerprintId
          ? a.ordinal - b.ordinal
          : a.createdAt - b.createdAt
      );
    const runRows = (await localDb.runs.where("sourceId").equals(source.id).toArray())
      .filter(
        (run) =>
          run.initiatedFromEvidenceBaseId === evidenceBaseId ||
          (!!membership.latestFingerprintId &&
            run.sourceFingerprintId === membership.latestFingerprintId)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const runs = [];
    for (const run of runRows) {
      const findingRows = await localDb.findings.where("runId").equals(run.runId).sortBy("findingIndex");
      const segmentManifest = await localDb.runSegmentRefs
        .where("runId")
        .equals(run.runId)
        .sortBy("chunkIndex");
      runs.push({
        id: run.runId,
        lensId: run.lensId,
        lensVersion: run.lensVersion,
        lensMarkdownSnapshot: run.lensMarkdownSnapshot,
        chunkingVersion: run.chunkingVersion,
        sourceFingerprintId: run.sourceFingerprintId,
        initiatedFromEvidenceBaseId: run.initiatedFromEvidenceBaseId,
        status: run.status,
        error: run.error?.slice(0, 4000),
        modelUsed: run.modelUsed,
        createdAt: run.createdAt,
        findings: await Promise.all(findingRows.map(async (findingRow) => {
          const finding = findingRow.finding;
          const evidenceRefs = findingRow.id == null
            ? []
            : await localDb.findingEvidenceRefs
                .where("findingId")
                .equals(findingRow.id)
                .toArray();
          return {
            id: String(findingRow.id ?? `${run.runId}:${findingRow.findingIndex}`),
            text: stringValue(finding.text).slice(0, 2000),
            category: stringValue(finding.category).slice(0, 200),
            detail: stringValue(finding.detail).slice(0, 4000),
            confidence: numberValue(finding.confidence),
            sourceSpan: sourceSpanValue(finding.sourceSpan),
            anchor: anchorValue(finding.anchor),
            quotes: boundedQuotes(stringArrayValue(finding.quotes)),
            enrichments: boundedLocalEnrichments(recordArrayValue(finding.enrichments)),
            evidenceRefs: evidenceRefs.map((ref) => ({
              id: ref.id,
              sourceSegmentId: ref.sourceSegmentId,
              segmentKey: ref.segmentKey,
              role: ref.role,
              exactQuote: ref.exactQuote,
              quoteHash: ref.quoteHash,
              anchor: ref.anchor,
              relevanceNote: ref.relevanceNote,
            })),
          };
        })),
        segmentManifest: segmentManifest.map((ref) => ({
          id: ref.id,
          sourceSegmentId: ref.sourceSegmentId,
          segmentKey: ref.segmentKey,
          chunkIndex: ref.chunkIndex,
          role: ref.role,
          status: ref.status,
        })),
      });
    }

    sources.push({
      id: source.id,
      sourceKey: source.sourceKey,
      kind: source.kind,
      url: source.url,
      title: source.title,
      externalId: source.externalId,
      metadata: source.metadata,
      addedAt: membership.addedAt,
      latestFingerprint: fingerprint ? normalizeFingerprint(fingerprint) : undefined,
      fingerprints: fingerprints.map(normalizeFingerprint),
      segments: segments.map((segment) => ({
        id: segment.id,
        sourceFingerprintId: segment.sourceFingerprintId,
        segmentKey: segment.segmentKey,
        ordinal: segment.ordinal,
        kind: segment.kind,
        anchor: segment.anchor,
        contentHash: segment.contentHash,
        normalizedLength: segment.normalizedLength,
        normalizationVersion: segment.normalizationVersion,
        segmentationVersion: segment.segmentationVersion,
        extractionStatus: segment.extractionStatus,
      })),
      runs,
    });
  }

  return { ...summary, sources };
}

export async function previewDeleteLocalEvidenceBase(
  evidenceBaseId: string
): Promise<EvidenceBaseDeletePreview> {
  const existing = await localDb.evidenceBases.get(evidenceBaseId);
  if (!existing) throw new Error("Evidence base not found");
  const memberships = await localDb.evidenceBaseSources
    .where("evidenceBaseId")
    .equals(evidenceBaseId)
    .toArray();
  const runs = await localDb.runs
    .where("initiatedFromEvidenceBaseId")
    .equals(evidenceBaseId)
    .toArray();
  let findings = 0;
  let findingsDeleted = 0;
  let runsDeleted = 0;
  let runsRetained = 0;
  const deletedRunIds = new Set<string>();
  for (const run of runs) {
    const count = await localDb.findings.where("runId").equals(run.runId).count();
    findings += count;
    if (await localRunIsReferencedElsewhere(run, evidenceBaseId)) {
      runsRetained += 1;
    } else {
      runsDeleted += 1;
      findingsDeleted += count;
      deletedRunIds.add(run.runId);
    }
  }
  let sharedSources = 0;
  let sourcesDeleted = 0;
  for (const membership of memberships) {
    const references = await localDb.evidenceBaseSources
      .where("sourceId")
      .equals(membership.sourceId)
      .toArray();
    if (references.some((reference) => reference.evidenceBaseId !== evidenceBaseId)) {
      sharedSources += 1;
      continue;
    }
    const sourceRuns = await localDb.runs.where("sourceId").equals(membership.sourceId).toArray();
    if (sourceRuns.every((run) => deletedRunIds.has(run.runId))) sourcesDeleted += 1;
  }
  return {
    evidenceBaseId,
    sourceMemberships: memberships.length,
    initiatedRuns: runs.length,
    findings,
    exclusiveSources: memberships.length - sharedSources,
    sharedSources,
    sourcesDeleted,
    runsDeleted,
    runsRetained,
    findingsDeleted,
  };
}

export async function deleteLocalEvidenceBase(
  evidenceBaseId: string
): Promise<{ deleted: true; preview: EvidenceBaseDeletePreview }> {
  const preview = await previewDeleteLocalEvidenceBase(evidenceBaseId);
  await localDb.transaction(
    "rw",
    [
      localDb.evidenceBases,
      localDb.sources,
      localDb.sourceFingerprints,
      localDb.sourceSegments,
      localDb.evidenceBaseSources,
      localDb.runs,
      localDb.findings,
      localDb.runSegmentRefs,
      localDb.findingEvidenceRefs,
    ],
    async () => {
      const initiatedRuns = await localDb.runs
        .where("initiatedFromEvidenceBaseId")
        .equals(evidenceBaseId)
        .toArray();
      for (const run of initiatedRuns) {
        if (await localRunIsReferencedElsewhere(run, evidenceBaseId)) {
          await localDb.runs.update(run.runId, { initiatedFromEvidenceBaseId: undefined });
          continue;
        }
        const findings = await localDb.findings.where("runId").equals(run.runId).toArray();
        for (const finding of findings) {
          if (finding.id != null) {
            await localDb.findingEvidenceRefs.where("findingId").equals(finding.id).delete();
          }
        }
        await localDb.findings.where("runId").equals(run.runId).delete();
        await localDb.runSegmentRefs.where("runId").equals(run.runId).delete();
        await localDb.runs.delete(run.runId);
      }
      const memberships = await localDb.evidenceBaseSources
        .where("evidenceBaseId")
        .equals(evidenceBaseId)
        .toArray();
      for (const membership of memberships) {
        const otherMemberships = (
          await localDb.evidenceBaseSources.where("sourceId").equals(membership.sourceId).toArray()
        ).filter((candidate) => candidate.id !== membership.id);
        if (otherMemberships.length === 0) {
          const remainingRuns = await localDb.runs
            .where("sourceId")
            .equals(membership.sourceId)
            .count();
          if (remainingRuns === 0) {
            await localDb.sourceSegments.where("sourceId").equals(membership.sourceId).delete();
            await localDb.sourceFingerprints.where("sourceId").equals(membership.sourceId).delete();
            await localDb.sources.delete(membership.sourceId);
          }
        }
        await localDb.evidenceBaseSources.delete(membership.id);
      }
      await localDb.evidenceBases.delete(evidenceBaseId);
    }
  );
  return { deleted: true, preview };
}

export async function exportLocalEvidenceBase(evidenceBaseId: string): Promise<EvidenceBaseExport> {
  return {
    schemaVersion: "lenses.evidence-base.v3",
    exportedAt: Date.now(),
    evidenceBase: await getLocalEvidenceBaseDetail(evidenceBaseId),
  };
}

async function localEvidenceBaseSummary(row: LocalEvidenceBaseRow): Promise<EvidenceBase> {
  const [sourceCount, runCount] = await Promise.all([
    localDb.evidenceBaseSources.where("evidenceBaseId").equals(row.id).count(),
    localDb.runs.where("initiatedFromEvidenceBaseId").equals(row.id).count(),
  ]);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    guidingQuestion: row.guidingQuestion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceCount,
    runCount,
  };
}

function normalizeFingerprint(row: LocalSourceFingerprintRow) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    contentHash: row.contentHash,
    fileHash: row.fileHash,
    hashAlgorithm: row.hashAlgorithm,
    extractionVersion: row.extractionVersion,
    contentLength: row.contentLength,
    observedAt: row.observedAt,
  };
}

function boundedQuotes(quotes: string[] | undefined): string[] | undefined {
  if (!quotes) return undefined;
  const bounded = quotes
    .map((quote) => quote.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 8);
  return bounded.length > 0 ? bounded : undefined;
}

function boundedMetadata(
  metadata: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .slice(0, 24)
    .map(([key, value]) => [key.trim().slice(0, 80), value.trim().slice(0, 500)] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function cleanSourceUrl(
  url: string | undefined,
  kind: EvidenceSourceCaptureInput["kind"]
): string | undefined {
  const clean = cleanOptional(url, 4000);
  if (!clean) return undefined;
  if (kind === "pdf" && /^(?:blob|data|file):/i.test(clean)) return undefined;
  return clean;
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanOptional(value: string | undefined, maxLength: number): string | undefined {
  const clean = value?.trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function anchorValue(value: unknown): AnchorType | undefined {
  const parsed = Anchor.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function recordArrayValue(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry)
  );
}

function boundedLocalEnrichments(
  enrichments: Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> | undefined {
  return enrichments?.slice(0, 20).map((enrichment) => ({
    lensId: stringValue(enrichment.lensId).slice(0, 200),
    summary: stringValue(enrichment.summary).slice(0, 2000),
    data: boundedMetadata(recordStringValues(enrichment.data)),
    sources: recordArrayValue(enrichment.sources)?.slice(0, 20).map((source) => ({
      url: stringValue(source.url).slice(0, 4000),
      title: stringValue(source.title).slice(0, 500),
    })),
    addedBy: enrichment.addedBy === "user" ? "user" : "agent",
    at: numberValue(enrichment.at),
  }));
}

function recordStringValues(value: unknown): Record<string, string> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function sourceSpanValue(value: unknown): { start: number; end: number } | undefined {
  const record = recordValue(value);
  return record && typeof record.start === "number" && typeof record.end === "number"
    ? { start: record.start, end: record.end }
    : undefined;
}

async function localRunIsReferencedElsewhere(
  run: { sourceId?: string; sourceFingerprintId?: string },
  evidenceBaseId: string
): Promise<boolean> {
  if (!run.sourceId || !run.sourceFingerprintId) return false;
  const memberships = await localDb.evidenceBaseSources
    .where("sourceId")
    .equals(run.sourceId)
    .toArray();
  return memberships.some(
    (membership) =>
      membership.evidenceBaseId !== evidenceBaseId &&
      membership.latestFingerprintId === run.sourceFingerprintId
  );
}
