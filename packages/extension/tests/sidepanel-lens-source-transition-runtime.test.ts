// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const chromeMocks = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(),
  sendToActiveTab: vi.fn(async () => ({})),
}));

vi.mock("../src/sidepanel/lib/chrome.js", () => ({
  openOptionsPage: vi.fn(),
  sendRuntimeMessage: chromeMocks.sendRuntimeMessage,
  sendToActiveTab: chromeMocks.sendToActiveTab,
}));

import { useLensRuns } from "../src/sidepanel/hooks/useLensRuns.js";
import type { PanelSource } from "../src/sidepanel/types.js";

const CLAIM_LENS_IDS = ["claim-extractor"] as const;
const sourceA = source("a");
const sourceB = source("b");

describe("lens runs across source transitions", () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    chromeMocks.sendRuntimeMessage.mockReset();
    chromeMocks.sendToActiveTab.mockClear();
  });

  it("does not repopulate the new source with stopped state from an aborted old run", async () => {
    let releaseOldRun: ((value: unknown) => void) | null = null;
    chromeMocks.sendRuntimeMessage.mockImplementation((message: { type?: string }) => {
      if (message.type === "run") {
        return new Promise((resolve) => {
          releaseOldRun = resolve;
        });
      }
      if (message.type === "get-source-findings") return Promise.resolve({ runs: [] });
      return Promise.resolve({});
    });

    const probe = await mountLensRuns(sourceA);
    let oldRun: Promise<void> | null = null;
    act(() => {
      oldRun = probe.current.runLensIdsChunked(CLAIM_LENS_IDS);
    });
    await waitFor(() => probe.current.allSections[0]?.clientStatus === "running");

    await probe.render(sourceB);
    await act(async () => {
      await oldRun;
      await nextTask();
    });

    expect(probe.current.allSections).toEqual([]);

    // Settle the abandoned transport promise so the test leaves no pending
    // work even though the hook correctly stopped observing it on abort.
    releaseOldRun?.({ findings: [] });
  });

  async function mountLensRuns(initialSource: PanelSource) {
    let current: ReturnType<typeof useLensRuns> | null = null;
    const showWarning = vi.fn();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

    function Probe({ activeSource }: { activeSource: PanelSource }) {
      current = useLensRuns({
        source: activeSource,
        transcript: [],
        activeTabId: null,
        showWarning,
        dedicatedLensIds: CLAIM_LENS_IDS,
      });
      return createElement("div", null, current.allSections.length);
    }

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Probe, { activeSource: initialSource }));
      await nextTask();
    });

    return {
      get current() {
        if (!current) throw new Error("Lens-run probe did not mount");
        return current;
      },
      render: async (activeSource: PanelSource) => {
        await act(async () => {
          root?.render(createElement(Probe, { activeSource }));
          await nextTask();
        });
      },
    };
  }
});

function source(key: string): PanelSource {
  return {
    key: `web:${key}`,
    kind: "web_page",
    title: `Source ${key.toUpperCase()}`,
    url: `https://example.com/${key}`,
    text: `A factual statement from source ${key}.`,
    scope: "page",
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await act(async () => {
      await nextTask();
    });
  }
  throw new Error("Timed out waiting for condition");
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
