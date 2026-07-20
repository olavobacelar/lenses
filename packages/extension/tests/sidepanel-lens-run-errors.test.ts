import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "src", "sidepanel", "sidepanel.css");
const css = readFileSync(cssPath, "utf-8");
const lensSections = readFileSync(
  join(here, "..", "src", "sidepanel", "components", "LensSections.tsx"),
  "utf-8"
);

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((match) => match[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("sidepanel lens run errors", () => {
  it("marks failed lens sections as warning states", () => {
    const body = extractRuleBody(".acc-section.run-failed");
    expect(body).toMatch(/border-color:\s*var\(--warn-border\)/);
  });

  it("renders failed run messages as readable warning cards", () => {
    const body = extractRuleBody(".lens-run-message--error");
    expect(body).toMatch(/background:\s*var\(--warn-bg\)/);
    expect(body).toMatch(/border-color:\s*var\(--warn-border\)/);
  });

  it("does not use empty skeleton rows for running lenses", () => {
    expect(css).not.toContain(".lens-skeleton");
    expect(css).not.toContain(".sk-row");
    expect(css).not.toContain(".sk-line");
  });

  it("shows per-chunk tick progress with a stop control for running lens sections", () => {
    expect(lensSections).toContain("lens-chunk-progress");
    // Per-chunk ticks replaced the "Extracting... 3/7" text-and-bar strip.
    expect(lensSections).toContain("<ChunkTicks");
    expect(lensSections).not.toContain("Extracting...");
    expect(lensSections).toContain("<StopIcon />");
    // The tick cells and their in-flight pulse are defined in the stylesheet.
    expect(css).toContain(".chunk-tick");
    expect(css).toContain("chunk-tick-pulse");
  });
});
