/**
 * Time tracking functionality
 *
 * Handles playback time tracking and formatting.
 */

import type { VideoTime } from '../types/transcript';

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let videoElement: HTMLVideoElement | null = null;
let timeUpdateInterval: ReturnType<typeof setInterval> | null = null;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format seconds into HH:MM:SS or MM:SS string
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// Video Element Management
// ─────────────────────────────────────────────────────────────

export function getVideoElement(): HTMLVideoElement | null {
  return videoElement;
}

export function setVideoElement(element: HTMLVideoElement | null): void {
  videoElement = element;
}

export function findVideoElement(): HTMLVideoElement | null {
  if (!videoElement) {
    videoElement = document.querySelector('video');
  }
  return videoElement;
}

// ─────────────────────────────────────────────────────────────
// Current Time
// ─────────────────────────────────────────────────────────────

export function getCurrentTime(): VideoTime | null {
  findVideoElement();

  if (videoElement) {
    return {
      seconds: videoElement.currentTime,
      formatted: formatTime(videoElement.currentTime),
      duration: videoElement.duration,
      durationFormatted: formatTime(videoElement.duration),
    };
  }

  return null;
}

export function seekTo(seconds: number): boolean {
  findVideoElement();

  if (videoElement) {
    videoElement.currentTime = seconds;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// Playback Tracking
// ─────────────────────────────────────────────────────────────

export function startPlaybackTracking(): void {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
  }

  videoElement = document.querySelector('video');

  if (videoElement) {
    timeUpdateInterval = setInterval(() => {
      try {
        if (!chrome.runtime?.id) {
          clearInterval(timeUpdateInterval!);
          return;
        }
        const time = getCurrentTime();
        if (time) {
          chrome.runtime.sendMessage({ action: 'timeUpdate', time }).catch(() => {
            // Ignore when side panel is not open
          });
        }
      } catch {
        clearInterval(timeUpdateInterval!);
      }
    }, 1000);
  }
}

export function stopPlaybackTracking(): void {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
}
