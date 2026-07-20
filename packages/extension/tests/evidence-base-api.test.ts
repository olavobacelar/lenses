import { beforeEach, describe, expect, it, vi } from "vitest";

const localEvidenceBases = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  exportBundle: vi.fn(),
  getDetail: vi.fn(),
  list: vi.fn(),
  hasSource: vi.fn(),
  previewRemove: vi.fn(),
  update: vi.fn(),
}));

const localEvidenceRuns = vi.hoisted(() => ({
  fail: vi.fn(),
  markChunk: vi.fn(),
  start: vi.fn(),
}));

vi.mock("../src/background/local-evidence-bases.js", () => ({
  createLocalEvidenceBase: localEvidenceBases.create,
  deleteLocalEvidenceBase: localEvidenceBases.remove,
  exportLocalEvidenceBase: localEvidenceBases.exportBundle,
  getLocalEvidenceBaseDetail: localEvidenceBases.getDetail,
  listLocalEvidenceBases: localEvidenceBases.list,
  localEvidenceBaseHasSource: localEvidenceBases.hasSource,
  previewDeleteLocalEvidenceBase: localEvidenceBases.previewRemove,
  updateLocalEvidenceBase: localEvidenceBases.update,
}));

vi.mock("../src/background/local-evidence-runs.js", () => ({
  failLocalEvidenceRun: localEvidenceRuns.fail,
  markLocalEvidenceRunChunk: localEvidenceRuns.markChunk,
  startLocalEvidenceRun: localEvidenceRuns.start,
}));

import {
  evidenceBaseHasSource,
  failEvidenceRun,
  listEvidenceBases,
  startEvidenceRun,
} from "../src/background/evidence-base-api.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evidence base API", () => {
  it("uses browser-local persistence independently of the managed AI mode", async () => {
    localEvidenceBases.list.mockResolvedValue([
      {
        id: "base-1",
        title: "Review",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await expect(listEvidenceBases()).resolves.toMatchObject({
      evidenceBases: [{ id: "base-1", title: "Review" }],
    });
    expect(localEvidenceBases.list).toHaveBeenCalledOnce();
  });

  it("checks evidence-base membership in the local database", async () => {
    localEvidenceBases.hasSource.mockResolvedValue(true);

    await expect(
      evidenceBaseHasSource("base-1", "url:https://example.com/report")
    ).resolves.toEqual({ present: true });
    expect(localEvidenceBases.hasSource).toHaveBeenCalledWith(
      "base-1",
      "url:https://example.com/report"
    );
  });

  it("forwards text-free source descriptors to the local evidence-run store", async () => {
    const input = {
      evidenceBaseId: "base-1",
      lensId: "claim-extractor",
      sourceKey: "url:https://example.com/report",
      kind: "web_page" as const,
      url: "https://example.com/report",
      title: "Report",
      fingerprint: {
        contentHash: "a".repeat(64),
        extractionVersion: "lenses-source-v1",
        contentLength: 42,
        observedAt: 123,
      },
      chunkingVersion: "owned-core-v1",
      segments: [
        {
          segmentKey: "segment-1",
          ordinal: 0,
          kind: "text" as const,
          anchor: { kind: "text" as const, start: 0, end: 42 },
          contentHash: "b".repeat(64),
          normalizedLength: 42,
          normalizationVersion: "normalization-v1",
          segmentationVersion: "segmentation-v1",
          extractionStatus: "complete" as const,
        },
      ],
      inspections: [{ segmentKey: "segment-1", chunkIndex: 0, role: "core" as const }],
    };
    localEvidenceRuns.start.mockResolvedValue({
      runId: "run-1",
      sourceId: "source-1",
      sourceFingerprintId: "fingerprint-1",
      evidenceBaseSourceAdded: true,
    });

    await expect(startEvidenceRun(input)).resolves.toMatchObject({
      runId: "run-1",
      evidenceBaseSourceAdded: true,
    });
    expect(localEvidenceRuns.start).toHaveBeenCalledWith(input);
    expect(localEvidenceRuns.start.mock.calls[0][0].segments[0]).not.toHaveProperty("text");
  });

  it("records terminal run state in the local database", async () => {
    localEvidenceRuns.fail.mockResolvedValue({ updated: true });

    await expect(
      failEvidenceRun({ runId: "run-1", status: "failed", error: "Model unavailable" })
    ).resolves.toEqual({ updated: true });
    expect(localEvidenceRuns.fail).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      error: "Model unavailable",
    });
  });
});
