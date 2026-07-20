import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..");

function readSource(path: string) {
  return readFileSync(join(extensionDir, "src", path), "utf-8");
}

describe("side panel open behavior", () => {
  it("opens directly with the active tab instead of probing the current-window sentinel", () => {
    const actions = readSource("popup/sidePanelActions.ts");

    expect(actions).not.toContain("WINDOW_ID_CURRENT");
    expect(actions).not.toContain("directError");
    expect(actions).toContain("isExtensionOptionsPageUrl(tab?.url, SETTINGS_PAGE_URL)");
    expect(actions).toContain("SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE");
    expect(actions).toContain("await popupSidePanel.open({ tabId: tab.id })");

    const directOpenIndex = actions.indexOf("popupSidePanel.open({ tabId: tab.id })");
    const backgroundFallbackIndex = actions.indexOf("openViaBackground");
    expect(directOpenIndex).toBeGreaterThan(-1);
    expect(backgroundFallbackIndex).toBeGreaterThan(-1);
    expect(directOpenIndex).toBeLessThan(backgroundFallbackIndex);
  });

  it("keeps the popup open and reports panel handoff failures", () => {
    const actions = readSource("popup/sidePanelActions.ts");
    const controller = readSource("popup/usePopupController.ts");

    expect(actions).toContain("return { opened: false, error: message }");
    expect(actions).toContain("window.close();");
    expect(controller).toContain("Could not open side panel: ${result.error}");
  });

  it("leaves toolbar open behavior under the service worker panel-mode setting", () => {
    const sourcePanel = readSource("background/source-panel.ts");
    const serviceWorker = readSource("background/service-worker.ts");

    expect(sourcePanel).not.toContain("openPanelOnActionClick: false");
    expect(serviceWorker).toContain("function applyPanelMode");
    expect(serviceWorker).toContain("chrome.sidePanel.setPanelBehavior");
  });

  it("adds an action context-menu item for the opposite toolbar surface", () => {
    const serviceWorker = readSource("background/service-worker.ts");

    expect(serviceWorker).toContain('const OPEN_ACTION_POPUP_MENU_ID = "open-lenses-main-popup"');
    expect(serviceWorker).toContain('const OPEN_SOURCE_PANEL_MENU_ID = "open-lenses-side-panel"');
    expect(serviceWorker).toContain('title: "Open main popup"');
    expect(serviceWorker).toContain('title: "Open side panel"');
    expect(serviceWorker).toContain('contexts: ["action"]');
    expect(serviceWorker).toContain("visible: unifiedPanelEnabled");
    expect(serviceWorker).toContain("visible: !unifiedPanelEnabled");
    expect(serviceWorker).toContain("function updateActionSurfaceContextMenus");
    expect(serviceWorker).toContain("updateActionSurfaceContextMenus(enabled)");
  });

  it("opens the configured popup from the action menu even when toolbar clicks open the panel", () => {
    const serviceWorker = readSource("background/service-worker.ts");

    expect(serviceWorker).toContain("async function openActionPopupFromContextMenu");
    expect(serviceWorker).toContain("await chrome.action.setPopup({ popup: ACTION_POPUP_PATH })");
    expect(serviceWorker).toContain("await chrome.action.openPopup");
    expect(serviceWorker).toContain('chrome.action.setPopup({ popup: "" }).catch');

    const restoreIndex = serviceWorker.indexOf(
      "await chrome.action.setPopup({ popup: ACTION_POPUP_PATH })"
    );
    const openIndex = serviceWorker.indexOf("await chrome.action.openPopup");
    const clearIndex = serviceWorker.indexOf('chrome.action.setPopup({ popup: "" }).catch');

    expect(restoreIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeLessThan(openIndex);
    expect(openIndex).toBeLessThan(clearIndex);
  });

  it("routes action context-menu clicks to the popup or side panel handlers", () => {
    const serviceWorker = readSource("background/service-worker.ts");

    expect(serviceWorker).toContain("chrome.contextMenus.onClicked.addListener(async (info, tab)");
    expect(serviceWorker).toContain("menuItemId === OPEN_ACTION_POPUP_MENU_ID");
    expect(serviceWorker).toContain("await openActionPopupFromContextMenu(tab)");
    expect(serviceWorker).toContain("menuItemId === OPEN_SOURCE_PANEL_MENU_ID");
    expect(serviceWorker).toContain("await openSourcePanelFromActionContext(tab)");
  });

  it("keeps the internal debug-options action menu item as a normal command", () => {
    const serviceWorker = readSource("background/service-worker.ts");

    expect(serviceWorker).toContain("if (INTERNAL_TOOLS_ENABLED)");
    expect(serviceWorker).toContain(
      'title: showDebugOptions ? "Hide debug options" : "Show debug options"'
    );
    expect(serviceWorker).toContain("updateDebugOptionsMenuTitle(showDebugOptions)");
    expect(serviceWorker).not.toContain('type: "checkbox"');
    expect(serviceWorker).not.toContain("checked: !showDebugOptions");
  });

  it("opens from content-script rail clicks before awaiting side panel setup", () => {
    const sourcePanel = readSource("background/source-panel.ts");

    const enableIndex = sourcePanel.indexOf("const enablePanel = enableSidePanelForTab");
    const openIndex = sourcePanel.indexOf("await sidePanel.open({ tabId: resolvedTabId })");
    const awaitEnableIndex = sourcePanel.indexOf("await enablePanel");

    expect(enableIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(-1);
    expect(awaitEnableIndex).toBeGreaterThan(-1);
    expect(enableIndex).toBeLessThan(openIndex);
    expect(openIndex).toBeLessThan(awaitEnableIndex);
    expect(sourcePanel).not.toContain("await enableSidePanelForTab(resolvedTabId)");
    expect(sourcePanel).toContain("chrome.tabs.onActivated.addListener");
    expect(sourcePanel).toContain("isExtensionOptionsPageUrl(url, SETTINGS_PAGE_URL)");
    expect(sourcePanel).toContain("closeSourcePanelForSettingsTab");
  });

  it("tracks side panel state so the page rail can hide and toggle it closed", () => {
    const sourcePanel = readSource("background/source-panel.ts");
    const pageDock = readSource("content/PageLensDock.tsx");

    expect(pageDock).toContain('action: "toggle-source-panel"');
    expect(pageDock).toContain('action: "get-source-panel-state"');
    expect(pageDock).toContain('"source-panel-state"');
    expect(sourcePanel).toContain('case "toggle-source-panel"');
    expect(sourcePanel).toContain('case "get-source-panel-state"');
    expect(sourcePanel).toContain("toggleSourcePanel");
    // Current Chrome emits sidePanel opened/closed events; the presence port
    // remains the fallback for older/worker-recycled cases.
    expect(sourcePanel).toContain("setupSourcePanelEvents");
    expect(sourcePanel).toContain("sidePanel?.onOpened?.addListener");
    expect(sourcePanel).toContain("sidePanel?.onClosed?.addListener");
    expect(sourcePanel).toContain("chrome.runtime.onConnect.addListener");
    expect(sourcePanel).toContain("SOURCE_PANEL_PRESENCE_PORT");
    expect(sourcePanel).toContain("sourcePanelPortsByWindow");
    expect(sourcePanel).toContain("sourcePanelEventStateByWindow");
    expect(sourcePanel).toContain("isSourcePanelOpenInWindow");
    expect(sourcePanel).toContain("port.onDisconnect.addListener");
    expect(sourcePanel).toContain('type: "source-panel-state"');
    expect(sourcePanel).toContain("await sidePanel.close({ tabId })");
    expect(sourcePanel).toContain("open: false");
    expect(sourcePanel).toContain("open: true");
  });

  it("opens a presence port from the side panel document, keyed by window", () => {
    const entry = readSource("sidepanel/sidepanel.tsx");
    const presence = readSource("sidepanel/lib/panel-presence.ts");

    expect(entry).toContain("connectSourcePanelPresence()");
    expect(presence).toContain("SOURCE_PANEL_PRESENCE_PORT");
    expect(presence).toContain("chrome.runtime.connect");
    expect(presence).toContain("chrome.windows.getCurrent");
    // A forced disconnect (MV3 5-minute cap / worker recycle) must reconnect so
    // the worker's record stays accurate while the panel is still open.
    expect(presence).toContain("scheduleReconnect");
    expect(presence).toContain('window.addEventListener("pagehide"');
  });

  it("uses Radix icons for the top-bar actions", () => {
    // Reload lives on the page row; the gear moved up to the base row cluster.
    const header = readSource("sidepanel/components/Header.tsx");
    const bar = readSource("sidepanel/components/EvidenceBaseBar.tsx");
    const css = readSource("sidepanel/sidepanel.css");

    expect(header).toContain('import { ReloadIcon } from "@radix-ui/react-icons"');
    expect(header).toContain("<ReloadIcon aria-hidden");
    expect(bar).toContain('import { GearIcon } from "@radix-ui/react-icons"');
    expect(bar).toContain("<GearIcon aria-hidden");
    expect(header).not.toContain("&#8635;");
    expect(header).not.toContain("&#9881;");
    expect(css).toContain(".icon-btn svg");
    expect(css).toContain("width: 16px");
    expect(css).toContain("height: 16px");
  });

});
