import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: any[]) => unknown;

vi.mock("../src/background/api-key-messages", () => ({
  setupApiKeyMessageHandlers: vi.fn(),
}));

vi.mock("../src/background/source-panel", () => ({
  openSourcePanelFromActionContext: vi.fn(async () => ({ success: true })),
  setupSourcePanelHandlers: vi.fn(),
}));

vi.mock("../src/background/source-stream", () => ({
  setupSourceStreamHandlers: vi.fn(),
}));

vi.mock("../src/background/youtube", () => ({
  setupYouTubeHandlers: vi.fn(),
}));

vi.mock("../src/background/local-runtime", () => ({
  askLocalFindingQuestion: vi.fn(),
  clearLocalFindingsForPage: vi.fn(),
  createLocalSavedSelection: vi.fn(),
  deleteLocalSavedSelection: vi.fn(),
  deleteLocalUserLens: vi.fn(),
  generateLocalLensName: vi.fn(),
  getLocalConversation: vi.fn(),
  getLocalDebugData: vi.fn(),
  getLocalStoredRunStates: vi.fn(),
  listLocalLensRows: vi.fn(),
  listLocalSavedSelections: vi.fn(),
  runLocalLens: vi.fn(),
  saveLocalConversation: vi.fn(),
  saveLocalFindings: vi.fn(),
  saveLocalLensConfig: vi.fn(),
  saveLocalUserLens: vi.fn(),
  updateLocalSavedSelection: vi.fn(),
}));

function storageArea(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn((keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
      const result = { ...values };
      if (callback) {
        callback(result);
        return undefined;
      }
      return Promise.resolve(result);
    }),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

function createChromeHarness() {
  const messageListeners: Listener[] = [];
  const sentTabMessages: Array<{ tabId: number; message: unknown }> = [];
  const addListener = vi.fn((listener: Listener) => undefined);
  const local = storageArea();
  const sync = storageArea();

  const chromeMock = {
    action: {
      openPopup: vi.fn(async () => undefined),
      setPopup: vi.fn(async () => undefined),
    },
    commands: { onCommand: { addListener } },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener },
      removeAll: vi.fn((callback?: () => void) => callback?.()),
      update: vi.fn((_id: string, _update: unknown, callback?: () => void) => callback?.()),
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://lenses-test/${path}`,
      lastError: undefined,
      onConnect: { addListener },
      onMessage: {
        addListener: (listener: Listener) => messageListeners.push(listener),
      },
      reload: vi.fn(),
      sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
    },
    storage: {
      local,
      onChanged: { addListener },
      sync,
    },
    tabs: {
      create: vi.fn(async () => undefined),
      get: vi.fn(async (tabId: number) => ({ id: tabId })),
      onUpdated: { addListener },
      query: vi.fn(async () => []),
      sendMessage: vi.fn(
        (tabId: number, message: unknown, callback?: (response: unknown) => void) => {
          sentTabMessages.push({ tabId, message });
          callback?.({ renderedCount: 1, failedAnchorCount: 0 });
        }
      ),
    },
  };

  return {
    chromeMock,
    sentTabMessages,
    async dispatch(message: unknown, tabId: number): Promise<unknown> {
      return new Promise((resolve, reject) => {
        let handled = false;
        for (const listener of messageListeners) {
          const keepChannelOpen = listener(message, { tab: { id: tabId } }, resolve);
          handled ||= keepChannelOpen === true;
        }
        if (!handled) reject(new Error("No runtime listener handled the message"));
      });
    },
  };
}

describe("stored page lens restoration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { __DEV_RELOAD__?: boolean }).__DEV_RELOAD__;
  });

  it("uses freshly reacquired page text because runs do not retain source snapshots", async () => {
    const harness = createChromeHarness();
    (globalThis as { chrome?: unknown }).chrome = harness.chromeMock;
    (globalThis as { __DEV_RELOAD__?: boolean }).__DEV_RELOAD__ = false;

    const localRuntime = await import("../src/background/local-runtime");
    vi.mocked(localRuntime.getLocalStoredRunStates).mockResolvedValue([
      {
        runId: "run-1",
        lensId: "claim-extractor",
        status: "completed",
        createdAt: 1,
        findings: [
          {
            text: "Beta",
            category: "empirical",
            detail: "Stored finding",
            confidence: 0.9,
            sourceSpan: { start: 0, end: 4 },
          },
        ],
      },
    ] as Awaited<ReturnType<typeof localRuntime.getLocalStoredRunStates>>);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await import("../src/background/service-worker");

    const response = await harness.dispatch(
      {
        type: "restore-page-lens-results",
        sourceUrl: "https://www.youtube.com/watch?v=test",
        sourceKey: "youtube:test",
        sourceText: "Beta transcript evidence",
      },
      42
    );

    expect(response).toEqual({
      restoredLenses: 1,
      results: [
        {
          lensId: "claim-extractor",
          findingCount: 1,
          renderedCount: 1,
          failedAnchorCount: 0,
        },
      ],
    });
    expect(harness.sentTabMessages).toContainEqual({
      tabId: 42,
      message: expect.objectContaining({
        type: "highlight",
        lensId: "claim-extractor",
        sourceText: "Beta transcript evidence",
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
