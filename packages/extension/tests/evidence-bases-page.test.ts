import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pageRoot = join(here, "..", "src", "evidence-bases");

function readSource(relativePath: string): string {
  return readFileSync(join(pageRoot, relativePath), "utf-8");
}

describe("evidence bases page", () => {
  it("removes evidence-base icons and locks the editor textareas", () => {
    const app = readSource("App.tsx");
    const css = readSource("evidence-bases.css");

    expect(app).not.toContain("BaseGlyph");
    expect(app).not.toContain("iconKind");
    expect(app).not.toContain("iconValue");
    expect(app).not.toContain('<span>Icon</span>');
    expect(app).not.toContain("icon-swatches");
    expect(css).not.toContain("base-glyph");
    expect(css).toMatch(/\.editor-form textarea\s*\{[^}]*resize:\s*none;/);
  });

  it("uses the shared neutral tokens with the dark-first extension chrome", () => {
    const css = readSource("evidence-bases.css");

    const rootStart = css.indexOf(":root {");
    const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart));
    expect(rootBlock).toContain("color-scheme: dark;");
    expect(rootBlock).toContain("--page: #1a1a1c;");
    expect(rootBlock).toContain("--sidebar: #19191b;");
    expect(rootBlock).toContain("--accent: #7aa2f7;");

    const lightStart = css.indexOf(':root[data-theme="light"]');
    const lightBlock = css.slice(lightStart, css.indexOf("}", lightStart));
    expect(lightBlock).toContain("color-scheme: light;");
    expect(lightBlock).toContain("--accent: #2f6df6;");
    expect(lightBlock).toContain("--line: #e6e6e6;");

    // Focus affordance matches the settings page: a soft accent ring, not an
    // outline.
    expect(css).toContain("box-shadow: 0 0 0 3px var(--accent-ring);");
    expect(css).toContain("--font-system:");
  });

  it("locks the document while the sidebar list and main pane own the scroll", () => {
    const css = readSource("evidence-bases.css");

    expect(css).toMatch(/html,\s*body \{[^}]*overflow: hidden;/);

    const mainStart = css.indexOf(".evidence-main {");
    const mainBlock = css.slice(mainStart, css.indexOf("}", mainStart));
    expect(mainBlock).toContain("overflow-y: auto;");

    const listStart = css.indexOf(".evidence-list {");
    const listBlock = css.slice(listStart, css.indexOf("}", listStart));
    expect(listBlock).toContain("overflow-y: auto;");
  });

  it("shows a human capture summary instead of the raw SHA-256 hash", () => {
    const app = readSource("App.tsx");

    // The checksum is copyable but never rendered as page text.
    expect(app).not.toContain("contentHash.slice");
    expect(app).not.toContain(">SHA-256<");
    expect(app).toContain("Copy SHA-256 checksum");
    expect(app).toContain("navigator.clipboard.writeText(source.latestFingerprint!.contentHash)");
    expect(app).toContain("Captured {formatDate(source.latestFingerprint.observedAt)}");
    expect(app).not.toContain("No runs for this fingerprint");
  });

  it("keeps list copy in the shared voice: middot separators and full words", () => {
    const app = readSource("App.tsx");

    expect(app).not.toMatch(/\} sources \/ \{/);
    expect(app).not.toMatch(/\} findings \/ \{/);
    expect(app).not.toContain("} chars`");
    expect(app).toContain('formatCount(item.sourceCount, "source")');
    expect(app).toContain("characters");
  });

  it("brands the sidebar like the settings page", () => {
    const app = readSource("App.tsx");
    const html = readSource("evidence-bases.html");

    expect(app).toContain('className="sidebar-brand"');
    expect(app).toContain("../icons/icon-256.png");
    expect(app).toContain('className="sidebar-new-base"');
    expect(html).toContain("<title>Evidence Bases · Lenses</title>");
  });
});

describe("evidence bases page — run states", () => {
  it("never renders a raw run error, mapping it to a friendly cause instead", () => {
    const app = readSource("App.tsx");

    // The old raw passthrough is gone.
    expect(app).not.toContain(">{run.error}<");
    expect(app).toContain("function classifyRunError");
    // A missing/invalid key maps to a plain-language cause.
    expect(app).toContain("This lens needs an");
    expect(app).toContain("was rejected");
    // User-fixable causes are amber (warn); the fix action opens the AI settings.
    expect(app).toContain('"run-error is-warn"');
    expect(app).toContain('chrome.runtime.getURL("settings.html#ai")');
    // Server internals must not be interpolated into the message.
    expect(app).not.toContain("run.error}</p>");
  });

  it("folds repeat runs of a lens into an earlier-attempts disclosure", () => {
    const app = readSource("App.tsx");

    expect(app).toContain("function groupRunsByLens");
    expect(app).toContain("function RunGroup");
    expect(app).toContain('formatCount(group.earlier.length, "earlier attempt")');
    expect(app).toContain("defaultOpen={false}");
  });

  it("shows a banner when every run failed with no findings", () => {
    const app = readSource("App.tsx");

    expect(app).toContain("function failureOnlyRunCount");
    expect(app).toContain('className="base-alert"');
    expect(app).toContain("No findings yet — all");
  });

  it("keeps the source meta line to kind and run count only", () => {
    const app = readSource("App.tsx");

    expect(app).toContain(
      '{sourceKindLabel(source.kind)} · {formatCount(source.runs.length, "run")}'
    );
    expect(app).not.toContain('formatCount(currentSegments.length, "segment")');
  });
});
