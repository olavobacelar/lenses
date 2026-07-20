import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..");
const buildSource = readFileSync(join(extensionRoot, "build.ts"), "utf8");
const localDbSource = readFileSync(join(extensionRoot, "src/lib/local-db.ts"), "utf8");
const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));

describe("evidence-base extension build", () => {
  it("bundles the library page and the matching PDF.js worker", () => {
    expect(buildSource).toContain('src/evidence-bases/evidence-bases.tsx');
    expect(buildSource).toContain('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    expect(buildSource).toContain('join(outdir, "pdf/pdf.worker.min.mjs")');
    expect(buildSource).toContain('pdfjs-dist/standard_fonts');
  });

  it("keeps scripts and workers local while permitting authorized PDF fetches", () => {
    const csp = manifest.content_security_policy.extension_pages as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src https: http:");
  });

  it("scopes reusable segment identity to its source fingerprint", () => {
    expect(localDbSource).toContain("this.version(4).stores");
    expect(localDbSource).toContain(
      '"id, sourceId, sourceFingerprintId, segmentKey, ordinal, [sourceFingerprintId+segmentKey]"'
    );
  });

  it("removes legacy evidence-base icon fields from local rows", () => {
    expect(localDbSource).toContain("this.version(5)");
    expect(localDbSource).toContain("delete row.iconKind");
    expect(localDbSource).toContain("delete row.iconValue");
  });
});
