/**
 * Chat message types for the sidepanel UI
 */

import type { TextSegment } from './ai-content';

/** Simple timestamp for messages (just position, no duration) */
export interface MessageTimestamp {
  /** Position in seconds */
  seconds: number;
  /** Formatted time (e.g., "3:45") */
  formatted: string;
}

/** Role of a message sender */
export type MessageRole = 'user' | 'assistant' | 'system' | 'error';

/** Screenshot attachment */
export interface Screenshot {
  /** Unique identifier */
  id: number;
  /** Base64 data URL of the image */
  dataUrl: string;
}

/** A chat message displayed in the UI */
export interface ChatMessage {
  /** Unique identifier */
  id: number;
  /** Message role/type */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Optional screenshot attachments (for user messages) */
  screenshots?: string[];
  /** Video timestamp when message was sent (for user messages) */
  videoTimestamp?: MessageTimestamp;
  /** Timestamp when message was created */
  timestamp: number;
  /** Text segments with inline citations (for assistant messages) */
  textSegments?: TextSegment[];
  /** Thinking text from extended thinking (for assistant messages) */
  thinkingText?: string;
  /** Extracted credibility rating (for assistant messages) */
  credibility?: 'low' | 'medium' | 'high' | null;
}

/** Message stored in Convex database */
export interface StoredMessage {
  /** Auto-incremented ID */
  id?: number;
  /** Video this message belongs to */
  videoId: string;
  /** Message role */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Screenshot data URLs */
  screenshots?: string[];
  /** Video timestamp when sent */
  videoTimestamp?: MessageTimestamp;
  /** Creation timestamp */
  timestamp: number;
  /** Thinking text from extended thinking (for assistant messages) */
  thinkingText?: string;
  /** Text segments with citations (for assistant messages) */
  textSegments?: TextSegment[];
}

/** Video record in Convex database */
export interface StoredVideo {
  videoId: string;
  title?: string;
  lastAccessed: number;
}

/** Claims record in Convex database */
export interface StoredClaims {
  videoId: string;
  claims: import('./claims').ExtractedClaim[];
  timestamp: number;
}
