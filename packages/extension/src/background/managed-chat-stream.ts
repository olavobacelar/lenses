/**
 * Managed source-chat relay.
 *
 * In managed mode every chat surface — the sidebar and the in-page selection
 * chat — streams through the same `/managed/ask-finding/stream`
 * endpoint. This helper POSTs a source-grounded chat request and relays the
 * normalized SSE events (chunk / thinking / searching / citations / done /
 * error) straight to the surface's port, which is the same event contract the
 * BYOK direct-streaming path emits. The grouped web-search/fetch trace rides
 * along on the `searching` events untouched.
 */

import { getConvexSiteBaseUrl, readConfiguredConvexUrl } from "../lib/convex-url";
import { readManagedApiError } from "../lib/managed-api";
import type { ReasoningEffort } from "../lib/reasoning-settings";
import type { AiModel, ModelProvider } from "../types/ai-models";

export interface ManagedSourceChatRequest {
  question: string;
  source: {
    kind: "web_page" | "youtube_video" | "pdf";
    title?: string;
    url?: string;
    text: string;
    scope: "page" | "selection" | "transcript";
  };
  // Loose content: chat history carries MessageContent (string | blocks); the
  // Convex endpoint wants plain strings, so it's coerced before sending.
  conversation?: Array<{ role: "user" | "assistant"; content: unknown }>;
  sourceUrl?: string;
}

export interface ManagedChatAiSettings {
  provider: ModelProvider;
  model: AiModel;
  reasoningEffort?: ReasoningEffort;
}

/** Cap the source payload so a long page/transcript doesn't bloat the request. */
const SOURCE_TEXT_MAX_CHARS = 120_000;

export function buildManagedSourceChatPayload(
  request: ManagedSourceChatRequest,
  aiSettings: ManagedChatAiSettings
) {
  return {
    question: request.question,
    source: {
      ...request.source,
      text: request.source.text.slice(0, SOURCE_TEXT_MAX_CHARS),
    },
    sourceUrl: request.sourceUrl ?? request.source.url,
    conversation: toPlainConversation(request.conversation),
    provider: aiSettings.provider,
    model: aiSettings.model,
    reasoningEffort: aiSettings.reasoningEffort,
  };
}

export async function streamSourceChatViaManagedService(
  port: chrome.runtime.Port,
  request: ManagedSourceChatRequest,
  aiSettings: ManagedChatAiSettings,
  signal: AbortSignal
): Promise<void> {
  const convexUrl = await readConfiguredConvexUrl();
  const siteUrl = getConvexSiteBaseUrl(convexUrl);

  let response: Response;
  try {
    response = await fetch(`${siteUrl}/managed/ask-finding/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildManagedSourceChatPayload(request, aiSettings)),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    postSafe(port, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!response.ok || !response.body) {
    const message = await readManagedApiError(
      response,
      `Streaming API error: ${response.status}`
    );
    postSafe(port, { type: "error", error: message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  const flush = (rawEvent: string): boolean => {
    for (const event of parseSseDataObjects(rawEvent)) {
      if (event.type === "done") sawDone = true;
      if (!postSafe(port, event)) return false;
    }
    return true;
  };

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r", "");
      let marker = buffer.indexOf("\n\n");
      while (marker >= 0) {
        const rawEvent = buffer.slice(0, marker);
        buffer = buffer.slice(marker + 2);
        if (!flush(rawEvent)) return;
        marker = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim().length > 0 && !flush(buffer.trim())) return;
    // A dropped stream may never deliver `done`; close the turn so the UI
    // doesn't hang in a streaming state.
    if (!sawDone) postSafe(port, { type: "done", fullText: "" });
  } finally {
    reader.releaseLock();
  }
}

/** Coerce chat history to the `{ role, content: string }` shape Convex expects. */
function toPlainConversation(
  conversation: ManagedSourceChatRequest["conversation"]
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(conversation)) return [];
  return conversation.map((message) => ({
    role: message.role,
    content: plainText(message.content),
  }));
}

function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function postSafe(port: chrome.runtime.Port, event: Record<string, unknown>): boolean {
  try {
    port.postMessage(event);
    return true;
  } catch {
    return false;
  }
}

function parseSseDataObjects(rawEvent: string): Array<Record<string, unknown> & { type?: string }> {
  const events: Array<Record<string, unknown> & { type?: string }> = [];
  for (const line of rawEvent.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        events.push(parsed as Record<string, unknown> & { type?: string });
      }
    } catch {
      // Ignore malformed stream fragments.
    }
  }
  return events;
}
