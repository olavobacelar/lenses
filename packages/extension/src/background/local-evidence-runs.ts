import type { SourceSegmentDescriptor } from "@lenses/shared";
import {
  localDb,
  type LocalRunRow,
  type LocalRunSegmentRefRow,
  type LocalSourceSegmentRow,
} from "../lib/local-db";
import type {
  EvidenceRunChunkUpdate,
  EvidenceRunFailure,
  EvidenceRunStartInput,
  EvidenceRunStartResult,
} from "../lib/evidence-run";
import { captureLocalEvidenceSourceInCurrentTransaction } from "./local-evidence-bases";

export async function startLocalEvidenceRun(
  input: EvidenceRunStartInput
): Promise<EvidenceRunStartResult> {
  const storedLens = await localDb.lenses.get(input.lensId);
  const now = Date.now();
  const runId = makeId("run");
  let result: EvidenceRunStartResult | undefined;

  await localDb.transaction(
    "rw",
    [
      localDb.evidenceBases,
      localDb.sources,
      localDb.sourceFingerprints,
      localDb.evidenceBaseSources,
      localDb.runs,
      localDb.sourceSegments,
      localDb.runSegmentRefs,
    ],
    async () => {
      const captured = await captureLocalEvidenceSourceInCurrentTransaction(input);
      const segmentIds = await upsertLocalSourceSegments({
        sourceId: captured.sourceId,
        sourceFingerprintId: captured.sourceFingerprintId,
        segments: input.segments,
      });
      const run: LocalRunRow = {
        runId,
        runGroupId: makeId("run_group"),
        lensId: input.lensId,
        sourceUrl: cleanSourceUrl(input.url, input.kind),
        sourceKey: input.sourceKey,
        sourceKind: input.kind,
        sourceTitle: input.title,
        sourceId: captured.sourceId,
        sourceFingerprintId: captured.sourceFingerprintId,
        initiatedFromEvidenceBaseId: input.evidenceBaseId,
        lensVersion:
          input.lensVersion ??
          (typeof storedLens?.row.version === "string" ? storedLens.row.version : undefined),
        lensMarkdownSnapshot: input.lensMarkdownSnapshot ?? storedLens?.markdown,
        chunkingVersion: input.chunkingVersion,
        scope: input.scope,
        status: "running",
        createdAt: now,
        updatedAt: now,
      };
      await localDb.runs.add(run);
      if (input.inspections.length > 0) {
        await localDb.runSegmentRefs.bulkAdd(
          input.inspections.map((inspection): LocalRunSegmentRefRow => {
            const sourceSegmentId = segmentIds.get(inspection.segmentKey);
            if (!sourceSegmentId) throw new Error("Run inspection references an unknown segment");
            return {
              id: makeId("run_segment"),
              runId,
              sourceSegmentId,
              segmentKey: inspection.segmentKey,
              chunkIndex: inspection.chunkIndex,
              role: inspection.role,
              status: "pending",
            };
          })
        );
      }
      result = {
        runId,
        sourceId: captured.sourceId,
        sourceFingerprintId: captured.sourceFingerprintId,
        evidenceBaseSourceAdded: captured.added,
      };
    }
  );

  if (!result) throw new Error("Could not start evidence run");
  return result;
}

export async function markLocalEvidenceRunChunk(
  input: EvidenceRunChunkUpdate
): Promise<{ updated: number }> {
  const refs = await localDb.runSegmentRefs
    .where("[runId+chunkIndex]")
    .equals([input.runId, input.chunkIndex])
    .toArray();
  await localDb.runSegmentRefs.bulkPut(
    refs.map((ref) => ({ ...ref, status: input.status }))
  );
  return { updated: refs.length };
}

export async function failLocalEvidenceRun(
  input: EvidenceRunFailure
): Promise<{ updated: boolean }> {
  const run = await localDb.runs.get(input.runId);
  if (!run || run.status === "completed") return { updated: false };
  await localDb.transaction("rw", localDb.runs, localDb.runSegmentRefs, async () => {
    const refs = await localDb.runSegmentRefs.where("runId").equals(input.runId).toArray();
    await localDb.runSegmentRefs.bulkPut(
      refs.map((ref) =>
        ref.status === "pending" ? { ...ref, status: input.status } : ref
      )
    );
    await localDb.runs.update(input.runId, {
      status: input.status,
      findingCount: 0,
      error: input.error?.slice(0, 4000),
      updatedAt: Date.now(),
    });
  });
  return { updated: true };
}

async function upsertLocalSourceSegments(input: {
  sourceId: string;
  sourceFingerprintId: string;
  segments: SourceSegmentDescriptor[];
}): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const segment of input.segments) {
    const existing = await localDb.sourceSegments
      .where("[sourceFingerprintId+segmentKey]")
      .equals([input.sourceFingerprintId, segment.segmentKey])
      .first();
    if (existing) {
      ids.set(segment.segmentKey, existing.id);
      continue;
    }
    const row: LocalSourceSegmentRow = {
      id: makeId("segment"),
      sourceId: input.sourceId,
      sourceFingerprintId: input.sourceFingerprintId,
      ...segment,
      createdAt: Date.now(),
    };
    await localDb.sourceSegments.add(row);
    ids.set(segment.segmentKey, row.id);
  }
  return ids;
}

function cleanSourceUrl(
  url: string | undefined,
  kind: EvidenceRunStartInput["kind"]
): string | undefined {
  const clean = url?.trim();
  if (!clean) return undefined;
  if (kind === "pdf" && /^(?:blob|data|file|local-pdf):/i.test(clean)) return undefined;
  return clean.slice(0, 4000);
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
