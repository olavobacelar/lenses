/**
 * Time formatting utilities
 */

/**
 * Format seconds to human-readable timestamp (M:SS or H:MM:SS)
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

/**
 * Format milliseconds to timestamp
 */
export function formatTimeMs(ms: number): string {
  return formatTime(Math.floor(ms / 1000));
}

/**
 * Parse timestamp string (M:SS or H:MM:SS) to seconds
 */
export function parseTimestamp(timestamp: string): number {
  if (!timestamp) return 0;

  const parts = timestamp.split(':').map((p) => parseInt(p, 10) || 0);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}
