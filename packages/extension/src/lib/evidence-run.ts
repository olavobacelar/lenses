import type {
  FindingEvidenceRefInput,
  SourceSegmentDescriptor,
} from "@lenses/shared";
import type { EvidenceSourceCaptureInput } from "./evidence-bases";

export interface EvidenceRunStartInput extends EvidenceSourceCaptureInput {
  lensId: string;
  runRequestId?: string;
  scope?: "page" | "selection" | "transcript";
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  chunkingVersion: string;
  segments: SourceSegmentDescriptor[];
  inspections: Array<{
    segmentKey: string;
    chunkIndex: number;
    role: "core" | "context";
  }>;
}

export interface EvidenceRunStartResult {
  runId: string;
  sourceId: string;
  sourceFingerprintId: string;
  evidenceBaseSourceAdded: boolean;
}

export interface EvidenceRunChunkUpdate {
  runId: string;
  chunkIndex: number;
  status: "completed" | "failed" | "cancelled";
}

export interface EvidenceRunFailure {
  runId: string;
  status: "failed" | "cancelled";
  error?: string;
}

export interface EvidenceRunFindingsInput {
  runId?: string;
  evidenceRefs?: FindingEvidenceRefInput[];
}
