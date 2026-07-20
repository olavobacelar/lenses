import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), "utf-8");
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("managed credential source guards", () => {
  const worker = readSource("background/service-worker.ts");

  it("keeps credential fields out of managed service-worker request literals", () => {
    const managedLensRun = between(
      worker,
      'const aiSettings = await readStoredModelSettings("execution");',
      '} catch (error) {'
    );
    const managedLensNaming = between(
      worker,
      "async function generateLensNameViaConvex(",
      "async function lensConfigsById("
    );
    const managedFindingStream = between(
      worker,
      "const response = await fetch(`${convexSiteUrl}/managed/ask-finding/stream`",
      "if (!response.ok)"
    );

    for (const requestSource of [managedLensRun, managedLensNaming, managedFindingStream]) {
      expect(requestSource).not.toContain("apiKey:");
      expect(requestSource).not.toContain("apiKeys:");
    }
  });

  it("keeps personal-key controls behind the Local BYOK UI branch", () => {
    const options = readSource("options/OptionsApp.tsx");
    const optionsSettings = readSource("options/useOptionsSettings.ts");
    const keyMessages = readSource("background/api-key-messages.ts");

    expect(options).toContain('settings.appAccessMode === "local_byok"');
    expect(options).toContain("Managed service");
    expect(options).toContain("No access code is required.");
    expect(options).not.toContain("Jury access code");
    expect(optionsSettings).toContain('settings.appAccessMode !== "local_byok"');
    expect(keyMessages).toContain(
      "if (!isLocalByokMode(await readAppAccessMode())) return true;"
    );
  });
});
