import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(src, ...parts), "utf8");

describe("managed execution keeps product data in the browser", () => {
  it("uses the local evidence-base implementation in every AI mode", () => {
    const api = read("background", "evidence-base-api.ts");

    expect(api).not.toContain("readAppAccessMode");
    expect(api).not.toContain("convexCall");
    expect(api).not.toContain("/api/query");
    expect(api).not.toContain("/api/mutation");
    expect(api).toContain("listLocalEvidenceBases");
    expect(api).toContain("startLocalEvidenceRun");
  });

  it("does not expose managed persistence routes from the extension worker", () => {
    const worker = read("background", "service-worker.ts");

    expect(worker).not.toContain('"/saved-selections"');
    expect(worker).not.toContain('"/conversation"');
    expect(worker).not.toContain('path: "lenses:');
    expect(worker).not.toContain('path: "findings:');
    expect(worker).toContain("return createLocalSavedSelection(message)");
    expect(worker).toContain("return saveLocalConversation(message, message.messages)");
    expect(worker).toContain("return { lenses: await listLocalLensRows() }");
  });

  it("forces managed model calls to be non-persisting", () => {
    const worker = read("background", "service-worker.ts");
    const managedRun = worker.slice(
      worker.indexOf("async function handleRun("),
      worker.indexOf("// --- Page lens orchestration")
    );
    const requestBodyStart = managedRun.indexOf("body: JSON.stringify");
    const managedRequestBody = managedRun.slice(
      requestBodyStart,
      managedRun.indexOf("signal: options?.signal", requestBodyStart)
    );

    expect(managedRequestBody).toContain("persist: false");
    expect(managedRequestBody).not.toContain("trackingRunId:");
    expect(managedRequestBody).not.toContain("sourceUrl: request.sourceUrl");
    expect(managedRun).toContain("await saveFindings");
  });
});
