/**
 * Transcript helper utilities
 */

import type { TranscriptSegment, TranscriptChunk } from '../../types/transcript';

/**
 * Split transcript into chunks for claims extraction
 * @param transcript Full transcript segments
 * @param chunkDuration Duration of each chunk in seconds (default 5 minutes)
 * @param overlapDuration Overlap between chunks in seconds (default 1 minute)
 */
export function splitTranscriptIntoChunks(
  transcript: TranscriptSegment[],
  chunkDuration = 300,
  overlapDuration = 60
): TranscriptChunk[] {
  if (!transcript || transcript.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  const totalDuration = transcript[transcript.length - 1].start + 10;
  let chunkStart = 0;

  while (chunkStart < totalDuration) {
    const chunkEnd = chunkStart + chunkDuration;

    const chunkSegments = transcript.filter(
      (item) => item.start >= chunkStart && item.start < chunkEnd
    );

    if (chunkSegments.length > 0) {
      chunks.push({
        startTime: chunkStart,
        endTime: chunkEnd,
        segments: chunkSegments,
        text: chunkSegments.map((item) => `[${item.formatted}] ${item.text}`).join('\n'),
      });
    }

    chunkStart = chunkEnd - overlapDuration;
  }

  return chunks;
}

/**
 * Get transcript text around a specific time
 */
export function getTranscriptAroundTime(
  transcript: TranscriptSegment[],
  seconds: number,
  windowSeconds = 60
): { text: string; startFormatted: string; endFormatted: string } {
  const startTime = Math.max(0, seconds - windowSeconds);
  const endTime = seconds + windowSeconds;

  const segments = transcript.filter(
    (item) => item.start >= startTime && item.start <= endTime
  );

  if (segments.length === 0) {
    return { text: '', startFormatted: '', endFormatted: '' };
  }

  return {
    text: segments.map((item) => `[${item.formatted}] ${item.text}`).join('\n'),
    startFormatted: segments[0].formatted,
    endFormatted: segments[segments.length - 1].formatted,
  };
}
