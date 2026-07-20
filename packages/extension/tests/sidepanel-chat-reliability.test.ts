// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../src/sidepanel/hooks/useChat.js";
import type { PanelSource } from "../src/sidepanel/types.js";

type Listener = (value?: unknown) => void;

interface FakePort {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: () => void;
  fireMessage: (message: unknown) => void;
  fireDisconnect: () => void;
  onMessage: { addListener: (listener: Listener) => void };
  onDisconnect: { addListener: (listener: Listener) => void };
}

function makePort(name: string): FakePort {
  const messageListeners: Listener[] = [];
  const disconnectListeners: Listener[] = [];
  let disconnected = false;

  const fireDisconnect = () => {
    if (disconnected) return;
    disconnected = true;
    disconnectListeners.forEach((listener) => listener());
  };

  return {
    name,
    postMessage: vi.fn(),
    disconnect: fireDisconnect,
    fireMessage: (message) => messageListeners.forEach((listener) => listener(message)),
    fireDisconnect,
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
  };
}

const source: PanelSource = {
  key: "web:example.com/article",
  kind: "web_page",
  title: "Article",
  url: "https://example.com/article",
  text: "Article body",
  scope: "page",
};

const pendingSelectionAsk = {
  question: "Is the selected claim true? Check the evidence and cite it.",
  displayContent: "Check “Selected medical text”",
  context: {
    kind: "selection",
    selectedText: "Selected medical text",
    pageContext: "Surrounding page body",
    selectionMode: "truth",
  },
  createdAt: Date.now(),
} as const;

describe("sidepanel chat reliability", () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("hydrates the conversation before consuming a pending selection ask", async () => {
    let releaseRestore: ((value: unknown) => void) | null = null;
    const ports: FakePort[] = [];
    installChromeMock({
      pendingAsk: pendingSelectionAsk,
      connect: (name) => {
        const port = makePort(name);
        ports.push(port);
        return port;
      },
      getConversation: (reply) => {
        releaseRestore = reply;
      },
    });

    const probe = await mountChat({ activeTabId: 42 });
    await flushReact();

    expect(releaseRestore).not.toBeNull();
    expect(ports).toHaveLength(0);
    expect(probe.current.messages).toEqual([]);

    await act(async () => {
      releaseRestore!({ messages: [] });
      await nextTask();
    });
    await waitFor(() => ports.length === 1);

    expect(probe.current.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(probe.current.messages[0]?.content).toBe(pendingSelectionAsk.displayContent);

    await act(async () => {
      ports[0]!.fireMessage({ type: "done", fullText: "Successful answer" });
    });

    expect(probe.current.messages.at(-1)?.content).toBe("Successful answer");
  });

  it("makes a pre-terminal disconnect visible and retries the exact contextual request", async () => {
    const ports: FakePort[] = [];
    installChromeMock({
      pendingAsk: pendingSelectionAsk,
      connect: (name) => {
        const port = makePort(name);
        ports.push(port);
        return port;
      },
      getConversation: (reply) => reply({ messages: [] }),
    });

    const probe = await mountChat({ activeTabId: 42 });
    await waitFor(() => ports.length === 1);

    const firstRequest = ports[0]!.postMessage.mock.calls[0]?.[0];
    expect(firstRequest).toMatchObject({
      action: "ask-finding-stream",
      question: pendingSelectionAsk.question,
      selectionText: pendingSelectionAsk.context.selectedText,
      pageContext: pendingSelectionAsk.context.pageContext,
      selectionMode: pendingSelectionAsk.context.selectionMode,
    });

    await act(async () => {
      ports[0]!.fireDisconnect();
    });

    const interrupted = probe.current.messages.at(-1);
    expect(probe.current.isStreaming).toBe(false);
    expect(interrupted).toMatchObject({ role: "assistant", isError: true });
    expect(interrupted?.content).toContain("interrupted");

    let retried = false;
    await act(async () => {
      retried = await probe.current.retryFromMessage(interrupted!.id);
    });

    expect(retried).toBe(true);
    expect(ports).toHaveLength(2);
    expect(probe.current.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(probe.current.messages[0]?.content).toBe(pendingSelectionAsk.displayContent);

    const retryRequest = ports[1]!.postMessage.mock.calls[0]?.[0];
    expect(retryRequest).toMatchObject({
      action: "ask-finding-stream",
      question: pendingSelectionAsk.question,
      selectionText: pendingSelectionAsk.context.selectedText,
      pageContext: pendingSelectionAsk.context.pageContext,
      selectionMode: pendingSelectionAsk.context.selectionMode,
    });
  });

  async function mountChat({ activeTabId }: { activeTabId: number | null }) {
    let current: ReturnType<typeof useChat> | null = null;
    const showWarning = vi.fn();
    const onApiKeyMissing = vi.fn();

    function Probe() {
      current = useChat({
        activeTabId,
        source,
        transcript: [],
        currentTime: null,
        showWarning,
        onApiKeyMissing,
      });
      return createElement("div", null, current.messages.length);
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
        if (!current) throw new Error("Chat probe did not mount");
        return current;
      },
    };
  }
});

function installChromeMock({
  pendingAsk,
  connect,
  getConversation,
}: {
  pendingAsk?: typeof pendingSelectionAsk;
  connect: (name: string) => FakePort;
  getConversation: (reply: (value: unknown) => void) => void;
}) {
  let pendingAskAvailable = !!pendingAsk;

  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: {
        lastError: null,
        connect: vi.fn(({ name }: { name: string }) => connect(name)),
        sendMessage: vi.fn(
          (message: { type?: string }, reply: (value: unknown) => void) => {
            if (message.type === "get-conversation") {
              getConversation(reply);
              return;
            }
            reply({});
          }
        ),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            if (key === "pendingAsk:42" && pendingAskAvailable && pendingAsk) {
              return { [key]: pendingAsk };
            }
            return {};
          }),
          remove: vi.fn(async (key: string) => {
            if (key === "pendingAsk:42") pendingAskAvailable = false;
          }),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      tabs: { create: vi.fn() },
    },
  });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) return;
    await flushReact();
  }
  throw new Error("Timed out waiting for condition");
}

async function flushReact() {
  await act(async () => {
    await nextTask();
  });
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
