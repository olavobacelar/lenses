import Dexie, { type Table } from "dexie";
import type { Anchor, SourceSegmentDescriptor } from "@lenses/shared";
import { LENSES_LOCAL_DATABASE_NAME } from "./legacy-storage-compat";

export interface LocalLensRow {
  lensId: string;
  markdown?: string;
  isBuiltIn: boolean;
  updatedAt: number;
  row: Record<string, unknown>;
}

export interface LocalRunRow {
  runId: string;
  runGroupId?: string;
  lensId: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  sourceTitle?: string;
  sourceId?: string;
  sourceFingerprintId?: string;
  initiatedFromEvidenceBaseId?: string;
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  chunkingVersion?: string;
  scope?: "page" | "selection" | "transcript";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  findingCount?: number;
  error?: string;
  modelUsed?: string;
  rawResponse?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalFindingRow {
  id?: number;
  runId: string;
  lensId: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  findingIndex: number;
  finding: Record<string, unknown>;
}

export interface LocalEvidenceBaseRow {
  id: string;
  title: string;
  description?: string;
  guidingQuestion?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalSourceRow {
  id: string;
  sourceKey: string;
  kind: "web_page" | "youtube_video" | "pdf";
  url?: string;
  title?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface LocalSourceFingerprintRow {
  id: string;
  sourceId: string;
  contentHash: string;
  fileHash?: string;
  hashAlgorithm: "sha256";
  extractionVersion: string;
  contentLength: number;
  observedAt: number;
}

export interface LocalSourceSegmentRow extends SourceSegmentDescriptor {
  id: string;
  sourceId: string;
  sourceFingerprintId: string;
  createdAt: number;
}

export interface LocalRunSegmentRefRow {
  id: string;
  runId: string;
  sourceSegmentId: string;
  segmentKey: string;
  chunkIndex: number;
  role: "core" | "context";
  status: "pending" | "completed" | "failed" | "cancelled";
}

export interface LocalFindingEvidenceRefRow {
  id: string;
  findingId: number;
  runId: string;
  sourceSegmentId: string;
  segmentKey: string;
  role: "basis" | "context";
  exactQuote: string;
  quoteHash: string;
  anchor: Anchor;
  relevanceNote?: string;
}

export interface LocalEvidenceBaseSourceRow {
  id: string;
  evidenceBaseId: string;
  sourceId: string;
  latestFingerprintId?: string;
  addedAt: number;
  updatedAt: number;
  note?: string;
}

export interface LocalConversationRow {
  key: string;
  sourceKey: string;
  sourceUrl?: string;
  sourceKind: "web_page" | "youtube_video" | "pdf";
  scope: "page" | "selection" | "transcript";
  focus: "source" | "selection" | "finding" | "run";
  focusRef: string;
  messages: Array<Record<string, unknown>>;
  updatedAt: number;
}

export interface LocalSavedSelectionRow {
  id: string;
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  scope?: "page" | "selection" | "transcript";
  url: string;
  selectedText: string;
  messages: Array<Record<string, unknown>>;
  title: string;
  createdAt: number;
  updatedAt: number;
  anchorPrefix?: string;
  anchorSuffix?: string;
  textStart?: number;
  textEnd?: number;
  pageTitle?: string;
}

class LensesLocalDatabase extends Dexie {
  lenses!: Table<LocalLensRow, string>;
  runs!: Table<LocalRunRow, string>;
  findings!: Table<LocalFindingRow, number>;
  conversations!: Table<LocalConversationRow, string>;
  savedSelections!: Table<LocalSavedSelectionRow, string>;
  evidenceBases!: Table<LocalEvidenceBaseRow, string>;
  sources!: Table<LocalSourceRow, string>;
  sourceFingerprints!: Table<LocalSourceFingerprintRow, string>;
  sourceSegments!: Table<LocalSourceSegmentRow, string>;
  evidenceBaseSources!: Table<LocalEvidenceBaseSourceRow, string>;
  runSegmentRefs!: Table<LocalRunSegmentRefRow, string>;
  findingEvidenceRefs!: Table<LocalFindingEvidenceRefRow, string>;

  constructor() {
    super(LENSES_LOCAL_DATABASE_NAME);
    this.version(1).stores({
      lenses: "lensId, isBuiltIn, updatedAt",
      runs:
        "runId, lensId, sourceUrl, sourceKey, status, createdAt, updatedAt, [sourceUrl+lensId+createdAt], [sourceKey+lensId+createdAt]",
      findings:
        "++id, runId, lensId, sourceUrl, sourceKey, [sourceUrl+lensId], [sourceKey+lensId]",
      conversations: "key, sourceKey, sourceUrl, focus, updatedAt",
      savedSelections: "id, url, sourceKey, createdAt, updatedAt",
    });
    this.version(2).stores({
      lenses: "lensId, isBuiltIn, updatedAt",
      runs:
        "runId, lensId, sourceUrl, sourceKey, sourceId, sourceFingerprintId, initiatedFromEvidenceBaseId, status, createdAt, updatedAt, [sourceUrl+lensId+createdAt], [sourceKey+lensId+createdAt]",
      findings:
        "++id, runId, lensId, sourceUrl, sourceKey, [sourceUrl+lensId], [sourceKey+lensId]",
      conversations: "key, sourceKey, sourceUrl, focus, updatedAt",
      savedSelections: "id, url, sourceKey, createdAt, updatedAt",
      evidenceBases: "id, updatedAt, createdAt",
      sources: "id, &sourceKey, kind, url, externalId, updatedAt",
      sourceFingerprints: "id, sourceId, contentHash, [sourceId+contentHash], observedAt",
      evidenceBaseSources:
        "id, evidenceBaseId, sourceId, latestFingerprintId, [evidenceBaseId+sourceId], updatedAt",
    });
    this.version(3)
      .stores({
        lenses: "lensId, isBuiltIn, updatedAt",
        runs:
          "runId, lensId, sourceUrl, sourceKey, sourceId, sourceFingerprintId, initiatedFromEvidenceBaseId, status, createdAt, updatedAt, [sourceUrl+lensId+createdAt], [sourceKey+lensId+createdAt]",
        findings:
          "++id, runId, lensId, sourceUrl, sourceKey, [sourceUrl+lensId], [sourceKey+lensId]",
        conversations: "key, sourceKey, sourceUrl, focus, updatedAt",
        savedSelections: "id, url, sourceKey, createdAt, updatedAt",
        evidenceBases: "id, updatedAt, createdAt",
        sources: "id, &sourceKey, kind, url, externalId, updatedAt",
        sourceFingerprints: "id, sourceId, contentHash, [sourceId+contentHash], observedAt",
        sourceSegments:
          "id, sourceId, sourceFingerprintId, &segmentKey, ordinal, [sourceFingerprintId+segmentKey]",
        evidenceBaseSources:
          "id, evidenceBaseId, sourceId, latestFingerprintId, [evidenceBaseId+sourceId], updatedAt",
        runSegmentRefs:
          "id, runId, sourceSegmentId, chunkIndex, role, status, [runId+chunkIndex], [runId+sourceSegmentId]",
        findingEvidenceRefs:
          "id, findingId, runId, sourceSegmentId, [findingId+sourceSegmentId], [runId+findingId]",
      })
      .upgrade(async (transaction) => {
        await Promise.all(
          [
            "lenses",
            "runs",
            "findings",
            "conversations",
            "savedSelections",
            "evidenceBases",
            "sources",
            "sourceFingerprints",
            "sourceSegments",
            "evidenceBaseSources",
            "runSegmentRefs",
            "findingEvidenceRefs",
          ].map((table) => transaction.table(table).clear())
        );
      });
    this.version(4).stores({
      lenses: "lensId, isBuiltIn, updatedAt",
      runs:
        "runId, lensId, sourceUrl, sourceKey, sourceId, sourceFingerprintId, initiatedFromEvidenceBaseId, status, createdAt, updatedAt, [sourceUrl+lensId+createdAt], [sourceKey+lensId+createdAt]",
      findings:
        "++id, runId, lensId, sourceUrl, sourceKey, [sourceUrl+lensId], [sourceKey+lensId]",
      conversations: "key, sourceKey, sourceUrl, focus, updatedAt",
      savedSelections: "id, url, sourceKey, createdAt, updatedAt",
      evidenceBases: "id, updatedAt, createdAt",
      sources: "id, &sourceKey, kind, url, externalId, updatedAt",
      sourceFingerprints: "id, sourceId, contentHash, [sourceId+contentHash], observedAt",
      sourceSegments:
        "id, sourceId, sourceFingerprintId, segmentKey, ordinal, [sourceFingerprintId+segmentKey]",
      evidenceBaseSources:
        "id, evidenceBaseId, sourceId, latestFingerprintId, [evidenceBaseId+sourceId], updatedAt",
      runSegmentRefs:
        "id, runId, sourceSegmentId, chunkIndex, role, status, [runId+chunkIndex], [runId+sourceSegmentId]",
      findingEvidenceRefs:
        "id, findingId, runId, sourceSegmentId, [findingId+sourceSegmentId], [runId+findingId]",
    });
    this.version(5)
      .stores({
        evidenceBases: "id, updatedAt, createdAt",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("evidenceBases")
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            delete row.iconKind;
            delete row.iconValue;
          });
      });
  }
}

export const localDb = new LensesLocalDatabase();
