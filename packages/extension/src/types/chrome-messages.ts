/**
 * Chrome extension message passing types
 *
 * Defines type-safe interfaces for communication between:
 * - Content script ↔ Service worker
 * - Side panel ↔ Service worker
 * - Side panel ↔ Content script (via service worker)
 */

import type { TranscriptSegment, VideoMetadata, VideoTime } from './transcript';
import type { ExtractedClaim } from './claims';
import type { ConversationMessage, TextSegment } from './ai-content';
import type { ModelProvider } from './ai-models';

// ─────────────────────────────────────────────────────────────
// Content Script → Service Worker Messages
// ─────────────────────────────────────────────────────────────

export interface TranscriptLoadedMessage {
  action: 'transcriptLoaded';
  videoId: string;
  segmentCount: number;
}

export interface TimeUpdateMessage {
  action: 'timeUpdate';
  time: VideoTime;
}

export interface ExtractTranscriptMessage {
  action: 'extractTranscript';
}

// ─────────────────────────────────────────────────────────────
// Side Panel ↔ Content Script Messages
// ─────────────────────────────────────────────────────────────

export interface GetTranscriptMessage {
  action: 'getTranscript';
}

export interface GetTranscriptResponse {
  transcript: TranscriptSegment[] | null;
  videoId: string | null;
  metadata: VideoMetadata;
}

export interface RefreshTranscriptMessage {
  action: 'refreshTranscript';
}

export interface GetCurrentTimeMessage {
  action: 'getCurrentTime';
}

export interface SeekToMessage {
  action: 'seekTo';
  seconds: number;
}

export interface CaptureScreenshotMessage {
  action: 'captureScreenshot';
}

export interface CaptureScreenshotResponse {
  screenshot?: string;
  timestamp?: number;
  formatted?: string;
  error?: string;
}

export interface GetContextMessage {
  action: 'getContext';
  windowSeconds?: number;
}

export interface GetContextResponse {
  context: string;
  currentTime: VideoTime;
  metadata: VideoMetadata;
}

// ─────────────────────────────────────────────────────────────
// Side Panel → Service Worker Messages (via port)
// ─────────────────────────────────────────────────────────────

export interface AskClaudeStreamMessage {
  action: 'askClaudeStream';
  question: string;
  currentTime: VideoTime | null;
  transcript: TranscriptSegment[];
  screenshots: string[];
  conversationHistory: ConversationMessage[];
}

export interface GetCredibilityRatingMessage {
  action: 'getCredibilityRating';
  /** Full conversation including the verification response */
  conversationHistory: ConversationMessage[];
}

export interface ExtractClaimsMessage {
  action: 'extractClaims';
  transcriptSegment: string;
  currentTime: string;
  startTime: string;
  endTime: string;
}

export interface ExtractAllClaimsMessage {
  action: 'extractAllClaims';
  transcriptText: string;
  videoTitle: string;
}

export interface ExtractChunkClaimsMessage {
  action: 'extractChunkClaims';
  chunkText: string;
  startTime: string;
  endTime: string;
  videoTitle: string;
  previousClaims: string[];
}

// ─────────────────────────────────────────────────────────────
// Service Worker → Side Panel Messages (via port)
// ─────────────────────────────────────────────────────────────

export interface ChunkPortMessage {
  type: 'chunk';
  text: string;
  textSegments?: TextSegment[];
}

export interface ThinkingPortMessage {
  type: 'thinking';
  event: 'start' | 'delta' | 'end';
  text?: string;
  fullText?: string;
}

export interface SearchingPortMessage {
  type: 'searching';
  event: 'start' | 'end';
  kind?: 'search' | 'fetch';
  query?: string;
  url?: string;
  title?: string;
  results?: Array<{ url: string; title: string }>;
}

export interface CitationsPortMessage {
  type: 'citations';
  citations: Array<{
    url: string;
    title: string;
    citedText: string;
  }>;
  textSegments: TextSegment[];
}

export interface DonePortMessage {
  type: 'done';
  fullText: string;
}

export interface ErrorPortMessage {
  type: 'error';
  error: string;
}

export interface AllClaimsDonePortMessage {
  type: 'allClaimsDone';
  claims: ExtractedClaim[];
}

export interface AllClaimsErrorPortMessage {
  type: 'allClaimsError';
  error: string;
}

export interface ChunkClaimsDonePortMessage {
  type: 'chunkClaimsDone';
  claims: ExtractedClaim[];
  rawResponse?: string;
}

export interface ChunkClaimsErrorPortMessage {
  type: 'chunkClaimsError';
  error: string;
}

export interface CredibilityPortMessage {
  type: 'credibility';
  credibility: {
    rating: 'low' | 'medium' | 'high';
    reasoning?: string;
  };
}

export interface CredibilityRatingDonePortMessage {
  type: 'credibilityRatingDone';
  rating: 'low' | 'medium' | 'high';
}

export interface CredibilityRatingErrorPortMessage {
  type: 'credibilityRatingError';
  error: string;
}

/** Union of all port messages from service worker */
export type ServiceWorkerPortMessage =
  | ChunkPortMessage
  | ThinkingPortMessage
  | SearchingPortMessage
  | CitationsPortMessage
  | DonePortMessage
  | ErrorPortMessage
  | AllClaimsDonePortMessage
  | AllClaimsErrorPortMessage
  | ChunkClaimsDonePortMessage
  | ChunkClaimsErrorPortMessage
  | CredibilityPortMessage
  | CredibilityRatingDonePortMessage
  | CredibilityRatingErrorPortMessage;

// ─────────────────────────────────────────────────────────────
// API Key Management Messages
// ─────────────────────────────────────────────────────────────

export interface CheckApiKeyMessage {
  action: 'checkApiKey';
}

export interface CheckApiKeyResponse {
  hasKey: boolean;
}

export interface TestApiKeyMessage {
  action: 'testApiKey';
  apiKey: string;
  provider?: ModelProvider;
  model?: string;
}

export interface TestApiKeyResponse {
  valid: boolean;
}

// ─────────────────────────────────────────────────────────────
// Union Types
// ─────────────────────────────────────────────────────────────

/** All messages that can be sent to the service worker */
export type ServiceWorkerMessage =
  | TranscriptLoadedMessage
  | TimeUpdateMessage
  | ExtractTranscriptMessage
  | CheckApiKeyMessage
  | TestApiKeyMessage;

/** All messages that can be sent to the content script */
export type ContentScriptMessage =
  | GetTranscriptMessage
  | RefreshTranscriptMessage
  | GetCurrentTimeMessage
  | SeekToMessage
  | CaptureScreenshotMessage
  | GetContextMessage;
