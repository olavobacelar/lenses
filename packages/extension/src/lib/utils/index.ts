/**
 * Shared utility functions
 *
 * Re-exports all utilities for backward compatibility.
 * Prefer importing directly from specific modules for better tree-shaking.
 */

// Time utilities
export { formatTime, formatTimeMs, parseTimestamp } from './time';

// Text formatting
export { escapeHtml, decodeHtmlEntities, formatMarkdown } from './formatting';

// URL utilities
export { isYouTubeVideoUrl, extractVideoId, checkIsVideoPage } from './url';

// Domain/hostname utilities (for citations)
export function getDomainName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const parts = hostname.split('.');
    if (parts.length > 2) {
      return parts[parts.length - 2];
    }
    return parts[0];
  } catch {
    return 'source';
  }
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export { getLocalFaviconUrl as getFaviconUrl } from '../local-favicon';

// Credibility utilities
export {
  type CredibilityRating,
  extractCredibilityRating,
  getCredibilityLabel,
  getCredibilityIcon,
} from './credibility';

// Thinking text utilities
export { extractThinkingHeading, hasCompleteHeading } from './thinking';

// Transcript utilities
export { splitTranscriptIntoChunks, getTranscriptAroundTime } from './transcript';

// Miscellaneous
export { generateId, debounce, truncate, clamp } from './misc';
