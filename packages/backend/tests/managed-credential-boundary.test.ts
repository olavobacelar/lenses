import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, "..");

function readBackendSource(relativePath: string): string {
  return readFileSync(join(backendRoot, relativePath), "utf-8");
}

describe("managed backend credential source guards", () => {
  it("keeps deprecated client credential fields out of Convex actions", () => {
    const runs = readBackendSource("convex/runs.ts");
    const http = readBackendSource("convex/http.ts");
    const publicActionHandlers = runs.slice(
      0,
      runs.indexOf("function getLensNamesForAnnotations")
    );

    expect(publicActionHandlers).not.toMatch(/args\.apiKeys?\b/);
    expect(http).not.toContain("payload.apiKey");
    expect(runs).toContain("resolveManagedProviderApiKey");
    expect(http).toContain("resolveManagedProviderApiKey");
  });

  it("keeps paid model actions private and exposes them through managed routes", () => {
    const runs = readBackendSource("convex/runs.ts");
    const http = readBackendSource("convex/http.ts");

    expect(runs).toContain("export const run = internalAction");
    expect(runs).toContain("export const generateLensName = internalAction");
    expect(runs).toContain("export const askFindingQuestion = internalAction");
    expect(http).toContain('path: "/managed/run"');
    expect(http).toContain('path: "/managed/generate-lens-name"');
    expect(http).toContain('path: "/managed/ask-finding"');
    expect(http).not.toMatch(/jury|grant/i);
  });
});
