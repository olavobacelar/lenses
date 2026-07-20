import { Effect } from "effect";
import {
  type ClaudeModel,
  usesAdaptiveThinking,
} from "../types/claude";
import type { AiModel } from "../types/ai-models";
import type { ConversationMessage, SystemPromptPart } from "../types/ai-content";
import {
  DEFAULT_REASONING_EFFORT,
  type ReasoningEffort,
} from "../lib/reasoning-settings";
import { makeApiCall } from "./api/claude-client";
import { makeOpenAIApiCall } from "./api/openai-client";
import {
  getStreamingErrorMessage,
  makePortCallbacks,
  readOpenAIStreamingResponse,
  readStreamingResponse,
} from "./assistant-streaming";
import { getApiKey, getSettings } from "./effects/storage";
import { buildUserContent } from "./prompts/system";
import { streamSourceChatViaManagedService } from "./managed-chat-stream";
import { isLocalByokMode, readAppAccessMode } from "../lib/app-mode";
import { readStoredModelSettings } from "../lib/model-settings";
import type { StreamCallbacks } from "./types";

interface SourceStreamRequest {
  action: "askSourceStream";
  question: string;
  source: {
    kind: "web_page" | "youtube_video" | "pdf";
    title?: string;
    url?: string;
    text: string;
    scope: "page" | "selection" | "transcript";
  };
  conversationHistory?: ConversationMessage[];
  screenshots?: string[];
}

const SOURCE_CONTEXT_MAX_CHARS = 120_000;

export function setupSourceStreamHandlers(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "claude-stream") return;

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") return;
      const action = String((message as { action?: unknown }).action ?? "");
      if (action !== "askSourceStream") return;

      streamSourceOverPort(port, message as SourceStreamRequest);
    });
  });
}

const streamSourceAPIEffect = (
  apiKey: string,
  request: SourceStreamRequest,
  callbacks: StreamCallbacks,
  model: ClaudeModel,
  reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT
) =>
  Effect.gen(function* () {
    const sourceText = request.source.text.slice(0, SOURCE_CONTEXT_MAX_CHARS);
    const systemPrompt: SystemPromptPart[] = [
      {
        type: "text",
        text: [
          "You are Lenses, a source-grounded assistant for the active browser page.",
          "The user is asking about the current source. Treat Focus as the surface being inspected and Scope as the slice of source content provided.",
          "Answer from the source first, but reach for web search whenever it would strengthen the answer — to verify claims, add context the source omits, find corroborating or contradicting reporting, or check the source's own sourcing. Don't wait to be asked.",
          "When a question benefits from it, run several focused searches across different angles rather than a single broad one, then synthesize what you find. When a result looks important, open it with web fetch to read the full page instead of relying on the search snippet.",
          "When you use web search, cite the external sources. When the source itself is enough, say so plainly.",
        ].join("\n"),
      },
      {
        type: "text",
        text: [
          `Focus: ${sourceKindLabel(request.source.kind)}`,
          `Scope: ${request.source.scope}`,
          `Title: ${request.source.title || "Untitled"}`,
          `URL: ${request.source.url || "unknown"}`,
          "",
          "<source_text>",
          sourceText,
          "</source_text>",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ];
    const messages: ConversationMessage[] = [
      ...(request.conversationHistory ?? []),
      { role: "user", content: buildUserContent(request.question, request.screenshots ?? [], null) },
    ];

    const response = yield* makeApiCall({
      apiKey,
      model,
      maxTokens: 12000,
      system: systemPrompt,
      messages,
      stream: true,
      reasoningEffort,
      thinking: usesAdaptiveThinking(model)
        ? { type: "adaptive", display: "summarized" }
        : undefined,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        {
          type: "web_fetch_20250910",
          name: "web_fetch",
          max_uses: 5,
          citations: { enabled: true },
        },
      ],
    });

    return yield* readStreamingResponse(response, callbacks);
  });

const streamOpenAISourceAPIEffect = (
  apiKey: string,
  request: SourceStreamRequest,
  callbacks: StreamCallbacks,
  model: AiModel,
  reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT
) =>
  Effect.gen(function* () {
    const sourceText = request.source.text.slice(0, SOURCE_CONTEXT_MAX_CHARS);
    const systemPrompt: SystemPromptPart[] = [
      {
        type: "text",
        text: [
          "You are Lenses, a source-grounded assistant for the active browser page.",
          "The user is asking about the current source. Treat Focus as the surface being inspected and Scope as the slice of source content provided.",
          "Answer from the source first, but reach for web search whenever it would strengthen the answer — to verify claims, add context the source omits, find corroborating or contradicting reporting, or check the source's own sourcing. Don't wait to be asked.",
          "When a question benefits from it, run several focused searches across different angles rather than a single broad one, then synthesize what you find. When a result looks important, open it with web fetch to read the full page instead of relying on the search snippet.",
          "When you use web search, cite the external sources. When the source itself is enough, say so plainly.",
        ].join("\n"),
      },
      {
        type: "text",
        text: [
          `Focus: ${sourceKindLabel(request.source.kind)}`,
          `Scope: ${request.source.scope}`,
          `Title: ${request.source.title || "Untitled"}`,
          `URL: ${request.source.url || "unknown"}`,
          "",
          "<source_text>",
          sourceText,
          "</source_text>",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ];
    const messages: ConversationMessage[] = [
      ...(request.conversationHistory ?? []),
      { role: "user", content: buildUserContent(request.question, request.screenshots ?? [], null) },
    ];

    const response = yield* makeOpenAIApiCall({
      apiKey,
      model,
      maxTokens: 10000,
      system: systemPrompt,
      messages,
      stream: true,
      reasoningEffort,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });

    return yield* readOpenAIStreamingResponse(response, callbacks);
  });

function streamSourceOverPort(port: chrome.runtime.Port, request: SourceStreamRequest): void {
  void routeSourceStream(port, request);
}

async function routeSourceStream(
  port: chrome.runtime.Port,
  request: SourceStreamRequest
): Promise<void> {
  // Parity routing: managed mode streams through the same backend pipeline the
  // in-page selection chat uses; BYOK mode keeps the direct streaming below.
  const mode = await readAppAccessMode();
  if (!isLocalByokMode(mode)) {
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    const { provider, model, reasoningEffort } = await readStoredModelSettings("chat");
    await streamSourceChatViaManagedService(
      port,
      {
        question: request.question,
        source: request.source,
        conversation: request.conversationHistory ?? [],
        sourceUrl: request.source.url,
      },
      { provider, model, reasoningEffort },
      controller.signal
    );
    return;
  }

  Effect.runPromise(
    Effect.gen(function* () {
      const apiKey = yield* getApiKey;
      const { provider, chatModel, reasoningEffort } = yield* getSettings;
      const callbacks = makePortCallbacks(port);
      let fullResponse: string;
      if (provider === "openai") {
        fullResponse = yield* streamOpenAISourceAPIEffect(
          apiKey,
          request,
          callbacks,
          chatModel,
          reasoningEffort
        );
      } else {
        fullResponse = yield* streamSourceAPIEffect(
          apiKey,
          request,
          callbacks,
          chatModel as ClaudeModel,
          reasoningEffort
        );
      }

      port.postMessage({ type: "done", fullText: fullResponse });
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          port.postMessage({ type: "error", error: getStreamingErrorMessage(error) });
        })
      )
    )
  );
}

function sourceKindLabel(kind: SourceStreamRequest["source"]["kind"]): string {
  if (kind === "youtube_video") return "YouTube video";
  if (kind === "pdf") return "PDF document";
  return "web page";
}
