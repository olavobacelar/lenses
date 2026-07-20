/**
 * Main-world YouTube transcript extraction.
 *
 * Keep this function self-contained. Chrome injects it into the page context,
 * so it cannot reference imports or extension-scope helpers.
 */

export function extractTranscriptFunction(): void {
  void (async function () {
    type TranscriptSegment = {
      text: string;
      start: number;
      duration: number;
      formatted: string;
    };

    type CaptionTrack = {
      baseUrl?: string;
      url?: string;
      languageCode?: string;
      vssId?: string;
      kind?: string;
    };

    type CaptionRenderer = {
      captionTracks?: CaptionTrack[];
      automaticCaptions?: CaptionTrack[];
    };

    type PlayerResponse = {
      videoDetails?: { videoId?: string };
      microformat?: { playerMicroformatRenderer?: { externalVideoId?: string } };
      captions?: { playerCaptionsTracklistRenderer?: CaptionRenderer };
    };

    const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    const PLAYER_CLIENTS = [
      { clientName: 'IOS', clientVersion: '20.10.3' },
      { clientName: 'ANDROID', clientVersion: '20.10.38' },
      { clientName: 'WEB', clientVersion: '2.20240101.00.00' },
    ];

    const videoId = getVideoIdFromUrl();

    function postTranscript(transcript: TranscriptSegment[] | null): void {
      window.postMessage({ type: 'LENSES_TRANSCRIPT_DATA', videoId, transcript }, '*');
    }

    if (!videoId) {
      postTranscript(null);
      return;
    }

    try {
      const existingTranscript = extractTranscriptFromDom();
      if (existingTranscript) {
        postTranscript(existingTranscript);
        return;
      }

      const inlineTranscript = await fetchTranscriptFromInlinePlayer();
      if (inlineTranscript) {
        postTranscript(inlineTranscript);
        return;
      }

      const playerTranscript = await fetchTranscriptFromPlayerApi();
      if (playerTranscript) {
        postTranscript(playerTranscript);
        return;
      }

      postTranscript(await openTranscriptPanelAndExtract());
    } catch (error) {
      console.warn('[Lenses] YouTube transcript extraction failed', error);
      postTranscript(null);
    }

    function getVideoIdFromUrl(): string | null {
      const { pathname } = window.location;
      if (
        pathname.startsWith('/shorts/') ||
        pathname.startsWith('/embed/') ||
        pathname.startsWith('/v/')
      ) {
        return pathname.split('/')[2] || null;
      }

      return new URLSearchParams(window.location.search).get('v');
    }

    function formatTime(seconds: number): string {
      const safeSeconds = Math.max(0, Math.floor(seconds));
      const hours = Math.floor(safeSeconds / 3600);
      const minutes = Math.floor((safeSeconds % 3600) / 60);
      const remainingSeconds = safeSeconds % 60;

      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
      }
      return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    function parseTimestamp(text: string): number | null {
      const parts = text
        .trim()
        .split(':')
        .map((part) => Number(part));

      if (parts.length < 2 || parts.length > 3 || parts.some((part) => Number.isNaN(part))) {
        return null;
      }

      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return parts[0] * 60 + parts[1];
    }

    function cleanText(text: string): string {
      return text.replace(/\s+/g, ' ').trim();
    }

    function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] | null {
      const normalized = segments
        .filter((segment) => segment.text && Number.isFinite(segment.start))
        .sort((a, b) => a.start - b.start)
        .map((segment, index, sorted) => {
          const next = sorted[index + 1];
          const inferredDuration = next ? Math.max(0, next.start - segment.start) : 0;
          const duration = segment.duration > 0 ? segment.duration : inferredDuration;
          return {
            text: cleanText(segment.text),
            start: segment.start,
            duration,
            formatted: segment.formatted || formatTime(segment.start),
          };
        });

      return normalized.length > 0 ? normalized : null;
    }

    function extractTranscriptFromDom(): TranscriptSegment[] | null {
      const segments: TranscriptSegment[] = [];

      document.querySelectorAll('ytd-transcript-segment-renderer').forEach((item) => {
        const timestamp = item.querySelector('.segment-timestamp')?.textContent ?? '';
        const text = item.querySelector('.segment-text')?.textContent ?? '';
        const start = parseTimestamp(timestamp);
        if (start !== null && cleanText(text)) {
          segments.push({ text: cleanText(text), start, duration: 0, formatted: timestamp.trim() });
        }
      });

      document.querySelectorAll('transcript-segment-view-model').forEach((item) => {
        const timestamp =
          item.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent ?? '';
        const text = item.querySelector('span.yt-core-attributed-string')?.textContent ?? '';
        const start = parseTimestamp(timestamp);
        if (start !== null && cleanText(text)) {
          segments.push({ text: cleanText(text), start, duration: 0, formatted: timestamp.trim() });
        }
      });

      return normalizeSegments(segments);
    }

    async function fetchTranscriptFromInlinePlayer(): Promise<TranscriptSegment[] | null> {
      const playerResponse = getValidatedPlayerResponse();
      return playerResponse ? fetchTranscriptFromCaptionTracks(playerResponse) : null;
    }

    async function fetchTranscriptFromPlayerApi(): Promise<TranscriptSegment[] | null> {
      for (const client of PLAYER_CLIENTS) {
        try {
          const response = await fetch(INNERTUBE_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: client.clientName,
                  clientVersion: client.clientVersion,
                  hl: navigator.language || 'en',
                  gl: 'US',
                },
              },
              videoId,
            }),
          });

          if (!response.ok) continue;
          const playerResponse = (await response.json()) as PlayerResponse;
          const transcript = await fetchTranscriptFromCaptionTracks(playerResponse);
          if (transcript) return transcript;
        } catch {
          continue;
        }
      }

      return null;
    }

    async function fetchTranscriptFromCaptionTracks(
      playerResponse: PlayerResponse
    ): Promise<TranscriptSegment[] | null> {
      const track = pickCaptionTrack(getCaptionTracks(playerResponse));
      return track ? fetchCaptionTrack(track) : null;
    }

    function getValidatedPlayerResponse(): PlayerResponse | null {
      const pageWindow = window as Window & { ytInitialPlayerResponse?: unknown };
      const candidates = [
        pageWindow.ytInitialPlayerResponse,
        extractInlinePlayerResponse(),
      ];

      for (const candidate of candidates) {
        if (isMatchingPlayerResponse(candidate)) return candidate as PlayerResponse;
      }

      return null;
    }

    function isMatchingPlayerResponse(value: unknown): value is PlayerResponse {
      if (!isRecord(value)) return false;
      const response = value as PlayerResponse;
      const detailVideoId = response.videoDetails?.videoId;
      const microformatVideoId = response.microformat?.playerMicroformatRenderer?.externalVideoId;
      return detailVideoId === videoId || microformatVideoId === videoId;
    }

    function extractInlinePlayerResponse(): unknown {
      for (const script of Array.from(document.scripts)) {
        const source = script.textContent ?? '';
        const markerIndex = source.indexOf('ytInitialPlayerResponse');
        if (markerIndex < 0) continue;

        const jsonText = extractBalancedJson(source, markerIndex);
        if (!jsonText) continue;

        try {
          return JSON.parse(jsonText);
        } catch {
          continue;
        }
      }

      return null;
    }

    function extractBalancedJson(source: string, startAt: number): string | null {
      const start = source.indexOf('{', startAt);
      if (start < 0) return null;

      let depth = 0;
      let inString = false;
      let quote = '';
      let escaping = false;

      for (let index = start; index < source.length; index++) {
        const char = source[index];

        if (inString) {
          if (escaping) {
            escaping = false;
          } else if (char === '\\') {
            escaping = true;
          } else if (char === quote) {
            inString = false;
            quote = '';
          }
          continue;
        }

        if (char === '"' || char === "'") {
          inString = true;
          quote = char;
          continue;
        }

        if (char === '{') depth++;
        if (char === '}') depth--;
        if (depth === 0) return source.slice(start, index + 1);
      }

      return null;
    }

    function getCaptionTracks(playerResponse: PlayerResponse): CaptionTrack[] {
      const renderer = playerResponse.captions?.playerCaptionsTracklistRenderer;
      const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
      const automaticCaptions = Array.isArray(renderer?.automaticCaptions)
        ? renderer.automaticCaptions
        : [];

      return [...captionTracks, ...automaticCaptions].filter((track) => track.baseUrl || track.url);
    }

    function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
      if (tracks.length === 0) return null;

      const preferredLanguage = normalizeLanguage(navigator.language || 'en');
      const preferredBase = preferredLanguage.split('-')[0];

      const score = (track: CaptionTrack): number => {
        const language = getTrackLanguage(track);
        const languageBase = language.split('-')[0];
        const isManual = !isAutoGeneratedTrack(track);
        const isPreferred = language === preferredLanguage || languageBase === preferredBase;
        const isEnglish = language === 'en' || language.startsWith('en-');

        if (isManual && isPreferred) return 0;
        if (isPreferred) return 1;
        if (isManual && isEnglish) return 2;
        if (isEnglish) return 3;
        if (isManual) return 4;
        return 5;
      };

      return [...tracks].sort((a, b) => score(a) - score(b))[0] ?? null;
    }

    function normalizeLanguage(language: string): string {
      return language.trim().replace(/_/g, '-').toLowerCase();
    }

    function getTrackLanguage(track: CaptionTrack): string {
      return normalizeLanguage(track.languageCode || track.vssId || '').replace(/^a\./, '');
    }

    function isAutoGeneratedTrack(track: CaptionTrack): boolean {
      return track.kind === 'asr' || String(track.vssId || '').startsWith('a.');
    }

    async function fetchCaptionTrack(track: CaptionTrack): Promise<TranscriptSegment[] | null> {
      const baseUrl = track.baseUrl || track.url;
      if (!baseUrl) return null;

      try {
        const parsedUrl = new URL(baseUrl);
        if (parsedUrl.hostname !== 'youtube.com' && !parsedUrl.hostname.endsWith('.youtube.com')) {
          return null;
        }
      } catch {
        return null;
      }

      for (const format of ['json3', '']) {
        try {
          const captionUrl = new URL(baseUrl);
          if (format) captionUrl.searchParams.set('fmt', format);

          const response = await fetch(captionUrl.toString(), {
            credentials: 'include',
            headers: { Accept: '*/*' },
          });
          if (!response.ok) continue;

          const body = await response.text();
          if (!body.trim()) continue;

          const transcript =
            format === 'json3' ? parseTranscriptJson(body) : parseTranscriptXml(body);
          if (transcript) return transcript;
        } catch {
          continue;
        }
      }

      return null;
    }

    function parseTranscriptJson(jsonText: string): TranscriptSegment[] | null {
      try {
        const data = JSON.parse(jsonText) as { events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string }>;
        }> };
        const segments: TranscriptSegment[] = [];

        for (const event of data.events ?? []) {
          if (!Array.isArray(event.segs)) continue;

          const text = cleanText(event.segs.map((segment) => segment.utf8 || '').join(''));
          const start = Number(event.tStartMs ?? 0) / 1000;
          const duration = Number(event.dDurationMs ?? 0) / 1000;

          if (text) segments.push({ text, start, duration, formatted: formatTime(start) });
        }

        return normalizeSegments(segments);
      } catch {
        return null;
      }
    }

    function parseTranscriptXml(xml: string): TranscriptSegment[] | null {
      const documentXml = new DOMParser().parseFromString(xml, 'text/xml');
      const segments: TranscriptSegment[] = [];

      documentXml.querySelectorAll('p[t]').forEach((paragraph) => {
        const start = Number(paragraph.getAttribute('t') ?? 0) / 1000;
        const duration = Number(paragraph.getAttribute('d') ?? 0) / 1000;
        const words = Array.from(paragraph.querySelectorAll('s')).map(
          (segment) => segment.textContent ?? ''
        );
        const text = cleanText(words.length > 0 ? words.join('') : paragraph.textContent ?? '');
        if (text) segments.push({ text, start, duration, formatted: formatTime(start) });
      });

      if (segments.length === 0) {
        documentXml.querySelectorAll('text[start]').forEach((node) => {
          const start = Number(node.getAttribute('start') ?? 0);
          const duration = Number(node.getAttribute('dur') ?? 0);
          const text = cleanText(node.textContent ?? '');
          if (text) segments.push({ text, start, duration, formatted: formatTime(start) });
        });
      }

      return normalizeSegments(segments);
    }

    async function openTranscriptPanelAndExtract(): Promise<TranscriptSegment[] | null> {
      const transcriptButton = findTranscriptButton();
      if (!transcriptButton) return null;

      transcriptButton.click();
      return pollForTranscript();
    }

    async function pollForTranscript(): Promise<TranscriptSegment[] | null> {
      for (let attempt = 0; attempt < 20; attempt++) {
        const transcript = extractTranscriptFromDom();
        if (transcript) return transcript;
        await delay(250);
      }
      return null;
    }

    function findTranscriptButton(): HTMLElement | null {
      const selectorMatch = document.querySelector(
        'ytd-video-description-transcript-section-renderer button, button[aria-label*="transcript" i]'
      );
      if (selectorMatch instanceof HTMLElement) return selectorMatch;

      const textMatch = Array.from(document.querySelectorAll('button')).find((button) => {
        const text = cleanText(button.textContent ?? '').toLowerCase();
        return text.includes('show transcript') || text === 'transcript';
      });

      return textMatch instanceof HTMLElement ? textMatch : null;
    }

    function delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null;
    }
  })();
}
