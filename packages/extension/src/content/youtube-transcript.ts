/**
 * Transcript extraction and management
 *
 * Handles transcript fetching, parsing, and state.
 */

import type { TranscriptSegment, VideoMetadata } from '../types/transcript';

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let currentTranscript: TranscriptSegment[] | null = null;
let currentVideoId: string | null = null;

// ─────────────────────────────────────────────────────────────
// State Getters/Setters
// ─────────────────────────────────────────────────────────────

export function getCurrentTranscript(): TranscriptSegment[] | null {
  return currentTranscript;
}

export function getCurrentVideoId(): string | null {
  return currentVideoId;
}

export function resetTranscriptState(): void {
  currentTranscript = null;
  currentVideoId = null;
}

// ─────────────────────────────────────────────────────────────
// Video ID Detection
// ─────────────────────────────────────────────────────────────

export function getVideoId(): string | null {
  const pathname = window.location.pathname;

  if (pathname.startsWith('/shorts/')) {
    return pathname.split('/')[2] || null;
  }

  return new URLSearchParams(window.location.search).get('v');
}

export function isVideoPage(url = location.href): boolean {
  return url.includes('/watch') || url.includes('/shorts/');
}

// ─────────────────────────────────────────────────────────────
// Video Metadata
// ─────────────────────────────────────────────────────────────

export function getVideoMetadata(): VideoMetadata {
  const title =
    document.querySelector(
      'h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string'
    )?.textContent ||
    document.querySelector('meta[name="title"]')?.getAttribute('content') ||
    document.title.replace(' - YouTube', '');

  const channel =
    document.querySelector('#channel-name a, #owner #text a')?.textContent?.trim() || 'Unknown';

  return { title, channel };
}

// ─────────────────────────────────────────────────────────────
// Transcript Context
// ─────────────────────────────────────────────────────────────

export function getContextAroundTime(
  transcript: TranscriptSegment[],
  currentSeconds: number,
  windowSeconds = 60
): string {
  if (!transcript || !transcript.length) return '';

  const startTime = Math.max(0, currentSeconds - windowSeconds);
  const endTime = currentSeconds + windowSeconds;

  const relevantSegments = transcript.filter(
    (segment) => segment.start >= startTime && segment.start <= endTime
  );

  return relevantSegments.map((s) => `[${s.formatted}] ${s.text}`).join('\n');
}

// ─────────────────────────────────────────────────────────────
// Transcript Extraction
// ─────────────────────────────────────────────────────────────

function requestTranscriptExtraction(): Promise<TranscriptSegment[] | null> {
  return new Promise((resolve) => {
    const requestVideoId = getVideoId();

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'LENSES_TRANSCRIPT_DATA') {
        const currentPageVideoId = getVideoId();
        const responseVideoId =
          typeof event.data.videoId === 'string' ? event.data.videoId : currentPageVideoId;
        if (currentPageVideoId !== requestVideoId || responseVideoId !== requestVideoId) {
          return;
        }
        window.removeEventListener('message', handler);
        resolve(event.data.transcript);
      }
    };
    window.addEventListener('message', handler);

    chrome.runtime.sendMessage({ action: 'extractTranscript' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Lenses] Service worker error:', chrome.runtime.lastError);
        window.removeEventListener('message', handler);
        resolve(null);
      } else if (response?.error) {
        console.error('[Lenses] Extraction error:', response.error);
        window.removeEventListener('message', handler);
        resolve(null);
      }
    });

    // Timeout
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 15000);
  });
}

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  try {

    const transcript = await requestTranscriptExtraction();

    if (transcript && transcript.length > 0) {
      return transcript;
    }

    return null;
  } catch (error) {
    console.error('[Lenses] ERROR fetching transcript:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

export async function initializeTranscript(): Promise<void> {
  const videoId = getVideoId();

  if (!videoId) {
    return;
  }

  if (videoId === currentVideoId && currentTranscript) {
    return;
  }

  currentTranscript = null;
  currentVideoId = videoId;

  const newTranscript = await fetchTranscript(videoId);

  if (getVideoId() !== videoId) {
    return;
  }

  currentTranscript = newTranscript;

  if (currentTranscript) {

    chrome.storage.session.set({
      currentTranscript,
      currentVideoId,
      metadata: getVideoMetadata(),
    });

    chrome.runtime.sendMessage({
      action: 'transcriptLoaded',
      videoId,
      segmentCount: currentTranscript.length,
    });
  } else {
    chrome.storage.session.set({
      currentTranscript: null,
      currentVideoId: videoId,
      metadata: getVideoMetadata(),
    });
  }
}
