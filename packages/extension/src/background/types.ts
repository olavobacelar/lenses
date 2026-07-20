/**
 * Service Worker Types and Tagged Errors
 *
 * Uses Effect's Data.TaggedError for precise error handling.
 */

import { Data } from 'effect';
import type { TextSegment } from '../types/ai-content';
import type { WebSearchKind, WebSearchResultRef } from '../lib/web-search';

// ─────────────────────────────────────────────────────────────
// Tagged Errors
// ─────────────────────────────────────────────────────────────

/** Error when API key is not configured */
export class ApiKeyNotConfiguredError extends Data.TaggedError('ApiKeyNotConfiguredError')<{}> {}

/** Error when API request fails */
export class ApiRequestError extends Data.TaggedError('ApiRequestError')<{
  readonly status: number;
  readonly message: string;
}> {}

/** Error when API response parsing fails */
export class ApiParseError extends Data.TaggedError('ApiParseError')<{
  readonly message: string;
}> {}

/**
 * Error when an API request is aborted (user cancelled, tab closed, etc).
 *
 * Kept distinct from ApiRequestError so the retry pipeline can refuse to
 * re-fire a fetch the caller explicitly asked to stop — otherwise a retry
 * would resurrect a cancelled lens run and bill the user again.
 */
export class ApiAbortedError extends Data.TaggedError('ApiAbortedError')<{
  readonly reason?: string;
}> {}

/** Error when transcript is not available */
export class TranscriptNotAvailableError extends Data.TaggedError('TranscriptNotAvailableError')<{}> {}

/** Error when script injection fails */
export class ScriptInjectionError extends Data.TaggedError('ScriptInjectionError')<{
  readonly message: string;
}> {}

/** Union of all service worker errors */
export type ServiceWorkerError =
  | ApiKeyNotConfiguredError
  | ApiRequestError
  | ApiAbortedError
  | ApiParseError
  | TranscriptNotAvailableError
  | ScriptInjectionError;

/**
 * Detect a fetch/Request abort. Browsers throw a DOMException named
 * 'AbortError' when an AbortController fires; some runtimes throw a plain
 * Error with the same name. Anything else (network, parse) is a real error.
 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError';
}

// ─────────────────────────────────────────────────────────────
// Stream State
// ─────────────────────────────────────────────────────────────

export interface StreamState {
  fullText: string;
  citations: Array<{ url: string; title: string; citedText: string }>;
  textSegments: TextSegment[];
  currentBlockType: string | null;
  currentToolName: string | null;
  currentToolInput: string;
  thinkingText: string;
  isSearching: boolean;
  /** Query parsed from the in-flight web_search block, paired with its results. */
  pendingSearchQuery: string;
  isFetching: boolean;
  /** URL parsed from the in-flight web_fetch block, paired with its result. */
  pendingFetchUrl: string;
  credibility: { rating: 'low' | 'medium' | 'high'; reasoning?: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Streaming Callbacks
// ─────────────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (text: string, textSegments: TextSegment[]) => void;
  onThinking: (event: { type: string; text?: string; fullText?: string }) => void;
  onSearching: (event: {
    type: string;
    kind?: WebSearchKind;
    query?: string;
    url?: string;
    title?: string;
    results?: WebSearchResultRef[];
  }) => void;
  onCitations: (
    citations: Array<{ url: string; title: string; citedText: string }>,
    textSegments: TextSegment[]
  ) => void;
  onCredibility: (credibility: { rating: 'low' | 'medium' | 'high'; reasoning?: string }) => void;
}
