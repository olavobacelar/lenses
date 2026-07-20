import type { ExtractedClaim } from "../types/claims";
import type { Anchor } from "@lenses/shared";
import type { ConversationMessage, TextSegment } from "../types/ai-content";
import type { TranscriptSegment, VideoMetadata, VideoTime } from "../types/transcript";
import type { ChatActivityItem } from "../lib/chat-activity";
import type { ChatUiMeta } from "../lib/ChatUi";
import type { WebSearchEntry } from "../lib/web-search";
import type { SourceFingerprintInput } from "../lib/evidence-bases";
import type { PdfPageText } from "../lib/pdf-source";

export type SourceKind = "web_page" | "youtube_video" | "pdf";
export type SourceScope = "page" | "selection" | "transcript";
export type MessageRole = "user" | "assistant" | "system" | "error";

export interface PageTextResponse {
  text?: string | null;
  sourceKind?: SourceKind;
  sourceTitle?: string;
  sourceKey?: string;
  scope?: SourceScope;
  /** The document's MIME type as the content script sees it; "application/pdf"
   *  identifies Chrome's PDF embedder page regardless of URL shape. */
  contentType?: string;
}

export interface TranscriptResponse {
  isVideoPage: boolean;
  transcript: TranscriptSegment[] | null;
  videoId: string | null;
  metadata: VideoMetadata | null;
}

export interface PanelSource {
  key: string;
  kind: SourceKind;
  title: string;
  url: string;
  text: string;
  scope: SourceScope;
  videoId?: string;
  metadata?: VideoMetadata | null;
  sourceMetadata?: Record<string, string>;
  fingerprint?: SourceFingerprintInput;
  pdfPages?: PdfPageText[];
}

export interface PanelMessage {
  id: number;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Assistant delivery failed, but the turn remains retryable. */
  isError?: boolean;
  action?: "api-keys";
  screenshots?: string[];
  videoTimestamp?: VideoTime | null;
  thinkingText?: string;
  activity?: ChatActivityItem[];
  textSegments?: TextSegment[];
  meta?: ChatUiMeta;
  searches?: WebSearchEntry[];
}

export type AttachmentKind = "image" | "document";

export interface Attachment {
  id: number;
  dataUrl: string;
  kind: AttachmentKind;
  name?: string;
  formatted?: string;
}

export interface LensFindingEnrichment {
  lensId: string;
  summary: string;
  data?: Record<string, string>;
  sources?: Array<{ url: string; title: string }>;
}

export type LensFindingAnchor = Anchor;

export interface LensFinding {
  text: string;
  category: string;
  detail: string;
  confidence: number;
  sourceSpan?: { start: number; end: number };
  anchor?: LensFindingAnchor;
  quotes?: string[];
  enrichments?: LensFindingEnrichment[];
}

export type LensRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface LensRunState {
  runId: string;
  lensId: string;
  status: LensRunStatus;
  error?: string;
  modelUsed?: string;
  rawResponse?: string;
  createdAt: number;
  findingCount?: number;
  findings: LensFinding[];
  // Chunk-level coverage from the run's segment manifest; lets a stopped run
  // say how much of the source it actually inspected.
  chunkCoverage?: { done: number; total: number };
  initiatedFromEvidenceBaseId?: string;
  initiatedFromEvidenceBaseTitle?: string;
}

export interface LensRunsResponse {
  runs?: LensRunState[];
  byLens?: Record<string, LensFinding[]>;
  error?: string;
}

export interface RunLensResponse {
  findings?: LensFinding[];
  runId?: string;
  rawResponse?: string;
  modelUsed?: string;
  error?: string;
  cancelled?: boolean;
}

export interface ClaimsState {
  claims: ExtractedClaim[];
  isExtracting: boolean;
  progress: { current: number; total: number };
}

export type ChatHistory = ConversationMessage[];
