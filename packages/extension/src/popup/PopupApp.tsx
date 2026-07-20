import { EraserIcon, GearIcon } from "@radix-ui/react-icons";
import { ComposerSection } from "./components/ComposerSection";
import { DebugControls } from "./components/DebugControls";
import { LensPicker } from "./components/LensPicker";
import { StatusView } from "./components/StatusView";
import { ToggleRow } from "./components/ToggleRow";
import { usePopupController } from "./usePopupController";

export function PopupApp() {
  const controller = usePopupController();
  const debugVisible = __INTERNAL_TOOLS__ && controller.storageState.showDebugOptions;
  const headerDomain = controller.domain ?? "Current page";
  const headerPageTitle =
    controller.pageTitle && controller.pageTitle !== headerDomain ? controller.pageTitle : null;
  const headerLabel = headerPageTitle ? `${headerPageTitle} — ${headerDomain}` : headerDomain;

  return (
    <div className="container">
      <header>
        <div className="site-heading">
          {/* Page title is the headline; the domain reads as a quiet source line
              beneath it. A domain-only page has no title, so the domain stands
              alone and is promoted to the headline via `.site-domain:only-child`. */}
          <h1 title={headerLabel}>
            {headerPageTitle ? <span className="site-title">{headerPageTitle}</span> : null}
            <span className="site-domain">{headerDomain}</span>
          </h1>
        </div>
        {/* Utility actions live as quiet icon buttons next to settings, the
            same icon-cluster pattern the side panel header uses. */}
        <div className="header-actions">
          <button
            id="open-source-panel"
            className="icon-btn"
            type="button"
            title="Open source panel"
            aria-label="Open source panel"
            disabled={controller.busy["open-source-panel"]}
            onClick={() => void controller.openSourcePanel()}
          >
            <SidebarPanelIcon />
          </button>
          <button
            id="clear-highlights"
            className="icon-btn"
            type="button"
            title="Clear highlights"
            aria-label="Clear highlights"
            disabled={!!controller.unsupportedPage}
            onClick={() => void controller.clearHighlights()}
          >
            <EraserIcon aria-hidden="true" focusable="false" />
          </button>
          <button
            id="open-settings"
            className="icon-btn"
            type="button"
            title="Settings"
            aria-label="Open settings"
            onClick={controller.openSettings}
          >
            <GearIcon aria-hidden="true" focusable="false" />
          </button>
        </div>
      </header>

      {controller.unsupportedPage ? (
        <UnsupportedPageNotice
          title={controller.unsupportedPage.title}
          message={controller.unsupportedPage.message}
        />
      ) : (
        <>
          <LensPicker
            selectedLensIds={controller.selectedLensIds}
            computingLensIds={controller.computingLensIds}
            settlingLensIds={controller.settlingLensIds}
            pinnedLensIds={controller.pinnedLensIds}
            onLensChecked={controller.setLensChecked}
            onLensPinToggle={controller.toggleLensPin}
            onRun={controller.runSelectedLenses}
          />

          <section className="auto-toggle">
            <p className="section-label">Behavior</p>
            <ToggleRow
              id="auto-run"
              title="Auto-run on page load"
              checked={controller.storageState.autoRun}
              onChange={controller.setAutoRun}
            />
            <ToggleRow
              id="page-dock-enabled"
              title="Page dock on websites"
              checked={controller.storageState.pageDockEnabled}
              onChange={controller.setPageDockEnabled}
            />
            {controller.pageDockSiteDisabled ? (
              <button
                id="enable-page-dock-site"
                className="utility-link"
                type="button"
                disabled={controller.busy["enable-page-dock-site"]}
                onClick={() => void controller.enablePageDockOnCurrentSite()}
              >
                Enable page dock on this site
              </button>
            ) : null}
          </section>

          {/* The free-text composer is the last main control — lens selection and
              behavior settings sit above it, the query box anchors the bottom. */}
          <ComposerSection
            mode={controller.composerMode}
            value={controller.composerInput}
            menuOpen={controller.composerMenuOpen}
            onModeChange={controller.setComposerMode}
            onValueChange={controller.setComposerInput}
            onMenuOpenChange={controller.setComposerMenuOpen}
            onSubmit={controller.submitComposer}
          />
        </>
      )}

      <StatusView status={controller.status} />

      {__INTERNAL_TOOLS__ && !controller.unsupportedPage ? (
        <>
          <section id="debug-panel" className={`debug-panel ${debugVisible ? "" : "hidden"}`}>
            <p className="section-label">Debug</p>
            <ToggleRow
              id="debug-mode"
              title="Debug mode"
              checked={controller.storageState.debugMode}
              onChange={controller.setDebugMode}
            />
          </section>

          <section
            id="debug-view-links"
            className={`debug-view-links ${debugVisible ? "" : "hidden"}`}
          >
            <button
              id="open-page-debug-markdown"
              className="debug-link"
              type="button"
              disabled={controller.busy["open-page-debug-view"]}
              onClick={() => void controller.openPageDebugView()}
            >
              Open page debug view
            </button>
          </section>

          <DebugControls
            visible={debugVisible}
            storePageLenses={controller.storageState.storePageLenses}
            testSourceMaxCitations={controller.storageState.testSourceMaxCitations}
            testSourceUseCache={controller.storageState.testSourceUseCache}
            busy={controller.busy}
            onStorePageLensesChange={controller.setStorePageLenses}
            onMaxCitationsChange={controller.setTestSourceMaxCitations}
            onUseCacheChange={controller.setTestSourceUseCache}
            onRenewSourceCache={controller.renewCache}
            onClearPageStorage={controller.clearPageStorage}
            onOpenFixture={controller.openFixture}
            onCopyFixturePath={controller.copyPath}
            onCopyFixtureText={controller.copyText}
          />
        </>
      ) : null}

      <footer
        id="connection-footer"
        className={`connection-footer ${controller.connectionFooterHidden ? "hidden" : ""}`}
      >
        <div id="connection-status" className="connection disconnected">
          <span className="dot"></span>
          <span id="connection-text">Not connected</span>
        </div>
      </footer>
    </div>
  );
}

function UnsupportedPageNotice({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="unsupported-page" aria-live="polite">
      <div>
        <p className="unsupported-page-label">{title}</p>
        <p className="unsupported-page-message">{message}</p>
      </div>
    </section>
  );
}

// Same panel glyph the page dock uses for its sidebar toggle, so the popup's
// source-panel button reads as the same control across surfaces.
function SidebarPanelIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}
