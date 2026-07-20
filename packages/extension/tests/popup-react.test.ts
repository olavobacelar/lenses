import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..");
const popupDir = join(here, "..", "src", "popup");
const buildPath = join(here, "..", "build.ts");

function read(path: string) {
  return readFileSync(path, "utf-8");
}

describe("popup React migration", () => {
  it("lives under the package test directory, not a repo-root tests directory", () => {
    expect(extensionDir.endsWith(join("packages", "extension"))).toBe(true);
  });

  it("uses React roots for popup and debug view pages", () => {
    const popupHtml = read(join(popupDir, "popup.html"));
    const debugHtml = read(join(popupDir, "debug-view.html"));
    const popupEntry = read(join(popupDir, "popup.tsx"));
    const debugEntry = read(join(popupDir, "debug-view.tsx"));

    expect(popupHtml).toContain('<div id="root"></div>');
    expect(debugHtml).toContain('<div id="root"></div>');
    expect(popupEntry).toContain("createRoot(rootElement).render");
    expect(debugEntry).toContain("createRoot(rootElement).render");
  });

  it("builds popup surfaces from TSX entries and no legacy popup.ts remains", () => {
    const build = read(buildPath);

    expect(build).toContain('src/popup/popup.tsx');
    expect(build).toContain('src/popup/debug-view.tsx');
    expect(build).not.toContain('src/popup/popup.ts"');
    expect(build).not.toContain("debug-page.ts");
    expect(existsSync(join(popupDir, "popup.ts"))).toBe(false);
    expect(existsSync(join(popupDir, "debug-page.ts"))).toBe(false);
  });

  it("preserves popup ids and controls in React components", () => {
    const app = read(join(popupDir, "PopupApp.tsx"));
    const composer = read(join(popupDir, "components", "ComposerSection.tsx"));
    const debugControls = read(join(popupDir, "components", "DebugControls.tsx"));

    for (const id of [
      "open-settings",
      "open-source-panel",
      "clear-highlights",
      "page-dock-enabled",
      "enable-page-dock-site",
      "debug-panel",
      "debug-view-links",
      "connection-footer",
    ]) {
      expect(app).toContain(`id="${id}"`);
    }

    expect(app).toContain("Page dock on websites");
    expect(app).toContain("Enable page dock on this site");
    expect(app).toContain("UnsupportedPageNotice");

    for (const id of ["composer-input", "composer-submit", "composer-switch", "composer-menu"]) {
      expect(composer).toContain(`id="${id}"`);
    }

    for (const id of [
      "store-page-lenses",
      "test-source-max-citations",
      "test-source-use-cache",
      "renew-source-cache",
      "test-fixture-list",
      "clear-page-storage",
    ]) {
      expect(debugControls).toContain(`id="${id}"`);
    }
  });

  it("re-skins the popup to share the side panel's chip/header/composer language", () => {
    const app = read(join(popupDir, "PopupApp.tsx"));
    const picker = read(join(popupDir, "components", "LensPicker.tsx"));
    const composer = read(join(popupDir, "components", "ComposerSection.tsx"));
    const css = read(join(popupDir, "popup.css"));

    // Source panel + clear live as header icon buttons, not a bottom action row.
    expect(app).toContain('className="header-actions"');
    expect(app).toContain("EraserIcon");
    expect(app).not.toContain('className="actions secondary"');

    // The source-panel button reuses the dock's panel glyph but stays a muted
    // bare icon like clear/settings — no accent tint that would read as active.
    expect(app).toContain("SidebarPanelIcon");
    expect(app).not.toContain("is-source");
    expect(css).not.toContain(".icon-btn.is-source");

    // The single lens list uses sidebar-style pill chips; the checkbox glyph is gone.
    expect(picker).toContain("lens-chip");
    expect(picker).toContain('className="run-pill"');
    expect(picker).not.toContain("lens-check");
    // The popup no longer renders a separate "this domain" list — it merged in.
    expect(app).not.toContain("domain-lenses");
    expect(app).not.toContain("DomainLensPanel");

    // Composer mirrors the side panel composer2 (round send + inline mode pill).
    expect(composer).toContain('className="ta2"');
    expect(composer).toContain('className="c2-send"');
    expect(composer).toContain('className="c2-mode"');

    // The shared chip/composer styling exists; the old split-button is removed.
    expect(css).toContain('.lens-chip[data-state="checked"]');
    expect(css).toContain(".run-pill");
    expect(css).toContain(".composer2");
    expect(css).not.toContain(".composer-split");
  });

  it("runs selected lenses inline and breathes their pills while computing", () => {
    const controller = read(join(popupDir, "usePopupController.ts"));
    const picker = read(join(popupDir, "components", "LensPicker.tsx"));
    const css = read(join(popupDir, "popup.css"));

    // Highlight drives the in-worker page run and keeps the popup open to
    // animate, instead of staging + opening the panel + closing.
    expect(controller).toContain('type: "run-page-lenses"');
    expect(controller).toContain("computingLensIds");
    expect(controller).toContain("settlingLensIds");
    expect(controller).toContain("MIN_COMPUTING_VISIBLE_MS");

    // The pill carries the computing / settling state classes.
    expect(picker).toContain("is-computing");
    expect(picker).toContain("is-settling");

    // The breathe keyframes + reduced-motion fallback exist.
    expect(css).toContain("lenses-popup-pill-breathe");
    expect(css).toContain("prefers-reduced-motion");

    // The thin selection: the checked chip is a single accent hairline now.
    expect(css).toContain("single accent hairline");
  });

  it("shows a compact unsupported-page state instead of page-only controls", () => {
    const app = read(join(popupDir, "PopupApp.tsx"));
    const controller = read(join(popupDir, "usePopupController.ts"));
    const css = read(join(popupDir, "popup.css"));

    expect(controller).toContain("getUnsupportedSourcePage");
    expect(controller).toContain("unsupportedPage");
    expect(controller).toContain("setUnsupportedPage");
    expect(app).toContain("controller.unsupportedPage ? (");
    expect(app).toContain('className="unsupported-page"');
    expect(app).toContain("!!controller.unsupportedPage");
    expect(app).not.toContain("settings-link");
    expect(app).not.toContain(">Open settings<");
    expect(css).toContain(".unsupported-page");
    expect(css).not.toContain(".settings-link");
  });

  it("merges the two lens lists into one rail-style list with per-domain pins", () => {
    const app = read(join(popupDir, "PopupApp.tsx"));
    const picker = read(join(popupDir, "components", "LensPicker.tsx"));
    const controller = read(join(popupDir, "usePopupController.ts"));
    const css = read(join(popupDir, "popup.css"));

    // The separate "this domain" allow/hide panel is gone — one list now, and
    // the controller no longer drives the domain-rule system.
    expect(app).not.toContain("DomainLensPanel");
    expect(app).not.toContain("This domain");
    expect(controller).not.toContain("setLensAllowedForCurrentDomain");
    expect(controller).not.toContain("domainLensOptions");

    // Each chip carries the page rail's pin affordance, backed by the shared
    // pinned-lenses store so a pin set here also shows up on the rail.
    expect(picker).toContain("lens-pin");
    expect(picker).toContain("DrawingPin");
    expect(picker).toContain("onLensPinToggle");
    expect(app).toContain("site-heading");
    expect(app).toContain("site-title");
    expect(app).toContain("site-domain");
    expect(app).not.toContain("<h1>Lenses</h1>");
    expect(controller).toContain("pageTitle");
    expect(css).toContain(".site-heading");
    expect(css).toContain(".site-title");
    expect(css).not.toContain(".domain-pill");

    // The header stacks page title over a quiet domain line — no orange bullet,
    // no inline "/" separator. A domain-only page promotes the domain to the
    // headline via :only-child.
    expect(app).not.toContain("site-mark");
    expect(app).not.toContain("site-separator");
    expect(css).not.toContain(".site-mark");
    expect(css).not.toContain(".site-separator");
    expect(css).toContain(".site-domain:only-child");
    expect(controller).toContain("toggleLensPinForUrl");
    expect(controller).toContain("PINNED_IDS_BY_DOMAIN_KEY");

    // The pin styling exists and mirrors the rail's hover-reveal + pinned state.
    expect(css).toContain(".lens-pin");
    expect(css).toContain(".lens-pin.is-pinned");
    expect(css).not.toContain(".domain-lenses");
  });
});
