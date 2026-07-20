import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

afterEach(() => {
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
  } else {
    delete (globalThis as { document?: unknown }).document;
  }
});

async function importShadowUi() {
  // shadow-ui reads the current theme from the document at module scope, so a
  // minimal document stub is needed to import it in the node test environment.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { getAttribute: () => null } },
  });
  return import("../src/content/shadow-ui.js");
}

describe("shadow surface interaction policy", () => {
  it("declares an explicit interaction policy for every surface", async () => {
    const { LENSES_SURFACE_INTERACTION } = await importShadowUi();

    // Click-through surfaces float over page content; their root box must
    // never absorb clicks meant for the site (the page dock overlapping
    // YouTube's video-card menus was the original regression).
    expect(LENSES_SURFACE_INTERACTION).toEqual({
      chatbox: "interactive",
      "citation-tooltip": "click-through",
      "orphaned-panel": "interactive",
      "page-dock": "click-through",
      "page-dock-toast": "click-through",
      "selection-trigger": "interactive",
      "source-callouts": "click-through",
    });
  });

  it("does not grant pointer-events to shadow roots without a policy", () => {
    const shadowUi = readSource("content/shadow-ui.ts");

    // A bare [data-lenses-shadow-root] selector with pointer-events: auto is
    // exactly the rule that let the page dock swallow site clicks — its
    // specificity beats the per-surface pointer-events: none declarations.
    expect(shadowUi).not.toMatch(
      /\[data-lenses-shadow-root\]\s*\{[^}]*pointer-events:\s*auto/
    );

    expect(shadowUi).toContain(
      '[data-lenses-shadow-root][data-lenses-interaction="interactive"]'
    );
    expect(shadowUi).toContain(
      '[data-lenses-shadow-root][data-lenses-interaction="click-through"]'
    );
  });

  it("stamps the interaction policy on every mounted root", async () => {
    const shadowUi = readSource("content/shadow-ui.ts");
    expect(shadowUi).toContain(
      'root.setAttribute("data-lenses-interaction", LENSES_SURFACE_INTERACTION[surface])'
    );
  });

  it("keeps the page dock root click-through in its own stylesheets", () => {
    const pageDockCss = readSource("content/styles/page-dock.css");
    const controller = readSource("content/PageLensDockController.ts");

    const rootRule = pageDockCss.match(/\.lenses-page-dock-root\s*\{[^}]+\}/g);
    expect(rootRule?.some((rule) => rule.includes("pointer-events: none"))).toBe(true);
    expect(controller).toContain("pointer-events: none");
  });
});

describe("shadow surface z-index layering", () => {
  it("keeps the ambient dock below site modal layers", () => {
    const shadowUi = readSource("content/shadow-ui.ts");

    // The always-on dock must yield to the site's own dialogs (common modal
    // systems layer around 1000-1500), so its host cannot share the maximum
    // z-index group with the user-invoked transient surfaces.
    expect(shadowUi).toMatch(
      /:host\(\[data-lenses-surface="page-dock"\]\) \{\s*z-index: 990 !important;/
    );
    expect(shadowUi).not.toMatch(/:host\(\[data-lenses-surface="page-dock"\]\),/);
    expect(shadowUi).toMatch(/surface === "page-dock"\) return "990"/);
  });

  it("keeps user-invoked transient surfaces at the maximum layer", () => {
    const shadowUi = readSource("content/shadow-ui.ts");

    const maxGroup = shadowUi.match(
      /((?::host\(\[data-lenses-surface="[^"]+"\]\),?\s*)+)\{\s*z-index: 2147483647 !important;/
    );
    expect(maxGroup?.[1]).toContain('"page-dock-toast"');
    expect(maxGroup?.[1]).toContain('"selection-trigger"');
    expect(maxGroup?.[1]).toContain('"citation-tooltip"');
  });
});
