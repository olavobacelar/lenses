/**
 * Claude API Client
 *
 * Handles API calls to Claude with automatic retry for transient errors.
 */

import { Effect, Schedule } from 'effect';
import {
  isClaudeModel,
  supportsClaudeEffort,
} from '../../types/claude';
import type { AiModel } from '../../types/ai-models';
import type {
  ConversationMessage,
  SystemPromptPart,
} from '../../types/ai-content';
import type { ReasoningEffort } from '../../lib/reasoning-settings';
import { ApiAbortedError, ApiParseError, ApiRequestError, isAbortError } from '../types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Retry schedule for transient API errors (429, 500, 502, 503, 504)
export const API_RETRY_SCHEDULE = Schedule.intersect(
  Schedule.recurs(2), // Max 2 retries
  Schedule.exponential('500 millis', 2) // 500ms, 1s, 2s
);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ApiCallOptions {
  apiKey: string;
  model: AiModel;
  maxTokens: number;
  system: string | SystemPromptPart[];
  messages: ConversationMessage[];
  stream?: boolean;
  thinking?:
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'adaptive'; display?: 'summarized' | 'omitted' };
  reasoningEffort?: ReasoningEffort;
  outputConfig?: { effort?: ReasoningEffort };
  tools?: Array<{
    type?: string;
    name: string;
    description?: string;
    input_schema?: object;
    max_uses?: number;
    citations?: { enabled?: boolean };
    allowed_domains?: string[];
    blocked_domains?: string[];
  }>;
  outputFormat?: object;
  /**
   * Caller-supplied AbortSignal. Wiring this through to fetch() is what makes
   * cancelling a lens run actually stop the upstream Claude call (and therefore
   * stop billing for output tokens that would have been generated).
   */
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Check if an HTTP status code is retryable (transient error)
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// ─────────────────────────────────────────────────────────────
// API Effects
// ─────────────────────────────────────────────────────────────

/**
 * Make an API call to Claude with automatic retry for transient errors.
 * Returns the Response object for streaming, or parsed JSON for non-streaming.
 */
export const makeApiCall = (options: ApiCallOptions) =>
  Effect.gen(function* () {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    if (options.outputFormat) {
      headers['anthropic-beta'] = 'structured-outputs-2025-11-13';
    }

    const body: Record<string, any> = {
      model: options.model,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: options.messages,
    };

    if (options.stream) {
      body.stream = true;
    }

    if (options.thinking) {
      body.thinking = options.thinking;
    }

    const outputConfig =
      options.outputConfig ??
      (options.reasoningEffort &&
      isClaudeModel(options.model) &&
      supportsClaudeEffort(options.model)
        ? { effort: options.reasoningEffort }
        : undefined);

    if (outputConfig) {
      body.output_config = outputConfig;
    }

    if (options.tools) {
      body.tools = options.tools;
    }

    if (options.outputFormat) {
      body.output_format = options.outputFormat;
    }


    const response = yield* Effect.tryPromise({
      try: () => fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      }),
      catch: (error) =>
        isAbortError(error)
          ? new ApiAbortedError({ reason: 'fetch aborted' })
          : new ApiRequestError({ status: 0, message: String(error) }),
    });


    if (!response.ok) {
      const errorBody = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => ({}),
      });

      const errorMessage = (errorBody as any)?.error?.message || `API error: ${response.status}`;

      // If retryable, fail with error that will trigger retry
      if (isRetryableStatus(response.status)) {
        return yield* Effect.fail(new ApiRequestError({ status: response.status, message: errorMessage }));
      }

      // Non-retryable error
      return yield* Effect.fail(new ApiRequestError({ status: response.status, message: errorMessage }));
    }

    return response;
  }).pipe(
    // Retry only on retryable status codes. ApiAbortedError is intentionally
    // excluded — re-firing a cancelled request would defeat the whole point
    // of cancellation and bill the user a second time.
    Effect.retry({
      schedule: API_RETRY_SCHEDULE,
      while: (error) =>
        error instanceof ApiRequestError && isRetryableStatus(error.status),
    })
  );

/**
 * Make a non-streaming API call and parse the JSON response
 */
export const makeJsonApiCall = <T>(options: Omit<ApiCallOptions, 'stream'>) =>
  Effect.gen(function* () {
    const response = yield* makeApiCall({ ...options, stream: false });

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) =>
        isAbortError(error)
          ? new ApiAbortedError({ reason: 'response body aborted' })
          : new ApiParseError({ message: String(error) }),
    });

    return json as T;
  });
