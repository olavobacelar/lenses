/**
 * URL utilities for YouTube video detection and parsing
 */

import { Effect } from 'effect';
import { NoActiveTabError } from '../messaging/types';

/**
 * Check if a URL is a YouTube video page (watch or shorts)
 */
export function isYouTubeVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.youtube.com') return false;
    return parsed.searchParams.has('v') || parsed.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/')[2] || null;
    }
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

/**
 * Check if current active tab is a YouTube video page
 */
export async function checkIsVideoPage(): Promise<{
  isVideo: boolean;
  videoId: string | null;
}> {
  return Effect.runPromise(
    Effect.async<{ url: string }, NoActiveTabError>((resume) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          resume(Effect.succeed({ url: tabs[0].url }));
        } else {
          resume(Effect.fail(new NoActiveTabError()));
        }
      });
    }).pipe(
      Effect.map(({ url }) => {
        const isVideo = isYouTubeVideoUrl(url);
        const videoId = isVideo ? extractVideoId(url) : null;
        return { isVideo, videoId };
      }),
      Effect.catchAll(() => Effect.succeed({ isVideo: false, videoId: null }))
    )
  );
}
