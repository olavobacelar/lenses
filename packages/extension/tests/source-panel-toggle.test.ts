import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_PANEL_PRESENCE_PORT } from "../src/lib/source-panel-presence";
import { SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE } from "../src/lib/source-panel-url";

// Behavioral coverage for the page dock's "toggle sidebar" action. The bug:
// toggling decided open-vs-close from an in-memory mirror that only stayed
// honest on Chrome 141/142+ (sidePanel.onOpened/onClosed). When the panel was
// opened from the popup or toolbar icon, the mirror said "closed" and the first
// dock click re-opened it (a no-op) instead of closing — so it took two clicks.
// The fix tracks the panel via a live presence port; these tests drive that
// port and assert a single toggle does the right thing.

type Listener = (...args: unknown[]) => unknown;

interface FakePort {
  name: string;
  onDisconnect: { addListener: (cb: Listener) => void };
  disconnect: () => void;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(activeTabs: unknown[] = []) {
  const connectListeners: Listener[] = [];
  const messageListeners: Listener[] = [];
  const activatedListeners: Listener[] = [];
  const updatedListeners: Listener[] = [];
  const panelOpenedListeners: Listener[] = [];
  const panelClosedListeners: Listener[] = [];
  const sentTabMessages: Array<{ tabId: number; message: unknown }> = [];

  const sidePanel = {
    open: vi.fn(async (_options: { tabId: number }) => undefined),
    close: vi.fn(async (_options: { tabId?: number; windowId?: number }) => undefined),
    setOptions: vi.fn(async () => undefined),
    onOpened: { addListener: (cb: Listener) => panelOpenedListeners.push(cb) },
    onClosed: { addListener: (cb: Listener) => panelClosedListeners.push(cb) },
  };

  const chromeMock = {
    runtime: {
      lastError: undefined as undefined | { message: string },
      getURL: (path: string) => `chrome-extension://lenses-test/${path}`,
      onConnect: { addListener: (cb: Listener) => connectListeners.push(cb) },
      onMessage: { addListener: (cb: Listener) => messageListeners.push(cb) },
    },
    tabs: {
      onUpdated: { addListener: (cb: Listener) => updatedListeners.push(cb) },
      onActivated: { addListener: (cb: Listener) => activatedListeners.push(cb) },
      query: vi.fn((_query: unknown, callback?: (tabs: unknown[]) => void) => {
        if (callback) {
          callback([]);
          return undefined;
        }
        return Promise.resolve(activeTabs);
      }),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        windowId: 7,
        url: "https://example.com/story",
      })),
      sendMessage: vi.fn(
        (tabId: number, message: unknown, callback?: () => void) => {
          sentTabMessages.push({ tabId, message });
          callback?.();
        }
      ),
    },
    sidePanel,
  };

  return {
    chromeMock,
    sidePanel,
    sentTabMessages,
    async activateTab(tab: { id: number; windowId: number; url: string }): Promise<void> {
      chromeMock.tabs.get.mockResolvedValueOnce(tab);
      activatedListeners.forEach((cb) => cb({ tabId: tab.id, windowId: tab.windowId }));
      await flush();
    },
    async updateTab(
      tabId: number,
      changeInfo: { url?: string; status?: string },
      tab: { windowId: number; url?: string }
    ): Promise<void> {
      updatedListeners.forEach((cb) => cb(tabId, changeInfo, tab));
      await flush();
    },
    connectPanel(windowId: number): FakePort {
      const disconnectListeners: Listener[] = [];
      const port: FakePort = {
        name: `${SOURCE_PANEL_PRESENCE_PORT}:${windowId}`,
        onDisconnect: { addListener: (cb: Listener) => disconnectListeners.push(cb) },
        disconnect: () => disconnectListeners.forEach((cb) => cb()),
      };
      connectListeners.forEach((cb) => cb(port));
      return port;
    },
    firePanelOpened(info = { path: "sidepanel/sidepanel.html", windowId: 7 }): void {
      panelOpenedListeners.forEach((cb) => cb(info));
    },
    firePanelClosed(info = { path: "sidepanel/sidepanel.html", windowId: 7 }): void {
      panelClosedListeners.forEach((cb) => cb(info));
    },
    // Invokes the message handler and returns immediately, without awaiting any
    // microtasks — lets a test observe what happened synchronously inside the
    // dispatch (e.g. that sidePanel.open() was called in the same tick).
    dispatchAction(
      action: string,
      sender: { tab?: { id?: number; windowId?: number; url?: string } }
    ): void {
      for (const listener of messageListeners) {
        listener({ action }, sender, () => undefined);
      }
    },
    async sendAction(
      action: string,
      sender: { tab?: { id?: number; windowId?: number; url?: string } }
    ): Promise<unknown> {
      let response: unknown;
      const sendResponse = (value: unknown) => {
        response = value;
      };
      for (const listener of messageListeners) {
        listener({ action }, sender, sendResponse);
      }
      await flush();
      return response;
    },
  };
}

async function setup(activeTabs: unknown[] = []) {
  vi.resetModules();
  const harness = createHarness(activeTabs);
  (globalThis as unknown as { chrome: unknown }).chrome = harness.chromeMock;
  const mod = await import("../src/background/source-panel");
  mod.setupSourcePanelHandlers();
  return {
    ...harness,
    openSourcePanelFromActionContext: mod.openSourcePanelFromActionContext,
  };
}

describe("source panel toggle", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("closes in a single toggle when the panel was opened outside the worker", async () => {
    const h = await setup();
    // Panel was opened by the popup/toolbar — the worker only learns about it
    // through the presence port, not an open() call.
    h.connectPanel(7);

    const response = await h.sendAction("toggle-source-panel", {
      tab: { id: 11, windowId: 7 },
    });

    expect(h.sidePanel.close).toHaveBeenCalledWith({ tabId: 11 });
    expect(h.sidePanel.open).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true, open: false });
  });

  it("calls sidePanel.open synchronously within the dispatch to preserve the user gesture", async () => {
    const h = await setup();

    // The dock click reaches the worker through runtime.sendMessage carrying a
    // transient user activation. open() must run in the same synchronous tick —
    // any `await` before it loses the gesture and Chrome rejects the open. We
    // assert open() was already called before yielding to a single microtask.
    h.dispatchAction("toggle-source-panel", { tab: { id: 11, windowId: 7 } });

    expect(h.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 });
  });

  it("opens from the action context menu before awaiting side panel setup", async () => {
    const h = await setup();

    const result = h.openSourcePanelFromActionContext({
      id: 11,
      windowId: 7,
      url: "https://example.com/story",
    } as chrome.tabs.Tab);

    expect(h.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 11,
      path: "sidepanel/sidepanel.html",
      enabled: true,
    });
    expect(h.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 });
    await expect(result).resolves.toEqual({ success: true });
  });

  it("opens in a single toggle when no panel is connected for the window", async () => {
    const h = await setup();

    const response = await h.sendAction("toggle-source-panel", {
      tab: { id: 11, windowId: 7 },
    });

    expect(h.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 });
    expect(h.sidePanel.close).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true, open: true });
  });

  it("does not treat a panel in another window as open for this window", async () => {
    const h = await setup();
    h.connectPanel(99);

    const response = await h.sendAction("toggle-source-panel", {
      tab: { id: 11, windowId: 7 },
    });

    expect(h.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 });
    expect(response).toEqual({ success: true, open: true });
  });

  it("reports open state per window for the page dock to read on mount", async () => {
    const h = await setup();
    h.connectPanel(7);

    const openInWindow = await h.sendAction("get-source-panel-state", {
      tab: { id: 11, windowId: 7 },
    });
    const openInOtherWindow = await h.sendAction("get-source-panel-state", {
      tab: { id: 22, windowId: 8 },
    });

    expect(openInWindow).toEqual({ success: true, open: true });
    expect(openInOtherWindow).toEqual({ success: true, open: false });
  });

  it("falls back to opening once the panel's presence port disconnects", async () => {
    const h = await setup();
    const port = h.connectPanel(7);

    port.disconnect();

    const response = await h.sendAction("toggle-source-panel", {
      tab: { id: 11, windowId: 7 },
    });

    expect(h.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 });
    expect(response).toEqual({ success: true, open: true });
  });

  it("notifies the window's tabs when panel presence changes", async () => {
    const h = await setup();
    h.chromeMock.tabs.query.mockImplementation(
      (_query: unknown, callback?: (tabs: unknown[]) => void) => {
        callback?.([{ id: 11 }, { id: 12 }]);
        return undefined;
      }
    );

    const port = h.connectPanel(7);
    expect(h.sentTabMessages).toContainEqual({
      tabId: 11,
      message: { type: "source-panel-state", open: true },
    });

    h.sentTabMessages.length = 0;
    port.disconnect();
    expect(h.sentTabMessages).toContainEqual({
      tabId: 12,
      message: { type: "source-panel-state", open: false },
    });
  });

  it("uses sidePanel close events to re-show the page rail even if the panel document lingers", async () => {
    const h = await setup();
    h.chromeMock.tabs.query.mockImplementation(
      (_query: unknown, callback?: (tabs: unknown[]) => void) => {
        callback?.([{ id: 11 }, { id: 12 }]);
        return undefined;
      }
    );
    h.connectPanel(7);
    h.sentTabMessages.length = 0;

    h.firePanelClosed();

    expect(h.sentTabMessages).toContainEqual({
      tabId: 11,
      message: { type: "source-panel-state", open: false },
    });
    const response = await h.sendAction("get-source-panel-state", {
      tab: { id: 11, windowId: 7 },
    });
    expect(response).toEqual({ success: true, open: false });
  });

  it("uses sidePanel open events as an authoritative open signal before a presence port connects", async () => {
    const h = await setup();

    h.firePanelOpened();

    const response = await h.sendAction("get-source-panel-state", {
      tab: { id: 11, windowId: 7 },
    });
    expect(response).toEqual({ success: true, open: true });
  });

  it("closes and disables the source panel when the Lenses settings tab becomes active", async () => {
    const h = await setup();
    h.connectPanel(7);

    await h.activateTab({
      id: 33,
      windowId: 7,
      url: "chrome-extension://lenses-test/settings.html#general",
    });

    expect(h.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 33, enabled: false });
    expect(h.sidePanel.close).toHaveBeenCalledWith({ windowId: 7 });

    const response = await h.sendAction("get-source-panel-state", {
      tab: { id: 33, windowId: 7 },
    });
    expect(response).toEqual({ success: true, open: false });
  });

  it("keeps the source panel available on browser pages so it can explain the unsupported state", async () => {
    const h = await setup();

    await h.activateTab({
      id: 44,
      windowId: 7,
      url: "chrome://extensions/",
    });

    expect(h.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 44,
      path: "sidepanel/sidepanel.html",
      enabled: true,
    });
    expect(h.sidePanel.close).not.toHaveBeenCalled();
  });

  it("refuses direct opens on the Lenses settings page", async () => {
    const h = await setup();

    const response = await h.sendAction("open-source-panel", {
      tab: {
        id: 33,
        windowId: 7,
        url: "chrome-extension://lenses-test/settings.html#general",
      },
    });

    expect(h.sidePanel.open).not.toHaveBeenCalled();
    expect(h.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 33, enabled: false });
    expect(h.sidePanel.close).toHaveBeenCalledWith({ windowId: 7 });
    expect(response).toEqual({ error: SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE });
  });

  it("syncs the active settings tab when the worker starts", async () => {
    const h = await setup([
      {
        id: 33,
        windowId: 7,
        url: "chrome-extension://lenses-test/settings.html#general",
      },
    ]);

    await flush();

    expect(h.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 33, enabled: false });
    expect(h.sidePanel.close).toHaveBeenCalledWith({ windowId: 7 });
  });
});
