import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), "utf-8");
}

describe("evidence base bar", () => {
  it("removes evidence-base icons and locks the textareas", () => {
    const bar = readSource("sidepanel/components/EvidenceBaseBar.tsx");
    const css = readSource("sidepanel/sidepanel.css");

    expect(bar).not.toContain("EvidenceBaseGlyph");
    expect(bar).not.toContain("iconKind");
    expect(bar).not.toContain("iconValue");
    expect(bar).not.toContain("<legend>Icon</legend>");
    expect(bar).not.toContain("evidence-icon-kind");
    expect(bar).not.toContain("evidence-icon-options");
    expect(css).not.toContain("evidence-base-option-icon");
    expect(css).toMatch(/\.evidence-dialog-form textarea\s*\{[^}]*resize:\s*none;/);
  });

  it("keeps the bar to the selector plus library and new-base actions", () => {
    const bar = readSource("sidepanel/components/EvidenceBaseBar.tsx");

    expect(bar).toContain('data-tooltip="Open evidence bases"');
    expect(bar).toContain('data-tooltip="New evidence base"');

    // Sources only enter a base by running a lens (or extracting claims);
    // there is no explicit add control and no local-file surface.
    expect(bar).not.toContain("Add current source");
    expect(bar).not.toContain("Open local PDF");
    expect(bar).not.toContain('type="file"');
    expect(bar).not.toContain("FileUp");
    expect(bar).not.toContain("FilePlus");
  });

  it("has no local-PDF ingestion path anywhere in the sidepanel", () => {
    const activeSource = readSource("sidepanel/hooks/useActiveSource.ts");
    const types = readSource("sidepanel/types.ts");
    const lensRuns = readSource("sidepanel/hooks/useLensRuns.ts");

    expect(activeSource).not.toContain("loadPdfFile");
    expect(activeSource).not.toContain("local-pdf:");
    expect(activeSource).not.toContain("extractPdfSource");
    // Remote (URL) PDFs remain supported.
    expect(activeSource).toContain("fetchPdfSource");
    expect(types).not.toContain("pdfOrigin");
    expect(lensRuns).not.toContain("pdfOrigin");
  });

  it("captures the source into the active base as part of starting a run", () => {
    const runs = readSource("background/local-evidence-runs.ts");

    expect(runs).toContain("captureLocalEvidenceSourceInCurrentTransaction(input)");
  });
});

describe("auto-capture feedback (saved-source indicator + toast)", () => {
  it("labels source membership explicitly without presenting it as run success", () => {
    const bar = readSource("sidepanel/components/EvidenceBaseBar.tsx");
    const css = readSource("sidepanel/sidepanel.css");

    expect(bar).toContain("sourceInBase: boolean | null");
    expect(bar).toContain("sourceInBase === true");
    expect(bar).not.toContain("sourceInBase != null");
    expect(bar).toContain("SourceSavedIndicator");
    expect(bar).toContain('role="status"');
    expect(bar).toContain(">Saved</span>");
    expect(bar).toContain("Analysis status appears in each Lens section");
    expect(bar).not.toContain("CaptureDot");
    expect(bar).not.toContain("evidence-capture-dot");
    expect(css).toContain(".evidence-source-saved");
    expect(css).not.toContain(".evidence-capture-dot");
    expect(css).not.toMatch(/\.evidence-source-saved\s*\{[^}]*var\(--ok\)/s);
  });

  it("queries membership and raises a toast only on first capture", () => {
    const capture = readSource("sidepanel/hooks/useEvidenceCapture.ts");

    expect(capture).toContain('type: "evidence-base-has-source"');
    // handleCaptured updates source membership immediately and toasts only
    // when the source was newly added.
    expect(capture).toContain("setSourceInBase(true)");
    expect(capture).toContain("if (!added) return");
    expect(capture).toContain("Source saved to");
  });

  it("fires onSourceCaptured from both run paths using the added flag", () => {
    const lensRuns = readSource("sidepanel/hooks/useLensRuns.ts");
    const claims = readSource("sidepanel/hooks/useClaims.ts");

    for (const source of [lensRuns, claims]) {
      expect(source).toContain("evidenceBaseSourceAdded?: boolean");
      expect(source).toContain(
        "onSourceCaptured?.(started.evidenceBaseSourceAdded === true)"
      );
    }
  });

  it("wires the capture hook into App and the bar", () => {
    const app = readSource("sidepanel/App.tsx");

    expect(app).toContain("useEvidenceCapture");
    expect(app).toContain("onSourceCaptured: evidenceCapture.handleCaptured");
    expect(app).toContain("sourceInBase={evidenceCapture.sourceInBase}");
    expect(app).toContain("evidence-capture-toast");
  });
});

describe("evidence-base-first top bar", () => {
  function ruleBody(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`Could not find rule for ${selector}`);
    return match[1];
  }

  it("renders the base switcher above the page title in one top bar", () => {
    const app = readSource("sidepanel/App.tsx");

    const topbar = app.indexOf('className="panel-topbar"');
    const bar = app.indexOf("<EvidenceBaseBar");
    const header = app.indexOf("<Header");
    expect(topbar).toBeGreaterThan(-1);
    // Bar comes first (the workspace), then the demoted page title beneath it.
    expect(bar).toBeGreaterThan(topbar);
    expect(header).toBeGreaterThan(bar);
  });

  it("styles the selector as a borderless workspace switcher", () => {
    const css = readSource("sidepanel/sidepanel.css");
    const trigger = ruleBody(css, ".evidence-base-trigger");

    expect(trigger).toMatch(/border:\s*1px solid transparent/);
    expect(trigger).toMatch(/background:\s*transparent/);
    expect(trigger).toMatch(/font-weight:\s*650/);
    // Hover reveals a soft wash rather than a frame.
    expect(css).toContain(".panel-topbar");
    expect(ruleBody(css, ".evidence-base-trigger:hover,\n.evidence-base-trigger:focus-visible"))
      .toMatch(/background:\s*var\(--icon-hover-bg\)/);
  });

  it("demotes the page title to a secondary single line", () => {
    const css = readSource("sidepanel/sidepanel.css");
    const title = ruleBody(css, ".source-title-block h1");

    expect(title).toMatch(/font-size:\s*13px/);
    expect(title).toMatch(/color:\s*var\(--text\)/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/white-space:\s*nowrap/);
  });

  it("clusters global chrome on the base row and hides reload until hover", () => {
    const bar = readSource("sidepanel/components/EvidenceBaseBar.tsx");
    const header = readSource("sidepanel/components/Header.tsx");
    const css = readSource("sidepanel/sidepanel.css");

    // Base row cluster: [library] [+] [gear] — settings is workspace/app
    // chrome, so it sits with the other persistent controls.
    expect(bar).toContain('data-tooltip="Open evidence bases"');
    expect(bar).toContain('data-tooltip="New evidence base"');
    expect(bar).toContain('data-tooltip="Settings"');
    expect(bar.indexOf('data-tooltip="New evidence base"')).toBeGreaterThan(
      bar.indexOf('data-tooltip="Open evidence bases"')
    );
    expect(bar.indexOf('data-tooltip="Settings"')).toBeGreaterThan(
      bar.indexOf('data-tooltip="New evidence base"')
    );

    // Page row keeps only its page-scoped action, revealed on hover/focus.
    expect(header).not.toContain("GearIcon");
    expect(header).not.toContain("onOpenOptions");
    expect(header).toContain('data-tooltip="Reload source"');
    expect(header).not.toContain('title="Reload source"');
    expect(ruleBody(css, ".source-header .icon-btn")).toMatch(/opacity:\s*0/);
    expect(
      ruleBody(css, ".source-header:hover .icon-btn,\n.source-header:focus-within .icon-btn")
    ).toMatch(/opacity:\s*1/);
  });

  it("shows top-bar tooltips quickly without native title timing", () => {
    const css = readSource("sidepanel/sidepanel.css");

    expect(css).toContain(".icon-btn[data-tooltip]::after");
    expect(
      ruleBody(
        css,
        ".icon-btn[data-tooltip]:hover::after,\n.icon-btn[data-tooltip]:focus-visible::after"
      )
    ).toMatch(/transition-delay:\s*100ms/);
  });
});
