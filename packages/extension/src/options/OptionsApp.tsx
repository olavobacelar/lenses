import {
  ColorWheelIcon,
  Cross2Icon,
  HamburgerMenuIcon,
  IdCardIcon,
  MixerHorizontalIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import * as Switch from "@radix-ui/react-switch";
import type { DragEvent as ReactDragEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionsSettings } from "./useOptionsSettings";
import { LensEditor } from "./LensEditor";
import { SelectControl } from "./SelectControl";
import { useLensLibrary, type LensLibrary } from "./useLensLibrary";
import type { PageDockVisibilityMode } from "../lib/page-dock-settings";
import type {
  SelectionTriggerDomainStyle,
  SelectionTriggerStyle,
  SelectionTriggerVisibilityMode,
} from "../lib/selection-trigger-settings";
import type { AppAccessMode } from "../lib/app-mode";

type SettingsSection = "general" | "ai" | "appearance";

// Contest builds exclude the toolbar popup, page dock, and floating chatbox,
// so the settings rows that configure those surfaces are hidden. Guarded with
// `typeof` so tests that load this module without the bundler's define still
// run.
const CONTEST_BUILD =
  typeof __CONTEST_BUILD__ === "undefined" ? false : __CONTEST_BUILD__;

const OPENAI_API_KEYS_URL = "https://platform.openai.com/api-keys";
const ANTHROPIC_API_KEYS_URL = "https://console.anthropic.com/settings/keys";

// Which top-level view the settings page shows, derived from the URL hash so the
// sidebar's lens entries are deep-linkable (#lenses/<id>) from the rail and
// side panel. Legacy settings anchors (#api-keys, #models, …) stay on the
// settings view. The sentinel `new` opens a fresh, unsaved lens draft.
type Route =
  | { view: "settings"; section: SettingsSection }
  | { view: "lenses"; lensId?: string };

const NEW_LENS_ROUTE = "new";
type DropPlacement = "before" | "after";
type DropTarget = { lensId: string; placement: DropPlacement };

function routeFromHash(hash: string): Route {
  if (hash === "#lenses" || hash.startsWith("#lenses/")) {
    const lensId = hash.startsWith("#lenses/")
      ? decodeURIComponent(hash.slice("#lenses/".length))
      : undefined;
    return { view: "lenses", lensId };
  }
  return { view: "settings", section: settingsSectionFromHash(hash) };
}

function settingsSectionFromHash(hash: string): SettingsSection {
  switch (hash) {
    case "#rail":
      return "general";
    case "#ai":
    case "#api-keys":
    case "#models":
      return "ai";
    case "#general":
      return "general";
    case "#appearance":
      return "appearance";
    default:
      return "general";
  }
}

function useHashRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return routeFromHash(hash);
}

// Tracks whether the viewport is narrow enough that the sidebar should collapse
// into a drawer. Kept here (not in CSS) because we also need to auto-close the
// drawer when the user picks a destination, and skip rendering it altogether
// when wide so focus traps and overlays don't show up on desktop.
function useIsNarrow(breakpoint = 900) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}

export function OptionsApp() {
  const route = useHashRoute();
  const lensLibrary = useLensLibrary();
  const isNarrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the active destination changes — picking a nav
  // entry should feel like it dismissed the menu, not left it hanging.
  useEffect(() => {
    setDrawerOpen(false);
  }, [route.view, route.view === "settings" ? route.section : route.lensId]);

  // Esc should close the drawer; matches the modal/overlay convention users
  // expect from the Obsidian-style "More" menu.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const sidebar = (
    <SettingsSidebar
      route={route}
      lensLibrary={lensLibrary}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <main className={`settings-layout ${isNarrow ? "narrow" : ""}`}>
      {isNarrow ? null : sidebar}

      <div className="settings-main">
        {isNarrow ? (
          <MobileHeader onOpenMenu={() => setDrawerOpen(true)} />
        ) : null}

        {route.view === "lenses" ? (
          <LensEditor
            initialLensId={route.lensId === NEW_LENS_ROUTE ? undefined : route.lensId}
            startBlank={route.lensId === NEW_LENS_ROUTE}
            lensLibrary={lensLibrary}
          />
        ) : (
          <SettingsView section={route.section} />
        )}
      </div>

      {isNarrow && drawerOpen ? (
        <MobileDrawer onClose={() => setDrawerOpen(false)}>{sidebar}</MobileDrawer>
      ) : null}
    </main>
  );
}

function MobileHeader({
  onOpenMenu,
}: {
  onOpenMenu: () => void;
}) {
  return (
    <header className="mobile-header">
      <div className="mobile-header-brand">
        <BrandMark />
        <span>Settings</span>
      </div>
      <button
        type="button"
        className="mobile-header-more"
        onClick={onOpenMenu}
        aria-label="Open navigation"
      >
        <HamburgerMenuIcon aria-hidden="true" focusable="false" />
      </button>
    </header>
  );
}

function MobileDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mobile-drawer-root">
      <div className="mobile-drawer" role="dialog" aria-label="Navigation" aria-modal="true">
        <header className="mobile-drawer-header">
          <div className="mobile-header-brand">
            <BrandMark />
            <span>Settings</span>
          </div>
          <button
            type="button"
            className="mobile-drawer-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <Cross2Icon aria-hidden="true" focusable="false" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const SETTINGS_PAGE_COPY: Record<SettingsSection, { title: string }> = {
  ai: {
    title: "AI",
  },
  general: {
    title: "General",
  },
  appearance: {
    title: "Appearance",
  },
};

function SettingsView({ section }: { section: SettingsSection }) {
  const {
    settings,
    status,
    modelsForProvider,
    activeModels,
    updateSetting,
    setProvider,
    setModel,
    setTheme,
  } = useOptionsSettings();
  // Settings persist automatically on change, so the form has nothing to
  // submit — just stop the browser from reloading the page on Enter.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  // Per-domain trigger-style overrides are edited as discrete rows. Domains are
  // normalized on save, so the raw text is kept verbatim while editing here.
  const domainStyleRules = settings.selectionTriggerDomainStyles;
  const setDomainStyleRules = (rules: SelectionTriggerDomainStyle[]) =>
    updateSetting("selectionTriggerDomainStyles", rules);
  const addDomainStyleRule = () =>
    setDomainStyleRules([
      ...domainStyleRules,
      { domain: "", style: settings.selectionTriggerStyle === "immediate" ? "modifier" : "immediate" },
    ]);
  const updateDomainStyleRule = (index: number, patch: Partial<SelectionTriggerDomainStyle>) =>
    setDomainStyleRules(
      domainStyleRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    );
  const removeDomainStyleRule = (index: number) =>
    setDomainStyleRules(domainStyleRules.filter((_, i) => i !== index));

  const page = SETTINGS_PAGE_COPY[section];

  return (
    <section className="options-shell">
      <header className="page-header">
        <h1>{page.title}</h1>
      </header>

      <form id="settings-form" className="settings-form" onSubmit={onSubmit}>
        {section === "ai" ? (
          <section id="ai" className="settings-card">
            <div className="setting-row">
              <label className="setting-copy" htmlFor="app-access-mode">
                <span className="setting-title">App mode</span>
                <span className="setting-description">
                  Managed uses the included service. Local BYOK uses your own provider key.
                </span>
              </label>
              <SelectControl<AppAccessMode>
                id="app-access-mode"
                value={settings.appAccessMode}
                onChange={(value) => updateSetting("appAccessMode", value)}
                options={[
                  { value: "managed", label: "Managed" },
                  { value: "local_byok", label: "Local BYOK" },
                ]}
              />
            </div>

            <div className="setting-row">
              <label className="setting-copy" htmlFor="model-provider">
                <span className="setting-title">Default provider</span>
                <span className="setting-description">
                  Its selected chat and extraction models are used unless a lens has its own override.
                </span>
              </label>
              <SelectControl
                id="model-provider"
                value={settings.provider}
                onChange={setProvider}
                options={[
                  { value: "anthropic", label: "Anthropic" },
                  { value: "openai", label: "OpenAI" },
                ]}
              />
            </div>

            <ModelSelect
              id="chat-model"
              title="Chat model"
              description="Used by the side panel when you ask about a source."
              models={modelsForProvider}
              value={activeModels.chat}
              onChange={(value) => setModel("chat", value)}
            />
            <ModelSelect
              id="execution-model"
              title="Extraction model"
              description="Used when applying lenses to extract and annotate findings."
              models={modelsForProvider}
              value={activeModels.execution}
              onChange={(value) => setModel("execution", value)}
            />

            {settings.appAccessMode === "local_byok" ? (
              <>
                <ApiKeyField
                  title="Anthropic API key"
                  description="Used only for direct Local BYOK calls. Stored on this device."
                  href={ANTHROPIC_API_KEYS_URL}
                  linkText="Create an Anthropic key"
                  inputId="api-key"
                  placeholder="sk-ant-..."
                  ariaLabel="Anthropic API key"
                  value={settings.anthropicApiKey}
                  onChange={(value) => updateSetting("anthropicApiKey", value)}
                />

                <ApiKeyField
                  title="OpenAI API key"
                  description="Used only for direct Local BYOK calls. Stored on this device."
                  href={OPENAI_API_KEYS_URL}
                  linkText="Create an OpenAI key"
                  inputId="openai-api-key"
                  placeholder="sk-..."
                  ariaLabel="OpenAI API key"
                  value={settings.openaiApiKey}
                  onChange={(value) => updateSetting("openaiApiKey", value)}
                />
              </>
            ) : (
              <div className="setting-row">
                <div className="setting-copy">
                  <span className="setting-title">Managed service</span>
                  <span className="setting-description">
                    Ready to use with the selected provider. No access code is required.
                  </span>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {section === "general" ? (
          <>
            {/* Both rows can be compiled out (diagnostics in production,
                toolbar behavior in contest builds); skip the card when it
                would render empty. */}
            {__INTERNAL_TOOLS__ || !CONTEST_BUILD ? (
            <section id="general" className="settings-card">
              {__INTERNAL_TOOLS__ ? (
                <SettingSelectRow
                  id="debug-mode"
                  title="Diagnostics"
                  description="Choose whether diagnostic controls and extra test surfaces are shown."
                  value={settings.debugMode ? "debug" : "standard"}
                  onChange={(value) => updateSetting("debugMode", value === "debug")}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "debug", label: "Debug controls" },
                  ]}
                />
              ) : null}
              {!CONTEST_BUILD ? (
                <SettingSelectRow
                  id="experimental-unified-panel"
                  title={
                    <>
                      Toolbar icon opens <span className="setting-badge">Experimental</span>
                    </>
                  }
                  description="Choose whether clicking the Lenses icon opens the compact popup or the side panel."
                  value={settings.experimentalUnifiedPanel ? "sidepanel" : "popup"}
                  onChange={(value) =>
                    updateSetting("experimentalUnifiedPanel", value === "sidepanel")
                  }
                  options={[
                    { value: "popup", label: "Popup" },
                    { value: "sidepanel", label: "Side panel" },
                  ]}
                />
              ) : null}
            </section>
            ) : null}

            <section id="rail" className="settings-section" aria-labelledby="rail-title">
              <div className="card-head">
                <h2 id="rail-title">Right rail</h2>
              </div>
              <div className="settings-card">
                <ToggleRow
                  id="page-dock-enabled"
                  title="Right rail on websites"
                  description="Master switch for the page rail that appears on web pages."
                  checked={settings.pageDockEnabled}
                  onChange={(checked) => updateSetting("pageDockEnabled", checked)}
                />
                <div className="setting-row">
                  <label className="setting-copy" htmlFor="page-dock-visibility-mode">
                    <span className="setting-title">Right rail visibility</span>
                    <span className="setting-description">
                      Choose whether the rail can appear on every website or only on selected
                      domains.
                    </span>
                  </label>
                  <SelectControl<PageDockVisibilityMode>
                    id="page-dock-visibility-mode"
                    value={settings.pageDockVisibilityMode}
                    disabled={!settings.pageDockEnabled}
                    onChange={(value) => updateSetting("pageDockVisibilityMode", value)}
                    options={[
                      { value: "all", label: "All websites" },
                      { value: "selected", label: "Selected domains" },
                    ]}
                  />
                </div>
                {settings.pageDockVisibilityMode === "selected" ? (
                  <div className="setting-row setting-row-stack">
                    <label className="setting-copy" htmlFor="page-dock-allowed-domains">
                      <span className="setting-title">Visible domains</span>
                      <span className="setting-description">
                        One domain per line. Subdomains are included automatically.
                      </span>
                    </label>
                    <textarea
                      id="page-dock-allowed-domains"
                      className="domain-list-textarea"
                      rows={4}
                      value={listToInput(settings.pageDockAllowedDomains)}
                      placeholder="nytimes.com"
                      disabled={!settings.pageDockEnabled}
                      onChange={(event) =>
                        updateSetting("pageDockAllowedDomains", parseListInput(event.target.value))
                      }
                    />
                  </div>
                ) : null}
                <div className="setting-row setting-row-stack">
                  <label className="setting-copy" htmlFor="page-dock-disabled-hosts">
                    <span className="setting-title">Hidden sites</span>
                    <span className="setting-description">
                      Sites hidden from the rail menu. Entries are exact hosts.
                    </span>
                  </label>
                  <textarea
                    id="page-dock-disabled-hosts"
                    className="domain-list-textarea"
                    rows={3}
                    value={listToInput(settings.pageDockDisabledHosts)}
                    placeholder="en.wikipedia.org"
                    disabled={!settings.pageDockEnabled}
                    onChange={(event) =>
                      updateSetting("pageDockDisabledHosts", parseListInput(event.target.value))
                    }
                  />
                </div>
              </div>
            </section>

            <section
              id="selection-popup"
              className="settings-section"
              aria-labelledby="selection-popup-title"
            >
              <div className="card-head">
                <h2 id="selection-popup-title">Selection popup</h2>
              </div>
              <div className="settings-card">
                <ToggleRow
                  id="selection-trigger-enabled"
                  title="Selection popup on websites"
                  description="Master switch for the popup that offers actions when you select text."
                  checked={settings.selectionTriggerEnabled}
                  onChange={(checked) => updateSetting("selectionTriggerEnabled", checked)}
                />
                {/* Contest builds pin chat actions to the side panel (the
                    floating chatbox is excluded), so the choice disappears. */}
                {!CONTEST_BUILD ? (
                  <ToggleRow
                    id="chat-actions-use-side-panel"
                    title="Open chat actions in side panel"
                    description="Selection and highlight chat actions use the side panel instead of the floating chat above text."
                    checked={settings.chatActionsUseSidePanel}
                    onChange={(checked) => updateSetting("chatActionsUseSidePanel", checked)}
                  />
                ) : null}
                <div className="setting-row">
                  <label className="setting-copy" htmlFor="selection-trigger-style">
                    <span className="setting-title">How it appears</span>
                    <span className="setting-description">
                      Immediate shows it as soon as you select. Hold ⌥ only shows it when you
                      finish selecting with Option held.
                    </span>
                  </label>
                  <SelectControl<SelectionTriggerStyle>
                    id="selection-trigger-style"
                    value={settings.selectionTriggerStyle}
                    disabled={!settings.selectionTriggerEnabled}
                    onChange={(value) => updateSetting("selectionTriggerStyle", value)}
                    options={[
                      { value: "immediate", label: "Immediate" },
                      { value: "modifier", label: "Hold ⌥ (Option)" },
                    ]}
                  />
                </div>
                <div className="setting-row setting-row-stack">
                  <div className="setting-copy">
                    <span className="setting-title">Per-domain behavior</span>
                    <span className="setting-description">
                      Override how the popup appears on specific domains. Subdomains are included
                      automatically; the default above applies everywhere else.
                    </span>
                  </div>
                  <div className="domain-style-rules">
                    {domainStyleRules.length > 0 ? (
                      <div className="domain-style-rule-list">
                        {domainStyleRules.map((rule, index) => (
                          <div className="domain-style-rule" key={index}>
                            <input
                              type="text"
                              className="domain-style-rule-domain"
                              value={rule.domain}
                              placeholder="nytimes.com"
                              spellCheck={false}
                              autoCapitalize="none"
                              disabled={!settings.selectionTriggerEnabled}
                              aria-label="Domain"
                              onChange={(event) =>
                                updateDomainStyleRule(index, { domain: event.target.value })
                              }
                            />
                            <SelectControl<SelectionTriggerStyle>
                              value={rule.style === "manual" ? "modifier" : rule.style}
                              disabled={!settings.selectionTriggerEnabled}
                              onChange={(value) => updateDomainStyleRule(index, { style: value })}
                              options={[
                                { value: "immediate", label: "Immediate" },
                                { value: "modifier", label: "Hold ⌥" },
                              ]}
                            />
                            <button
                              type="button"
                              className="domain-style-rule-remove"
                              aria-label={`Remove override for ${rule.domain || "domain"}`}
                              disabled={!settings.selectionTriggerEnabled}
                              onClick={() => removeDomainStyleRule(index)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="domain-style-add"
                      disabled={!settings.selectionTriggerEnabled}
                      onClick={addDomainStyleRule}
                    >
                      + Add domain
                    </button>
                  </div>
                </div>
                <div className="setting-row">
                  <label className="setting-copy" htmlFor="selection-trigger-visibility-mode">
                    <span className="setting-title">Selection popup visibility</span>
                    <span className="setting-description">
                      Choose whether the popup can appear on every website or only on selected
                      domains.
                    </span>
                  </label>
                  <SelectControl<SelectionTriggerVisibilityMode>
                    id="selection-trigger-visibility-mode"
                    value={settings.selectionTriggerVisibilityMode}
                    disabled={!settings.selectionTriggerEnabled}
                    onChange={(value) => updateSetting("selectionTriggerVisibilityMode", value)}
                    options={[
                      { value: "all", label: "All websites" },
                      { value: "selected", label: "Selected domains" },
                    ]}
                  />
                </div>
                {settings.selectionTriggerVisibilityMode === "selected" ? (
                  <div className="setting-row setting-row-stack">
                    <label className="setting-copy" htmlFor="selection-trigger-allowed-domains">
                      <span className="setting-title">Visible domains</span>
                      <span className="setting-description">
                        One domain per line. Subdomains are included automatically.
                      </span>
                    </label>
                    <textarea
                      id="selection-trigger-allowed-domains"
                      className="domain-list-textarea"
                      rows={4}
                      value={listToInput(settings.selectionTriggerAllowedDomains)}
                      placeholder="nytimes.com"
                      disabled={!settings.selectionTriggerEnabled}
                      onChange={(event) =>
                        updateSetting(
                          "selectionTriggerAllowedDomains",
                          parseListInput(event.target.value)
                        )
                      }
                    />
                  </div>
                ) : null}
                <div className="setting-row setting-row-stack">
                  <label className="setting-copy" htmlFor="selection-trigger-disabled-hosts">
                    <span className="setting-title">Hidden sites</span>
                    <span className="setting-description">
                      Sites where the popup never appears. Entries are exact hosts.
                    </span>
                  </label>
                  <textarea
                    id="selection-trigger-disabled-hosts"
                    className="domain-list-textarea"
                    rows={3}
                    value={listToInput(settings.selectionTriggerDisabledHosts)}
                    placeholder="mail.google.com"
                    disabled={!settings.selectionTriggerEnabled}
                    onChange={(event) =>
                      updateSetting(
                        "selectionTriggerDisabledHosts",
                        parseListInput(event.target.value)
                      )
                    }
                  />
                </div>
              </div>
            </section>
          </>
        ) : null}

        {section === "appearance" ? (
          <section id="appearance" className="settings-card">
            <div className="setting-row">
              <label className="setting-copy" htmlFor="theme-select">
                <span className="setting-title">Theme</span>
                <span className="setting-description">
                  Choose a fixed theme or follow the system appearance.
                </span>
              </label>
              <SelectControl
                id="theme-select"
                value={settings.theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
          </section>
        ) : null}

      </form>

      <div
        id="status"
        className={`save-indicator ${status.message ? "visible" : ""} ${
          status.isError ? "error" : ""
        } ${status.isSuccess ? "success" : ""}`}
        role="status"
        aria-live="polite"
      >
        {status.message}
      </div>
    </section>
  );
}

function SettingsSidebar({
  route,
  lensLibrary,
  onNavigate,
}: {
  route: Route;
  lensLibrary: LensLibrary;
  onNavigate: () => void;
}) {
  const activeSection = route.view === "settings" ? route.section : undefined;
  const activeLensId = route.view === "lenses" ? route.lensId : undefined;

  // The user vs. built-in split mirrors Obsidian Web Clipper's "Templates"
  // section: user-authored lenses (and the unsaved draft) sit at the top where
  // they're easy to reach, with built-ins listed below as a reference set.
  const userLenses = lensLibrary.lenses.filter((lens) => !lens.isBuiltIn);
  const builtInLenses = lensLibrary.lenses.filter((lens) => lens.isBuiltIn);
  const reorderUserLens = useCallback(
    async (draggedLensId: string, targetLensId: string, placement: DropPlacement) => {
      const currentIds = userLenses.map((lens) => lens.config.id);
      const nextIds = moveLensId(currentIds, draggedLensId, targetLensId, placement);
      if (sameOrder(currentIds, nextIds)) return;
      try {
        await lensLibrary.reorderUserLenses(nextIds);
      } catch (caught) {
        window.alert(formatError(caught));
      }
    },
    [lensLibrary, userLenses]
  );

  const reorderBuiltInLens = useCallback(
    async (draggedLensId: string, targetLensId: string, placement: DropPlacement) => {
      const currentIds = builtInLenses.map((lens) => lens.config.id);
      const nextIds = moveLensId(currentIds, draggedLensId, targetLensId, placement);
      if (sameOrder(currentIds, nextIds)) return;
      try {
        await lensLibrary.reorderBuiltInLenses(nextIds);
      } catch (caught) {
        window.alert(formatError(caught));
      }
    },
    [builtInLenses, lensLibrary]
  );

  const eraseLens = useCallback(
    async (lens: LensLibrary["lenses"][number]) => {
      const name = lens.config.name || lens.config.id;
      if (!window.confirm(`Are you sure you want to delete the lens "${name}"?`)) return;
      try {
        await lensLibrary.eraseLens(lens.config.id);
        if (activeLensId === lens.config.id) {
          window.location.hash = "#lenses";
        }
      } catch (caught) {
        window.alert(formatError(caught));
      }
    },
    [activeLensId, lensLibrary]
  );

  const goToNewLens = useCallback(() => {
    window.location.hash = `#lenses/${NEW_LENS_ROUTE}`;
    onNavigate();
  }, [onNavigate]);

  return (
    <aside className="settings-sidebar" aria-label="Settings navigation">
      <div className="sidebar-brand">
        <BrandMark />
        <span>Settings</span>
      </div>

      <nav className="settings-nav">
        <NavItem
          href="#general"
          active={activeSection === "general"}
          icon={MixerHorizontalIcon}
          label="General"
          onClick={onNavigate}
        />
        <NavItem
          href="#ai"
          active={activeSection === "ai"}
          icon={IdCardIcon}
          label="AI"
          onClick={onNavigate}
        />
        <NavItem
          href="#appearance"
          active={activeSection === "appearance"}
          icon={ColorWheelIcon}
          label="Appearance"
          onClick={onNavigate}
        />
      </nav>

      <div className="sidebar-section-label">Lenses</div>

      <button type="button" className="sidebar-new-lens" onClick={goToNewLens}>
        New lens
      </button>

      {lensLibrary.error ? (
        <p className="sidebar-lens-error">{lensLibrary.error}</p>
      ) : null}

      {activeLensId === NEW_LENS_ROUTE ? (
        <SidebarLensList lenses={[]} activeLensId={undefined} onNavigate={onNavigate}>
          <div className="sidebar-lens-row active">
            <span className="sidebar-lens-name">New lens</span>
            <span className="sidebar-lens-badge">unsaved</span>
          </div>
        </SidebarLensList>
      ) : null}

      <SidebarLensGroup
        lenses={userLenses}
        activeLensId={activeLensId}
        onNavigate={onNavigate}
        onDeleteLens={eraseLens}
        onReorderLens={reorderUserLens}
      />

      {builtInLenses.length > 0 ? (
        <>
          <div className="sidebar-section-label muted">Built-in</div>
          <SidebarLensGroup
            lenses={builtInLenses}
            activeLensId={activeLensId}
            onNavigate={onNavigate}
            onDeleteLens={eraseLens}
            onReorderLens={reorderBuiltInLens}
          />
        </>
      ) : null}
    </aside>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img
        src="icons/icon-256.png"
        srcSet="icons/icon-256.png 1x, icons/icon-512.png 2x"
        width="32"
        height="32"
        alt=""
      />
    </span>
  );
}

function SidebarLensList({
  lenses,
  activeLensId,
  onNavigate,
  onDeleteLens,
  onReorderLens,
  children,
}: {
  lenses: LensLibrary["lenses"];
  activeLensId: string | undefined;
  onNavigate: () => void;
  onDeleteLens?: (lens: LensLibrary["lenses"][number]) => void;
  onReorderLens?: (
    draggedLensId: string,
    targetLensId: string,
    placement: DropPlacement
  ) => void;
  children?: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [draggingLensId, setDraggingLensId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const lensIds = useMemo(() => lenses.map((lens) => lens.config.id), [lenses]);
  const navigateToLens = useCallback(
    (lensId: string) => {
      window.location.hash = `#lenses/${encodeURIComponent(lensId)}`;
      onNavigate();
    },
    [onNavigate]
  );

  const onDragStart = (event: ReactDragEvent<HTMLDivElement>, lensId: string) => {
    if (!onReorderLens) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", lensId);
    setDraggingLensId(lensId);
  };

  useEffect(() => {
    if (!draggingLensId || !onReorderLens) return;

    const onWindowDragOver = (event: DragEvent) => {
      const targetNode = event.target instanceof Node ? event.target : null;
      if (targetNode && listRef.current?.contains(targetNode)) return;

      const target = dropTargetForListPoint(listRef.current, event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      setDropTarget(target);
    };

    const onWindowDrop = (event: DragEvent) => {
      const targetNode = event.target instanceof Node ? event.target : null;
      if (targetNode && listRef.current?.contains(targetNode)) return;

      const target = dropTargetForListPoint(listRef.current, event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      setDraggingLensId(null);
      setDropTarget(null);
      if (!lensIds.includes(draggingLensId) || draggingLensId === target.lensId) return;
      onReorderLens(draggingLensId, target.lensId, target.placement);
    };

    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [draggingLensId, lensIds, onReorderLens]);

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!onReorderLens || !draggingLensId || !lensIds.includes(draggingLensId)) return;
    const target = dropTargetForListEvent(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };

  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!onReorderLens) return;
    const draggedLensId = draggingLensId || event.dataTransfer.getData("text/plain");
    if (!draggedLensId || !lensIds.includes(draggedLensId)) return;
    const target = dropTargetForListEvent(event) ?? dropTarget;
    if (!target) return;
    event.preventDefault();
    setDraggingLensId(null);
    setDropTarget(null);
    if (draggedLensId === target.lensId) return;
    onReorderLens(draggedLensId, target.lensId, target.placement);
  };

  return (
    <div
      ref={listRef}
      className="sidebar-lens-list"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
      {lenses.map((lens) => {
        const lensId = lens.config.id;
        const active = activeLensId === lensId;
        const editable = Boolean(onDeleteLens || onReorderLens);
        const targetClass =
          dropTarget?.lensId === lensId ? `drop-${dropTarget.placement}` : "";

        if (editable) {
          return (
            <div
              key={lensId}
              className={[
                "sidebar-lens-entry",
                active ? "active" : "",
                draggingLensId === lensId ? "dragging" : "",
                targetClass,
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={Boolean(onReorderLens)}
              data-sidebar-lens-id={lensId}
              onClick={() => navigateToLens(lensId)}
              onDragStart={(event) => onDragStart(event, lensId)}
              onDragEnd={() => {
                setDraggingLensId(null);
                setDropTarget(null);
              }}
            >
              <span className="sidebar-lens-handle" aria-hidden="true" />
              <a
                href={`#lenses/${encodeURIComponent(lensId)}`}
                className="sidebar-lens-row sidebar-lens-link"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate();
                }}
                draggable={false}
              >
                <span className="sidebar-lens-name">{lens.config.name}</span>
                {!lens.config.visible ? (
                  <span className="sidebar-lens-badge muted">hidden</span>
                ) : null}
              </a>
              {onDeleteLens ? (
                <button
                  type="button"
                  className="sidebar-lens-delete"
                  aria-label={`Delete ${lens.config.name}`}
                  title={`Delete ${lens.config.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteLens(lens);
                  }}
                >
                  <TrashIcon aria-hidden="true" focusable="false" />
                </button>
              ) : null}
            </div>
          );
        }

        return (
          <a
            key={lensId}
            href={`#lenses/${encodeURIComponent(lensId)}`}
            className={`sidebar-lens-row ${active ? "active" : ""}`}
            onClick={onNavigate}
          >
            <span className="sidebar-lens-name">{lens.config.name}</span>
            {!lens.config.visible ? (
              <span className="sidebar-lens-badge muted">hidden</span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

function SidebarLensGroup({
  lenses,
  activeLensId,
  onNavigate,
  onDeleteLens,
  onReorderLens,
}: {
  lenses: LensLibrary["lenses"];
  activeLensId: string | undefined;
  onNavigate: () => void;
  onDeleteLens?: (lens: LensLibrary["lenses"][number]) => void;
  onReorderLens?: (
    draggedLensId: string,
    targetLensId: string,
    placement: DropPlacement
  ) => void;
}) {
  if (lenses.length === 0) return null;

  return (
    <SidebarLensList
      lenses={lenses}
      activeLensId={activeLensId}
      onNavigate={onNavigate}
      onDeleteLens={onDeleteLens}
      onReorderLens={onReorderLens}
    />
  );
}

function dropTargetForListEvent(event: ReactDragEvent<HTMLDivElement>): DropTarget | null {
  return dropTargetForListY(event.currentTarget, event.clientY);
}

function dropTargetForListPoint(
  list: HTMLElement | null,
  clientX: number,
  clientY: number
): DropTarget | null {
  if (!list) return null;
  const rect = list.getBoundingClientRect();
  const horizontalSlop = 12;
  if (clientX < rect.left - horizontalSlop || clientX > rect.right + horizontalSlop) {
    return null;
  }
  return dropTargetForListY(list, clientY);
}

function dropTargetForListY(list: HTMLElement, clientY: number): DropTarget | null {
  const rows = Array.from(
    list.querySelectorAll<HTMLElement>("[data-sidebar-lens-id]")
  );
  for (const row of rows) {
    const lensId = row.dataset.sidebarLensId;
    if (!lensId) continue;
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { lensId, placement: "before" };
    }
  }
  const lastRow = rows.at(-1);
  const lensId = lastRow?.dataset.sidebarLensId;
  return lensId ? { lensId, placement: "after" } : null;
}

function moveLensId(
  lensIds: readonly string[],
  draggedLensId: string,
  targetLensId: string,
  placement: DropPlacement
): string[] {
  const withoutDragged = lensIds.filter((lensId) => lensId !== draggedLensId);
  const targetIndex = withoutDragged.indexOf(targetLensId);
  if (targetIndex < 0) return [...lensIds];
  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  const next = [...withoutDragged];
  next.splice(insertIndex, 0, draggedLensId);
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function NavItem({
  href,
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  href: string;
  icon: typeof MixerHorizontalIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      className={`nav-item ${active ? "active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="nav-icon" aria-hidden="true">
        <Icon focusable="false" />
      </span>
      <span>{label}</span>
    </a>
  );
}

function ApiKeyField({
  title,
  description,
  href,
  linkText,
  inputId,
  placeholder,
  ariaLabel,
  value,
  onChange,
}: {
  title: string;
  description: string;
  href: string;
  linkText: string;
  inputId: string;
  placeholder: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-title">{title}</span>
        <span className="setting-description">{description}</span>
        <a className="provider-link" href={href} target="_blank" rel="noreferrer">
          {linkText}
        </a>
      </div>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ModelSelect({
  id,
  title,
  description,
  models,
  value,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  models: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="setting-row">
      <label className="setting-copy" htmlFor={id}>
        <span className="setting-title">{title}</span>
        <span className="setting-description">{description}</span>
      </label>
      <SelectControl
        id={id}
        value={value}
        onChange={onChange}
        options={models.map((model) => ({ value: model, label: model }))}
      />
    </div>
  );
}

function SettingSelectRow<T extends string>({
  id,
  title,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string;
  title: React.ReactNode;
  description: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="setting-row">
      <label className="setting-copy" htmlFor={id}>
        <span className="setting-title">{title}</span>
        <span className="setting-description">{description}</span>
      </label>
      <SelectControl
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
      />
    </div>
  );
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string;
  title: React.ReactNode;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row toggle-row">
      <label className="setting-copy" htmlFor={id}>
        <span className="setting-title">{title}</span>
        <span className="setting-description">{description}</span>
      </label>
      <span className="switch-control">
        <Switch.Root
          id={id}
          className="switch-track"
          checked={checked}
          onCheckedChange={onChange}
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </span>
    </div>
  );
}

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function listToInput(values: readonly string[]): string {
  return values.join("\n");
}
