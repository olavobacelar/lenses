import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldShowPageLensDock } from "../src/content/PageLensDockSettings.js";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "chrome");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

afterEach(() => {
  restoreGlobal("window", originalWindowDescriptor);
  restoreGlobal("chrome", originalChromeDescriptor);
});

describe("page lens dock", () => {
  it("mounts a lightweight React rail in the content script", () => {
    const content = readSource("content/content.ts");
    const controller = readSource("content/PageLensDockController.ts");
    const settings = readSource("content/PageLensDockSettings.ts");
    const component = readSource("content/PageLensDock.tsx");
    const shadowUi = readSource("content/shadow-ui.ts");

    expect(content).toContain("mountPageLensDock");
    expect(content).toContain("PAGE_LENS_DOCK_ROOT_CLASS");
    expect(controller).toContain("createLensesShadowMount");
    expect(controller).toContain('surface: "page-dock"');
    expect(controller).toContain("rootClassName: PAGE_LENS_DOCK_ROOT_CLASS");
    expect(controller).toContain("const root = mount.root");
    expect(controller).toContain("ensurePageDockCriticalStyles(mount.shadowRoot)");
    expect(controller).toContain("target.insertBefore(style, stylesheet)");
    expect(controller).toContain("ensurePageDockCriticalStyles");
    expect(controller).toContain("PAGE_DOCK_CRITICAL_CSS");
    expect(controller).toContain("z-index: 2147483647;");
    expect(controller).toContain(
      ".${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail .lenses-page-dock-button.is-tail"
    );
    expect(shadowUi).toContain(':host([data-lenses-surface="page-dock"])');
    expect(shadowUi).toContain('surface === "page-dock"');
    expect(controller).toContain(
      ".${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:hover .lenses-page-dock-button.is-tail"
    );
    expect(controller).toContain("--lenses-page-dock-anchor-offset: 17px");
    expect(controller).toContain(
      ".${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view=\"custom\"] .lenses-page-dock-rail"
    );
    expect(controller).toContain(
      ".${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-source-panel-open=\"true\"] .lenses-page-dock-rail"
    );
    expect(controller).toContain("display: none;");
    expect(controller).toContain(
      "transform: translateY(calc(var(--lenses-page-dock-anchor-offset) * -1))"
    );
    expect(controller).toContain('root.style.visibility = "hidden"');
    expect(controller).toContain('root.style.pointerEvents = "none"');
    expect(controller).toContain("revealPageLensDockWhenStyled");
    expect(controller).toContain("isPageLensDockStyled");
    expect(controller).toContain("frame >= PAGE_DOCK_STYLE_WAIT_FRAME_LIMIT");
    expect(controller).toContain('buttonStyle.display === "inline-flex"');
    expect(controller).toContain('buttonStyle.width === "30px"');
    expect(controller).toContain('root.style.visibility = ""');
    expect(controller).toContain('root.style.pointerEvents = ""');
    expect(controller).toContain('removeLensesShadowHosts("page-dock")');
    expect(controller).toContain("removeExistingPageLensDockRoots");
    expect(controller).toContain("document.querySelectorAll<HTMLElement>");
    expect(controller).toContain("mount.remove()");
    expect(controller).toContain("createElement(PageLensDock");
    expect(controller).toContain("PageLensDockControllerOptions");
    expect(controller).toContain("getLensState");
    expect(controller).toContain("onLensVisibilityChange");
    expect(controller).toContain("onLensResultsClear");
    expect(controller).toContain("subscribeToLensState");
    expect(controller).toContain("shouldShowPageLensDock");
    expect(controller).toContain("window.location.protocol === \"http:\"");
    expect(settings).toContain("PAGE_DOCK_DISABLED_HOSTS_KEY");
    expect(settings).toContain("PAGE_DOCK_ENABLED_KEY");
    expect(settings).toContain("PAGE_DOCK_VISIBILITY_MODE_KEY");
    expect(settings).toContain("PAGE_DOCK_ALLOWED_DOMAINS_KEY");
    expect(component).toContain("useState<DockView | null>(null)");
    expect(component).toContain("lenses-page-dock-menu");
    expect(component).toContain("Hide until reload");
    expect(component).toContain("lenses-page-dock-rail");
    expect(component).toContain('railSlot="tail"');
    expect(component).toContain('railSlot === "tail" ? "is-tail" : ""');
    expect(component).toContain("lenses-page-dock-panel");
    expect(component).toContain("activePanelView");
    expect(component).toContain('dismissMenuOpen ? null : view');
    expect(component).toContain('data-view={activePanelView ?? (dismissMenuOpen ? "dismiss" : "rail")}');
    expect(component).toContain("eventTargetsDock(event, dockRef.current)");
    expect(component).toContain("event.composedPath()");
    expect(component).toContain("path.includes(dock)");
    expect(component).toContain('label="Lenses"');
    expect(component).toContain('label="Results"');
    expect(component).toContain('"Close sidebar"');
    expect(component).toContain('"Open sidebar"');
    expect(component).toContain("sourcePanelOpen");
    expect(component).not.toContain(
      'label={sourcePanelOpen ? "Close sidebar" : "Open sidebar"}\n          active={sourcePanelOpen}'
    );
    expect(component).toContain('action: "get-source-panel-state"');
    expect(component).toContain('"source-panel-state"');
    expect(component).toContain('data-source-panel-open={sourcePanelOpen ? "true" : undefined}');
    expect(component).toContain("if (!sourcePanelOpen) return;");
    expect(component).toContain("setDismissMenuOpen(false);");
    expect(component).toContain("SidebarPanelIcon");
    expect(component).toContain('<path d="M9 3v18" />');
    expect(component).not.toContain("ColumnsIcon");
    expect(component).not.toContain("PinLeftIcon");
    expect(component).not.toContain("LayoutIcon");
    expect(component.indexOf('icon="sidebar"')).toBeLessThan(
      component.indexOf('label="Custom lens"')
    );
    expect(component.indexOf('label="Custom lens"')).toBeLessThan(
      component.indexOf('label="Lenses"')
    );
    expect(component.indexOf('label="Results"')).toBeLessThan(
      component.indexOf('label="Dismiss Lenses"')
    );
    expect(component).not.toContain("title={label}");
    expect(component).toContain("USER_LENSES_CACHE_KEY");
    expect(component).toContain('type: "list-user-lenses"');
    expect(component).toContain("lenses-page-dock-lens-user-group");
    expect(component).toContain("lenses-page-dock-result-list");
    expect(component).toContain("lenses-page-dock-result-modes");
    expect(component).toContain("lenses-page-dock-result-clear");
    expect(component).not.toContain("lenses-page-dock-result-findings");
    expect(component).not.toContain("lenses-page-dock-result-finding-clear");
    expect(component).toContain("lenses-page-dock-panel-edit");
    expect(component).toContain("RESULT_DISPLAY_MODES");
    expect(component).toContain('{ mode: "list", label: "List" }');
    expect(component).not.toContain('{ mode: "both", label: "Both" }');
    expect(component).toContain("setResultDisplayMode");
    expect(component).toContain("clearLensResults");
    expect(component).not.toContain("clearLensFinding");
    expect(component).toContain("getResultItem");
    expect(component).not.toContain("SELECTED_LENSES_STORAGE_KEY");
    expect(component).not.toContain("buildAnnotationActions");
    expect(component).toContain('action: "toggle-source-panel"');
    expect(component).toContain("toggleSidebar");
    expect(component).toContain("DockStatusToast");
    expect(component).toContain("lenses-page-dock-toast");
    expect(component).toContain("toastError");
    expect(component).toContain("lenses-page-dock-lens-pills");
    expect(component).toContain("lenses-page-dock-run");
    expect(component).toContain("customInstructionRef");
    expect(component).toContain('customInstructionRef.current?.focus({ preventScroll: true })');
    expect(component).toContain('placeholder="Describe a lens"');
    expect(component).not.toContain('label="Run lenses"');
    expect(component).not.toContain("runSelectedLenses");
    expect(component).not.toContain("runAnnotationAction");
    expect(component).not.toContain('label="Clear highlights"');
    expect(component).not.toContain('icon="clear"');
    expect(component).not.toContain("Highlight every deadline, promise, or contradiction");
    expect(component).not.toContain("Run custom");
    expect(component).not.toContain("lenses-page-dock-domain");
    expect(component).toContain('"claim-extractor": "#4f8df9"');
    expect(component).not.toContain('"hedging-detector"');
    expect(component).toContain('"source-tracer": "#059669"');
    expect(component).not.toContain('"emotional-framing"');
  });

  it("loads domain-aware default lenses and toggles cached lens visibility", () => {
    const component = readSource("content/PageLensDock.tsx");
    const content = readSource("content/content.ts");
    const background = readSource("background/service-worker.ts");

    expect(component).toContain("domainLensOptions");
    expect(component).toContain("LENS_DOMAIN_RULES_KEY");
    expect(component).toContain('type: "list-lenses"');
    expect(component).toContain('type: "list-user-lenses"');
    expect(component).toContain("lensFromRow");
    expect(component).toContain("persistedExtraLensIds");
    expect(component).toContain("readUserLenses");
    expect(component).toContain("readActiveCustomLens");
    expect(component).toContain("setSelectedLensIds");
    expect(component).toContain("PageLensDockLensState");
    expect(component).toContain("computedLensIds");
    expect(component).toContain("findingCountByLensId");
    expect(component).toContain("renderedCountByLensId");
    expect(component).toContain("anchorFailureCountByLensId");
    expect(component).toContain("resultDisplayModeByLensId");
    expect(component).toContain("onLensDisplayModeChange");
    expect(component).toContain("locallyComputedFindingCountByLensId");
    expect(component).toContain("locallyRenderedCountByLensId");
    expect(component).toContain("locallyAnchorFailureCountByLensId");
    expect(component).toContain("visibleLensIds");
    expect(component).toContain("pendingLensIds");
    expect(component).toContain("queuedLensIds");
    expect(component).toContain("settlingLensIds");
    expect(component).toContain("runningLensIdsRef");
    expect(component).toContain("MIN_COMPUTING_VISIBLE_MS");
    expect(component).toContain("COMPUTING_SETTLE_MS");
    expect(component).toContain("waitForMinimumDuration");
    expect(component).toContain("beginLensSettling");
    expect(component).toContain("clearLensSettling");
    expect(component).toContain("readComputingAnimationDebug");
    expect(component).toContain('settling ? "is-settling" : ""');
    expect(component).toContain('completed ? "is-computed" : ""');
    expect(component).toContain('data-computing-lens-ids={pendingLensIds.join(" ") || undefined}');
    expect(component).not.toContain("ComputingSweep");
    expect(component).not.toContain("lenses-page-dock-computing-sweep");
    expect(component).toContain("getAnimations({ subtree: true })");
    expect(component).toContain("dot.getAnimations()");
    expect(component).toContain("itemAnimations");
    expect(component).toContain("dotAnimations");
    expect(component).not.toContain("sweepAnimationName");
    expect(component).not.toContain(".lenses-page-dock-sweep-line");
    expect(component).not.toContain("sweepStrokeDashoffset");
    expect(component).toContain("[Lenses][page-dock] computing animation");
    expect(component).toContain("[Lenses][page-dock] computing effect-start");
    expect(component).toContain("setDockLensSelected");
    expect(component).toContain("queueLensComputation");
    expect(component).toContain("computeLens");
    expect(component).toContain("dockLensTitle");
    expect(component).toContain('const noun = foundCount === 1 ? "finding" : "findings"');
    expect(component).toContain("`${name}: ${renderedCount} placed, ${foundCount} found`");
    expect(component).toContain("`${name}: ${foundCount} ${noun} computed`");
    expect(component).toContain("title={dockLensTitle");
    expect(component).toContain("onLensVisibilityChange(lensId, false)");
    expect(component).toContain("onLensVisibilityChange(lensId, true)");
    expect(component).toContain("onLensDisplayModeChange(lensId, mode)");
    expect(component).toContain("onLensResultsClear(lensId)");
    expect(component).toContain("Clear ${item.name} results");
    expect(component).toContain('aria-busy={computing ? "true" : undefined}');
    expect(component).toContain("data-lens-id={lens.lensId}");
    expect(component).toContain("data-lens-id={item.id}");
    expect(component).toContain('aria-pressed={mode === option.mode}');
    expect(component).toContain('type: "run-page-lenses"');
    expect(component).toContain("lensIds");
    expect(component).toContain("selectedDockLensIds");
    expect(component).toContain("clearFirst: false");
    expect(component).toContain("customLens: { instruction, name, lensId }");
    expect(component).toContain("ACTIVE_CUSTOM_LENS_KEY");
    expect(content).toContain("getPageLensDockLensState");
    expect(content).toContain("findingCountByLensId");
    expect(content).toContain("renderedCountByLensId");
    expect(content).toContain("anchorFailureCountByLensId");
    expect(content).toContain("sourceTextByLensId");
    expect(content).toContain('"source-tracer": { autoSourceChecks: false }');
    expect(content).toContain("resultDisplayModeByLensId");
    expect(content).toContain('return getLensResultDisplayMode(lensId) === "inline"');
    expect(content).toContain('return getLensResultDisplayMode(lensId) === "notes"');
    expect(content).not.toContain('mode === "inline" || mode === "both"');
    expect(content).not.toContain('mode === "notes" || mode === "both"');
    expect(content).toContain("setPageLensDockLensDisplayMode");
    expect(content).toContain("clearPageLensDockLensResults");
    expect(content).toContain("clearPageLensDockFindingResult");
    expect(content).toContain("set-lens-result-display-mode");
    expect(content).toContain("clear-lens-results");
    expect(content).not.toContain("clear-lens-finding-result");
    expect(content).toContain("restoreStoredPageLensResults");
    expect(content).toContain('type: "restore-page-lens-results"');
    expect(content).toContain("sourceKey: getCurrentPageSourceKey()");
    expect(content).toContain("window.setTimeout(restoreStoredPageLensResults");
    expect(content).toContain("lenses-annotation-marker");
    expect(content).toContain("failedAnchors");
    expect(content).toContain("[Lenses][content][anchors] failed to anchor findings");
    expect(content).toContain("setPageLensDockLensVisibility");
    expect(content).toContain("subscribeToPageLensDockState");
    expect(content).toContain("notifyPageLensDockStateChanged");
    expect(background).toContain("RestorePageLensResultsRequest");
    expect(background).toContain("restoreStoredPageLensResultsForTab");
    expect(background).toContain("getStoredRunStates(");
    expect(background).toContain("req.lensIds ?? []");
    expect(background).toContain("colors: colorsForLens(run.lensId)");
    expect(background).toContain("cleanLensIds(request.lensIds ?? [])");
    expect(background).toContain("explicitly selected lenses run as chosen");
    expect(background).toContain("tabId: message.tabId ?? sender.tab?.id");
    expect(background).toContain("request.clearFirst !== false");
    expect(background).toContain("renderedCount");
    expect(background).toContain("failedAnchorCount");
    expect(background).toContain("sourceText: pageText.text");
    expect(background).toContain("const preparedSource = await prepareSegmentedSource(");
    expect(background).toContain("result = await runChunkedPageLens({");
    expect(background).not.toContain("runChunkedEvidencePageLens");
  });

  it("reacquires live text without cloning the page when requesting stored results", () => {
    const content = readSource("content/content.ts");

    expect(content).toContain("sourceText: getPageText()");
    expect(content).not.toContain("document.body.cloneNode(true)");
  });

  it("styles the rail as a right-edge webpage control", () => {
    const css = [
      readSource("content/styles/page-dock.css"),
      readSource("content/styles/dark-theme.css"),
    ].join("\n");

    expect(css).toContain(".lenses-page-dock-root");
    expect(css).toContain("position: fixed");
    expect(css).toContain("right: 0");
    expect(css).toContain("z-index: 2147483647");
    expect(css).not.toContain("right: 6px");
    expect(css).toContain("border-radius: 12px 0 0 12px");
    expect(css).toContain(".lenses-page-dock-menu");
    expect(css).toContain("--lenses-dock-surface-width: 216px");
    expect(css).toContain("--lenses-dock-menu-width: 176px");
    expect(css).toContain("width: min(var(--lenses-dock-surface-width)");
    expect(css).toContain("width: min(var(--lenses-dock-menu-width)");
    expect(css).toContain("max-width: min(var(--lenses-dock-surface-width)");
    expect(css).toContain("min-height: 28px");
    expect(css).toContain("color: var(--lenses-dock-muted)");
    expect(css).toContain(".lenses-page-dock-button.is-active");
    expect(css).toContain("gap: 0");
    expect(css).toContain("--lenses-page-dock-anchor-offset: 17px");
    expect(css).toContain(".lenses-page-dock-rail .lenses-page-dock-button.is-tail");
    expect(css).toContain("height: 0");
    expect(css).toContain("height: 30px");
    expect(css).toContain("height 0.18s ease");
    expect(css).toContain("opacity 0.18s ease");
    expect(css).not.toContain("transform: translateY(6px) scale(0.94)");
    expect(css).not.toContain(
      ".lenses-page-dock-rail .lenses-page-dock-button.is-tail:first-child + .lenses-page-dock-button.is-tail"
    );
    expect(css).not.toContain("transform: translateY(-6px) scale(0.94)");
    expect(css).toContain(
      "transform: translateY(calc(var(--lenses-page-dock-anchor-offset) * -1))"
    );
    expect(css).toContain(
      '.lenses-page-dock[data-view="custom"] .lenses-page-dock-rail'
    );
    expect(css).toContain(
      '.lenses-page-dock[data-source-panel-open="true"] .lenses-page-dock-rail'
    );
    expect(css).toContain("display: none");
    expect(css).not.toContain(
      '.lenses-page-dock[data-source-panel-open="true"] .lenses-page-dock-button.is-tail'
    );
    expect(css).not.toContain(
      '.lenses-page-dock[data-source-panel-open="true"] .lenses-page-dock-button + .lenses-page-dock-button'
    );
    expect(css).toContain("margin-top: 4px");
    expect(css).not.toContain(".lenses-page-dock-tail");
    expect(css).toContain(".lenses-page-dock-rail:hover .lenses-page-dock-button.is-tail");
    expect(css).toContain(".lenses-page-dock-rail:focus-within .lenses-page-dock-button.is-tail");
    expect(css).toContain(
      '.lenses-page-dock[data-view="dismiss"] .lenses-page-dock-button.is-tail'
    );
    expect(css).toContain("pointer-events: none");
    expect(css).toMatch(/\.lenses-page-dock\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(css).toMatch(/\.lenses-page-dock-rail\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(css).toMatch(
      /\.lenses-page-dock--collapsed \.lenses-page-dock-button,[\s\S]*?\.lenses-page-dock-button\s*\{[\s\S]*?pointer-events:\s*auto;/
    );
    expect(css).toMatch(
      /\.lenses-page-dock-rail:hover,[\s\S]*?\.lenses-page-dock-toast\s*\{\s*pointer-events:\s*auto;/
    );
    expect(css).toContain("right: calc(100% + 8px)");
    expect(css).toContain("opacity 0.06s ease");
    expect(css).toContain(".lenses-page-dock-toast");
    expect(css).toContain('data-kind="error"');
    expect(css).toContain(".lenses-page-dock-lens-pill");
    expect(css).toContain(".lenses-page-dock-lens-user-group");
    expect(css).toContain("border-top: 1px solid var(--lenses-dock-line-soft)");
    expect(css).toContain(".lenses-page-dock-panel-edit");
    expect(css).toContain(".lenses-page-dock-lens-pill.is-selected");
    expect(css).toContain(".lenses-page-dock-lens-pill.is-computed");
    expect(css).toContain("var(--lenses-dock-lens-accent, var(--lenses-dock-accent)) 20%");
    expect(css).toContain("box-shadow: none");
    expect(css).toContain(".lenses-page-dock-lens-pill.is-computing");
    expect(css).not.toContain(".lenses-page-dock-lens-pill.is-computing .lenses-page-dock-dot");
    expect(css).not.toContain(".lenses-page-dock-computing-sweep");
    expect(css).not.toContain(".lenses-page-dock-sweep-line");
    expect(css).toContain("animation: lenses-page-dock-surface-breathe 1s ease-in-out infinite");
    expect(css).toContain(".lenses-page-dock-lens-pill.is-settling");
    expect(css).toContain("background-color 0.42s ease");
    expect(css).toContain("var(--lenses-dock-lens-accent, var(--lenses-dock-accent)) 6%");
    expect(css).toContain("var(--lenses-dock-lens-accent, var(--lenses-dock-accent)) 48%");
    expect(css).not.toContain("@keyframes lenses-page-dock-dot-spin");
    expect(css).not.toContain("@keyframes lenses-page-dock-border-sweep");
    expect(css).toContain("@keyframes lenses-page-dock-surface-breathe");
    expect(css).not.toContain("@keyframes lenses-page-dock-computing-orbit");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain(".lenses-page-dock-pill-check");
    expect(css).toContain("flex-wrap: wrap");
    expect(css).not.toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain(".lenses-page-dock-result-list");
    expect(css).toContain(".lenses-page-dock-result-row");
    expect(css).toContain(".lenses-page-dock-result-modes");
    expect(css).toContain(".lenses-page-dock-result-mode.is-active");
    expect(css).toContain(".lenses-page-dock-result-clear");
    expect(css).not.toContain(".lenses-page-dock-result-findings");
    expect(css).not.toContain(".lenses-page-dock-result-finding-clear");
    expect(css).not.toContain(".lenses-page-dock-annotation-list");
    expect(css).not.toContain('.lenses-page-dock[data-view="annotations"] .lenses-page-dock-panel');
    expect(css).toContain(".lenses-page-dock-run");
    expect(css).toContain("align-self: flex-end");
    expect(css).toContain("border-radius: var(--lenses-radius-pill)");
    expect(css).toContain("box-shadow: inset 0 0 0 1px var(--lenses-dock-accent-ring)");
    expect(css).not.toContain(".lenses-page-dock-custom button");
    expect(css).toContain('html[data-lenses-theme="dark"] .lenses-page-dock-panel');
    expect(css).toContain('[data-lenses-theme="dark"] .lenses-page-dock-panel');
  });

  it("exposes content CSS to shadow-mounted popup UI", () => {
    const manifest = readFileSync(join(here, "..", "manifest.json"), "utf-8");

    expect(manifest).toContain('"web_accessible_resources"');
    expect(manifest).toContain('"content/highlight.css"');
  });

  it("keeps the right rail visible by default unless the current host is hidden", async () => {
    stubPageDockStorage({}, "https://example.com/article");
    await expect(shouldShowPageLensDock()).resolves.toBe(true);

    stubPageDockStorage(
      { "pageDock:disabledHosts": ["example.com"] },
      "https://example.com/article"
    );
    await expect(shouldShowPageLensDock()).resolves.toBe(false);
  });

  it("supports selected-domain right rail visibility", async () => {
    stubPageDockStorage(
      {
        "pageDock:visibilityMode": "selected",
        "pageDock:allowedDomains": ["nytimes.com"],
      },
      "https://www.nytimes.com/2026/article"
    );
    await expect(shouldShowPageLensDock()).resolves.toBe(true);

    stubPageDockStorage(
      {
        "pageDock:visibilityMode": "selected",
        "pageDock:allowedDomains": ["nytimes.com"],
      },
      "https://example.com/article"
    );
    await expect(shouldShowPageLensDock()).resolves.toBe(false);
  });
});

function stubPageDockStorage(stored: Record<string, unknown>, href: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
    location: { href },
    },
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
    storage: {
      local: {
        get: vi.fn(async () => stored),
        set: vi.fn(async () => undefined),
      },
    },
    },
  });
}

function restoreGlobal(
  name: "window" | "chrome",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
