import { describe, expect, it } from "vitest";
import { EvidenceBaseDetail } from "../src/index.js";

describe("EvidenceBaseDetail", () => {
  it("exposes provenance and bounded findings without source contents or raw responses", () => {
    const detail = EvidenceBaseDetail.parse({
      id: "base-1",
      title: "Origins review",
      createdAt: 1,
      updatedAt: 2,
      sourceCount: 1,
      runCount: 1,
      sources: [
        {
          id: "source-1",
          sourceKey: "url:https://example.com",
          kind: "web_page",
          url: "https://example.com",
          addedAt: 2,
          sourceText: "must not escape",
          latestFingerprint: {
            id: "fingerprint-1",
            sourceId: "source-1",
            contentHash: "a".repeat(64),
            hashAlgorithm: "sha256",
            extractionVersion: "lenses-source-v1",
            contentLength: 100,
            observedAt: 2,
          },
          runs: [
            {
              id: "run-1",
              lensId: "claim-extractor",
              chunkingVersion: "lenses-owned-core-v1",
              sourceFingerprintId: "fingerprint-1",
              status: "completed",
              rawResponse: "must not escape",
              sourceText: "must not escape",
              createdAt: 3,
              findings: [
                {
                  id: "finding-1",
                  text: "A bounded finding",
                  category: "claim",
                  detail: "Assessment",
                  confidence: 0.9,
                  anchor: { kind: "pdf", pageNumber: 4, start: 12, end: 31 },
                  quotes: ["Short quotation"],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(detail.sources[0]).not.toHaveProperty("sourceText");
    expect(detail.sources[0].runs[0]).not.toHaveProperty("sourceText");
    expect(detail.sources[0].runs[0]).not.toHaveProperty("rawResponse");
    expect(detail.sources[0].runs[0].sourceFingerprintId).toBe("fingerprint-1");
    expect(detail.sources[0].runs[0].chunkingVersion).toBe("lenses-owned-core-v1");
  });

  it("rejects quotation payloads beyond the evidence-base bounds", () => {
    const finding = {
      id: "finding-1",
      text: "Finding",
      category: "claim",
      detail: "Assessment",
      confidence: 0.9,
      quotes: Array.from({ length: 9 }, () => "quote"),
    };
    const result = EvidenceBaseDetail.shape.sources.element.shape.runs.element.shape.findings.element.safeParse(
      finding
    );
    expect(result.success).toBe(false);
  });
});
