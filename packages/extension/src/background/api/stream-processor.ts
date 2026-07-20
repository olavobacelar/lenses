/**
 * SSE Stream Processor
 *
 * Processes Server-Sent Events from the Claude API streaming response.
 */

import {
  parseStreamEvent,
  isTextDelta,
  isThinkingDelta,
  isCitationsDelta,
} from '../../schemas/claude-api';
import {
  parseWebFetchResult,
  parseWebFetchUrl,
  parseWebSearchQuery,
  parseWebSearchResults,
} from '../../lib/web-search';
import type { StreamState, StreamCallbacks } from '../types';

/**
 * Create initial stream state
 */
export function createInitialStreamState(): StreamState {
  return {
    fullText: '',
    citations: [],
    textSegments: [],
    currentBlockType: null,
    currentToolName: null,
    currentToolInput: '',
    thinkingText: '',
    isSearching: false,
    pendingSearchQuery: '',
    isFetching: false,
    pendingFetchUrl: '',
    credibility: null,
  };
}

/**
 * Process a single SSE line and update state
 */
export function processStreamLine(
  line: string,
  state: StreamState,
  callbacks: StreamCallbacks
): StreamState {
  if (!line.startsWith('data: ')) return state;

  const data = line.slice(6);
  if (data === '[DONE]') return state;

  const parsed = parseStreamEvent(data);
  if (!parsed) {
    return state;
  }

  let newState = { ...state };

  // Track content block types
  if (parsed.type === 'content_block_start') {
    newState.currentBlockType = parsed.content_block?.type || null;
    newState.currentToolName = parsed.content_block?.name || null;
    newState.currentToolInput = '';

    if (newState.currentBlockType === 'thinking') {
      callbacks.onThinking({ type: 'start' });
    }

    if (newState.currentBlockType === 'text') {
      newState.textSegments = [...newState.textSegments, { text: '', citations: [] }];
    }

    if (
      newState.currentBlockType === 'server_tool_use' &&
      parsed.content_block?.name === 'web_search'
    ) {
      // The query streams in as input_json_delta; defer the `start` event until
      // content_block_stop, when the full query is known.
      newState.isSearching = true;
      newState.pendingSearchQuery = '';
    }

    if (
      newState.currentBlockType === 'server_tool_use' &&
      parsed.content_block?.name === 'web_fetch'
    ) {
      // Same deferral as web_search: the url streams in as input_json_delta.
      newState.isFetching = true;
      newState.pendingFetchUrl = '';
    }

    if (newState.currentBlockType === 'web_search_tool_result') {
      if (newState.isSearching) {
        callbacks.onSearching({
          type: 'end',
          kind: 'search',
          query: newState.pendingSearchQuery,
          results: parseWebSearchResults(parsed.content_block?.content),
        });
        newState.isSearching = false;
        newState.pendingSearchQuery = '';
      }
    }

    if (newState.currentBlockType === 'web_fetch_tool_result') {
      if (newState.isFetching) {
        const page = parseWebFetchResult(parsed.content_block?.content);
        callbacks.onSearching({
          type: 'end',
          kind: 'fetch',
          url: page?.url || newState.pendingFetchUrl,
          title: page?.title,
        });
        newState.isFetching = false;
        newState.pendingFetchUrl = '';
      }
    }
  }

  // Handle deltas
  if (parsed.type === 'content_block_delta') {
    const delta = parsed.delta;

    if (isThinkingDelta(delta)) {
      newState.thinkingText += delta.thinking;
      callbacks.onThinking({ type: 'delta', text: delta.thinking });
    }

    if (isTextDelta(delta)) {
      newState.fullText += delta.text;
      if (newState.textSegments.length > 0) {
        const segments = [...newState.textSegments];
        segments[segments.length - 1] = {
          ...segments[segments.length - 1],
          text: segments[segments.length - 1].text + delta.text,
        };
        newState.textSegments = segments;
      }
      callbacks.onChunk(delta.text, newState.textSegments);
    }

    // Handle tool input JSON delta (for custom tools like report_credibility)
    if (delta?.type === 'input_json_delta' && delta.partial_json) {
      newState.currentToolInput += delta.partial_json;
    }

    if (isCitationsDelta(delta)) {
      const citation = delta.citation;
      if (newState.textSegments.length > 0) {
        const segments = [...newState.textSegments];
        const currentSegment = { ...segments[segments.length - 1] };

        // Handle trailing newlines
        let trailingNewlines = '';
        if (currentSegment.text === '' && segments.length > 1) {
          const prevSegment = { ...segments[segments.length - 2] };
          const newlineMatch = prevSegment.text.match(/(\n+)$/);
          if (newlineMatch) {
            trailingNewlines = newlineMatch[1];
            prevSegment.text = prevSegment.text.slice(0, -trailingNewlines.length);
            segments[segments.length - 2] = prevSegment;
          }
        }

        currentSegment.citations = [
          ...currentSegment.citations,
          {
            type: citation.type,
            url: citation.url,
            title: citation.title,
            citedText: citation.cited_text,
          },
        ];
        segments[segments.length - 1] = currentSegment;

        const newCitation = {
          url: citation.url,
          title: citation.title,
          citedText: citation.cited_text,
        };
        newState.citations = [...newState.citations, newCitation];
        newState.textSegments = [...segments, { text: trailingNewlines, citations: [] }];

        callbacks.onCitations(newState.citations, newState.textSegments);
      }
    }
  }

  // Handle content block stop
  if (parsed.type === 'content_block_stop') {
    if (newState.currentBlockType === 'thinking') {
      callbacks.onThinking({ type: 'end', fullText: newState.thinkingText });
    }

    // The web_search query / web_fetch url is complete now; announce the step so
    // the UI can show it while the result block streams in next.
    if (
      newState.currentBlockType === 'server_tool_use' &&
      newState.currentToolName === 'web_search'
    ) {
      newState.pendingSearchQuery = parseWebSearchQuery(newState.currentToolInput);
      callbacks.onSearching({ type: 'start', kind: 'search', query: newState.pendingSearchQuery });
    }

    if (
      newState.currentBlockType === 'server_tool_use' &&
      newState.currentToolName === 'web_fetch'
    ) {
      newState.pendingFetchUrl = parseWebFetchUrl(newState.currentToolInput);
      callbacks.onSearching({ type: 'start', kind: 'fetch', url: newState.pendingFetchUrl });
    }

    // Process completed tool_use blocks
    if (newState.currentBlockType === 'tool_use' && newState.currentToolName === 'report_credibility') {
      try {
        const toolInput = JSON.parse(newState.currentToolInput);
        newState.credibility = {
          rating: toolInput.rating,
          reasoning: toolInput.reasoning,
        };
        callbacks.onCredibility(newState.credibility);
      } catch (e) {
        console.error('[Lenses] Failed to parse credibility tool input:', e);
      }
    }

    newState.currentBlockType = null;
    newState.currentToolName = null;
  }

  return newState;
}
