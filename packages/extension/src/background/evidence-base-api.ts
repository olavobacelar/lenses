import type {
  EvidenceBase,
  EvidenceBaseDeletePreview,
  EvidenceBaseDetail,
  EvidenceBaseExport,
} from "@lenses/shared";
import {
  createLocalEvidenceBase,
  deleteLocalEvidenceBase,
  exportLocalEvidenceBase,
  getLocalEvidenceBaseDetail,
  listLocalEvidenceBases,
  localEvidenceBaseHasSource,
  previewDeleteLocalEvidenceBase,
  updateLocalEvidenceBase,
} from "./local-evidence-bases";
import {
  failLocalEvidenceRun,
  markLocalEvidenceRunChunk,
  startLocalEvidenceRun,
} from "./local-evidence-runs";
import type {
  EvidenceRunChunkUpdate,
  EvidenceRunFailure,
  EvidenceRunStartInput,
  EvidenceRunStartResult,
} from "../lib/evidence-run";

export interface EvidenceBaseWriteInput {
  title: string;
  description?: string;
  guidingQuestion?: string;
}

export async function listEvidenceBases(): Promise<{ evidenceBases: EvidenceBase[] }> {
  return { evidenceBases: await listLocalEvidenceBases() };
}

export async function createEvidenceBase(
  input: EvidenceBaseWriteInput
): Promise<{ id: string }> {
  return createLocalEvidenceBase(evidenceBaseWriteArgs(input));
}

export async function updateEvidenceBase(
  input: EvidenceBaseWriteInput & { evidenceBaseId: string }
): Promise<{ id: string }> {
  const args = { evidenceBaseId: input.evidenceBaseId, ...evidenceBaseWriteArgs(input) };
  return updateLocalEvidenceBase(args);
}

export async function startEvidenceRun(
  input: EvidenceRunStartInput
): Promise<EvidenceRunStartResult> {
  return startLocalEvidenceRun(input);
}

export async function markEvidenceRunChunk(
  input: EvidenceRunChunkUpdate
): Promise<{ updated: number }> {
  return markLocalEvidenceRunChunk(input);
}

export async function failEvidenceRun(
  input: EvidenceRunFailure
): Promise<{ updated: boolean }> {
  return failLocalEvidenceRun(input);
}

export async function getEvidenceBase(
  evidenceBaseId: string
): Promise<{ evidenceBase: EvidenceBaseDetail }> {
  return { evidenceBase: await getLocalEvidenceBaseDetail(evidenceBaseId) };
}

export async function evidenceBaseHasSource(
  evidenceBaseId: string,
  sourceKey: string
): Promise<{ present: boolean }> {
  return { present: await localEvidenceBaseHasSource(evidenceBaseId, sourceKey) };
}

export async function previewDeleteEvidenceBase(
  evidenceBaseId: string
): Promise<{ preview: EvidenceBaseDeletePreview }> {
  return { preview: await previewDeleteLocalEvidenceBase(evidenceBaseId) };
}

export async function deleteEvidenceBase(
  evidenceBaseId: string
): Promise<{ deleted: boolean; preview: EvidenceBaseDeletePreview }> {
  return deleteLocalEvidenceBase(evidenceBaseId);
}

export async function exportEvidenceBase(
  evidenceBaseId: string
): Promise<{ bundle: EvidenceBaseExport }> {
  return { bundle: await exportLocalEvidenceBase(evidenceBaseId) };
}

function evidenceBaseWriteArgs(input: EvidenceBaseWriteInput): EvidenceBaseWriteInput {
  return {
    title: input.title,
    description: input.description,
    guidingQuestion: input.guidingQuestion,
  };
}
