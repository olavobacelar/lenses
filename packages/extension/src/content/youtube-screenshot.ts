/**
 * Screenshot capture functionality
 *
 * Captures screenshots from the video element.
 */

import { formatTime } from './youtube-time-tracker';

export interface ScreenshotResult {
  screenshot?: string;
  timestamp?: number;
  formatted?: string;
  error?: string;
}

/**
 * Capture a screenshot from the video element
 */
export function captureScreenshot(videoElement: HTMLVideoElement | null): ScreenshotResult {
  if (!videoElement) {
    videoElement = document.querySelector('video');
  }

  if (!videoElement) {
    return { error: 'No video element found' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(videoElement, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    return {
      screenshot: dataUrl,
      timestamp: videoElement.currentTime,
      formatted: formatTime(videoElement.currentTime),
    };
  } catch (error) {
    console.error('[Lenses] Screenshot capture error:', error);
    return { error: 'Failed to capture screenshot' };
  }
}
