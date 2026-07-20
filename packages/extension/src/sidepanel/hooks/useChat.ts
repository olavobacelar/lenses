import { useCallback, useEffect, useRef, useState } from "react";
import {
  describePendingAskContext,
  isPendingAskFresh,
  parsePendingAsk,
  pendingAskKey,
  type PendingAskContext,
  type PendingAskContextSummary,
} from "../../lib/composer";
import type { ConversationMessage, TextSegment } from "../../types/ai-content";
import type { TranscriptSegment, VideoTime } from "../../types/transcript";
import {
  applyChatStreamEvent,
  createChatStreamState,
  type ChatStreamEvent,
  type ChatStreamState,
  type ChatStreamTextSegment,
} from "../../lib/chat-stream";
import { isApiKeyError } from "../lib/format";
import { legacyConversationStorageKey } from "../../lib/legacy-storage-compat";
import { openApiKeySettings, sendRuntimeMessage } from "../lib/chrome";
import {
  fromSavedConversationMessages,
  sidebarConversationIdentity,
  toSavedConversationMessages,
} from "../lib/conversation";
import { parsePanelMessages } from "../schemas";
import type { PanelMessage, PanelSource } from "../types";

interface UseChatOptions {
  activeTabId: number | null;
  source: PanelSource | null;
  transcript: TranscriptSegment[];
  currentTime: VideoTime | null;
  showWarning: (message: string) => void;
  onApiKeyMissing: () => void;
  onDraft?: (text: string) => void;
}

interface ContextualChatRequest {
  context: PendingAskContext;
  targetLensId?: string;
}

interface SendChatOptions {
  videoTimestamp?: VideoTime | null;
  displayContent?: string;
  /** `undefined` follows the current context; `null` forces whole-source chat. */
  contextualOverride?: ContextualChatRequest | null;
}

interface ChatRetryRequest {
  question: string;
  displayContent: string;
  attachedFiles: string[];
  videoTimestamp?: VideoTime | null;
  contextual: ContextualChatRequest | null;
}

const INTERRUPTED_RESPONSE_MESSAGE =
  "Response interrupted before completion. Retry to run the request again.";

export function useChat({
  activeTabId,
  source,
  transcript,
  currentTime,
  showWarning,
  onApiKeyMissing,
  onDraft,
}: UseChatOptions) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamPortRef = useRef<chrome.runtime.Port | null>(null);
  const messagesRef = useRef<PanelMessage[]>([]);
  const historyRef = useRef<ConversationMessage[]>([]);
  const sourceRef = useRef<PanelSource | null>(null);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
  const currentTimeRef = useRef<VideoTime | null>(null);
  const isStreamingRef = useRef(false);
  const consumingAskRef = useRef(false);
  const contextualChatRef = useRef<ContextualChatRequest | null>(null);
  const retryRequestByAssistantIdRef = useRef(new Map<number, ChatRetryRequest>());
  const restoreRequestIdRef = useRef(0);
  const hydratedSourceKeyRef = useRef<string | null>(null);
  const nextMessageIdRef = useRef(Date.now());
  // Mirror of contextualChatRef for the UI: the chip above the composer shows
  // what the chat is grounded in, so the contextual reroute is visible state.
  const [contextualChat, setContextualChat] = useState<PendingAskContextSummary | null>(
    null
  );
  const sourceKeyRef = useRef<string | null>(null);

  const setContextualChatContext = useCallback(
    (contextual: ContextualChatRequest | null) => {
      contextualChatRef.current = contextual;
      setContextualChat(
        contextual ? describePendingAskContext(contextual.context) : null
      );
    },
    []
  );

  const clearContextualChat = useCallback(() => {
    setContextualChatContext(null);
  }, [setContextualChatContext]);

  useEffect(() => {
    if ((source?.key ?? null) !== sourceKeyRef.current) {
      sourceKeyRef.current = source?.key ?? null;
      hydratedSourceKeyRef.current = null;
      setContextualChatContext(null);
    }
    sourceRef.current = source;
  }, [setContextualChatContext, source]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const setMessagesSync = useCallback(
    (updater: PanelMessage[] | ((current: PanelMessage[]) => PanelMessage[])) => {
      const next =
        typeof updater === "function" ? updater(messagesRef.current) : updater;
      messagesRef.current = next;
      setMessages(next);
    },
    []
  );

  const setHistorySync = useCallback(
    (
      updater:
        | ConversationMessage[]
        | ((current: ConversationMessage[]) => ConversationMessage[])
    ) => {
      const next =
        typeof updater === "function" ? updater(historyRef.current) : updater;
      historyRef.current = next;
      setConversationHistory(next);
    },
    []
  );

  // The sidebar thread lives in the unified conversations store (the same one
  // the in-page selection/finding chats use), keyed by the source's identity
  // with focus "source". The service worker persists it in the browser-local
  // database in both access modes.
  const persistMessages = useCallback(
    (targetSource = sourceRef.current, nextMessages = messagesRef.current) => {
      if (!targetSource) return;
      sendRuntimeMessage({
        type: "save-conversation",
        ...sidebarConversationIdentity(targetSource),
        messages: toSavedConversationMessages(nextMessages),
      }).catch((error) => {
        console.warn("[Lenses][sidepanel] conversation save failed", error);
      });
    },
    []
  );

  const restoreMessagesForSource = useCallback(
    async (targetSource: PanelSource | null): Promise<boolean> => {
      const requestId = ++restoreRequestIdRef.current;
      const targetSourceKey = targetSource?.key ?? null;

      if (!targetSource) {
        if (requestId !== restoreRequestIdRef.current || sourceRef.current) {
          return false;
        }
        retryRequestByAssistantIdRef.current.clear();
        setMessagesSync([]);
        setHistorySync([]);
        return true;
      }

      const restored = await loadConversationForSource(targetSource);
      if (
        requestId !== restoreRequestIdRef.current ||
        sourceRef.current?.key !== targetSourceKey ||
        isStreamingRef.current
      ) {
        return false;
      }

      retryRequestByAssistantIdRef.current.clear();
      setMessagesSync(restored);
      setHistorySync(buildConversationHistory(restored));
      hydratedSourceKeyRef.current = targetSource.key;
      return true;
    },
    [setHistorySync, setMessagesSync]
  );

  const restoreMessages = useCallback(async () => {
    const port = streamPortRef.current;
    streamPortRef.current = null;
    isStreamingRef.current = false;
    setIsStreaming(false);
    try {
      port?.disconnect();
    } catch {
      // The port may already be closed.
    }
    hydratedSourceKeyRef.current = null;
    await restoreMessagesForSource(sourceRef.current);
  }, [restoreMessagesForSource]);

  const finishStreaming = useCallback(
    (port: chrome.runtime.Port) => {
      if (streamPortRef.current !== port) return;
      streamPortRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      try {
        port.disconnect();
      } catch {
        // The terminal event may race with Chrome closing the port.
      }
      persistMessages();
    },
    [persistMessages]
  );

  const sendContextualChat = useCallback(
    async (
      questionOverride?: string,
      options?: {
        displayContent?: string;
        contextual?: ContextualChatRequest;
      }
    ): Promise<boolean> => {
      const targetSource = sourceRef.current;
      const contextual = options?.contextual ?? contextualChatRef.current;
      if (
        !targetSource ||
        !contextual ||
        hydratedSourceKeyRef.current !== targetSource.key ||
        isStreamingRef.current
      ) {
        return false;
      }

      const question = (questionOverride ?? "").trim();
      if (!question) return false;

      const stalePort = streamPortRef.current;
      streamPortRef.current = null;
      try {
        stalePort?.disconnect();
      } catch {
        // The stale port may already be closed.
      }
      isStreamingRef.current = true;
      setIsStreaming(true);

      const now = Math.max(Date.now(), nextMessageIdRef.current);
      nextMessageIdRef.current = now + 2;
      const visibleContent = options?.displayContent?.trim() || question;
      const userMessage: PanelMessage = {
        id: now,
        role: "user",
        content: visibleContent,
        timestamp: now,
      };
      const assistantMessage: PanelMessage = {
        id: now + 1,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setMessagesSync((current) => [...current, userMessage, assistantMessage]);
      retryRequestByAssistantIdRef.current.set(assistantMessage.id, {
        question,
        displayContent: visibleContent,
        attachedFiles: [],
        contextual,
      });

      const port = chrome.runtime.connect({ name: "lenses-finding-stream" });
      streamPortRef.current = port;
      let terminalReceived = false;

      const patchAssistant = (patch: Partial<PanelMessage>) => {
        setMessagesSync((current) =>
          current.map((message) =>
            message.id === assistantMessage.id ? { ...message, ...patch } : message
          )
        );
      };

      const finishWithError = (message: string) => {
        if (terminalReceived || streamPortRef.current !== port) return;
        terminalReceived = true;
        if (isApiKeyError(message)) {
          patchAssistant({
            role: "error",
            content: "Add an API key to use chat with this source.",
            action: "api-keys",
          });
          onApiKeyMissing();
        } else {
          patchAssistant({
            role: "assistant",
            isError: true,
            content: message || "Streaming failed.",
            textSegments: undefined,
          });
        }
        finishStreaming(port);
      };

      port.onMessage.addListener(
        makeStreamEventListener({
          patchAssistant,
          onError: (message) =>
            finishWithError(message || "Could not answer right now."),
          onDone: (state) => {
            if (terminalReceived || streamPortRef.current !== port) return;
            terminalReceived = true;
            patchAssistant({
              isError: false,
              content: state.text,
              textSegments: normalizeStreamTextSegments(state.textSegments),
              meta: state.meta,
            });
            setHistorySync((current) => [
              ...current,
              { role: "user", content: question },
              { role: "assistant", content: state.text },
            ]);
            finishStreaming(port);
          },
        })
      );

      port.onDisconnect.addListener(() => {
        if (
          terminalReceived ||
          streamPortRef.current !== port ||
          !isStreamingRef.current
        ) {
          return;
        }
        terminalReceived = true;
        patchAssistant({
          role: "assistant",
          isError: true,
          content: INTERRUPTED_RESPONSE_MESSAGE,
          textSegments: undefined,
        });
        finishStreaming(port);
      });

      port.postMessage({
        action: "ask-finding-stream",
        question,
        sourceUrl: targetSource.url,
        targetLensId: contextual.targetLensId,
        conversation: historyRef.current,
        annotations:
          contextual.context.kind === "annotations"
            ? contextual.context.annotations
            : [],
        ...(contextual.context.kind === "selection"
          ? {
              selectionText: contextual.context.selectedText,
              pageContext: contextual.context.pageContext,
              selectionMode: contextual.context.selectionMode,
            }
          : null),
      });

      return true;
    },
    [
      finishStreaming,
      onApiKeyMissing,
      setHistorySync,
      setMessagesSync,
    ]
  );

  const sendChat = useCallback(
    async (
      questionOverride?: string,
      attachedFiles: string[] = [],
      options?: SendChatOptions
    ): Promise<boolean> => {
      const targetSource = sourceRef.current;
      if (
        !targetSource ||
        hydratedSourceKeyRef.current !== targetSource.key ||
        isStreamingRef.current
      ) {
        return false;
      }

      const question = (questionOverride ?? "").trim();
      if (!question) return false;
      const contextual =
        options && Object.prototype.hasOwnProperty.call(options, "contextualOverride")
          ? (options.contextualOverride ?? null)
          : contextualChatRef.current;
      if (contextual && attachedFiles.length === 0) {
        return sendContextualChat(question, {
          displayContent: options?.displayContent,
          contextual,
        });
      }
      if (!targetSource.text.trim() && attachedFiles.length === 0) {
        showWarning("No source text available.");
        return false;
      }

      const stalePort = streamPortRef.current;
      streamPortRef.current = null;
      try {
        stalePort?.disconnect();
      } catch {
        // The stale port may already be closed.
      }
      isStreamingRef.current = true;
      setIsStreaming(true);

      const now = Math.max(Date.now(), nextMessageIdRef.current);
      nextMessageIdRef.current = now + 2;
      const videoTimestamp = options?.videoTimestamp ?? currentTimeRef.current;
      const visibleContent = options?.displayContent?.trim() || question;
      const userMessage: PanelMessage = {
        id: now,
        role: "user",
        content: visibleContent,
        timestamp: now,
        screenshots: attachedFiles,
        videoTimestamp,
      };
      const assistantMessage: PanelMessage = {
        id: now + 1,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setMessagesSync((current) => [...current, userMessage, assistantMessage]);
      retryRequestByAssistantIdRef.current.set(assistantMessage.id, {
        question,
        displayContent: visibleContent,
        attachedFiles: [...attachedFiles],
        videoTimestamp,
        contextual: null,
      });

      const port = chrome.runtime.connect({ name: "claude-stream" });
      streamPortRef.current = port;
      let terminalReceived = false;

      const patchAssistant = (patch: Partial<PanelMessage>) => {
        setMessagesSync((current) =>
          current.map((message) =>
            message.id === assistantMessage.id ? { ...message, ...patch } : message
          )
        );
      };

      const finishWithError = (message: string) => {
        if (terminalReceived || streamPortRef.current !== port) return;
        terminalReceived = true;
        if (isApiKeyError(message)) {
          patchAssistant({
            role: "error",
            content: "Add an API key to use chat with this source.",
            action: "api-keys",
          });
          onApiKeyMissing();
        } else {
          patchAssistant({
            role: "assistant",
            isError: true,
            content: message || "Streaming failed.",
            textSegments: undefined,
          });
        }
        finishStreaming(port);
      };

      port.onMessage.addListener(
        makeStreamEventListener({
          patchAssistant,
          onError: (message) => finishWithError(message || "Streaming failed."),
          onDone: (state) => {
            if (terminalReceived || streamPortRef.current !== port) return;
            terminalReceived = true;
            patchAssistant({
              isError: false,
              content: state.text,
              textSegments: normalizeStreamTextSegments(state.textSegments),
              meta: state.meta,
            });
            setHistorySync((current) => [
              ...current,
              { role: "user", content: question },
              { role: "assistant", content: state.text },
            ]);
            finishStreaming(port);
          },
        })
      );

      port.onDisconnect.addListener(() => {
        if (
          terminalReceived ||
          streamPortRef.current !== port ||
          !isStreamingRef.current
        ) {
          return;
        }
        terminalReceived = true;
        patchAssistant({
          role: "assistant",
          isError: true,
          content: INTERRUPTED_RESPONSE_MESSAGE,
          textSegments: undefined,
        });
        finishStreaming(port);
      });

      if (targetSource.kind === "youtube_video") {
        port.postMessage({
          action: "askClaudeStream",
          question,
          transcript: transcriptRef.current,
          currentTime: videoTimestamp,
          conversationHistory: historyRef.current,
          screenshots: attachedFiles,
        });
      } else {
        port.postMessage({
          action: "askSourceStream",
          question,
          source: targetSource,
          conversationHistory: historyRef.current,
          screenshots: attachedFiles,
        });
      }

      return true;
    },
    [
      finishStreaming,
      onApiKeyMissing,
      sendContextualChat,
      setHistorySync,
      setMessagesSync,
      showWarning,
    ]
  );

  const consumePendingAsk = useCallback(async () => {
    if (consumingAskRef.current || activeTabId == null) return;
    if (isStreamingRef.current) return;
    const activeSourceKey = sourceRef.current?.key;
    if (!activeSourceKey || hydratedSourceKeyRef.current !== activeSourceKey) return;

    consumingAskRef.current = true;
    try {
      const key = pendingAskKey(activeTabId);
      const stored = await chrome.storage.local.get(key);
      const ask = parsePendingAsk(stored[key]);
      if (!ask) return;

      await chrome.storage.local.remove(key);
      if (!isPendingAskFresh(ask, Date.now())) return;

      if (ask.context) {
        setContextualChatContext({
          context: ask.context,
          targetLensId: ask.targetLensId,
        });
      }
      if (ask.draft) {
        onDraft?.(ask.draft);
      }
      if (ask.question) {
        await sendChat(ask.question, [], {
          displayContent: ask.displayContent,
        });
      }
    } catch (error) {
      console.error("[Lenses][sidepanel] consume pending ask failed", error);
    } finally {
      consumingAskRef.current = false;
    }
  }, [activeTabId, onDraft, sendChat, setContextualChatContext]);

  const clearChat = useCallback(() => {
    const port = streamPortRef.current;
    streamPortRef.current = null;
    setContextualChatContext(null);
    isStreamingRef.current = false;
    setIsStreaming(false);
    try {
      port?.disconnect();
    } catch {
      // The port may already be closed.
    }
    retryRequestByAssistantIdRef.current.clear();
    setMessagesSync([]);
    setHistorySync([]);
    persistMessages(sourceRef.current, []);
  }, [persistMessages, setContextualChatContext, setHistorySync, setMessagesSync]);

  const replaceMessagesAndHistory = useCallback(
    (nextMessages: PanelMessage[], targetSource = sourceRef.current) => {
      const nextHistory = buildConversationHistory(nextMessages);
      const retainedIds = new Set(nextMessages.map((message) => message.id));
      for (const assistantId of retryRequestByAssistantIdRef.current.keys()) {
        if (!retainedIds.has(assistantId)) {
          retryRequestByAssistantIdRef.current.delete(assistantId);
        }
      }
      setMessagesSync(nextMessages);
      setHistorySync(nextHistory);
      persistMessages(targetSource, nextMessages);
    },
    [persistMessages, setHistorySync, setMessagesSync]
  );

  const rewindToMessage = useCallback(
    (messageId: number): boolean => {
      const targetSource = sourceRef.current;
      if (!targetSource) return false;

      const targetIndex = messagesRef.current.findIndex(
        (message) => message.id === messageId && message.role === "user"
      );
      if (targetIndex < 0) return false;

      isStreamingRef.current = false;
      setIsStreaming(false);
      const port = streamPortRef.current;
      streamPortRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // The port may already be closed.
      }

      const nextMessages = messagesRef.current.slice(0, targetIndex);
      replaceMessagesAndHistory(nextMessages, targetSource);
      return true;
    },
    [replaceMessagesAndHistory]
  );

  const retryFromMessage = useCallback(
    async (messageId: number): Promise<boolean> => {
      const targetSource = sourceRef.current;
      if (!targetSource || isStreamingRef.current) return false;

      const messageIndex = messagesRef.current.findIndex(
        (message) => message.id === messageId && message.role === "assistant"
      );
      if (messageIndex < 0) return false;

      let userIndex = -1;
      for (let index = messageIndex - 1; index >= 0; index--) {
        if (messagesRef.current[index]?.role === "user") {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) return false;

      const userMessage = messagesRef.current[userIndex];
      if (!userMessage || !userMessage.content.trim()) return false;
      const retryRequest = retryRequestByAssistantIdRef.current.get(messageId) ?? {
        question: userMessage.content,
        displayContent: userMessage.content,
        attachedFiles: [...(userMessage.screenshots ?? [])],
        videoTimestamp: userMessage.videoTimestamp,
        contextual: null,
      };

      isStreamingRef.current = false;
      setIsStreaming(false);
      const port = streamPortRef.current;
      streamPortRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // The port may already be closed.
      }

      const nextMessages = messagesRef.current.slice(0, userIndex);
      replaceMessagesAndHistory(nextMessages, targetSource);
      if (retryRequest.contextual) {
        return sendContextualChat(retryRequest.question, {
          displayContent: retryRequest.displayContent,
          contextual: retryRequest.contextual,
        });
      }
      return sendChat(retryRequest.question, retryRequest.attachedFiles, {
        videoTimestamp: retryRequest.videoTimestamp,
        displayContent: retryRequest.displayContent,
        contextualOverride: null,
      });
    },
    [replaceMessagesAndHistory, sendChat, sendContextualChat]
  );

  useEffect(() => {
    let cancelled = false;
    void restoreMessagesForSource(source).then((restored) => {
      if (!cancelled && restored) {
        void consumePendingAsk();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [consumePendingAsk, restoreMessagesForSource, source]);

  useEffect(() => {
    if (!isStreaming) void consumePendingAsk();
  }, [consumePendingAsk, isStreaming]);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (
        areaName === "local" &&
        activeTabId != null &&
        changes[pendingAskKey(activeTabId)]?.newValue
      ) {
        void consumePendingAsk();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [activeTabId, consumePendingAsk]);

  useEffect(
    () => () => {
      const port = streamPortRef.current;
      streamPortRef.current = null;
      isStreamingRef.current = false;
      try {
        port?.disconnect();
      } catch {
        // The port may already be closed.
      }
    },
    []
  );

  return {
    messages,
    conversationHistory,
    isStreaming,
    contextualChat,
    clearContextualChat,
    sendChat,
    clearChat,
    restoreMessages,
    retryFromMessage,
    rewindToMessage,
    openApiKeySettings,
  };
}

async function loadConversationForSource(
  targetSource: PanelSource
): Promise<PanelMessage[]> {
  try {
    const response = await sendRuntimeMessage<{ messages?: unknown }>({
      type: "get-conversation",
      ...sidebarConversationIdentity(targetSource),
    });
    const restored = fromSavedConversationMessages(response?.messages);
    if (restored.length > 0) return restored;
  } catch (error) {
    console.warn("[Lenses][sidepanel] conversation restore failed", error);
  }
  return importStoredConversation(targetSource);
}

// Import an existing chrome.storage thread into the current conversation store.
// Remove the source key only after the copy succeeds so a transient failure
// never loses the thread.
async function importStoredConversation(
  targetSource: PanelSource
): Promise<PanelMessage[]> {
  const storageKey = legacyConversationStorageKey(targetSource.key);
  let legacy: PanelMessage[] = [];
  try {
    const result = await chrome.storage.local.get(storageKey);
    legacy = parsePanelMessages(result[storageKey]);
  } catch {
    return [];
  }
  if (legacy.length === 0) return [];

  try {
    await sendRuntimeMessage({
      type: "save-conversation",
      ...sidebarConversationIdentity(targetSource),
      messages: toSavedConversationMessages(legacy),
    });
    await chrome.storage.local.remove(storageKey);
  } catch (error) {
    console.warn("[Lenses][sidepanel] conversation import failed", error);
  }
  return legacy;
}

function buildConversationHistory(messages: PanelMessage[]): ConversationMessage[] {
  return messages
    .filter(
      (message) =>
        !message.isError &&
        (message.role === "user" || message.role === "assistant")
    )
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
}

// One listener body for both stream ports: fold every wire event through the
// shared reducer, then hand the surfaces only the two decisions that are theirs
// (how to patch the assistant message, what to do at the end of the turn).
function makeStreamEventListener({
  patchAssistant,
  onDone,
  onError,
}: {
  patchAssistant: (patch: Partial<PanelMessage>) => void;
  onDone: (state: ChatStreamState) => void;
  onError: (message: string) => void;
}): (event: ChatStreamEvent) => void {
  let state = createChatStreamState();
  return (event) => {
    if (event.type === "error") {
      onError(event.error ?? "");
      return;
    }
    state = applyChatStreamEvent(state, event);
    if (event.type === "done") {
      onDone(state);
      return;
    }
    patchAssistant(streamStatePatch(state));
  };
}

function streamStatePatch(state: ChatStreamState): Partial<PanelMessage> {
  const patch: Partial<PanelMessage> = { content: state.text };
  if (state.thinkingText) patch.thinkingText = state.thinkingText;
  if (state.activity.length > 0) patch.activity = state.activity;
  if (state.searches.length > 0) patch.searches = state.searches;
  const segments = normalizeStreamTextSegments(state.textSegments);
  if (segments) patch.textSegments = segments;
  if (state.meta) patch.meta = state.meta;
  return patch;
}

// The finding stream sends bare {url, title, citedText?} citations while the
// direct provider stream already sends full TextSegment citations (with a
// `type` and, for Claude, an `encrypted_index`). Default only what's missing
// and pass everything else through so neither shape loses fields.
function normalizeStreamTextSegments(
  segments: ChatStreamTextSegment[]
): TextSegment[] | undefined {
  if (segments.length === 0) return undefined;
  return segments.map((segment) => ({
    text: segment.text,
    citations: segment.citations.map((citation) => {
      const extra = citation as { type?: unknown };
      return {
        ...citation,
        type: typeof extra.type === "string" ? extra.type : "web",
        citedText: citation.citedText ?? "",
      };
    }),
  }));
}
