/**
 * Zod schemas for Claude API streaming events
 *
 * These schemas provide runtime validation for the SSE events
 * received from Claude's streaming API, ensuring type safety
 * beyond TypeScript's compile-time checks.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Basic Types
// ─────────────────────────────────────────────────────────────

export const CacheUsageSchema = z.object({
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  input_tokens: z.number().optional(),
});

export const CitationSchema = z.object({
  type: z.string(), // Accept any citation type (web_search_result_location, char_location, etc.)
  url: z.string(),
  title: z.string(),
  cited_text: z.string(),
  // Web search citation fields
  encrypted_index: z.string().optional(),
  // Document citation fields
  document_index: z.number().optional(),
  document_title: z.string().optional(),
  start_char_index: z.number().optional(),
  end_char_index: z.number().optional(),
  start_page_number: z.number().optional(),
  end_page_number: z.number().optional(),
  start_block_index: z.number().optional(),
  end_block_index: z.number().optional(),
});

// ─────────────────────────────────────────────────────────────
// Delta Types (discriminated union)
// ─────────────────────────────────────────────────────────────

export const TextDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const ThinkingDeltaSchema = z.object({
  type: z.literal('thinking_delta'),
  thinking: z.string(),
});

export const CitationsDeltaSchema = z.object({
  type: z.literal('citations_delta'),
  citation: CitationSchema,
});

export const InputJsonDeltaSchema = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string(),
});

export const StreamDeltaSchema = z.discriminatedUnion('type', [
  TextDeltaSchema,
  ThinkingDeltaSchema,
  CitationsDeltaSchema,
  InputJsonDeltaSchema,
]);

// ─────────────────────────────────────────────────────────────
// Content Block Types
// ─────────────────────────────────────────────────────────────

export const ContentBlockTypeSchema = z.enum([
  'text',
  'thinking',
  'tool_use',
  'server_tool_use',
  'web_search_tool_result',
  'web_fetch_tool_result',
]);

export const ContentBlockStartSchema = z.object({
  type: ContentBlockTypeSchema,
  name: z.string().optional(),
  // Server-tool result blocks carry their payload inline at block start:
  // `web_search_tool_result` an array of results, `web_fetch_tool_result` a
  // single page object (and either can be an error object). Keep it untyped and
  // let the web-search helpers narrow it, so an unexpected shape never fails the
  // whole event parse.
  content: z.unknown().optional(),
});

// ─────────────────────────────────────────────────────────────
// Streaming Events (discriminated union)
// ─────────────────────────────────────────────────────────────

export const MessageStartEventSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    usage: CacheUsageSchema.optional(),
  }).optional(),
});

export const ContentBlockStartEventSchema = z.object({
  type: z.literal('content_block_start'),
  index: z.number(),
  content_block: ContentBlockStartSchema,
});

export const ContentBlockDeltaEventSchema = z.object({
  type: z.literal('content_block_delta'),
  index: z.number(),
  delta: StreamDeltaSchema,
});

export const ContentBlockStopEventSchema = z.object({
  type: z.literal('content_block_stop'),
  index: z.number(),
});

export const MessageDeltaEventSchema = z.object({
  type: z.literal('message_delta'),
  delta: z.object({
    stop_reason: z.string().optional(),
  }),
  usage: z.object({
    output_tokens: z.number(),
  }).optional(),
});

export const MessageStopEventSchema = z.object({
  type: z.literal('message_stop'),
});

/** Union of all streaming event schemas */
export const StreamEventSchema = z.discriminatedUnion('type', [
  MessageStartEventSchema,
  ContentBlockStartEventSchema,
  ContentBlockDeltaEventSchema,
  ContentBlockStopEventSchema,
  MessageDeltaEventSchema,
  MessageStopEventSchema,
]);

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Safely parse a streaming event from JSON string.
 * Returns null if parsing fails or the data is invalid.
 */
export function parseStreamEvent(jsonString: string) {
  try {
    const data = JSON.parse(jsonString);

    const result = StreamEventSchema.safeParse(data);
    if (!result.success) {
      // Log validation failures for important events
      if (data.type === 'content_block_delta' && data.delta?.type === 'citations_delta') {
        // Try to return a partial result for citations even if validation fails
        return {
          type: 'content_block_delta' as const,
          index: data.index,
          delta: {
            type: 'citations_delta' as const,
            citation: data.delta.citation,
          },
        };
      }
    }
    return result.success ? result.data : null;
  } catch (e) {
    console.error('[Lenses] Parse error:', e);
    return null;
  }
}

/**
 * Check if a delta is a text delta
 */
export function isTextDelta(
  delta: z.infer<typeof StreamDeltaSchema>
): delta is z.infer<typeof TextDeltaSchema> {
  return delta.type === 'text_delta';
}

/**
 * Check if a delta is a thinking delta
 */
export function isThinkingDelta(
  delta: z.infer<typeof StreamDeltaSchema>
): delta is z.infer<typeof ThinkingDeltaSchema> {
  return delta.type === 'thinking_delta';
}

/**
 * Check if a delta is a citations delta
 */
export function isCitationsDelta(
  delta: z.infer<typeof StreamDeltaSchema>
): delta is z.infer<typeof CitationsDeltaSchema> {
  return delta.type === 'citations_delta';
}

// ─────────────────────────────────────────────────────────────
// Inferred Types
// ─────────────────────────────────────────────────────────────

export type ParsedStreamEvent = z.infer<typeof StreamEventSchema>;
export type ParsedDelta = z.infer<typeof StreamDeltaSchema>;
export type ParsedCitation = z.infer<typeof CitationSchema>;
