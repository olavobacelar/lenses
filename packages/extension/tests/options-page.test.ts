import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");
const optionsRoot = join(here, "..", "src", "options");

function readSource(relativePath: string): string {
  return readFileSync(join(optionsRoot, relativePath), "utf-8");
}

function readExtensionSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

describe("settings page", () => {
  it("uses the product name for the browser tab title", () => {
    const html = readExtensionSource("settings.html");

    expect(html).toContain("<title>Lenses</title>");
    expect(html).not.toContain("<title>Settings</title>");
  });

  it("keeps the document locked while the settings panes own real overflow", () => {
    const css = readSource("options.css");

    const htmlStart = css.indexOf("html {");
    const htmlBlock = css.slice(htmlStart, css.indexOf("}", htmlStart));
    expect(htmlBlock).toContain("height: 100%;");
    expect(htmlBlock).toContain("overflow: hidden;");

    const bodyStart = css.indexOf("body {");
    const bodyBlock = css.slice(bodyStart, css.indexOf("}", bodyStart));
    expect(bodyBlock).toContain("height: 100%;");
    expect(bodyBlock).toContain("overflow: hidden;");

    const rootStart = css.indexOf("#root {");
    const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart));
    expect(rootBlock).toContain("height: 100%;");

    const layoutStart = css.indexOf(".settings-layout {");
    const layoutBlock = css.slice(layoutStart, css.indexOf("}", layoutStart));
    expect(layoutBlock).toContain("height: 100%;");
    expect(layoutBlock).toContain("min-height: 0;");
    expect(layoutBlock).toContain(
      "grid-template-columns: var(--settings-sidebar-width) minmax(0, 1fr);",
    );
    expect(layoutBlock).toContain("overflow: hidden;");
    expect(css).toContain("--settings-sidebar-width: 300px;");
    expect(css).toContain("--settings-pane-gutter: 72px;");
    expect(css).toContain(
      "padding: 52px var(--settings-pane-right-padding) 52px var(--settings-pane-gutter);",
    );

    const mainStart = css.indexOf(".settings-main {");
    const mainBlock = css.slice(mainStart, css.indexOf("}", mainStart));
    expect(mainBlock).toContain("min-height: 0;");
    expect(mainBlock).toContain("overflow-y: auto;");
    expect(mainBlock).toContain("overscroll-behavior: contain;");
  });

  it("makes general the default settings section and lists AI after it", () => {
    const app = readSource("OptionsApp.tsx");

    expect(app).toContain('default:\n      return "general"');
    // The nav is rendered in declaration order — General precedes the rest so
    // it remains the visual landing destination.
    const generalIndex = app.indexOf('href="#general"');
    const aiIndex = app.indexOf('href="#ai"');
    const appearanceIndex = app.indexOf('href="#appearance"');
    expect(generalIndex).toBeGreaterThan(-1);
    expect(generalIndex).toBeLessThan(aiIndex);
    expect(aiIndex).toBeLessThan(appearanceIndex);
    expect(app).not.toContain('href="#api-keys"');
    expect(app).not.toContain('href="#models"');
  });

  it("routes legacy API and model hashes to the merged AI section", () => {
    const app = readSource("OptionsApp.tsx");

    expect(app).toContain('case "#ai":');
    expect(app).toContain('case "#api-keys":');
    expect(app).toContain('case "#models":\n      return "ai"');
    expect(app).toContain('title: "AI"');
  });

  it("keeps settings section names only in the main page header", () => {
    const app = readSource("OptionsApp.tsx");
    const css = readSource("options.css");

    expect(app).toContain("<h1>{page.title}</h1>");
    expect(app).not.toContain("page.description");
    expect(app).not.toContain('aria-labelledby="api-keys-title"');
    expect(app).not.toContain('aria-labelledby="models-title"');
    expect(app).not.toContain('aria-labelledby="ai-title"');
    expect(app).not.toContain('aria-labelledby="general-title"');
    expect(app).not.toContain('aria-labelledby="appearance-title"');
    expect(app).not.toContain('id="api-keys-title">API keys</h2>');
    expect(app).not.toContain('id="models-title">Models</h2>');
    expect(app).not.toContain('id="ai-title">AI</h2>');
    expect(app).not.toContain('id="general-title">General</h2>');
    expect(app).not.toContain('id="appearance-title">Appearance</h2>');
    expect(css).not.toContain(".page-header p:not(.eyebrow)");
    expect(css).toContain(".settings-card > .setting-row:first-child");
    expect(css).toContain("--settings-heading-inset: 14px;");
    expect(css).toContain("padding: 0 var(--settings-heading-inset);");
  });

  it("renders the right rail controls inside the general section", () => {
    const app = readSource("OptionsApp.tsx");
    const settings = readSource("useOptionsSettings.ts");

    // The rail card is grouped under General — both cards render together
    // whenever `section === "general"` so users find them in one place.
    expect(app).toContain('{section === "general"');
    expect(app).toContain('id="rail"');
    expect(app).toContain('id="page-dock-enabled"');
    expect(app).toContain('id="page-dock-visibility-mode"');
    expect(app).toContain('id="page-dock-allowed-domains"');
    expect(app).toContain('id="page-dock-disabled-hosts"');
    expect(settings).toContain("PAGE_DOCK_VISIBILITY_MODE_KEY");
    expect(settings).toContain("PAGE_DOCK_ALLOWED_DOMAINS_KEY");
  });

  it("surfaces managed and local BYOK AI modes while keeping the Lens library local", () => {
    const app = readSource("OptionsApp.tsx");
    const settings = readSource("useOptionsSettings.ts");
    const lensLibrary = readSource("useLensLibrary.ts");

    expect(app).toContain('{section === "ai"');
    expect(app).toContain('id="ai"');
    expect(app).toContain('id="app-access-mode"');
    expect(app).toContain('{ value: "managed", label: "Managed" }');
    expect(app).toContain('{ value: "local_byok", label: "Local BYOK" }');
    expect(settings).toContain("DEFAULT_APP_ACCESS_MODE");
    expect(settings).toContain("APP_ACCESS_MODE_STORAGE_KEY");
    expect(lensLibrary).not.toContain("APP_ACCESS_MODE_STORAGE_KEY");
    expect(lensLibrary).not.toContain("appAccessMode");
    expect(lensLibrary).toContain("browser-local Lens library");
  });

  it("makes Managed mode available without an access code", () => {
    const app = readSource("OptionsApp.tsx");
    const managedStart = app.indexOf(
      ") : (",
      app.indexOf('settings.appAccessMode === "local_byok"')
    );
    const managedEnd = app.indexOf("\n            )}", managedStart);
    const managedBranch = app.slice(managedStart, managedEnd);

    expect(managedBranch).toContain("Managed service");
    expect(managedBranch).toContain("No access code is required.");
    expect(app).not.toContain("Jury access code");
    expect(app).not.toContain('type: "jury-access:redeem"');
    expect(managedBranch).not.toContain("Create an OpenAI key");
    expect(managedBranch).not.toContain("Create an Anthropic key");
  });

  it("labels the default lens model by its extraction role", () => {
    const app = readSource("OptionsApp.tsx");

    expect(app).toContain('title="Extraction model"');
    expect(app).toContain("Used when applying lenses to extract and annotate findings.");
  });

  it("lets the user choose the default model provider", () => {
    const app = readSource("OptionsApp.tsx");
    const settings = readSource("useOptionsSettings.ts");

    expect(app).toContain("Default provider");
    expect(app).toContain("unless a lens has its own override");
    expect(app).toContain('{ value: "anthropic", label: "Anthropic" }');
    expect(app).toContain('{ value: "openai", label: "OpenAI" }');
    expect(settings).toContain("[AI_SETTINGS_STORAGE_KEYS.provider]: provider");
    expect(settings).toContain("snapshot.selectedModelsByProvider.anthropic.execution");
    expect(settings).toContain("snapshot.selectedModelsByProvider.openai.execution");
  });

  it("renders diagnostics and toolbar behavior as settings dropdowns", () => {
    const app = readSource("OptionsApp.tsx");

    expect(app).toContain('id="debug-mode"');
    expect(app).toContain('{ value: "standard", label: "Standard" }');
    expect(app).toContain('{ value: "debug", label: "Debug controls" }');
    expect(app).toContain('id="experimental-unified-panel"');
    expect(app).toContain('{ value: "popup", label: "Popup" }');
    expect(app).toContain('{ value: "sidepanel", label: "Side panel" }');
  });

  it("keeps select controls from inheriting the generic button chrome", () => {
    const css = readSource("options.css");

    expect(css).toContain(".select-value");
    expect(css).toContain("button.select-trigger");
    expect(css).toContain("--section-focus-bg: #232a38;");
    expect(css).toContain("--section-focus-bg: #eef3fe;");
    expect(css).toContain("background: var(--section-focus-bg);");
    expect(css).toContain('button.select-trigger[data-state="open"]');
    expect(css).toContain('.select-trigger[data-state="open"] .select-icon');
  });

  it("prevents settings textareas from being resized by hand", () => {
    const css = readSource("options.css");
    const textareaStart = css.indexOf("textarea {\n  min-height: 96px;");
    const textareaBlock = css.slice(textareaStart, css.indexOf("}", textareaStart));

    expect(textareaStart).toBeGreaterThan(-1);
    expect(textareaBlock).toContain("resize: none;");
  });

  it("surfaces a 'New lens' button and the lens list directly in the sidebar", () => {
    const app = readSource("OptionsApp.tsx");
    const css = readSource("options.css");

    expect(app).toContain("function BrandMark()");
    expect(app).toContain("<BrandMark />");
    expect(app).toContain('className="brand-mark"');
    expect(app).toContain('src="icons/icon-256.png"');
    expect(app).toContain("icons/icon-256.png 1x");
    expect(app).toContain("icons/icon-512.png 2x");
    expect(app).toContain("<span>Settings</span>");
    expect(app).not.toContain('<p className="eyebrow">Lenses</p>');
    expect(css).toContain(".brand-mark img");
    expect(css).toContain("font-weight: 650;");

    // The sidebar owns lens creation now — there is no separate detail-page
    // master pane. Both the section label and the new-lens button must be
    // rendered in the SettingsSidebar tree.
    expect(app).toContain("sidebar-new-lens");
    expect(app).toContain(">New lens<");
    expect(app).toContain("sidebar-section-label");
    expect(app).toContain('SidebarLensGroup');
    expect(app).not.toContain("userLensEmptyHint");
    expect(app).not.toContain("Forks and new lenses appear here.");
    expect(app).not.toContain("emptyHint");
    expect(css).not.toContain(".sidebar-lens-hint");

    // The "New lens" button navigates to a deep-linkable route the editor
    // recognizes as a blank-draft sentinel.
    expect(app).toContain('NEW_LENS_ROUTE = "new"');
    expect(app).toContain('window.location.hash = `#lenses/${NEW_LENS_ROUTE}`');
  });

  it("lets user lenses be reordered and deleted from the sidebar", () => {
    const app = readSource("OptionsApp.tsx");
    const hook = readSource("useLensLibrary.ts");
    const css = readSource("options.css");

    expect(app).toContain("sidebar-lens-handle");
    expect(app).toContain("sidebar-lens-delete");
    expect(app).toContain("TrashIcon");
    expect(app).toContain("moveLensId");
    expect(app).toContain("dropTargetForListEvent");
    expect(app).toContain("data-sidebar-lens-id");
    expect(app).toContain("navigateToLens");
    expect(app).toContain("onClick={() => navigateToLens(lensId)}");
    expect(app).toContain("event.stopPropagation();");
    expect(app).toContain('placement: "after"');
    expect(app).toContain('Are you sure you want to delete the lens "');
    expect(app).toContain("reorderBuiltInLens");
    expect(app).toContain("const editable = Boolean(onDeleteLens || onReorderLens)");
    expect(hook).toContain('type: "erase-lens"');
    expect(hook).toContain('type: "reorder-user-lenses"');
    expect(hook).toContain('type: "reorder-built-in-lenses"');
    expect(css).toContain(".sidebar-lens-entry");
    expect(css).toContain(".sidebar-lens-entry.drop-before::before");
    expect(css).toContain("margin: -6px 0 -16px;");
    expect(css).toContain("--surface-selected:");

    const entryStart = css.indexOf(".sidebar-lens-entry {");
    const entryBlock = css.slice(entryStart, css.indexOf("}", entryStart));
    expect(entryBlock).toContain("cursor: pointer;");

    const entryActiveStart = css.indexOf(".sidebar-lens-entry.active {");
    const entryActiveBlock = css.slice(entryActiveStart, css.indexOf("}", entryActiveStart));
    expect(entryActiveBlock).toContain("background: var(--surface-selected);");
    expect(entryActiveBlock).not.toContain("box-shadow");

    const rowActiveStart = css.indexOf("\n.sidebar-lens-row.active {") + 1;
    const rowActiveBlock = css.slice(rowActiveStart, css.indexOf("}", rowActiveStart));
    expect(rowActiveBlock).toContain("background: var(--surface-selected);");
    expect(rowActiveBlock).toContain("box-shadow: none;");
    expect(rowActiveBlock).not.toContain("var(--accent");

    const deleteStart = css.indexOf(".sidebar-lens-delete {");
    const deleteBlock = css.slice(deleteStart, css.indexOf("}", deleteStart));
    expect(deleteBlock).toContain("opacity: 0;");
    expect(deleteBlock).toContain("pointer-events: none;");
    expect(css).toContain(".sidebar-lens-entry:hover .sidebar-lens-delete");
    expect(css).toContain(".sidebar-lens-entry:focus-within .sidebar-lens-delete");
    expect(css).toContain(".sidebar-lens-delete:focus-visible");
    expect(css).toContain("pointer-events: auto;");
  });

  it("renders the lens editor with an empty draft when the route is #lenses/new", () => {
    const app = readSource("OptionsApp.tsx");
    const editor = readSource("LensEditor.tsx");

    // OptionsApp must translate the sentinel to a `startBlank` prop instead of
    // passing it through as an initialLensId (which the editor would try to
    // look up and fail).
    expect(app).toContain("startBlank={route.lensId === NEW_LENS_ROUTE}");
    expect(app).toContain(
      "initialLensId={route.lensId === NEW_LENS_ROUTE ? undefined : route.lensId}"
    );

    // The editor seeds an empty draft when startBlank is true so the user can
    // start typing immediately.
    expect(editor).toContain("startBlank");
    expect(editor).toContain("setDraft(emptyDraft())");
  });

  it("groups the lens form into sections with a collapsed-by-default Advanced group", () => {
    const editor = readSource("LensEditor.tsx");
    const css = readSource("options.css");

    // The 18 fields are chunked into labelled sections instead of one flat grid,
    // in this order, so the essential authoring path leads.
    for (const title of [
      '<Section title="Basics"',
      '<Section\n          title="Instructions"',
      '<Section title="Findings"',
      '<Section\n          title="Behavior"',
      '<Section\n          title="Where it runs"',
    ]) {
      expect(editor).toContain(title);
    }

    // Advanced is a disclosure that starts closed; its fields only mount once the
    // user opens it, keeping the power-user knobs out of the default view.
    expect(editor).toContain("const [advancedOpen, setAdvancedOpen] = useState(false)");
    expect(editor).toContain('data-open={advancedOpen}');
    expect(editor).toContain("{advancedOpen ? (");

    // The section layout and disclosure carry their own styles.
    expect(css).toContain(".lens-section {");
    expect(css).toContain(".lens-advanced-toggle {");
    // The old flat grid is gone.
    expect(css).not.toContain(".lens-form-grid {");
  });

  it("persists settings automatically instead of behind a manual Save button", () => {
    const app = readSource("OptionsApp.tsx");
    const settings = readSource("useOptionsSettings.ts");

    // The manual Save submit button is gone — changes write themselves.
    expect(app).not.toContain('id="save"');
    expect(app).not.toContain("saveSettings");

    // A debounced effect persists the latest snapshot on change, but only once
    // the stored values have hydrated (so defaults never overwrite real data).
    expect(settings).toContain("persistSettings");
    expect(settings).toContain("AUTOSAVE_DEBOUNCE_MS");
    expect(settings).toContain("if (!hydrated) return;");
    expect(settings).toContain("skipNextAutoSave");

    // Feedback is acknowledged the instant a change happens, then confirmed.
    expect(settings).toContain('showStatus("Saving…")');
    expect(settings).toContain('showStatus("Saved", false, true)');
    expect(settings).toContain('setStatus({ message: "", isError: false, isSuccess: true })');
    expect(settings).toContain("API_KEY_TEST_DEBOUNCE_MS");
    expect(settings).toContain("testProviderApiKey");
    expect(settings).toContain("Testing ${label}");
    expect(app).not.toContain("Test active key");
    expect(app).not.toContain('id="test-key"');

    // The confirmation floats fixed to the viewport instead of sitting in a
    // footer that scrolls out of view when a top-of-form control changes.
    expect(app).toContain("save-indicator");
    const css = readSource("options.css");
    expect(css).toContain(".save-indicator {");
    expect(css).toContain("position: fixed;");
    expect(css).toContain("--success: #3fb950;");
    expect(css).toContain(".save-indicator.success");
  });

  it("vertically centers the toggle thumb in the track grid, matching the popup/sidepanel", () => {
    const css = readSource("options.css");

    // The track owns vertical centering. The thumb transform moves horizontally
    // only, so native button line-box/baseline behavior cannot push the thumb
    // a pixel low.
    const trackStart = css.indexOf(".switch-track {");
    const trackBlock = css.slice(trackStart, css.indexOf("}", trackStart));
    expect(trackBlock).toContain("display: grid;");
    expect(trackBlock).toContain("align-items: center;");
    expect(trackBlock).toContain("justify-items: start;");
    expect(trackBlock).toContain("height: 20px;");
    // The track is a <button>, and the generic `button { min-height: 38px }`
    // rule will stretch it into a tall oval unless this floor is overridden.
    expect(trackBlock).toContain("min-height: 20px;");

    const thumbStart = css.indexOf(".switch-thumb {");
    const thumbBlock = css.slice(thumbStart, css.indexOf("}", thumbStart));
    expect(thumbBlock).toContain("height: 14px;");
    expect(thumbBlock).toContain("transform: translateX(3px);");

    expect(css).toContain("transform: translateX(17px);");
  });

  it("collapses the sidebar into a drawer on narrow viewports instead of a tab strip", () => {
    const app = readSource("OptionsApp.tsx");
    const css = readSource("options.css");

    // The breakpoint is driven by JS (so the drawer can auto-close on
    // navigation) rather than by media queries swapping in tabs.
    expect(app).toContain("useIsNarrow");
    expect(app).toContain("MobileHeader");
    expect(app).toContain("MobileDrawer");
    expect(app).toContain("mobile-header-more");
    expect(app).toContain("mobile-drawer-close");
    expect(app).toContain('aria-modal="true"');
    expect(app).toContain("Cross2Icon");
    expect(app).not.toContain("mobile-header-title");
    expect(app).not.toContain("pageTitleFor");

    // The "narrow" modifier removes the sidebar column so the main pane
    // takes the full width; the drawer becomes a full-screen navigation view
    // instead of a cramped side sheet over clipped content.
    expect(css).toContain(".settings-layout.narrow");
    expect(css).toContain("grid-template-columns: 1fr;");
    expect(css).toContain(".mobile-drawer");
    expect(css).toContain(".mobile-drawer-header");
    expect(css).not.toContain(".mobile-drawer-scrim");
    expect(css).not.toContain("@keyframes drawer-slide");

    const drawerStart = css.indexOf(".mobile-drawer {");
    const drawerBlock = css.slice(drawerStart, css.indexOf("}", drawerStart));
    expect(drawerBlock).toContain("width: 100%;");
    expect(drawerBlock).toContain("background: var(--surface);");

    const drawerSidebarStart = css.indexOf(".mobile-drawer .settings-sidebar {");
    const drawerSidebarBlock = css.slice(
      drawerSidebarStart,
      css.indexOf("}", drawerSidebarStart)
    );
    expect(drawerSidebarBlock).toContain("min-height: calc(100vh - 64px);");
    expect(drawerSidebarBlock).toContain("background: transparent;");
    expect(css).toContain(".mobile-drawer .sidebar-brand");
  });
});
