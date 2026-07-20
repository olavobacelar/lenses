import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidepanelDir = join(here, "..", "src", "sidepanel");

function readSidepanelSource(path: string) {
  return readFileSync(join(sidepanelDir, path), "utf-8");
}

describe("sidepanel sidebar lens controls", () => {
  it("removes only the rail-owned lens selector block from the sidebar app", () => {
    const app = readSidepanelSource("App.tsx");

    expect(app).toContain("<ClaimsSection");
    expect(app).toContain("<LensSections");
    expect(app).toContain("<SourceSection");
    expect(app).toContain("<ChatDock");
    expect(app).toContain("<CustomLensToast");

    expect(app).not.toContain('from "./components/ControlBay"');
    expect(app).not.toContain("<ControlBay");
  });

  it("runs the dedicated Claims section through the shared lens runner for every source", () => {
    const app = readSidepanelSource("App.tsx");
    const lensRuns = readSidepanelSource("hooks/useLensRuns.ts");

    expect(app).not.toContain('from "./hooks/useClaims"');
    expect(app).not.toContain("claims.extractClaims");
    expect(app).toContain("dedicatedLensIds: CLAIMS_LENS_IDS");
    expect(app).toContain("lensRuns.allSections.find");
    expect(app).toContain("runSidebarLensIds(CLAIMS_LENS_IDS)");
    expect(app).toContain("canRunClaimExtractor(source, transcript)");
    expect(lensRuns).toContain("dedicatedLensIds?: readonly string[]");
    expect(lensRuns).toContain("allSections");
  });
});
