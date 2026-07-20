// Local BYOK streaming for the "lenses-finding-stream" port — parity with the
// managed /managed/ask-finding/stream pipeline. The selection and annotation
// chats get the same prompt flavors, web search + web fetch tools, streamed
// thinking, inline citations, and the structured verdict header the "Check"
// quick action renders as a pill. Only the transport differs: the user's own
// provider key, called directly from the service worker.

import { Effect } from "effect";
import {
  MetaHeaderExtractor,
  buildMetaInstruction,
  getMetaSchemaForMode,
  type ParsedMeta,
  type SelectionMode,
} from "@lenses/shared";
import { isClaudeModel, usesAdaptiveThinking } from "../types/claude";
import type { ConversationMessage, TextSegment } from "../types/ai-content";
import { makeApiCall } from "./api/claude-client";
import { makeOpenAIApiCall } from "./api/openai-client";
import {
  getStreamingErrorMessage,
  makePortCallbacks,
  readOpenAIStreamingResponse,
  readStreamingResponse,
} from "./assistant-streaming";
import type { LocalAiSettings } from "./local-runtime";
import type { StreamCallbacks } from "./types";

export interface LocalFindingStreamRequest {
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
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
}

interface ChatSettings {
  webSearch: boolean;
  requireCitations: boolean;
}

interface ResponseStyle {
  preferBrief: boolean;
  preferLowEffort: boolean;
}

// Mirrors the managed pipeline's per-flavor tables (convex/http.ts).
const DEFAULT_LENS_CHAT_SETTINGS: ChatSettings = {
  webSearch: false,
  requireCitations: false,
};

const SELECTION_CHAT_SETTINGS: ChatSettings = {
  webSearch: true,
  requireCitations: true,
};

const LENS_CHAT_SETTINGS: Record<string, ChatSettings> = {
  "source-tracer": { webSearch: true, requireCitations: true },
};

const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
  preferBrief: false,
  preferLowEffort: false,
};

const SELECTION_RESPONSE_STYLE: ResponseStyle = {
  preferBrief: false,
  preferLowEffort: true,
};

const LENS_RESPONSE_STYLES: Record<string, ResponseStyle> = {
  "source-tracer": { preferBrief: true, preferLowEffort: true },
};

const MAX_PAGE_CONTEXT_CHARS = 50_000;
const STREAM_MAX_TOKENS = 8_192;

export interface LocalAskFindingPrompt {
  systemPrompt: string;
  contextMessage: string;
  webSearch: boolean;
}

export function buildLocalAskFindingPrompt(
  request: LocalFindingStreamRequest
): LocalAskFindingPrompt {
  const selectionText = request.selectionText?.trim() ?? "";
  const isSelectionMode = request.annotations.length === 0 && selectionText.length > 0;
  const targetLensId =
    request.targetLensId?.trim() || request.annotations[0]?.lensId || "";

  const settings = isSelectionMode
    ? SELECTION_CHAT_SETTINGS
    : (LENS_CHAT_SETTINGS[targetLensId] ?? DEFAULT_LENS_CHAT_SETTINGS);
  const style = isSelectionMode
    ? SELECTION_RESPONSE_STYLE
    : (LENS_RESPONSE_STYLES[targetLensId] ?? DEFAULT_RESPONSE_STYLE);

  let systemPrompt = buildSystemPrompt(settings, style, isSelectionMode);
  const metaSchema = isSelectionMode
    ? getMetaSchemaForMode(request.selectionMode)
    : null;
  if (metaSchema) {
    systemPrompt += `\n\n${buildMetaInstruction(metaSchema)}`;
  }

  const sourceContext = request.sourceUrl
    ? `Source URL: ${request.sourceUrl}`
    : "Source URL: unknown";

  let contextMessage: string;
  if (isSelectionMode) {
    const boundedPageContext = (request.pageContext ?? "").slice(
      0,
      MAX_PAGE_CONTEXT_CHARS
    );
    const pageBlock = boundedPageContext
      ? `Page text (extracted via the lens extraction pipeline; may be truncated):\n"""\n${boundedPageContext}\n"""`
      : "Page text: unavailable";
    contextMessage =
      `${sourceContext}\n\n` +
      `Selected text from the page:\n"""\n${selectionText}\n"""\n\n` +
      `${pageBlock}\n\n` +
      (settings.webSearch
        ? "Answer the user's question about the selected text. Use the page text as supporting context. Use web search when needed to verify claims; be explicit about uncertainty."
        : "Answer the user's question about the selected text. Use the page text as supporting context. Be concise and practical.");
  } else {
    const annotationContext = request.annotations
      .map((annotation, index) => {
        const confidence = Math.round(annotation.confidence * 100);
        return (
          `${index + 1}. Lens: ${annotation.lensId}\n` +
          `   Label: ${annotation.label}\n` +
          `   Category: ${annotation.category}\n` +
          `   Confidence: ${confidence}%\n` +
          `   Text: "${annotation.text}"\n` +
          `   Detail: ${annotation.detail}`
        );
      })
      .join("\n\n");
    contextMessage =
      `${sourceContext}\n\nAnnotation context:\n${annotationContext}\n\n` +
      (settings.webSearch
        ? "Use web search when needed to verify claims. Be explicit about uncertainty."
        : "Use concise, practical language. Include alternative interpretations when relevant.");
  }

  return { systemPrompt, contextMessage, webSearch: settings.webSearch };
}

function buildSystemPrompt(
  settings: ChatSettings,
  style: ResponseStyle,
  isSelectionMode: boolean
): string {
  const formatRule =
    "Write in plain conversational prose. Avoid markdown headers (#, ##), do not " +
    "use bullet or numbered lists unless the answer is genuinely a list of items, " +
    "and skip block quotes. Bold/italic are fine sparingly for emphasis. " +
    "If a clarification is needed, just ask in one or two sentences — do not " +
    "format the request as a document.";

  const basePrompt = isSelectionMode
    ? "The user selected a passage on a webpage and is asking a question about it. " +
      "Ground your answer in the selected text and the surrounding page text provided " +
      "as context. Keep answers tight and concrete — typically 2 to 5 sentences. " +
      "If the user's question is ambiguous, ask one short clarifying question instead " +
      "of guessing. Do not invent facts that aren't supported by the selection or page."
    : "You help users investigate highlighted issues in text. " +
      "Ground answers in the provided annotation context and avoid inventing facts. " +
      "If context is insufficient, say what is missing and suggest verification steps.";

  if (!settings.webSearch) {
    return `${basePrompt} ${formatRule}`;
  }

  const citationInstruction = settings.requireCitations
    ? "Every material claim should include inline citations from retrieved sources. "
    : "";
  const brevityInstruction = style.preferBrief
    ? "Keep the response short and direct: no more than 8 short sentences total. "
    : "";
  const effortInstruction = style.preferLowEffort
    ? "Do the minimum work needed: use a small number of targeted searches and stop once evidence is sufficient. "
    : "";

  return (
    `${basePrompt} ` +
    "You can use web search and web fetch. For factual or sourcing questions, search the web before answering rather than relying on memory, and run several focused searches across different angles when the question benefits from it. When a result looks important, fetch the page to read it in full instead of relying on the snippet. " +
    "Prefer primary sources and high-quality reporting. " +
    (!isSelectionMode
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

/**
 * Drop the first `count` characters from a cumulative segment list. Used to
 * hide the structured JSON header from citation-bearing segments — the header
 * always precedes any web-tool citation, so dropped prefixes carry none.
 */
export function stripLeadingCharsFromSegments(
  segments: TextSegment[],
  count: number
): TextSegment[] {
  if (count <= 0) return segments;
  let remaining = count;
  const result: TextSegment[] = [];
  for (const segment of segments) {
    if (remaining <= 0) {
      result.push(segment);
      continue;
    }
    if (segment.text.length <= remaining) {
      remaining -= segment.text.length;
      continue;
    }
    result.push({ ...segment, text: segment.text.slice(remaining) });
    remaining = 0;
  }
  return result;
}

interface FindingStreamResult {
  fullText: string;
  textSegments: TextSegment[];
  citations: Array<{ url: string; title: string; citedText: string }>;
  meta: ParsedMeta | null;
}

// Wraps the shared port callbacks so the structured header (when a schema is
// active) is parsed out of the prose exactly as the managed stream does:
// withhold it from chunk/segment events, emit one `meta` event, and report
// prose-only text at the end.
export function makeLocalFindingCallbacks(
  port: chrome.runtime.Port,
  schemaMode: SelectionMode | undefined,
  useSchema: boolean
): { callbacks: StreamCallbacks; finalize: (rawFullText: string) => FindingStreamResult } {
  const base = makePortCallbacks(port);
  const schema = useSchema ? getMetaSchemaForMode(schemaMode) : null;
  const extractor = schema ? new MetaHeaderExtractor(schema) : null;

  let rawLength = 0;
  let proseLength = 0;
  let meta: ParsedMeta | null = null;
  let lastSegments: TextSegment[] = [];
  let lastCitations: Array<{ url: string; title: string; citedText: string }> = [];

  // Characters consumed as header so far; constant once the extractor settles,
  // and zero when there is no extractor or no header was found.
  const headerLength = () => rawLength - proseLength;

  const emitMeta = (parsed: ParsedMeta | null) => {
    if (!parsed || meta) return;
    meta = parsed;
    port.postMessage({ type: "meta", meta: parsed });
  };

  const callbacks: StreamCallbacks = {
    onChunk: (text, textSegments) => {
      lastSegments = textSegments;
      if (!extractor) {
        base.onChunk(text, textSegments);
        return;
      }
      rawLength += text.length;
      const result = extractor.push(text);
      emitMeta(result.meta);
      if (!result.proseText) return;
      proseLength += result.proseText.length;
      base.onChunk(
        result.proseText,
        stripLeadingCharsFromSegments(textSegments, headerLength())
      );
    },
    onThinking: base.onThinking,
    onSearching: base.onSearching,
    onCitations: (citations, textSegments) => {
      lastCitations = citations;
      lastSegments = textSegments;
      base.onCitations(
        citations,
        stripLeadingCharsFromSegments(textSegments, headerLength())
      );
    },
    onCredibility: base.onCredibility,
  };

  const finalize = (rawFullText: string): FindingStreamResult => {
    if (extractor) {
      // A stream that ended while the header was still buffering flushes the
      // buffer as prose so no text is ever lost.
      const flushed = extractor.end();
      emitMeta(flushed.meta);
      if (flushed.proseText) {
        proseLength += flushed.proseText.length;
        base.onChunk(
          flushed.proseText,
          stripLeadingCharsFromSegments(lastSegments, headerLength())
        );
      }
    }
    return {
      fullText: rawFullText.slice(headerLength()),
      textSegments: stripLeadingCharsFromSegments(lastSegments, headerLength()),
      citations: lastCitations,
      meta,
    };
  };

  return { callbacks, finalize };
}

export async function streamLocalAskFindingOverPort(
  port: chrome.runtime.Port,
  request: LocalFindingStreamRequest,
  aiSettings: LocalAiSettings,
  signal: AbortSignal
): Promise<void> {
  const apiKey = aiSettings.apiKey?.trim();
  if (!apiKey) {
    port.postMessage({
      type: "error",
      error: `No ${aiSettings.provider === "openai" ? "OpenAI" : "Anthropic"} API key configured`,
    });
    return;
  }

  const selectionText = request.selectionText?.trim() ?? "";
  const isSelectionMode = request.annotations.length === 0 && selectionText.length > 0;
  const prompt = buildLocalAskFindingPrompt(request);
  const { callbacks, finalize } = makeLocalFindingCallbacks(
    port,
    request.selectionMode,
    isSelectionMode
  );

  const messages: ConversationMessage[] = [
    { role: "user", content: prompt.contextMessage },
    ...(request.conversation ?? []),
    { role: "user", content: request.question },
  ];

  const streamEffect = Effect.gen(function* () {
    const response =
      aiSettings.provider === "openai"
        ? yield* makeOpenAIApiCall({
            apiKey,
            model: aiSettings.model,
            maxTokens: STREAM_MAX_TOKENS,
            system: prompt.systemPrompt,
            messages,
            stream: true,
            reasoningEffort: aiSettings.reasoningEffort,
            tools: prompt.webSearch
              ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
              : undefined,
            signal,
          })
        : yield* makeApiCall({
            apiKey,
            model: aiSettings.model,
            maxTokens: STREAM_MAX_TOKENS,
            system: prompt.systemPrompt,
            messages,
            stream: true,
            reasoningEffort: aiSettings.reasoningEffort,
            thinking:
              isClaudeModel(aiSettings.model) && usesAdaptiveThinking(aiSettings.model)
                ? { type: "adaptive", display: "summarized" }
                : undefined,
            tools: prompt.webSearch
              ? [
                  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
                  {
                    type: "web_fetch_20250910",
                    name: "web_fetch",
                    max_uses: 3,
                    citations: { enabled: true },
                  },
                ]
              : undefined,
            signal,
          });

    return aiSettings.provider === "openai"
      ? yield* readOpenAIStreamingResponse(response, callbacks)
      : yield* readStreamingResponse(response, callbacks);
  });

  try {
    const rawFullText = await Effect.runPromise(streamEffect);
    if (signal.aborted) return;
    const result = finalize(rawFullText);
    port.postMessage({
      type: "done",
      fullText: result.fullText,
      citations: result.citations,
      textSegments: result.textSegments,
      ...(result.meta ? { meta: result.meta } : {}),
      modelUsed: aiSettings.model,
    });
  } catch (error) {
    if (signal.aborted) return;
    try {
      port.postMessage({ type: "error", error: getStreamingErrorMessage(error) });
    } catch {
      // Port is likely closed.
    }
  }
}
