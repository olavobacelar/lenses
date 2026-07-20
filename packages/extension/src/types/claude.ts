/** Claude Messages API model, request, and streaming response types. */

import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
} from '@lenses/shared';
import type { ConversationMessage, SystemPromptPart } from './ai-content';

export {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
};

/** Available Claude models */
export type ClaudeModel =
  | 'claude-fable-5'
  | 'claude-opus-4-8'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5-20251001';

export const VALID_CLAUDE_MODELS: ClaudeModel[] = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
];

export function usesAdaptiveThinking(model: ClaudeModel): boolean {
  return model === 'claude-fable-5' ||
    model === 'claude-opus-4-8' ||
    model === 'claude-sonnet-5';
}

export function supportsClaudeEffort(model: ClaudeModel): boolean {
  return model === 'claude-fable-5' ||
    model === 'claude-opus-4-8' ||
    model === 'claude-sonnet-5';
}

export function isClaudeModel(value: string | undefined): value is ClaudeModel {
  return VALID_CLAUDE_MODELS.includes(value as ClaudeModel);
}

export function validateClaudeModel(
  model: string | undefined,
  fallback: ClaudeModel = DEFAULT_ANTHROPIC_CHAT_MODEL
): ClaudeModel {
  return isClaudeModel(model) ? model : fallback;
}

/** Request body for Claude streaming API */
export interface ClaudeStreamRequest {
  model: ClaudeModel;
  max_tokens: number;
  system: SystemPromptPart[];
  messages: ConversationMessage[];
  stream: true;
  thinking?: {
    type: 'enabled';
    budget_tokens: number;
  };
  tools?: Array<{
    type: 'web_search_20250305';
    name: 'web_search';
    max_uses: number;
  }>;
  output_format?: {
    type: 'json_schema';
    schema: object;
  };
}

/** Cache usage information from message_start event */
export interface CacheUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
}

// ─────────────────────────────────────────────────────────────
// Streaming Event Types
// ─────────────────────────────────────────────────────────────

/** Content block types that can appear in streams */
export type ContentBlockType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'server_tool_use'
  | 'web_search_tool_result';

/** A citation from web search or document */
export interface Citation {
  type: string; // 'web_search_result_location', 'char_location', 'page_location', etc.
  url: string;
  title: string;
  cited_text: string;
  // Web search specific
  encrypted_index?: string;
  // Document specific
  document_index?: number;
  document_title?: string;
  start_char_index?: number;
  end_char_index?: number;
  start_page_number?: number;
  end_page_number?: number;
}

/** Text delta in streaming */
export interface TextDelta {
  type: 'text_delta';
  text: string;
}

/** Thinking delta in streaming (extended thinking) */
export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

/** Citations delta in streaming */
export interface CitationsDelta {
  type: 'citations_delta';
  citation: Citation;
}

/** Streaming partial JSON for custom tool calls */
export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

/** Union of all delta types */
export type StreamDelta = TextDelta | ThinkingDelta | CitationsDelta | InputJsonDelta;

/** Content block start info */
export interface ContentBlockStart {
  type: ContentBlockType;
  name?: string;
}

// ─────────────────────────────────────────────────────────────
// Streaming Events (discriminated union)
// ─────────────────────────────────────────────────────────────

export interface MessageStartEvent {
  type: 'message_start';
  message?: {
    usage?: CacheUsage;
  };
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlockStart;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: StreamDelta;
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason?: string;
  };
  usage?: {
    output_tokens: number;
  };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

/** Union of all streaming events */
export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;
