// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/evidence-bases.js", () => ({
  fingerprintText: vi.fn(async (text: string) => `fingerprint:${text}`),
}));

vi.mock("../src/lib/pdf-source.js", () => ({
  fetchPdfSource: vi.fn(),
  resolvePdfUrl: vi.fn(() => null),
}));

import { useActiveSource } from "../src/sidepanel/hooks/useActiveSource.js";

type ActivatedListener = (activeInfo: { tabId: number; windowId: number }) => void;
type UpdatedListener = (
  tabId: number,
  changeInfo: { url?: string; status?: string }
) => void;

describe("active source runtime transitions", () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("retries a transient empty active-tab query and atomically replaces the source", async () => {
    const tabs = [
      { id: 11, url: "https://example.com/first", title: "First tab" },
      undefined,
      { id: 22, url: "https://example.com/second", title: "Second tab" },
    ];
    const chromeMock = installChromeMock(() => tabs.shift());
    const probe = await mountSource();

    await waitFor(() => probe.current.source?.title === "First page");

    act(() => chromeMock.fireActivated({ tabId: 22, windowId: 1 }));
    await waitFor(() => probe.current.source?.title === "Second page");

    expect(probe.showWarning).not.toHaveBeenCalled();
    expect(chromeMock.query).toHaveBeenLastCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
  });

  it("keeps the last resolved source when Chrome still cannot identify an active tab", async () => {
    let firstQuery = true;
    const chromeMock = installChromeMock(() => {
      if (!firstQuery) return undefined;
      firstQuery = false;
      return { id: 11, url: "https://example.com/first", title: "First tab" };
    });
    const probe = await mountSource();

    await waitFor(() => probe.current.source?.title === "First page");

    act(() => chromeMock.fireActivated({ tabId: 22, windowId: 1 }));
    await waitFor(() => probe.showWarning.mock.calls.length > 0);

    expect(probe.current.source?.title).toBe("First page");
    expect(probe.current.isLoadingSource).toBe(false);
    expect(probe.showWarning).toHaveBeenLastCalledWith("No active tab.");
  });

  async function mountSource() {
    let current: ReturnType<typeof useActiveSource> | null = null;
    const showWarning = vi.fn();
    const hideWarning = vi.fn();

    function Probe() {
      current = useActiveSource({ showWarning, hideWarning });
      return createElement("div", null, current.source?.title ?? "No source");
    }

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Probe));
      await nextTask();
    });

    return {
      get current() {
        if (!current) throw new Error("Source probe did not mount");
        return current;
      },
      showWarning,
    };
  }
});

function installChromeMock(nextTab: () => chrome.tabs.Tab | undefined) {
  const activatedListeners: ActivatedListener[] = [];
  const updatedListeners: UpdatedListener[] = [];
  const query = vi.fn(async () => {
    const tab = nextTab();
    return tab ? [tab] : [];
  });

  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: { lastError: null },
      tabs: {
        query,
        sendMessage: vi.fn(
          (
            tabId: number,
            message: { type?: string; action?: string },
            reply: (value: unknown) => void
          ) => {
            if (message.type === "get-page-text") {
              reply({
                text: `Body for tab ${tabId}`,
                sourceTitle: tabId === 11 ? "First page" : "Second page",
                sourceKey: `web:${tabId}`,
                scope: "page",
              });
              return;
            }
            reply({});
          }
        ),
        onActivated: {
          addListener: (listener: ActivatedListener) => activatedListeners.push(listener),
          removeListener: (listener: ActivatedListener) => {
            const index = activatedListeners.indexOf(listener);
            if (index >= 0) activatedListeners.splice(index, 1);
          },
        },
        onUpdated: {
          addListener: (listener: UpdatedListener) => updatedListeners.push(listener),
          removeListener: (listener: UpdatedListener) => {
            const index = updatedListeners.indexOf(listener);
            if (index >= 0) updatedListeners.splice(index, 1);
          },
        },
      },
    },
  });

  return {
    query,
    fireActivated: (activeInfo: { tabId: number; windowId: number }) =>
      activatedListeners.forEach((listener) => listener(activeInfo)),
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error("Timed out waiting for condition");
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
