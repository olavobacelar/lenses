import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getBuiltInLens } from "../src/lenses/registry.js";
import {
  resolveManagedProviderApiKey,
  resolveLensProviderModel,
  resolveProviderModel,
  resolveRequestedModelProvider,
  type ModelProvider,
} from "../src/findings/model.js";
import {
  MetaHeaderExtractor,
  buildMetaInstruction,
  getMetaSchemaForMode,
  type ParsedMeta,
  type SelectionMode,
} from "@lenses/shared";
import {
  extractOpenAISearchQuery,
  parseAnthropicSearchResults,
  parseFetchUrlJson,
  parseSearchQueryJson,
  parseWebFetchResult,
} from "../src/webSearch.js";
import { isManagedModelAllowed } from "../src/managedModels.js";
import {
  MAX_CITATION_PUBLISHER_URLS,
  normalizePublicCitationUrl,
} from "../src/citationUrl.js";

const SELECTION_MODE_VALUES: readonly SelectionMode[] = [
  "ask",
  "explain",
  "truth",
  "summarize",
];
const REASONING_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
const OPENAI_REASONING_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

const http = httpRouter();

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface StreamAskFindingRequest {
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
  provider?: "anthropic" | "openai";
  model?: string;
  reasoningEffort?: string;
  testing?: boolean;
  streamOptions?: {
    maxCitations?: number;
  };
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  annotations: Array<{
    lensId: string;
    label: string;
    category: string;
    text: string;
    detail: string;
    confidence: number;
  }>;
  selectionText?: string;
  pageContext?: string;
  selectionMode?: SelectionMode;
  // Source-grounded chat (sidebar / selection chat about a whole page or video).
  // When present with no annotations or selectionText, the request is answered
  // as conversational chat grounded in this source.
  source?: {
    kind?: "web_page" | "youtube_video" | "pdf";
    title?: string;
    url?: string;
    text?: string;
    scope?: "page" | "selection" | "transcript";
  };
}

interface LensChatSettings {
  webSearch: boolean;
  requireCitations: boolean;
}

interface StreamResponseStyle {
  preferBrief: boolean;
  preferLowEffort: boolean;
}

interface WebCitation {
  url: string;
  title: string;
  citedText?: string;
}

interface StreamTextSegment {
  text: string;
  citations: WebCitation[];
}

interface ResolveCitationPublishersRequest {
  urls: string[];
}

const DEFAULT_LENS_CHAT_SETTINGS: LensChatSettings = {
  webSearch: false,
  requireCitations: false,
};

const SELECTION_CHAT_SETTINGS: LensChatSettings = {
  webSearch: true,
  requireCitations: true,
};

// Source-grounded chat: web tools on, but don't force a citation on every claim
// (it's open conversation about the page/video, not a sourcing audit).
const SOURCE_CHAT_SETTINGS: LensChatSettings = {
  webSearch: true,
  requireCitations: false,
};

const LENS_CHAT_SETTINGS: Record<string, LensChatSettings> = {
  "source-tracer": { webSearch: true, requireCitations: true },
};

const DEFAULT_STREAM_RESPONSE_STYLE: StreamResponseStyle = {
  preferBrief: false,
  preferLowEffort: false,
};

const SOURCE_TRACER_STREAM_RESPONSE_STYLE: StreamResponseStyle = {
  preferBrief: true,
  preferLowEffort: true,
};

const SELECTION_STREAM_RESPONSE_STYLE: StreamResponseStyle = {
  preferBrief: false,
  preferLowEffort: true,
};

function logHttpStreamDebug(event: string, details: Record<string, unknown> = {}) {
  if (env.LENSES_MANAGED_DIAGNOSTICS !== "true") return;
  console.log("[Lenses][convex][finding-stream]", event, details);
}

function resolveReasoningEffort(value: unknown): ReasoningEffort {
  const resolved = typeof value === "string" &&
    REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : "medium";
  // Managed requests use a bounded reasoning backstop. Local BYOK keeps
  // the broader provider-specific choices.
  return resolved === "low" ? "low" : "medium";
}

function supportsOpenAIReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("chatgpt-") ||
    /^o\d/.test(normalized)
  );
}

function isOpenAIReasoningEffort(effort: ReasoningEffort): boolean {
  return OPENAI_REASONING_EFFORT_VALUES.includes(
    effort as (typeof OPENAI_REASONING_EFFORT_VALUES)[number]
  );
}

function supportsClaudeEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized === "claude-fable-5" ||
    normalized === "claude-opus-4-8" ||
    normalized === "claude-sonnet-5"
  );
}

function usesClaudeAdaptiveThinking(model: string): boolean {
  return supportsClaudeEffort(model);
}

http.route({
  path: "/managed/run",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await readJsonObject(request);
    if (
      !payload ||
      typeof payload.text !== "string" ||
      payload.text.length === 0 ||
      payload.text.length > 30_000 ||
      typeof payload.lensId !== "string" ||
      payload.lensId.length === 0 ||
      payload.lensId.length > 200
    ) {
      return jsonError("Invalid managed lens request", 400);
    }

    const customLens = readManagedCustomLens(payload.customLens);
    if (customLens === null) {
      return jsonError("Invalid managed custom Lens", 400);
    }
    const builtInLens = getBuiltInLens(payload.lensId);
    if (!customLens && !builtInLens) {
      return jsonError("Unknown managed Lens", 400);
    }
    const requestedProvider = resolveRequestedModelProvider(payload.provider);
    if (!requestedProvider) {
      return jsonError("Unsupported managed provider", 400);
    }
    const resolved = resolveLensProviderModel({
      provider: requestedProvider,
      testing: payload.testing === true,
      settingsModel: typeof payload.model === "string" ? payload.model : undefined,
      lensDefaultModel: customLens ? undefined : builtInLens?.defaultModel,
    });
    if (!isManagedModelAllowed(resolved.provider, resolved.model)) {
      return jsonError("Unsupported managed model", 400);
    }
    if (!resolveManagedProviderApiKey({ provider: resolved.provider })) {
      return jsonError("Managed provider is unavailable", 503);
    }

    const managedPayload = {
      text: payload.text,
      lensId: payload.lensId,
      customLens,
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: resolveReasoningEffort(payload.reasoningEffort),
      testing: payload.testing === true,
      runRequestId: readBoundedString(payload.runRequestId, 200),
    };
    try {
      const value = await ctx.runAction(internal.runs.run, managedPayload);
      return jsonOk({ status: "success", value });
    } catch (error) {
      return managedActionError(error, "Managed lens run failed");
    }
  }),
});

http.route({
  path: "/managed/generate-lens-name",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await readJsonObject(request);
    if (
      !payload ||
      typeof payload.instruction !== "string" ||
      payload.instruction.trim().length === 0 ||
      payload.instruction.length > 10_000
    ) {
      return jsonError("Invalid managed naming request", 400);
    }
    const requestedProvider = resolveRequestedModelProvider(payload.provider);
    if (!requestedProvider) {
      return jsonError("Unsupported managed provider", 400);
    }
    const resolved = resolveProviderModel({
      provider: requestedProvider,
      testing: payload.testing === true,
      model: typeof payload.model === "string" ? payload.model : undefined,
      purpose: "extraction",
    });
    if (!isManagedModelAllowed(resolved.provider, resolved.model)) {
      return jsonError("Unsupported managed model", 400);
    }
    if (!resolveManagedProviderApiKey({ provider: resolved.provider })) {
      return jsonError("Managed provider is unavailable", 503);
    }
    const managedPayload = {
      instruction: payload.instruction,
      provider: resolved.provider,
      model: resolved.model,
      testing: payload.testing === true,
    };
    try {
      const value = await ctx.runAction(
        internal.runs.generateLensName,
        managedPayload
      );
      return jsonOk({ status: "success", value });
    } catch (error) {
      return managedActionError(error, "Managed lens naming failed");
    }
  }),
});

http.route({
  path: "/managed/cancel-run",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await readJsonObject(request, 4_096);
    const runRequestId = readBoundedString(payload?.runRequestId, 200);
    if (!runRequestId) {
      return jsonError("Invalid managed cancel request", 400);
    }

    const result = await ctx.runMutation(
      internal.runHelpers.requestCancelByRunRequestId,
      { runRequestId }
    );
    return jsonOk(result);
  }),
});

http.route({
  path: "/managed/ask-finding",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await readJsonObject(request);
    const annotations = readManagedAnnotations(payload?.annotations);
    const conversation = readManagedConversation(payload?.conversation);
    if (
      !payload ||
      typeof payload.question !== "string" ||
      payload.question.trim().length === 0 ||
      payload.question.length > 10_000 ||
      !annotations ||
      annotations.length === 0 ||
      !conversation
    ) {
      return jsonError("Invalid managed question request", 400);
    }
    const requestedProvider = resolveRequestedModelProvider(payload.provider);
    if (!requestedProvider) {
      return jsonError("Unsupported managed provider", 400);
    }
    const resolved = resolveProviderModel({
      provider: requestedProvider,
      testing: payload.testing === true,
      model: typeof payload.model === "string" ? payload.model : undefined,
      purpose: "chat",
    });
    if (!isManagedModelAllowed(resolved.provider, resolved.model)) {
      return jsonError("Unsupported managed model", 400);
    }
    if (!resolveManagedProviderApiKey({ provider: resolved.provider })) {
      return jsonError("Managed provider is unavailable", 503);
    }
    const managedPayload = {
      question: payload.question,
      sourceUrl: readBoundedString(payload.sourceUrl, 2_048),
      targetLensId: readBoundedString(payload.targetLensId, 200),
      annotations,
      conversation,
      provider: resolved.provider,
      model: resolved.model,
      testing: payload.testing === true,
    };
    try {
      const value = await ctx.runAction(
        internal.runs.askFindingQuestion,
        managedPayload
      );
      return jsonOk({ status: "success", value });
    } catch (error) {
      return managedActionError(error, "Managed question answering failed");
    }
  }),
});

http.route({
  path: "/managed/ask-finding/stream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const parsedPayload = await readJsonObject(request, 512_000);
    if (!parsedPayload) {
      return jsonError("Invalid JSON payload", 400);
    }
    const payload = parsedPayload as unknown as StreamAskFindingRequest;

    const provider = resolveRequestedModelProvider(payload.provider);
    if (!provider) {
      return jsonError("Unsupported managed provider", 400);
    }

    const question = typeof payload.question === "string" ? payload.question.trim() : "";
    if (!question || question.length > 10_000) {
      return jsonError("Question cannot be empty", 400);
    }

    const annotations = readManagedAnnotations(payload.annotations) ?? [];
    const conversation = readManagedConversation(payload.conversation);
    if (!conversation) return jsonError("Invalid conversation context", 400);
    const selectionText =
      typeof payload.selectionText === "string" ? payload.selectionText.trim() : "";
    const pageContext =
      typeof payload.pageContext === "string" ? payload.pageContext.trim() : "";
    const sourceText =
      typeof payload.source?.text === "string" ? payload.source.text.trim() : "";
    const sourceUrl = readBoundedString(payload.sourceUrl, 2_048);
    const sourceTitle = readBoundedString(payload.source?.title, 500) ?? "Untitled";
    const sourceKind =
      payload.source?.kind === "youtube_video" || payload.source?.kind === "pdf"
        ? payload.source.kind
        : "web_page";
    const sourceScope =
      payload.source?.scope === "selection" || payload.source?.scope === "transcript"
        ? payload.source.scope
        : "page";
    // Source chat is a whole-page or transcript conversation. It has no
    // annotations and no specific selection.
    const isSourceChat =
      annotations.length === 0 && selectionText.length === 0 && sourceText.length > 0;
    const isSelectionMode = annotations.length === 0 && selectionText.length > 0;

    if (annotations.length === 0 && !selectionText && !isSourceChat) {
      return jsonError("Missing context: provide annotations, selectionText, or source", 400);
    }
    if (
      selectionText.length > 50_000 ||
      pageContext.length > 120_000 ||
      sourceText.length > 120_000
    ) {
      return jsonError("Managed source context is too large", 400);
    }

    const selectionMode = isSelectionMode
      ? resolveSelectionMode(payload.selectionMode)
      : undefined;
    const targetLensId = resolveTargetLensId(payload.targetLensId, annotations);
    const chatSettings = isSourceChat
      ? SOURCE_CHAT_SETTINGS
      : isSelectionMode
        ? SELECTION_CHAT_SETTINGS
        : resolveLensChatSettings(targetLensId);
    const responseStyle = isSourceChat
      ? DEFAULT_STREAM_RESPONSE_STYLE
      : isSelectionMode
        ? SELECTION_STREAM_RESPONSE_STYLE
        : resolveStreamResponseStyle(targetLensId);
    const maxCitations = resolveStreamMaxCitations(payload.streamOptions?.maxCitations);
    const { model } = resolveProviderModel({
      provider,
      testing: payload.testing === true,
      model: typeof payload.model === "string" ? payload.model : undefined,
      purpose: "chat",
    });
    if (!isManagedModelAllowed(provider, model)) {
      return jsonError("Unsupported managed model", 400);
    }
    const apiKey = resolveManagedProviderApiKey({ provider });
    if (!apiKey) {
      return jsonError("Managed provider is unavailable", 503);
    }
    const reasoningEffort = resolveReasoningEffort(payload.reasoningEffort);
    const metaSchema = isSelectionMode ? getMetaSchemaForMode(selectionMode) : null;
    logHttpStreamDebug("request_received", {
      targetLensId,
      provider,
      webSearch: chatSettings.webSearch,
      requireCitations: chatSettings.requireCitations,
      preferBrief: responseStyle.preferBrief,
      preferLowEffort: responseStyle.preferLowEffort,
      maxCitations,
      reasoningEffort,
      annotationCount: annotations.length,
      conversationCount: conversation.length,
      mode: isSelectionMode ? "selection" : "annotations",
      selectionLength: selectionText.length,
      pageContextLength: pageContext.length,
    });
    const sourceContext = sourceUrl
      ? `Source URL: ${sourceUrl}`
      : "Source URL: unknown";

    let systemPrompt = buildAskFindingSystemPrompt(
      chatSettings,
      responseStyle,
      isSourceChat ? "source" : isSelectionMode ? "selection" : "annotations"
    );
    if (metaSchema) {
      systemPrompt += `\n\n${buildMetaInstruction(metaSchema)}`;
    }

    let contextMessage: string;
    if (isSourceChat) {
      const body = truncatePageContext(sourceText);
      const focus =
        sourceKind === "youtube_video"
          ? "YouTube video"
          : sourceKind === "pdf"
            ? "PDF"
            : "web page";
      contextMessage =
        `${sourceContext}\n\n` +
        `Focus: ${focus}\n` +
        `Title: ${sourceTitle}\n` +
        `Scope: ${sourceScope}\n\n` +
        `Source content (extracted; may be truncated):\n"""\n${body}\n"""\n\n` +
        "Answer the user's question grounded in this source. Use web search and web fetch when they would strengthen the answer; cite external sources you rely on.";
    } else if (isSelectionMode) {
      const boundedPageContext = truncatePageContext(pageContext);
      const pageBlock = boundedPageContext
        ? `Page text (extracted via the lens extraction pipeline; may be truncated):\n"""\n${boundedPageContext}\n"""`
        : "Page text: unavailable";
      contextMessage =
        `${sourceContext}\n\n` +
        `Selected text from the page:\n"""\n${selectionText}\n"""\n\n` +
        `${pageBlock}\n\n` +
        (chatSettings.webSearch
          ? "Answer the user's question about the selected text. Use the page text as supporting context. Use web search when needed to verify claims; be explicit about uncertainty."
          : "Answer the user's question about the selected text. Use the page text as supporting context. Be concise and practical.");
    } else {
      const lensNames = getLensNamesForAnnotations(annotations);
      const annotationContext = formatAnnotationContext(annotations, lensNames);
      contextMessage =
        `${sourceContext}\n\nAnnotation context:\n${annotationContext}\n\n` +
        (chatSettings.webSearch
          ? "Use web search when needed to verify claims. Be explicit about uncertainty."
          : "Use concise, practical language. Include alternative interpretations when relevant.");
    }

    const messages = [
      { role: "user" as const, content: contextMessage },
      ...conversation,
      { role: "user" as const, content: question },
    ];

    const upstreamResponse =
      provider === "openai"
        ? await fetch(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              max_output_tokens: 8_192,
              stream: true,
              ...(supportsOpenAIReasoningEffort(model) && isOpenAIReasoningEffort(reasoningEffort)
                ? { reasoning: { effort: reasoningEffort } }
                : {}),
              instructions: systemPrompt,
              input: messages,
              ...(chatSettings.webSearch ? { tools: [{ type: "web_search" }] } : {}),
            }),
          })
        : await fetch(ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: 8_192,
              stream: true,
              ...(usesClaudeAdaptiveThinking(model)
                ? { thinking: { type: "adaptive", display: "summarized" } }
                : {}),
              ...(supportsClaudeEffort(model)
                ? { output_config: { effort: reasoningEffort } }
                : {}),
              system: systemPrompt,
              messages,
              ...(chatSettings.webSearch
                ? {
                    tools: [
                      {
                        type: "web_search_20250305",
                        name: "web_search",
                        max_uses: 3,
                      },
                      {
                        type: "web_fetch_20250910",
                        name: "web_fetch",
                        max_uses: 3,
                        citations: { enabled: true },
                      },
                    ],
                  }
                : {}),
            }),
          });

    if (!upstreamResponse.ok) {
      const upstreamStatus = upstreamResponse.status;
      await upstreamResponse.body?.cancel();
      logHttpStreamDebug("upstream_error", {
        provider,
        status: upstreamStatus,
      });
      return jsonError(
        "Managed provider is temporarily unavailable",
        mapUpstreamErrorStatus(upstreamStatus)
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstreamReader = upstreamResponse.body?.getReader();

    if (!upstreamReader) {
      return jsonError(
        `No stream body returned by ${provider === "openai" ? "OpenAI" : "Anthropic"}`,
        503
      );
    }

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        let currentBlockType: string | null = null;
        let currentBlockName: string | null = null;
        let buffer = "";
        let fullText = "";
        let thinkingText = "";
        let modelUsed = model;
        let searching = false;
        let fetching = false;
        let currentToolInput = "";
        let pendingSearchQuery = "";
        let pendingFetchUrl = "";
        const citations = new Map<string, WebCitation>();
        let textSegments: StreamTextSegment[] = [];
        let chunkEvents = 0;
        const metaExtractor = metaSchema ? new MetaHeaderExtractor(metaSchema) : null;
        let metaPayload: ParsedMeta | null = null;

        const ingestProseText = (text: string) => {
          if (!text) return;
          fullText += text;
          chunkEvents++;

          if (textSegments.length === 0) {
            textSegments = [{ text, citations: [] }];
          } else {
            const segments = [...textSegments];
            const last = segments[segments.length - 1];
            segments[segments.length - 1] = {
              ...last,
              text: last.text + text,
              citations: [...last.citations],
            };
            textSegments = segments;
          }

          send({ type: "chunk", text, textSegments: cloneTextSegments(textSegments) });
        };

        const emitMetaIfFound = (meta: ParsedMeta | null) => {
          if (!meta || metaPayload) return;
          metaPayload = meta;
          send({ type: "meta", meta });
          logHttpStreamDebug("meta_extracted", { meta });
        };

        const ingestCitation = (citation: WebCitation) => {
          const key = `${citation.url}|${citation.title}`;
          if (citations.has(key)) {
            return;
          }
          const canAddCitation = maxCitations === null || citations.size < maxCitations;
          if (!canAddCitation) {
            return;
          }
          citations.set(key, citation);
          logHttpStreamDebug("citation_delta", {
            title: citation.title,
            url: citation.url,
            citationCount: citations.size,
          });

          if (textSegments.length === 0) {
            textSegments = [{ text: "", citations: [citation] }];
          } else {
            const segments = cloneTextSegments(textSegments);
            const currentIndex = segments.length - 1;
            const current = { ...segments[currentIndex] };
            let trailingNewlines = "";

            if (!current.text && segments.length > 1) {
              const prevIndex = segments.length - 2;
              const prev = { ...segments[prevIndex] };
              const match = prev.text.match(/(\n+)$/);
              if (match) {
                trailingNewlines = match[1];
                prev.text = prev.text.slice(0, -trailingNewlines.length);
                segments[prevIndex] = prev;
              }
            }

            current.citations = [...current.citations, citation];
            segments[currentIndex] = current;

            if (trailingNewlines) {
              segments.push({ text: trailingNewlines, citations: [] });
            }

            textSegments = segments;
          }

          send({
            type: "citations",
            citations: Array.from(citations.values()),
            textSegments: cloneTextSegments(textSegments),
          });
        };

        const handleAnthropicLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6);
          if (!data || data === "[DONE]") return;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }

          const type = event.type;
          if (type === "message_start") {
            const message = event.message as Record<string, unknown> | undefined;
            if (message && typeof message.model === "string") {
              modelUsed = message.model;
            }
            return;
          }

          if (type === "content_block_start") {
            const contentBlock = event.content_block as Record<string, unknown> | undefined;
            currentBlockType =
              contentBlock && typeof contentBlock.type === "string" ? contentBlock.type : null;
            currentBlockName =
              contentBlock && typeof contentBlock.name === "string" ? contentBlock.name : null;

            if (currentBlockType === "thinking") {
              send({ type: "thinking", event: "start" });
            }

            if (currentBlockType === "text") {
              textSegments = [...textSegments, { text: "", citations: [] }];
            }

            if (currentBlockType === "server_tool_use" && currentBlockName === "web_search") {
              // The query streams in as input_json_delta; defer `start` until
              // content_block_stop, when the full query is known.
              searching = true;
              currentToolInput = "";
              pendingSearchQuery = "";
            }

            if (currentBlockType === "server_tool_use" && currentBlockName === "web_fetch") {
              // Same deferral as web_search: the url streams in as input_json_delta.
              fetching = true;
              currentToolInput = "";
              pendingFetchUrl = "";
            }

            if (currentBlockType === "web_search_tool_result" && searching) {
              searching = false;
              logHttpStreamDebug("web_search_end");
              send({
                type: "searching",
                event: "end",
                kind: "search",
                query: pendingSearchQuery,
                results: parseAnthropicSearchResults(contentBlock?.content),
              });
              pendingSearchQuery = "";
            }

            if (currentBlockType === "web_fetch_tool_result" && fetching) {
              fetching = false;
              logHttpStreamDebug("web_fetch_end");
              const page = parseWebFetchResult(contentBlock?.content);
              send({
                type: "searching",
                event: "end",
                kind: "fetch",
                url: page?.url || pendingFetchUrl,
                title: page?.title,
              });
              pendingFetchUrl = "";
            }
            return;
          }

          if (type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown> | undefined;
            const deltaType = delta?.type;

            if (deltaType === "thinking_delta") {
              const thinking = typeof delta?.thinking === "string" ? delta.thinking : "";
              if (thinking) {
                thinkingText += thinking;
                send({ type: "thinking", event: "delta", text: thinking });
              }
              return;
            }

            if (deltaType === "text_delta") {
              const text = typeof delta?.text === "string" ? delta.text : "";
              if (text) {
                if (metaExtractor) {
                  const result = metaExtractor.push(text);
                  emitMetaIfFound(result.meta);
                  ingestProseText(result.proseText);
                } else {
                  ingestProseText(text);
                }
              }
              return;
            }

            if (deltaType === "input_json_delta") {
              const partial =
                typeof delta?.partial_json === "string" ? delta.partial_json : "";
              if (partial) currentToolInput += partial;
              return;
            }

            if (deltaType === "citations_delta") {
              const citation = parseCitation((delta as Record<string, unknown>).citation);
              if (!citation) return;
              ingestCitation(citation);
            }
            return;
          }

          if (type === "content_block_stop") {
            if (currentBlockType === "server_tool_use" && currentBlockName === "web_search") {
              pendingSearchQuery = parseSearchQueryJson(currentToolInput);
              logHttpStreamDebug("web_search_start");
              send({ type: "searching", event: "start", kind: "search", query: pendingSearchQuery });
            }
            if (currentBlockType === "server_tool_use" && currentBlockName === "web_fetch") {
              pendingFetchUrl = parseFetchUrlJson(currentToolInput);
              logHttpStreamDebug("web_fetch_start");
              send({ type: "searching", event: "start", kind: "fetch", url: pendingFetchUrl });
            }
            if (currentBlockType === "thinking") {
              send({ type: "thinking", event: "end", fullText: thinkingText });
            }
            if (currentBlockType === "text" && metaExtractor) {
              const flushed = metaExtractor.end();
              emitMetaIfFound(flushed.meta);
              ingestProseText(flushed.proseText);
            }
            currentBlockType = null;
            currentBlockName = null;
          }
        };

        const handleOpenAILine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6);
          if (!data || data === "[DONE]") return;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }

          const type = typeof event.type === "string" ? event.type : "";
          if (type === "response.created" || type === "response.completed") {
            const responseRecord = event.response as Record<string, unknown> | undefined;
            if (responseRecord && typeof responseRecord.model === "string") {
              modelUsed = responseRecord.model;
            }
          }

          if (type === "response.output_text.delta") {
            const text = typeof event.delta === "string" ? event.delta : "";
            if (text) {
              if (metaExtractor) {
                const result = metaExtractor.push(text);
                emitMetaIfFound(result.meta);
                ingestProseText(result.proseText);
              } else {
                ingestProseText(text);
              }
            }
            return;
          }

          if (type === "response.output_text.annotation.added") {
            const citation = parseCitation(event.annotation);
            if (citation) ingestCitation(citation);
            return;
          }

          if (type === "response.output_item.added") {
            const item = event.item as Record<string, unknown> | undefined;
            const query = extractOpenAISearchQuery(item);
            if (query) pendingSearchQuery = query;
            if (item?.type === "web_search_call" && !searching) {
              searching = true;
              logHttpStreamDebug("web_search_start");
              send({ type: "searching", event: "start", query: pendingSearchQuery });
            }
            return;
          }

          if (type.includes("web_search_call") && !searching && !type.endsWith(".completed")) {
            searching = true;
            logHttpStreamDebug("web_search_start");
            send({ type: "searching", event: "start", query: pendingSearchQuery });
            return;
          }

          if (type.includes("web_search_call") && type.endsWith(".completed")) {
            if (searching) {
              searching = false;
              logHttpStreamDebug("web_search_end");
              send({ type: "searching", event: "end", query: pendingSearchQuery });
              pendingSearchQuery = "";
            }
            return;
          }

          if (type === "response.completed") {
            const responseRecord = event.response as Record<string, unknown> | undefined;
            for (const annotation of extractOpenAIAnnotationsFromResponse(responseRecord)) {
              const citation = parseCitation(annotation);
              if (citation) ingestCitation(citation);
            }
          }
        };

        try {
          while (true) {
            const result = await upstreamReader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value, { stream: true });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex >= 0) {
              const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
              buffer = buffer.slice(newlineIndex + 1);
              if (provider === "openai") handleOpenAILine(line);
              else handleAnthropicLine(line);
              newlineIndex = buffer.indexOf("\n");
            }
          }

          if (buffer.trim().length > 0) {
            if (provider === "openai") handleOpenAILine(buffer.trim());
            else handleAnthropicLine(buffer.trim());
          }

          if (searching) {
            send({ type: "searching", event: "end", kind: "search", query: pendingSearchQuery });
          }

          if (fetching) {
            send({ type: "searching", event: "end", kind: "fetch", url: pendingFetchUrl });
          }

          if (metaExtractor) {
            const flushed = metaExtractor.end();
            emitMetaIfFound(flushed.meta);
            ingestProseText(flushed.proseText);
          }

          const finalText = fullText.trim();
          logHttpStreamDebug("stream_complete_before_store", {
            finalTextLength: finalText.length,
            chunkEvents,
            thinkingLength: thinkingText.length,
            citationCount: citations.size,
            segmentCount: textSegments.length,
            modelUsed,
            meta: metaPayload,
          });

          send({
            type: "done",
            fullText: finalText,
            citations: Array.from(citations.values()),
            textSegments: cloneTextSegments(textSegments),
            modelUsed,
            ...(metaPayload ? { meta: metaPayload } : {}),
          });
          logHttpStreamDebug("done_sent");
          controller.close();
        } catch (error) {
          logHttpStreamDebug("stream_error", {
            chunkEvents,
            citationCount: citations.size,
          });
          send({
            type: "error",
            error: "Managed response stream ended unexpectedly",
          });
          controller.close();
        } finally {
          upstreamReader.releaseLock();
        }
      },
      cancel: async () => {
        try {
          await upstreamReader.cancel();
        } catch {
          // no-op
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }),
});

http.route({
  path: "/resolve-citation-publishers",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = (await readJsonObject(request, 64_000)) as
      | (ResolveCitationPublishersRequest & Record<string, unknown>)
      | null;
    if (!payload) {
      return jsonError("Invalid JSON payload", 400);
    }

    if (!Array.isArray(payload.urls) || payload.urls.length > MAX_CITATION_PUBLISHER_URLS) {
      return jsonError(
        `Expected at most ${MAX_CITATION_PUBLISHER_URLS} urls`,
        400
      );
    }

    logHttpStreamDebug("citation_publishers_request_received", {
      requestedUrlCount: payload.urls.length,
    });

    const normalizedUrls = payload.urls
      .map((url) => normalizePublicCitationUrl(url))
      .filter((url): url is string => typeof url === "string")
      .slice(0, MAX_CITATION_PUBLISHER_URLS);

    if (normalizedUrls.length === 0) {
      return jsonOk({ publishers: {} });
    }

    const originToRepresentativeUrl = new Map<string, string>();
    const originToUrls = new Map<string, Set<string>>();
    for (const url of normalizedUrls) {
      const origin = getUrlOrigin(url);
      if (!origin) continue;

      if (!originToRepresentativeUrl.has(origin)) {
        originToRepresentativeUrl.set(origin, url);
      }

      const existing = originToUrls.get(origin);
      if (existing) {
        existing.add(url);
      } else {
        originToUrls.set(origin, new Set([url]));
      }
    }

    const representativeUrls = Array.from(originToRepresentativeUrl.values());
    logHttpStreamDebug("citation_publishers_request_normalized", {
      normalizedUrlCount: normalizedUrls.length,
      representativeUrlCount: representativeUrls.length,
    });

    const originPublishers = await ctx.runAction(internal.citationResolver.resolvePublishers, {
      urls: representativeUrls,
    });

    const publishers: Record<string, string> = {};
    for (const [origin, urls] of originToUrls.entries()) {
      const publisher = originPublishers.publishers[origin];
      if (!publisher) continue;
      for (const url of urls) {
        publishers[url] = publisher;
      }
    }

    logHttpStreamDebug("citation_publishers_response_ready", {
      representativeResolvedCount: Object.keys(originPublishers.publishers).length,
      resolvedUrlCount: Object.keys(publishers).length,
    });

    return jsonOk({ publishers });
  }),
});

export default http;

async function readJsonObject(
  request: Request,
  maxBytes = 512_000
): Promise<Record<string, unknown> | null> {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      receivedBytes += result.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }

    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

function readManagedCustomLens(
  value: unknown
): { instruction: string; name?: string } | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const instruction = readBoundedString(record.instruction, 10_000);
  if (!instruction) return null;
  const name = record.name === undefined ? undefined : readBoundedString(record.name, 200);
  if (record.name !== undefined && !name) return null;
  return { instruction, ...(name ? { name } : {}) };
}

function readManagedAnnotations(value: unknown): StreamAskFindingRequest["annotations"] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const annotations: StreamAskFindingRequest["annotations"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const lensId = readBoundedString(record.lensId, 200);
    const label = readBoundedString(record.label, 200);
    const category = readBoundedString(record.category, 200);
    const text = readBoundedString(record.text, 10_000);
    const detail = readBoundedString(record.detail, 10_000);
    const confidence = record.confidence;
    if (
      !lensId ||
      !label ||
      !category ||
      !text ||
      !detail ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      return null;
    }
    annotations.push({ lensId, label, category, text, detail, confidence });
  }
  return annotations;
}

function readManagedConversation(
  value: unknown
): Array<{ role: "user" | "assistant"; content: string }> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of value.slice(-12)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") return null;
    const content = readBoundedString(record.content, 50_000);
    if (!content) continue;
    messages.push({ role: record.role, content });
  }
  return messages;
}

function managedActionError(_error: unknown, fallback: string): Response {
  return jsonError(fallback, 502);
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function jsonOk(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function mapUpstreamErrorStatus(status: number): number {
  if (status === 401 || status === 403 || status === 429) return status;
  if (status >= 400 && status < 500) return 400;
  return 503;
}

function getLensNamesForAnnotations(annotations: Array<{ lensId: string }>) {
  const lensNameMap = new Map<string, string>();
  const uniqueLensIds = [...new Set(annotations.map((annotation) => annotation.lensId))];

  for (const lensId of uniqueLensIds) {
    const builtInLens = getBuiltInLens(lensId);
    if (builtInLens) {
      lensNameMap.set(lensId, builtInLens.name);
      continue;
    }

    // Managed requests do not read installation-specific lens records. Custom
    // ids remain useful provenance without exposing a legacy shared row.
    lensNameMap.set(lensId, lensId);
  }

  return lensNameMap;
}

const MAX_PAGE_CONTEXT_CHARS = 50_000;

function truncatePageContext(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= MAX_PAGE_CONTEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PAGE_CONTEXT_CHARS)}\n\n[…truncated by Lenses to fit context window]`;
}

function formatAnnotationContext(
  annotations: Array<{
    lensId: string;
    label: string;
    category: string;
    text: string;
    detail: string;
    confidence: number;
  }>,
  lensNames: Map<string, string>
) {
  return annotations
    .map((annotation, index) => {
      const confidence = Math.round(annotation.confidence * 100);
      const lensName = lensNames.get(annotation.lensId) ?? annotation.lensId;
      return (
        `${index + 1}. Lens: ${lensName}\n` +
        `   Label: ${annotation.label}\n` +
        `   Category: ${annotation.category}\n` +
        `   Confidence: ${confidence}%\n` +
        `   Text: "${annotation.text}"\n` +
        `   Detail: ${annotation.detail}`
      );
    })
    .join("\n\n");
}

function resolveTargetLensId(
  targetLensId: string | undefined,
  annotations: Array<{ lensId: string }>
) {
  if (targetLensId && annotations.some((annotation) => annotation.lensId === targetLensId)) {
    return targetLensId;
  }
  return annotations[0]?.lensId;
}

function resolveLensChatSettings(targetLensId: string | undefined): LensChatSettings {
  if (!targetLensId) return DEFAULT_LENS_CHAT_SETTINGS;
  return LENS_CHAT_SETTINGS[targetLensId] ?? DEFAULT_LENS_CHAT_SETTINGS;
}

function resolveStreamResponseStyle(
  targetLensId: string | undefined
): StreamResponseStyle {
  if (targetLensId === "source-tracer") {
    return SOURCE_TRACER_STREAM_RESPONSE_STYLE;
  }
  return DEFAULT_STREAM_RESPONSE_STYLE;
}

function resolveSelectionMode(value: unknown): SelectionMode | undefined {
  if (typeof value !== "string") return undefined;
  return (SELECTION_MODE_VALUES as readonly string[]).includes(value)
    ? (value as SelectionMode)
    : undefined;
}

function resolveStreamMaxCitations(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function buildAskFindingSystemPrompt(
  settings: LensChatSettings,
  responseStyle: StreamResponseStyle,
  mode: "annotations" | "selection" | "source" = "annotations"
): string {
  const formatRule =
    "Write in plain conversational prose. Avoid markdown headers (#, ##), do not " +
    "use bullet or numbered lists unless the answer is genuinely a list of items, " +
    "and skip block quotes. Bold/italic are fine sparingly for emphasis. " +
    "If a clarification is needed, just ask in one or two sentences — do not " +
    "format the request as a document.";

  const annotationBase =
    "You help users investigate highlighted issues in text. " +
    "Ground answers in the provided annotation context and avoid inventing facts. " +
    "If context is insufficient, say what is missing and suggest verification steps.";

  const selectionBase =
    "The user selected a passage on a webpage and is asking a question about it. " +
    "Ground your answer in the selected text and the surrounding page text provided " +
    "as context. Keep answers tight and concrete — typically 2 to 5 sentences. " +
    "If the user's question is ambiguous, ask one short clarifying question instead " +
    "of guessing. Do not invent facts that aren't supported by the selection or page.";

  const sourceBase =
    "You are Lenses, a source-grounded assistant for the page or video the user is reading. " +
    "Answer the user's question grounded in the provided source first, in a clear, " +
    "conversational way. If the source doesn't cover something, say so plainly rather " +
    "than inventing facts.";

  const basePrompt =
    mode === "selection" ? selectionBase : mode === "source" ? sourceBase : annotationBase;

  if (!settings.webSearch) {
    return `${basePrompt} ${formatRule}`;
  }

  const citationInstruction = settings.requireCitations
    ? "Every material claim should include inline citations from retrieved sources. "
    : "";
  const brevityInstruction = responseStyle.preferBrief
    ? "Keep the response short and direct: no more than 8 short sentences total. "
    : "";
  const effortInstruction = responseStyle.preferLowEffort
    ? "Do the minimum work needed: use a small number of targeted searches and stop once evidence is sufficient. "
    : "";

  return (
    `${basePrompt} ` +
    "You can use web search and web fetch. For factual or sourcing questions, search the web before answering rather than relying on memory, and run several focused searches across different angles when the question benefits from it. When a result looks important, fetch the page to read it in full instead of relying on the snippet. " +
    "Prefer primary sources and high-quality reporting. " +
    (mode === "annotations"
      ? "Focus on surfacing the sources and evidence, not why the text was flagged. "
      : "") +
    "Use plain text only: no markdown headers, no markdown lists, no code fences. " +
    brevityInstruction +
    effortInstruction +
    citationInstruction +
    "Do not add a separate 'Sources' section at the end; citations must be inline. " +
    "If evidence is mixed or weak, clearly say that."
  );
}

function getUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function parseCitation(citation: unknown): WebCitation | null {
  if (!citation || typeof citation !== "object") return null;
  const record = citation as Record<string, unknown>;
  const nested =
    record.type === "url_citation" && record.url_citation && typeof record.url_citation === "object"
      ? (record.url_citation as Record<string, unknown>)
      : record;

  const rawUrl = typeof nested.url === "string" ? nested.url.trim() : "";
  if (!rawUrl) return null;

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(rawUrl).toString();
  } catch {
    return null;
  }

  const title =
    typeof nested.title === "string" && nested.title.trim()
      ? nested.title.trim()
      : new URL(normalizedUrl).hostname;

  const citedText =
    typeof nested.cited_text === "string" && nested.cited_text.trim()
      ? nested.cited_text.trim()
      : undefined;

  return {
    url: normalizedUrl,
    title,
    citedText,
  };
}

function extractOpenAIAnnotationsFromResponse(
  response: Record<string, unknown> | undefined
): unknown[] {
  if (!response || !Array.isArray(response.output)) return [];
  const annotations: unknown[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.content)) continue;
    for (const content of record.content) {
      if (!content || typeof content !== "object") continue;
      const contentRecord = content as Record<string, unknown>;
      if (Array.isArray(contentRecord.annotations)) {
        annotations.push(...contentRecord.annotations);
      }
    }
  }
  return annotations;
}

function cloneTextSegments(segments: StreamTextSegment[]): StreamTextSegment[] {
  return segments.map((segment) => ({
    text: segment.text,
    citations: segment.citations.map((citation) => ({
      url: citation.url,
      title: citation.title,
      citedText: citation.citedText,
    })),
  }));
}
