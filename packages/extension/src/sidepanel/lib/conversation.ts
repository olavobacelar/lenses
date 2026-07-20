// Identity + projection layer between the sidebar chat (PanelMessage) and the
// unified conversations store. The store is the same one the in-page selection
// and finding chats use — keyed by ConversationIdentity {sourceKey, sourceKind,
// scope, focus, focusRef}. Conversations stay in the browser-local database in
// both access modes; the selected mode changes AI execution, not persistence.
// The sidebar's whole-source thread is `focus: "source"` with no focusRef.
//
// Projection is deliberately narrower than PanelMessage:
// - only user/assistant turns persist (error bubbles are transient UI),
// - screenshots (data-URL images) never leave the device,
// - citation extras beyond {url, title, citedText} are trimmed to fit the
//   store's strict message shape, and re-defaulted on restore.

import type { TextSegment } from "../../types/ai-content";
import type { VideoTime } from "../../types/transcript";
import type { ChatActivityItem } from "../../lib/chat-activity";
import type { WebSearchEntry } from "../../lib/web-search";
import type { PanelMessage, PanelSource } from "../types";

export interface SidebarConversationIdentity {
  sourceKey: string;
  sourceUrl?: string;
  sourceKind: "web_page" | "youtube_video" | "pdf";
  scope: "page" | "transcript";
  focus: "source";
}

export interface SavedConversationCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface SavedConversationTextSegment {
  text: string;
  citations: SavedConversationCitation[];
}

export interface SavedConversationMessage {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  thinkingText?: string;
  textSegments?: SavedConversationTextSegment[];
  meta?: Record<string, string>;
  activity?: ChatActivityItem[];
  searches?: WebSearchEntry[];
  videoTimestamp?: { seconds: number; formatted: string };
}

/** Keep each stored thread bounded. */
export const SAVED_CONVERSATION_MESSAGE_LIMIT = 80;

export function sidebarConversationIdentity(
  source: PanelSource
): SidebarConversationIdentity {
  return {
    sourceKey: source.key,
    ...(source.url ? { sourceUrl: source.url } : null),
    sourceKind: source.kind,
    // The sidebar always chats about the whole source; "selection" is not a
    // sidebar scope, so anything unexpected degrades to "page".
    scope: source.scope === "transcript" ? "transcript" : "page",
    focus: "source",
  };
}

export function toSavedConversationMessages(
  messages: readonly PanelMessage[],
  limit = SAVED_CONVERSATION_MESSAGE_LIMIT
): SavedConversationMessage[] {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !message.isError &&
        message.content.trim().length > 0
    )
    .slice(-limit)
    .map((message) => {
      const saved: SavedConversationMessage = {
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      };
      if (message.thinkingText) saved.thinkingText = message.thinkingText;
      if (message.textSegments && message.textSegments.length > 0) {
        saved.textSegments = message.textSegments.map((segment) => ({
          text: segment.text,
          citations: segment.citations.map((citation) => ({
            url: citation.url,
            title: citation.title,
            ...(citation.citedText ? { citedText: citation.citedText } : null),
          })),
        }));
      }
      if (message.meta && Object.keys(message.meta).length > 0) {
        saved.meta = message.meta;
      }
      if (message.activity && message.activity.length > 0) {
        saved.activity = message.activity;
      }
      if (message.searches && message.searches.length > 0) {
        saved.searches = message.searches;
      }
      if (message.videoTimestamp) {
        saved.videoTimestamp = {
          seconds: message.videoTimestamp.seconds,
          formatted: message.videoTimestamp.formatted,
        };
      }
      return saved;
    });
}

/**
 * Rebuild PanelMessages from stored conversation rows. Tolerant of unknown
 * input (the rows crossed a runtime-message boundary): anything without a
 * user/assistant role and non-empty string content is skipped. Ids and
 * timestamps are synthesized — they only need to be unique within the session.
 */
export function fromSavedConversationMessages(value: unknown): PanelMessage[] {
  if (!Array.isArray(value)) return [];
  const base = Date.now() - value.length;
  const restored: PanelMessage[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.hidden === true) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.content !== "string" || !record.content.trim()) continue;

    const message: PanelMessage = {
      id: base + restored.length,
      role: record.role,
      content: record.content,
      timestamp: base + restored.length,
    };
    if (typeof record.thinkingText === "string" && record.thinkingText) {
      message.thinkingText = record.thinkingText;
    }
    const textSegments = restoreTextSegments(record.textSegments);
    if (textSegments) message.textSegments = textSegments;
    const meta = restoreMeta(record.meta);
    if (meta) message.meta = meta;
    if (Array.isArray(record.activity) && record.activity.length > 0) {
      message.activity = record.activity as ChatActivityItem[];
    }
    if (Array.isArray(record.searches) && record.searches.length > 0) {
      message.searches = record.searches as WebSearchEntry[];
    }
    const videoTimestamp = restoreVideoTimestamp(record.videoTimestamp);
    if (videoTimestamp) message.videoTimestamp = videoTimestamp;

    restored.push(message);
  }

  return restored;
}

function restoreTextSegments(value: unknown): TextSegment[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const segments: TextSegment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== "string") continue;
    const citations = Array.isArray(record.citations) ? record.citations : [];
    segments.push({
      text: record.text,
      citations: citations.flatMap((citation) => {
        if (!citation || typeof citation !== "object") return [];
        const cite = citation as Record<string, unknown>;
        if (typeof cite.url !== "string" || typeof cite.title !== "string") return [];
        return [
          {
            type: typeof cite.type === "string" ? cite.type : "web",
            url: cite.url,
            title: cite.title,
            citedText: typeof cite.citedText === "string" ? cite.citedText : "",
          },
        ];
      }),
    });
  }
  return segments.length > 0 ? segments : undefined;
}

function restoreMeta(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// The store keeps only {seconds, formatted}; duration is display-irrelevant
// for a restored seek chip, so it re-materializes zeroed.
function restoreVideoTimestamp(value: unknown): VideoTime | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.seconds !== "number" || typeof record.formatted !== "string") {
    return undefined;
  }
  return {
    seconds: record.seconds,
    formatted: record.formatted,
    duration: typeof record.duration === "number" ? record.duration : 0,
    durationFormatted:
      typeof record.durationFormatted === "string" ? record.durationFormatted : "",
  };
}
