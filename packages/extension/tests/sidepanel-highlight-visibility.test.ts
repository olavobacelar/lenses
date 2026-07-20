import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

describe("sidepanel highlight visibility controls", () => {
  it("uses existing accordion count chips as lens visibility toggles", () => {
    const lensSections = readSource("sidepanel/components/LensSections.tsx");

    expect(lensSections).toContain("acc-count--toggle");
    expect(lensSections).toContain('role={canToggleHighlights ? "switch" : undefined}');
    expect(lensSections).toContain("onToggleHighlightVisibility(section.lensId)");
    expect(lensSections).toContain('const countLabel = highlightsAreHidden ? "Hidden" : countText;');
  });

  it("uses the existing Claims status chip for claim highlight visibility", () => {
    const claimsSection = readSource("sidepanel/components/ClaimsSection.tsx");
    const app = readSource("sidepanel/App.tsx");

    expect(claimsSection).toContain("acc-count--toggle");
    expect(claimsSection).toContain('role={canToggleHighlights ? "switch" : undefined}');
    expect(app).toContain("CLAIM_EXTRACTOR_LENS_ID");
    expect(app).toContain("toggleLensHighlightVisibility(CLAIM_EXTRACTOR_LENS_ID)");
  });

  it("filters hidden lenses in the content renderer without deleting annotations", () => {
    const content = readSource("content/content.ts");
    const types = readSource("content/types.ts");
    const background = readSource("background/service-worker.ts");

    expect(types).toContain('type: "set-lens-highlight-visibility"');
    expect(types).toContain("resetVisibility?: boolean");
    expect(content).toContain(
      "const resultDisplayModeByLensId = new Map<string, LensResultDisplayMode>();"
    );
    expect(content).toContain("isLensResultVisible(annotation.lensId)");
    expect(content).toContain('case "set-lens-highlight-visibility"');
    expect(content).toContain("message.resetVisibility !== false");
    expect(content).toContain("const visibleAnnotations = activeAnnotations.filter");
    expect(background).toContain('{ type: "clear", resetVisibility: false }');
  });
});
