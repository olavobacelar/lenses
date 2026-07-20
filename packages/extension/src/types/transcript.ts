/**
 * Transcript and video-related types
 */

/** A single segment of a video transcript with timing information */
export interface TranscriptSegment {
  /** The text content of this segment */
  text: string;
  /** Start time in seconds */
  start: number;
  /** Duration of this segment in seconds */
  duration: number;
  /** Human-readable timestamp (e.g., "3:45" or "1:23:45") */
  formatted: string;
}

/** Video metadata extracted from YouTube page */
export interface VideoMetadata {
  /** Video title */
  title: string;
  /** Channel name */
  channel: string;
}

/** Current playback time information */
export interface VideoTime {
  /** Current position in seconds */
  seconds: number;
  /** Formatted current time (e.g., "3:45") */
  formatted: string;
  /** Total video duration in seconds */
  duration: number;
  /** Formatted total duration (e.g., "10:30") */
  durationFormatted: string;
}

/** Chunk of transcript for claims extraction (5-minute segments with overlap) */
export interface TranscriptChunk {
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Transcript segments within this chunk */
  segments: TranscriptSegment[];
  /** Pre-formatted text with timestamps */
  text: string;
}
