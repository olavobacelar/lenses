import { SOURCE_PANEL_PRESENCE_PORT } from "../lib/source-panel-presence";
import {
  isExtensionOptionsPageUrl,
  SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE,
} from "../lib/source-panel-url";

type SidePanelApi = {
  setOptions(options: { tabId: number; path?: string; enabled: boolean }): Promise<void>;
  open(options: { tabId: number }): Promise<void>;
  close?(options: { tabId?: number; windowId?: number }): Promise<void>;
  onClosed?: {
    addListener(callback: (info: { path: string; tabId?: number; windowId: number }) => void): void;
  };
  onOpened?: {
    addListener(callback: (info: { path: string; tabId?: number; windowId: number }) => void): void;
  };
};

const sidePanel = (chrome as typeof chrome & { sidePanel?: SidePanelApi }).sidePanel;
const SOURCE_PANEL_PATH = "sidepanel/sidepanel.html";
const SETTINGS_PAGE_URL = chrome.runtime.getURL("settings.html");

// Windows whose side panel is currently open. Current Chrome provides explicit
// sidePanel open/close events, which are the only reliable signal when the user
// manually closes the browser side panel. The live presence port remains a
// fallback for older Chrome builds and service-worker restarts where an already
// open panel needs to announce itself again.
const sourcePanelPortsByWindow = new Map<number, Set<chrome.runtime.Port>>();
const sourcePanelEventStateByWindow = new Map<number, boolean>();

export function setupSourcePanelHandlers(): void {
  setupSourcePanelOptions();
  setupSourcePanelEvents();
  setupSourcePanelPresence();
  setupSourcePanelMessages();
}

export async function openSourcePanelFromActionContext(
  tab?: chrome.tabs.Tab
): Promise<{ success: true } | { error: string }> {
  if (!sidePanel) return { error: "Side panel API is not available." };

  if (typeof tab?.id !== "number") {
    return openSourcePanel();
  }

  if (isExtensionOptionsPageUrl(tab.url, SETTINGS_PAGE_URL)) {
    await disableSidePanelForTab(tab.id);
    await closeSourcePanelForSettingsTab(tab.id, tab.windowId);
    return { error: SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE };
  }

  const enableActionPanel = enableSidePanelForTab(tab.id).catch((error) => {
    console.warn("[Lenses] Could not refresh source panel options", error);
  });
  await sidePanel.open({ tabId: tab.id });
  await enableActionPanel;
  return { success: true };
}

function setupSourcePanelOptions(): void {
  if (!sidePanel) return;

  syncActiveSourcePanelTab();

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    const url = tab.url || changeInfo.url;
    syncSourcePanelForTab(tabId, url, tab.windowId).catch((error) => {
      console.warn("[Lenses] Could not update source panel availability", error);
    });
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs
      .get(tabId)
      .then((tab) => syncSourcePanelForTab(tabId, tab.url, tab.windowId))
      .catch((error) => {
        console.warn("[Lenses] Could not update source panel for activated tab", error);
      });
  });
}

function syncActiveSourcePanelTab(): void {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (typeof tab?.id !== "number") return;
      return syncSourcePanelForTab(tab.id, tab.url, tab.windowId);
    })
    .catch((error) => {
      console.warn("[Lenses] Could not update source panel for active tab", error);
    });
}

function setupSourcePanelPresence(): void {
  chrome.runtime.onConnect.addListener((port) => {
    const windowId = parsePresencePortWindowId(port.name);
    if (windowId === null) return;

    trackSourcePanelPort(windowId, port);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      untrackSourcePanelPort(windowId, port);
    });
  });
}

function setupSourcePanelEvents(): void {
  sidePanel?.onOpened?.addListener((info) => {
    if (!isLensesSourcePanelPath(info.path)) return;
    sourcePanelEventStateByWindow.set(info.windowId, true);
    notifyWindowSourcePanelState(info.windowId, true);
  });

  sidePanel?.onClosed?.addListener((info) => {
    if (!isLensesSourcePanelPath(info.path)) return;
    sourcePanelEventStateByWindow.set(info.windowId, false);
    sourcePanelPortsByWindow.delete(info.windowId);
    notifyWindowSourcePanelState(info.windowId, false);
  });
}

function isLensesSourcePanelPath(path: string): boolean {
  return path === SOURCE_PANEL_PATH || path.endsWith(`/${SOURCE_PANEL_PATH}`);
}

function parsePresencePortWindowId(name: string): number | null {
  const prefix = `${SOURCE_PANEL_PRESENCE_PORT}:`;
  if (!name.startsWith(prefix)) return null;
  const windowId = Number(name.slice(prefix.length));
  return Number.isInteger(windowId) ? windowId : null;
}

function trackSourcePanelPort(windowId: number, port: chrome.runtime.Port): void {
  let ports = sourcePanelPortsByWindow.get(windowId);
  if (!ports) {
    ports = new Set();
    sourcePanelPortsByWindow.set(windowId, ports);
  }
  const wasOpen = ports.size > 0;
  ports.add(port);
  if (!wasOpen && !sourcePanelEventStateByWindow.has(windowId)) {
    notifyWindowSourcePanelState(windowId, true);
  }
}

function untrackSourcePanelPort(windowId: number, port: chrome.runtime.Port): void {
  const ports = sourcePanelPortsByWindow.get(windowId);
  if (!ports) return;
  ports.delete(port);
  if (ports.size === 0) {
    sourcePanelPortsByWindow.delete(windowId);
    if (!sourcePanelEventStateByWindow.has(windowId)) {
      notifyWindowSourcePanelState(windowId, false);
    }
  }
}

function isSourcePanelOpenInWindow(windowId: number | undefined): boolean {
  if (typeof windowId !== "number") return false;
  const eventState = sourcePanelEventStateByWindow.get(windowId);
  if (typeof eventState === "boolean") return eventState;
  return (sourcePanelPortsByWindow.get(windowId)?.size ?? 0) > 0;
}

function setupSourcePanelMessages(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("action" in message)) {
      return undefined;
    }

    const action = String((message as { action: unknown }).action);

    switch (action) {
      case "open-source-panel":
        openSourcePanel({
          tabId: (message as { tabId?: number }).tabId ?? sender.tab?.id,
          url: (message as { url?: string }).url ?? sender.tab?.url,
          windowId: sender.tab?.windowId,
        })
          .then(sendResponse)
          .catch((error) =>
            sendResponse({ error: error instanceof Error ? error.message : String(error) })
          );
        return true;

      case "toggle-source-panel":
        toggleSourcePanel(
          (message as { tabId?: number }).tabId ?? sender.tab?.id,
          (message as { windowId?: number }).windowId ?? sender.tab?.windowId,
          sender.tab?.url
        )
          .then(sendResponse)
          .catch((error) =>
            sendResponse({ error: error instanceof Error ? error.message : String(error) })
          );
        return true;

      case "get-source-panel-state": {
        const windowId = (message as { windowId?: number }).windowId ?? sender.tab?.windowId;
        sendResponse({ success: true, open: isSourcePanelOpenInWindow(windowId) });
        return true;
      }

      default:
        return undefined;
    }
  });
}

interface SourcePanelTarget {
  tabId?: number;
  url?: string;
  windowId?: number;
}

async function openSourcePanel(
  target: SourcePanelTarget = {}
): Promise<{ success: true } | { error: string }> {
  if (!sidePanel) return { error: "Side panel API is not available." };

  const resolvedTabId = target.tabId ?? (await getActiveTabId());
  if (!resolvedTabId) return { error: "No active tab." };

  if (isExtensionOptionsPageUrl(target.url, SETTINGS_PAGE_URL)) {
    await disableSidePanelForTab(resolvedTabId);
    await closeSourcePanelForSettingsTab(resolvedTabId, target.windowId);
    return { error: SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE };
  }

  const enablePanel = enableSidePanelForTab(resolvedTabId).catch((error) => {
    console.warn("[Lenses] Could not refresh source panel options", error);
  });
  await sidePanel.open({ tabId: resolvedTabId });
  await enablePanel;
  return { success: true };
}

async function toggleSourcePanel(
  tabId?: number,
  windowId?: number,
  url?: string
): Promise<{ success: true; open: boolean } | { error: string }> {
  if (!sidePanel) return { error: "Side panel API is not available." };

  let resolvedTabId = tabId;
  let resolvedWindowId = windowId;

  // chrome.sidePanel.open() may only be called in the same synchronous tick as
  // the user gesture that reached this handler — any `await` before it drops the
  // transient user activation and Chrome rejects open() with "may only be called
  // in response to a user gesture". The page dock passes its tab and window ids,
  // so in that case we decide open-vs-close with no `await` beforehand. Only when
  // the caller gave us no context (not a dock click) do we resolve the active tab
  // asynchronously, where losing the gesture has no user-visible cost.
  if (typeof resolvedTabId !== "number" || typeof resolvedWindowId !== "number") {
    resolvedTabId = resolvedTabId ?? (await getActiveTabId());
    if (typeof resolvedTabId !== "number") return { error: "No active tab." };
    resolvedWindowId = await resolveWindowId(resolvedTabId, resolvedWindowId);
  }

  if (isSourcePanelOpenInWindow(resolvedWindowId)) {
    return closeSourcePanel(resolvedTabId, resolvedWindowId);
  }

  const result = await openSourcePanel({ tabId: resolvedTabId, url, windowId: resolvedWindowId });
  if ("error" in result) return result;
  return { success: true, open: true };
}

async function closeSourcePanel(
  tabId: number,
  windowId?: number
): Promise<{ success: true; open: false } | { error: string }> {
  if (!sidePanel?.close) {
    return { error: "Side panel close API is not available in this Chrome version." };
  }

  await sidePanel.close({ tabId });
  // The presence port disconnects as the panel document tears down, which clears
  // the window entry. Clear it eagerly too so a rapid re-toggle reads the closed
  // state without waiting on the disconnect round-trip.
  if (typeof windowId === "number") {
    sourcePanelPortsByWindow.delete(windowId);
    notifyWindowSourcePanelState(windowId, false);
  }
  return { success: true, open: false };
}

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function resolveWindowId(tabId: number, windowId?: number): Promise<number | undefined> {
  if (typeof windowId === "number") return windowId;
  try {
    const tab = await chrome.tabs.get(tabId);
    return typeof tab.windowId === "number" ? tab.windowId : undefined;
  } catch {
    return undefined;
  }
}

async function enableSidePanelForTab(tabId: number): Promise<void> {
  if (!sidePanel) return;
  await sidePanel.setOptions({
    tabId,
    path: SOURCE_PANEL_PATH,
    enabled: true,
  });
}

async function disableSidePanelForTab(tabId: number): Promise<void> {
  if (!sidePanel) return;
  await sidePanel.setOptions({
    tabId,
    enabled: false,
  });
}

async function syncSourcePanelForTab(
  tabId: number,
  url: string | undefined,
  windowId: number | undefined
): Promise<void> {
  if (!sidePanel) return;

  if (isExtensionOptionsPageUrl(url, SETTINGS_PAGE_URL)) {
    await disableSidePanelForTab(tabId);
    await closeSourcePanelForSettingsTab(tabId, windowId);
    return;
  }

  await enableSidePanelForTab(tabId);
}

async function closeSourcePanelForSettingsTab(
  tabId: number,
  windowId: number | undefined
): Promise<void> {
  if (!sidePanel?.close) return;

  try {
    await sidePanel.close(typeof windowId === "number" ? { windowId } : { tabId });
  } catch (error) {
    console.warn("[Lenses] Could not close source panel on settings page", error);
  }
  if (typeof windowId === "number" && sourcePanelPortsByWindow.delete(windowId)) {
    notifyWindowSourcePanelState(windowId, false);
  }
}

function notifyWindowSourcePanelState(windowId: number, open: boolean): void {
  chrome.tabs.query({ windowId }, (tabs) => {
    void chrome.runtime.lastError;
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        notifyTabSourcePanelState(tab.id, open);
      }
    }
  });
}

function notifyTabSourcePanelState(tabId: number, open: boolean): void {
  chrome.tabs.sendMessage(tabId, { type: "source-panel-state", open }, () => {
    void chrome.runtime.lastError;
  });
}
