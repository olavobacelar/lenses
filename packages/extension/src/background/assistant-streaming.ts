import { Effect } from "effect";
import {
  type ClaudeModel,
  usesAdaptiveThinking,
} from "../types/claude";
import type { AiModel } from "../types/ai-models";
import type {
  ConversationMessage,
  TextSegment,
  SystemPromptPart,
} from "../types/ai-content";
import {
  DEFAULT_REASONING_EFFORT,
  type ReasoningEffort,
} from "../lib/reasoning-settings";
import type { VideoTime } from "../types/transcript";
import { makeApiCall } from "./api/claude-client";
import { makeOpenAIApiCall } from "./api/openai-client";
import { createInitialStreamState, processStreamLine } from "./api/stream-processor";
import { buildUserContent } from "./prompts/system";
import {
  ApiParseError,
  TranscriptNotAvailableError,
  type StreamCallbacks,
} from "./types";

export const streamClaudeAPIEffect = (
  apiKey: string,
  systemPrompt: SystemPromptPart[],
  userMessage: string,
  conversationHistory: ConversationMessage[],
  screenshots: string[],
  currentTime: VideoTime | null,
  callbacks: StreamCallbacks,
  model: ClaudeModel,
  reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT
) =>
  Effect.gen(function* () {
    const userContent = buildUserContent(userMessage, screenshots, currentTime);
    const messages: ConversationMessage[] = [
      ...conversationHistory,
      { role: "user", content: userContent },
    ];

    const response = yield* makeApiCall({
      apiKey,
      model,
      maxTokens: 16000,
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
        {
          name: "report_credibility",
          description:
            "Report the credibility assessment when verifying a claim. Call this tool to provide a structured credibility rating separate from your text response. Only use this when asked to verify a claim.",
          input_schema: {
            type: "object",
            properties: {
              rating: {
                type: "string",
                enum: ["low", "medium", "high"],
                description:
                  "Credibility level: low (unverified/contradictory), medium (partially verified), high (well-corroborated)",
              },
              reasoning: {
                type: "string",
                description: "Brief explanation for the rating (1-2 sentences)",
              },
            },
            required: ["rating"],
          },
        },
      ],
    });

    return yield* readStreamingResponse(response, callbacks);
  });

export const streamOpenAIAPIEffect = (
  apiKey: string,
  systemPrompt: SystemPromptPart[],
  userMessage: string,
  conversationHistory: ConversationMessage[],
  screenshots: string[],
  currentTime: VideoTime | null,
  callbacks: StreamCallbacks,
  model: AiModel,
  reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT
) =>
  Effect.gen(function* () {
    const userContent = buildUserContent(userMessage, screenshots, currentTime);
    const messages: ConversationMessage[] = [
      ...conversationHistory,
      { role: "user", content: userContent },
    ];

    const response = yield* makeOpenAIApiCall({
      apiKey,
      model,
      maxTokens: 12000,
      system: systemPrompt,
      messages,
      stream: true,
      reasoningEffort,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });

    return yield* readOpenAIStreamingResponse(response, callbacks);
  });

export function getStreamingErrorMessage(error: unknown): string {
  if (error instanceof TranscriptNotAvailableError) {
    return "No transcript available for this video.";
  }
  if (error && typeof error === "object" && "_tag" in error) {
    const taggedError = error as { _tag: string; message?: string };
    if (taggedError._tag === "ApiKeyNotConfiguredError") return "API key not configured";
    if (taggedError._tag === "TranscriptNotAvailableError") {
      return "No transcript available for this video.";
    }
    if (taggedError._tag === "ApiRequestError") {
      return taggedError.message || "API request failed";
    }
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

export const readStreamingResponse = (response: Response, callbacks: StreamCallbacks) =>
  Effect.gen(function* () {
    const reader = response.body?.getReader();
    if (!reader) {
      return yield* Effect.fail(new ApiParseError({ message: "Streaming response had no body." }));
    }

    const decoder = new TextDecoder();
    let state = createInitialStreamState();

    while (true) {
      const result = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (error) => new ApiParseError({ message: `Stream read error: ${error}` }),
      });

      if (result.done) break;

      const chunk = decoder.decode(result.value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        state = processStreamLine(line, state, callbacks);
      }
    }

    if (state.citations.length > 0) {
      callbacks.onCitations(state.citations, state.textSegments);
    }

    return state.fullText;
  });

export const readOpenAIStreamingResponse = (response: Response, callbacks: StreamCallbacks) =>
  Effect.gen(function* () {
    const reader = response.body?.getReader();
    if (!reader) {
      return yield* Effect.fail(new ApiParseError({ message: "Streaming response had no body." }));
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let textSegments: TextSegment[] = [];
    const citations = new Map<string, OpenAIUrlCitation>();
    let searching = false;
    // OpenAI carries the query on the web_search_call item; the search result
    // events that follow don't repeat it, so hold onto it across the pair.
    let pendingQuery = "";

    const addText = (text: string) => {
      if (!text) return;
      fullText += text;
      if (citations.size > 0) {
        textSegments = buildOpenAITextSegments(fullText, Array.from(citations.values()));
      } else if (textSegments.length === 0) {
        textSegments = [{ text, citations: [] }];
      } else {
        const segments = [...textSegments];
        const last = segments[segments.length - 1];
        segments[segments.length - 1] = {
          ...last,
          text: last.text + text,
        };
        textSegments = segments;
      }
      callbacks.onChunk(text, textSegments);
    };

    const addCitation = (annotation: unknown) => {
      const citation = parseOpenAIUrlCitation(annotation);
      if (!citation) return;
      const key = openAICitationKey(citation);
      if (citations.has(key)) return;

      citations.set(key, citation);
      textSegments = buildOpenAITextSegments(fullText, Array.from(citations.values()));

      callbacks.onCitations(openAICitationsForCallbacks(citations), textSegments);
    };

    const handleEvent = (event: Record<string, unknown>) => {
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "response.output_text.delta") {
        addText(typeof event.delta === "string" ? event.delta : "");
        return;
      }

      if (type === "response.output_text.annotation.added") {
        addCitation(event.annotation);
        return;
      }

      if (type === "response.output_item.added") {
        const query = extractOpenAISearchQuery(event.item);
        if (query) pendingQuery = query;
        return;
      }

      if (type.includes("web_search_call") && !searching && !type.endsWith(".completed")) {
        searching = true;
        callbacks.onSearching({ type: "start", query: pendingQuery });
        return;
      }

      if (type.includes("web_search_call") && type.endsWith(".completed")) {
        if (searching) {
          searching = false;
          callbacks.onSearching({ type: "end", query: pendingQuery });
          pendingQuery = "";
        }
        return;
      }

      if (type === "response.completed") {
        const responseRecord = event.response as Record<string, unknown> | undefined;
        const outputAnnotations = extractOpenAIAnnotationsFromResponse(responseRecord);
        for (const annotation of outputAnnotations) {
          addCitation(annotation);
        }
      }
    };

    try {
      while (true) {
        const result = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: (error) => new ApiParseError({ message: `Stream read error: ${error}` }),
        });
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r", "");
        let marker = buffer.indexOf("\n\n");
        while (marker >= 0) {
          const rawEvent = buffer.slice(0, marker);
          buffer = buffer.slice(marker + 2);
          for (const event of parseSseDataEvents(rawEvent)) {
            handleEvent(event);
          }
          marker = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim().length > 0) {
        for (const event of parseSseDataEvents(buffer.trim())) {
          handleEvent(event);
        }
      }

      if (searching) {
        callbacks.onSearching({ type: "end" });
      }

      if (citations.size > 0) {
        callbacks.onCitations(openAICitationsForCallbacks(citations), textSegments);
      }

      return fullText;
    } finally {
      reader.releaseLock();
    }
  });

export function makePortCallbacks(port: chrome.runtime.Port): StreamCallbacks {
  return {
    onChunk: (text, textSegments) => {
      port.postMessage({ type: "chunk", text, textSegments });
    },
    onThinking: (event) => {
      port.postMessage({
        type: "thinking",
        event: event.type,
        text: event.text || "",
        fullText: event.fullText || "",
      });
    },
    onSearching: (event) => {
      port.postMessage({
        type: "searching",
        event: event.type,
        kind: event.kind,
        query: event.query,
        url: event.url,
        title: event.title,
        results: event.results,
      });
    },
    onCitations: (citations, textSegments) => {
      port.postMessage({ type: "citations", citations, textSegments });
    },
    onCredibility: (credibility) => {
      port.postMessage({ type: "credibility", credibility });
    },
  };
}

/** Read the search query off an OpenAI `web_search_call` output item. */
function extractOpenAISearchQuery(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  if (record.type !== "web_search_call") return "";
  const action = record.action;
  if (!action || typeof action !== "object") return "";
  const query = (action as Record<string, unknown>).query;
  return typeof query === "string" ? query : "";
}

function parseSseDataEvents(rawEvent: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of rawEvent.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed stream fragments.
    }
  }
  return events;
}

interface OpenAIUrlCitation {
  url: string;
  title: string;
  citedText: string;
  startIndex?: number;
  endIndex?: number;
}

function parseOpenAIUrlCitation(annotation: unknown): OpenAIUrlCitation | null {
  if (!annotation || typeof annotation !== "object") return null;
  const record = annotation as Record<string, unknown>;
  const nested =
    record.type === "url_citation" && record.url_citation && typeof record.url_citation === "object"
      ? (record.url_citation as Record<string, unknown>)
      : record;

  if (nested.type && nested.type !== "url_citation") return null;
  const url = typeof nested.url === "string" ? nested.url.trim() : "";
  if (!url) return null;

  try {
    const normalizedUrl = new URL(url).toString();
    const title =
      typeof nested.title === "string" && nested.title.trim()
        ? nested.title.trim()
        : new URL(normalizedUrl).hostname;
    const startIndex = finiteNumber(nested.start_index);
    const endIndex = finiteNumber(nested.end_index);
    return {
      url: normalizedUrl,
      title,
      citedText: "",
      ...(startIndex !== undefined && endIndex !== undefined ? { startIndex, endIndex } : {}),
    };
  } catch {
    return null;
  }
}

function openAICitationKey(citation: OpenAIUrlCitation): string {
  return [
    citation.startIndex ?? "",
    citation.endIndex ?? "",
    citation.url,
    citation.title,
  ].join("|");
}

function openAICitationsForCallbacks(
  citations: Map<string, OpenAIUrlCitation>
): Array<{ url: string; title: string; citedText: string }> {
  return Array.from(citations.values()).map(({ url, title, citedText }) => ({
    url,
    title,
    citedText,
  }));
}

function buildOpenAITextSegments(text: string, citations: OpenAIUrlCitation[]): TextSegment[] {
  const ranged = citations
    .map((citation) => openAICitationRange(citation, text.length))
    .filter((range): range is OpenAICitationRange => !!range)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.citation.url.localeCompare(b.citation.url));
  const fallback = citations.filter((citation) => !openAICitationRange(citation, text.length));
  const segments: TextSegment[] = [];
  let cursor = 0;

  const pushText = (value: string, segmentCitations: TextSegment["citations"] = []) => {
    if (!value && segmentCitations.length === 0) return;
    const last = segments[segments.length - 1];
    if (segmentCitations.length === 0 && last && last.citations.length === 0) {
      last.text += value;
      return;
    }
    segments.push({ text: value, citations: segmentCitations });
  };

  for (let index = 0; index < ranged.length; index++) {
    const range = ranged[index];
    const sameRange = [range];
    while (
      index + 1 < ranged.length &&
      ranged[index + 1].start === range.start &&
      ranged[index + 1].end === range.end
    ) {
      sameRange.push(ranged[++index]);
    }

    if (range.start > cursor) {
      pushText(text.slice(cursor, range.start));
      cursor = range.start;
    }

    const citationPayloads = sameRange.map(({ citation }) => openAITextSegmentCitation(citation));
    if (range.end > cursor) {
      pushText(text.slice(cursor, range.end), citationPayloads);
      cursor = range.end;
    } else {
      const last = segments[segments.length - 1];
      if (last) {
        last.citations = [...last.citations, ...citationPayloads];
      } else {
        pushText("", citationPayloads);
      }
    }
  }

  if (cursor < text.length) {
    pushText(text.slice(cursor));
  }

  if (fallback.length > 0) {
    const fallbackPayloads = fallback.map(openAITextSegmentCitation);
    const last = segments[segments.length - 1];
    if (last) {
      last.citations = [...last.citations, ...fallbackPayloads];
    } else {
      pushText(text, fallbackPayloads);
    }
  }

  return segments.length > 0 ? segments : [{ text, citations: [] }];
}

interface OpenAICitationRange {
  citation: OpenAIUrlCitation;
  start: number;
  end: number;
}

function openAICitationRange(
  citation: OpenAIUrlCitation,
  textLength: number
): OpenAICitationRange | null {
  const { startIndex, endIndex } = citation;
  if (startIndex === undefined || endIndex === undefined) return null;
  if (startIndex < 0 || endIndex <= startIndex || startIndex >= textLength) return null;
  return {
    citation,
    start: startIndex,
    end: Math.min(endIndex, textLength),
  };
}

function openAITextSegmentCitation(citation: OpenAIUrlCitation): TextSegment["citations"][number] {
  return {
    type: "url_citation",
    url: citation.url,
    title: citation.title,
    citedText: citation.citedText,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
