import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_EVIDENCE_BASE_STORAGE_KEY,
  evidenceBaseExportFilename,
  fingerprintText,
  normalizeFingerprintText,
  readActiveEvidenceBaseId,
} from "../src/lib/evidence-bases.js";
import { LEGACY_MANAGED_MODE_STORAGE_VALUE } from "../src/lib/legacy-storage-compat.js";
import { extractPdfSource, resolvePdfUrl } from "../src/lib/pdf-source.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evidence-base fingerprints", () => {
  it("normalizes line endings and trailing whitespace before hashing", async () => {
    const first = await fingerprintText("Alpha  \r\nBeta\r\n");
    const second = await fingerprintText("Alpha\nBeta");

    expect(normalizeFingerprintText("Alpha  \r\nBeta\r\n")).toBe("Alpha\nBeta");
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contentLength).toBe("Alpha\nBeta".length);
  });

  it("migrates the active evidence base to mode-independent local storage", async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({
            "evidenceBases:activeByMode": {
              [LEGACY_MANAGED_MODE_STORAGE_VALUE]: "managed-legacy-1",
              local_byok: "local-1",
            },
          })),
          set,
          remove,
        },
      },
    });

    await expect(readActiveEvidenceBaseId()).resolves.toBe("local-1");
    expect(set).toHaveBeenCalledWith({
      [ACTIVE_EVIDENCE_BASE_STORAGE_KEY]: "local-1",
    });
    expect(remove).toHaveBeenCalledWith("evidenceBases:activeByMode");
  });

  it("creates stable JSON export filenames", () => {
    expect(evidenceBaseExportFilename("COVID Origins Review")).toBe(
      "covid-origins-review.evidencebase.json"
    );
  });
});

describe("PDF ingestion", () => {
  it("recognizes direct and Chrome-viewer PDF URLs", () => {
    expect(resolvePdfUrl("https://example.com/report.pdf")).toBe(
      "https://example.com/report.pdf"
    );
    expect(
      resolvePdfUrl(
        "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=https%3A%2F%2Fexample.com%2Fpaper.pdf"
      )
    ).toBe("https://example.com/paper.pdf");
    expect(resolvePdfUrl("https://example.com/article", "Article")).toBeNull();
  });

  it("extracts text, a file hash, and page ranges without retaining bytes", async () => {
    const result = await extractPdfSource(minimalTextPdf("Hello evidence"), "fixture.pdf");

    expect(result.text).toContain("Hello evidence");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ pageNumber: 1, start: 0 });
    expect(result.pages[0].end).toBe(result.text.length);
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fingerprint.fileHash).toBe(result.fileHash);
    expect(result.ocrRequired).toBe(false);
    expect(result).not.toHaveProperty("bytes");
  });
});

function minimalTextPdf(text: string): Uint8Array {
  const escaped = text.replace(/[\\()]/g, (character) => `\\${character}`);
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(new TextEncoder().encode(source).length);
    source += object;
  }
  const xrefOffset = new TextEncoder().encode(source).length;
  source += "xref\n0 6\n0000000000 65535 f \n";
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}
