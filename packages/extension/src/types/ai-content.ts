/** Provider-neutral request and UI content shared by every AI client. */

/** System prompt component with optional provider cache metadata. */
export interface SystemPromptPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ImageContent {
  type: 'image';
  source:
    | {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      }
    | {
        type: 'url';
        url: string;
      };
}

export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * PDF or plain-text attachment in the extension's internal message format.
 * Provider clients translate this shape into their native request blocks.
 */
export interface DocumentContent {
  type: 'document';
  source:
    | {
        type: 'base64';
        media_type: 'application/pdf';
        data: string;
      }
    | {
        type: 'text';
        media_type: 'text/plain';
        data: string;
      };
  title?: string;
}

export type MessageContent = string | (TextContent | ImageContent | DocumentContent)[];

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: MessageContent;
}

/** A rendered text span and the citations that support it. */
export interface TextSegment {
  text: string;
  citations: Array<{
    type: string;
    url: string;
    title: string;
    citedText: string;
    encrypted_index?: string;
  }>;
}

export interface ThinkingEvent {
  type: 'start' | 'delta' | 'end';
  text?: string;
  fullText?: string;
}

export interface SearchingEvent {
  type: 'start' | 'end';
  kind?: 'search' | 'fetch';
  query?: string;
  url?: string;
  title?: string;
  results?: Array<{ url: string; title: string }>;
}
