// The shared fold engine for assistant stream events. Every chat surface
// (sidepanel ChatDock, in-page chatbox) receives the same wire events from a
// background port — chunk / thinking / searching / citations / meta / done /
// error — and must accumulate them into one assistant turn. The fold rules are
// surface-independent, so they live here as a pure reducer over an immutable
// state value; surfaces map the folded state onto their own view models
// (a PanelMessage patch, a streaming preview) and keep only lifecycle handling
// (history, persistence, focus) local.

import {
  appendActivityThinkingDelta,
  finishActivityThinking,
  foldActivitySearchEvent,
  startActivityThinking,
  type ChatActivityItem,
} from "./chat-activity.js";
import {
  foldSearchEvent,
  isSearchInFlight,
  type WebSearchEntry,
  type WebSearchKind,
  type WebSearchResultRef,
} from "./web-search.js";

export interface ChatStreamCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface ChatStreamTextSegment {
  text: string;
  citations: ChatStreamCitation[];
}

export type ChatStreamMeta = Record<string, string>;

// The wire event contract both stream ports speak ("claude-stream" and
// "lenses-finding-stream"). Fields are optional where at least one sender
// omits them.
export type ChatStreamEvent =
  | { type: "chunk"; text?: string; textSegments?: ChatStreamTextSegment[] }
  | {
      type: "thinking";
      event: "start" | "delta" | "end";
      text?: string;
      fullText?: string;
    }
  | {
      type: "searching";
      event: "start" | "end";
      kind?: WebSearchKind;
      query?: string;
      url?: string;
      title?: string;
      results?: WebSearchResultRef[];
    }
  | { type: "citations"; textSegments?: ChatStreamTextSegment[] }
  | { type: "meta"; meta: ChatStreamMeta }
  | {
      type: "done";
      fullText?: string;
      textSegments?: ChatStreamTextSegment[];
      meta?: ChatStreamMeta;
    }
  | { type: "error"; error?: string };

export interface ChatStreamState {
  text: string;
  thinkingText: string;
  /** A thinking block is open (started and not yet ended). */
  thinkingOpen: boolean;
  activity: ChatActivityItem[];
  searches: WebSearchEntry[];
  /** At least one search/fetch is still in flight. */
  searching: boolean;
  textSegments: ChatStreamTextSegment[];
  meta?: ChatStreamMeta;
}

export function createChatStreamState(): ChatStreamState {
  return {
    text: "",
    thinkingText: "",
    thinkingOpen: false,
    activity: [],
    searches: [],
    searching: false,
    textSegments: [],
    meta: undefined,
  };
}

/**
 * Fold one wire event into the accumulated stream state. Pure: returns a new
 * state, never mutates. `error` is a lifecycle event with no state to fold and
 * returns the state unchanged; surfaces handle it (and the rest of `done` —
 * history, persistence) themselves.
 */
export function applyChatStreamEvent(
  state: ChatStreamState,
  event: ChatStreamEvent
): ChatStreamState {
  if (event.type === "chunk") {
    return {
      ...state,
      text: `${state.text}${event.text ?? ""}`,
      textSegments: event.textSegments ?? state.textSegments,
    };
  }

  if (event.type === "thinking") {
    if (event.event === "start") {
      return {
        ...state,
        thinkingOpen: true,
        activity: startActivityThinking(state.activity),
      };
    }
    if (event.event === "delta") {
      if (!event.text) return state;
      return {
        ...state,
        thinkingText: `${state.thinkingText}${event.text}`,
        thinkingOpen: true,
        activity: appendActivityThinkingDelta(state.activity, event.text),
      };
    }
    return {
      ...state,
      thinkingText: event.fullText ?? state.thinkingText,
      thinkingOpen: false,
      activity: finishActivityThinking(state.activity, event.fullText),
    };
  }

  if (event.type === "searching") {
    const searchEvent = {
      event: event.event,
      kind: event.kind,
      query: event.query,
      url: event.url,
      title: event.title,
      results: event.results,
    };
    const searches = foldSearchEvent(state.searches, searchEvent);
    return {
      ...state,
      activity: foldActivitySearchEvent(state.activity, searchEvent),
      searches,
      searching: isSearchInFlight(searches),
    };
  }

  if (event.type === "citations") {
    if (!Array.isArray(event.textSegments)) return state;
    return { ...state, textSegments: event.textSegments };
  }

  if (event.type === "meta") {
    return { ...state, meta: event.meta };
  }

  if (event.type === "done") {
    return {
      ...state,
      text: event.fullText || state.text,
      textSegments: event.textSegments ?? state.textSegments,
      meta: event.meta ?? state.meta,
      thinkingOpen: false,
      searching: false,
    };
  }

  return state;
}
