import { SOURCE_PANEL_PRESENCE_PORT } from "../../lib/source-panel-presence";

// Announces this side panel document's lifetime to the service worker so it can
// answer "is the panel open in this window?" without relying on
// sidePanel.onOpened/onClosed (Chrome 141/142+ only). The worker treats the
// panel as open for exactly as long as the port stays connected.
//
// MV3 force-disconnects ports after ~5 minutes to let the worker sleep, and the
// worker may be recycled at any time — both fire onDisconnect even though the
// panel is still open. So every disconnect that isn't this document unloading
// is answered with a reconnect, which keeps the worker's record accurate (and,
// while connected, keeps the worker awake). A real close tears down the
// document, so no reconnect runs.
export function connectSourcePanelPresence(): void {
  let unloading = false;
  let reconnectTimer: number | undefined;
  let cachedWindowId: number | null = null;

  window.addEventListener("pagehide", () => {
    unloading = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  });

  function scheduleReconnect(): void {
    if (unloading || reconnectTimer !== undefined) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, 250);
  }

  async function resolveWindowId(): Promise<number | null> {
    if (cachedWindowId !== null) return cachedWindowId;
    try {
      const win = await chrome.windows.getCurrent();
      cachedWindowId = typeof win.id === "number" ? win.id : null;
    } catch {
      cachedWindowId = null;
    }
    return cachedWindowId;
  }

  async function connect(): Promise<void> {
    if (unloading) return;

    const windowId = await resolveWindowId();
    if (windowId === null || unloading) {
      scheduleReconnect();
      return;
    }

    try {
      const port = chrome.runtime.connect({
        name: `${SOURCE_PANEL_PRESENCE_PORT}:${windowId}`,
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        scheduleReconnect();
      });
    } catch {
      // Worker asleep or context torn down — retry shortly.
      scheduleReconnect();
    }
  }

  void connect();
}
