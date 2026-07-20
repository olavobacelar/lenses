import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "src", "content", "styles", "page-dock.css");
const css = readFileSync(cssPath, "utf-8");

/**
 * Extract the body of the *first* rule whose selector exactly matches.
 * Deliberately not "contains" — we want the base rule, not the `:hover`
 * or `::-webkit-scrollbar-*` variants.
 */
function extractRuleBody(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`
  );
  const match = css.match(pattern);
  if (!match) {
    throw new Error(`Could not find rule for ${selector} in page-dock.css`);
  }
  return match[1]!;
}

describe("lens list bounded scroll", () => {
  // The .lenses-page-dock-lens-list rule is the wrapper that should bound
  // pill content so a user with many pinned/custom lenses doesn't get a
  // panel that runs off the screen. These tests are the contract.

  it("caps the lens list height with a clamp so pills can't push the panel off-screen", () => {
    const body = extractRuleBody(".lenses-page-dock-lens-list");
    // clamp() chosen over a flat px so the cap scales with viewport.
    expect(body).toMatch(/max-height:\s*clamp\(/);
  });

  it("only scrolls when content actually overflows (overflow-y: auto, not scroll)", () => {
    const body = extractRuleBody(".lenses-page-dock-lens-list");
    // `auto` = scrollbar only when needed. `scroll` would always reserve
    // the bar even with one pill, which violates the "only an option if
    // size gets large enough" requirement.
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).not.toMatch(/overflow-y:\s*scroll\b/);
  });

  it("hides the scrollbar by default (transparent thumb in base rule)", () => {
    const body = extractRuleBody(".lenses-page-dock-lens-list");
    // Firefox / spec property: thumb + track both transparent until hover.
    expect(body).toMatch(/scrollbar-color:\s*transparent\s+transparent/);
  });

  it("reveals the scrollbar on hover via both the spec and webkit properties", () => {
    // The hover state targets both Firefox-style (scrollbar-color) and
    // Chrome/Safari/Edge (::-webkit-scrollbar-thumb). Either pathway alone
    // would leave half our browser matrix without a visible scrollbar.
    expect(css).toMatch(
      /\.lenses-page-dock-lens-list:hover[\s\S]*?scrollbar-color:\s*color-mix/
    );
    expect(css).toMatch(
      /\.lenses-page-dock-lens-list:hover::-webkit-scrollbar-thumb[\s\S]*?background-color:\s*color-mix/
    );
  });

  it("keeps the scrollbar narrow so it doesn't visually compete with pill content", () => {
    // 6-8px is the band that reads as "scroll affordance" without
    // dominating the dark panel. Anything wider would shout for attention.
    const match = css.match(
      /\.lenses-page-dock-lens-list::-webkit-scrollbar\s*\{([^}]+)\}/
    );
    expect(match).not.toBeNull();
    const widthMatch = match![1]!.match(/width:\s*(\d+)px/);
    expect(widthMatch).not.toBeNull();
    const width = Number.parseInt(widthMatch![1]!, 10);
    expect(width).toBeGreaterThanOrEqual(4);
    expect(width).toBeLessThanOrEqual(10);
  });
});
