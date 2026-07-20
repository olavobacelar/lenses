/**
 * OpenAI Responses API client.
 *
 * The rest of the extension speaks in the existing Lenses stream shapes; this
 * file only handles provider-specific request and response translation.
 */

import { Effect } from 'effect';
import {
  supportsOpenAIReasoningEffort,
  type AiModel,
} from '../../types/ai-models';
import type {
  ConversationMessage,
  MessageContent,
  SystemPromptPart,
} from '../../types/ai-content';
import {
  isOpenAIReasoningEffort,
  type ReasoningEffort,
} from '../../lib/reasoning-settings';
import { ApiAbortedError, ApiParseError, ApiRequestError, isAbortError } from '../types';
import { API_RETRY_SCHEDULE, isRetryableStatus } from './claude-client';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export interface OpenAIApiCallOptions {
  apiKey: string;
  model: AiModel;
  maxTokens: number;
  system: string | SystemPromptPart[];
  messages: ConversationMessage[];
  stream?: boolean;
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
  reasoningEffort?: ReasoningEffort;
  outputFormat?: object;
  /** Caller-supplied AbortSignal forwarded to fetch — see ApiCallOptions.signal. */
  signal?: AbortSignal;
}

interface OpenAIOutputText {
  type: string;
  text?: string;
  annotations?: unknown[];
}

interface OpenAIMessageOutput {
  type: string;
  content?: OpenAIOutputText[];
}

export function systemToInstructions(system: string | SystemPromptPart[]): string {
  if (typeof system === 'string') return system;
  return system.map((part) => part.text).filter(Boolean).join('\n\n');
}

export function conversationToOpenAIInput(messages: ConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: contentToOpenAIContent(message.content),
  }));
}

function contentToOpenAIContent(content: MessageContent) {
  if (typeof content === 'string') return content;

  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'input_text', text: part.text };
    }

    if (part.type === 'document') {
      // PDFs go in as a base64 `input_file` (a filename is required so the API
      // can infer the type); text/markdown is inlined as `input_text` since the
      // Responses API has no plain-text document block.
      if (part.source.type === 'base64') {
        return {
          type: 'input_file',
          filename: part.title ?? 'document.pdf',
          file_data: `data:${part.source.media_type};base64,${part.source.data}`,
        };
      }

      return { type: 'input_text', text: part.source.data };
    }

    if (part.source.type === 'url') {
      return { type: 'input_image', image_url: part.source.url };
    }

    return {
      type: 'input_image',
      image_url: `data:${part.source.media_type};base64,${part.source.data}`,
    };
  });
}

export function buildOpenAIRequestBody(options: OpenAIApiCallOptions) {
  const body: Record<string, unknown> = {
    model: options.model,
    instructions: systemToInstructions(options.system),
    input: conversationToOpenAIInput(options.messages),
    max_output_tokens: options.maxTokens,
  };

  if (options.stream) {
    body.stream = true;
  }

  if (
    options.reasoningEffort &&
    isOpenAIReasoningEffort(options.reasoningEffort) &&
    supportsOpenAIReasoningEffort(options.model)
  ) {
    body.reasoning = { effort: options.reasoningEffort };
  }

  const tools = mapTools(options.tools);
  if (tools.length > 0) {
    body.tools = tools;
  }

  const textFormat = mapTextFormat(options.outputFormat);
  if (textFormat) {
    body.text = { format: textFormat };
  }

  return body;
}

function mapTools(tools: OpenAIApiCallOptions['tools']): object[] {
  if (!tools) return [];
  return tools.flatMap((tool) => {
    if (tool.name === 'web_search' || tool.type === 'web_search_20250305') {
      return [{ type: 'web_search' }];
    }

    // web_fetch is an Anthropic-only server tool; the OpenAI Responses API has
    // no equivalent, so drop it rather than send an unknown tool.
    if (tool.name === 'web_fetch' || tool.type?.startsWith('web_fetch')) {
      return [];
    }

    if (tool.input_schema) {
      return [
        {
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
          strict: false,
        },
      ];
    }

    return [];
  });
}

function mapTextFormat(outputFormat: object | undefined): object | null {
  if (!outputFormat || typeof outputFormat !== 'object') return null;
  const record = outputFormat as Record<string, unknown>;
  if (record.type !== 'json_schema' || !record.schema || typeof record.schema !== 'object') {
    return null;
  }

  return {
    type: 'json_schema',
    name: typeof record.name === 'string' ? record.name : 'structured_response',
    schema: record.schema,
    strict: true,
  };
}

export const makeOpenAIApiCall = (options: OpenAIApiCallOptions) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(OPENAI_RESPONSES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(buildOpenAIRequestBody(options)),
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
      const errorMessage =
        (errorBody as { error?: { message?: string } })?.error?.message ||
        `OpenAI API error: ${response.status}`;

      return yield* Effect.fail(
        new ApiRequestError({ status: response.status, message: errorMessage })
      );
    }

    return response;
  }).pipe(
    // Retry only on retryable HTTP statuses. ApiAbortedError is excluded by
    // shape — see the matching note in claude-client.ts.
    Effect.retry({
      schedule: API_RETRY_SCHEDULE,
      while: (error) =>
        error instanceof ApiRequestError && isRetryableStatus(error.status),
    })
  );

export const makeOpenAIJsonApiCall = <T>(options: Omit<OpenAIApiCallOptions, 'stream'>) =>
  Effect.gen(function* () {
    const response = yield* makeOpenAIApiCall({ ...options, stream: false });
    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) =>
        isAbortError(error)
          ? new ApiAbortedError({ reason: 'response body aborted' })
          : new ApiParseError({ message: String(error) }),
    });

    return { content: [{ text: extractOpenAIOutputText(json) }] } as T;
  });

export function extractOpenAIOutputText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const record = json as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return '';

  const chunks: string[] = [];
  for (const item of output as OpenAIMessageOutput[]) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n\n').trim();
}
