import type { TextSegment } from "../../types/ai-content";
import type { TranscriptSegment } from "../../types/transcript";

export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${segment.formatted}] ${segment.text}`).join("\n");
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function formatCompactNumber(value: number): string {
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

export function collectCitations(
  textSegments: TextSegment[]
): Array<{ url: string; title: string }> {
  const seen = new Set<string>();
  const citations: Array<{ url: string; title: string }> = [];

  for (const segment of textSegments) {
    for (const citation of segment.citations) {
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      citations.push({ url: citation.url, title: citation.title });
    }
  }

  return citations;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isApiKeyError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const normalized = message.toLowerCase();
  return normalized.includes("api key") || normalized.includes("key not configured");
}

export function isYouTubeVideoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname.endsWith("youtube.com") &&
      (url.pathname.startsWith("/watch") || url.pathname.startsWith("/shorts/"))
    );
  } catch {
    return false;
  }
}
