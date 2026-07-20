import type { AppModeChangedMessage } from "../lib/app-mode.js";
import type { ChatActivityItem } from "../lib/chat-activity.js";
import type { WebSearchEntry, WebSearchKind, WebSearchResultRef } from "../lib/web-search.js";

export interface Finding {
  text: string;
  category: string;
  detail: string;
  confidence: number;
  sourceSpan?: { start: number; end: number };
  runId?: string;
  findingIndex?: number;
  rawResponse?: string;
  rawFinding?: unknown;
}

export interface Annotation {
  id: string;
  finding: Finding;
  color: string;
  label: string;
  lensId: string;
}

export interface HighlightMessage {
  type: "highlight";
  findings: Finding[];
  lensId: string;
  colors: Record<string, { color: string; label: string }>;
  autoSourceChecks?: boolean;
  selectedText?: string;
  sourceText?: string;
}

export interface SetLensHighlightVisibilityMessage {
  type: "set-lens-highlight-visibility";
  lensId: string;
  visible: boolean;
}

export interface SetLensResultDisplayModeMessage {
  type: "set-lens-result-display-mode";
  lensId: string;
  mode: LensResultDisplayMode;
}

export interface ClearLensResultsMessage {
  type: "clear-lens-results";
  lensId: string;
}

export interface SavedSelection {
  id: string;
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  scope?: "page" | "selection" | "transcript";
  url: string;
  selectedText: string;
  messages: ChatMessage[];
  title: string;
  createdAt: number;
  anchorPrefix?: string;
  anchorSuffix?: string;
  textStart?: number;
  textEnd?: number;
  pageTitle?: string;
}

export interface SavedSelectionsMessage {
  type: "saved-selections";
  selections: SavedSelection[];
}

export interface ClearMessage {
  type: "clear";
  resetVisibility?: boolean;
}

export interface GetPageTextMessage {
  type: "get-page-text";
}

export interface GetSelectionMessage {
  type: "get-selection";
}

export interface GetDefuddleMessage {
  type: "get-defuddle";
}

export interface GetReadabilityMessage {
  type: "get-readability";
}

export type Message =
  | HighlightMessage
  | SetLensHighlightVisibilityMessage
  | SetLensResultDisplayModeMessage
  | ClearLensResultsMessage
  | ClearMessage
  | GetPageTextMessage
  | GetSelectionMessage
  | GetDefuddleMessage
  | GetReadabilityMessage
  | SavedSelectionsMessage
  | AppModeChangedMessage;

export interface ActionMessage {
  action?: string;
  force?: boolean;
  seconds?: number;
  currentSeconds?: number;
  windowSeconds?: number;
}

export type RuntimeMessage = Message | ActionMessage;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  thinkingText?: string;
  activity?: ChatActivityItem[];
  textSegments?: StreamTextSegment[];
  meta?: SelectionMessageMeta;
  searches?: WebSearchEntry[];
}

export type SelectionMessageMeta = Record<string, string>;

export interface AskFindingStreamPortRequest {
  action: "ask-finding-stream";
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
  sourceCheckOptions?: {
    maxCitations?: number;
    useCache?: boolean;
    forceRefresh?: boolean;
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
  selectionMode?: SelectionChatMode;
}

export interface StreamTextSegment {
  text: string;
  citations: Array<{ url: string; title: string; citedText?: string }>;
}

export type AskFindingStreamPortEvent =
  | { type: "chunk"; text: string; textSegments?: StreamTextSegment[] }
  | { type: "thinking"; event: "start" | "delta" | "end"; text?: string; fullText?: string }
  | {
      type: "searching";
      event: "start" | "end";
      kind?: WebSearchKind;
      query?: string;
      url?: string;
      title?: string;
      results?: WebSearchResultRef[];
    }
  | {
      type: "citations";
      citations: Array<{ url: string; title: string; citedText?: string }>;
      textSegments?: StreamTextSegment[];
    }
  | {
      type: "done";
      fullText: string;
      citations?: Array<{ url: string; title: string; citedText?: string }>;
      textSegments?: StreamTextSegment[];
      meta?: SelectionMessageMeta;
    }
  | { type: "meta"; meta: SelectionMessageMeta }
  | { type: "error"; error: string };

export interface ResolveCitationPublishersResponse {
  publishers?: Record<string, string>;
  authoritativeUrls?: string[];
  error?: string;
}

export type SelectionChatMode = "ask" | "explain" | "truth" | "summarize";

export type ChatContext =
  | { kind: "annotations"; annotations: Annotation[] }
  | {
      kind: "selection";
      selectedText: string;
      pageContext: string;
      initialMessages?: ChatMessage[];
      savedId?: string;
      selectionMode?: SelectionChatMode;
      initialQuestion?: string;
    };

export type LensResultDisplayMode = "inline" | "notes" | "list" | "off";

export interface LensUiConfig {
  autoSourceChecks?: boolean;
}
