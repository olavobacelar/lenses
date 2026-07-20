import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface SlideExportRequest {
  videoId?: string;
  videoUrl?: string;
  title?: string;
}

interface CandidateFrame {
  frameIndex: number;
  fileName: string;
  path: string;
  timestamp: number;
}

interface PrefilteredFrame extends CandidateFrame {
  hash: bigint;
  mean: number;
  stdDev: number;
}

interface FrameGroup {
  groupIndex: number;
  frames: PrefilteredFrame[];
  startTimestamp: number;
  endTimestamp: number;
}

interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface TranscriptData {
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

interface GeminiGroupDecision {
  groupIndex: number;
  chosenFrameIndex: number;
  keep: boolean;
  title?: string;
  visibleText?: string;
  summary?: string;
  contentType?: string;
  reason?: string;
}

interface GeminiVideoSlideDecision {
  slideIndex: number;
  representativeTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  keep: boolean;
  title?: string;
  visibleText?: string;
  summary?: string;
  contentType?: string;
  reason?: string;
}

interface MergedSlide {
  frame: CandidateFrame;
  decision: SlideDecision;
  title: string;
}

interface TimedSentence {
  text: string;
  start: number;
  end: number;
}

interface CommandResult {
  stdout: Buffer;
  stderr: string;
}

interface GeminiUploadedFile {
  name: string;
  uri: string;
  mimeType: string;
  state?: string;
}

interface SlideDecision {
  keep: boolean;
  title?: string;
  visibleText?: string;
  summary?: string;
  contentType?: string;
  reason?: string;
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: 'image/jpeg'; data: string } }
  | { file_data: { mime_type?: string; file_uri: string } };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Lenses-Filename',
};

const PORT = readPositiveInteger('SLIDE_EXPORT_PORT', 8765);
const FRAME_INTERVAL_SECONDS = readPositiveNumber('SLIDE_FRAME_INTERVAL_SECONDS', 0.5);
const GEMINI_GROUP_FRAME_LIMIT = readPositiveInteger(
  'SLIDE_EXPORT_GEMINI_GROUP_FRAME_LIMIT',
  6
);
const SLIDE_GROUP_HASH_DISTANCE_RATIO = readPositiveNumber(
  'SLIDE_GROUP_HASH_DISTANCE_RATIO',
  0.14
);
const GEMINI_VIDEO_MAX_SLIDES = readPositiveInteger(
  'SLIDE_EXPORT_GEMINI_VIDEO_MAX_SLIDES',
  80
);
const GEMINI_FILE_PROCESSING_TIMEOUT_MS = readPositiveInteger(
  'SLIDE_EXPORT_GEMINI_FILE_TIMEOUT_MS',
  10 * 60 * 1000
);
const COMMAND_TIMEOUT_MS = readPositiveInteger(
  'SLIDE_EXPORT_COMMAND_TIMEOUT_MS',
  30 * 60 * 1000
);
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v1';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const GEMINI_VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'gemini-3.5-flash';
const FINGERPRINT_WIDTH = 17;
const FINGERPRINT_HEIGHT = 16;
const HASH_BIT_COUNT = (FINGERPRINT_WIDTH - 1) * FINGERPRINT_HEIGHT;

function logProgress(message: string): void {
  console.log(`[slide-export] ${message}`);
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        port: PORT,
        geminiModel: GEMINI_MODEL,
        geminiVideoModel: GEMINI_VIDEO_MODEL,
        elevenLabsModel: ELEVENLABS_STT_MODEL,
      });
    }

    if (request.method === 'POST' && url.pathname === '/slides/export') {
      try {
        return await handleSlideExport(request);
      } catch (error) {
        console.error('[slide-export] failed:', error);
        return jsonResponse({ error: formatError(error) }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/slides/export/video') {
      try {
        return await handleGeminiVideoSlideExport(request);
      } catch (error) {
        console.error('[slide-export] failed:', error);
        return jsonResponse({ error: formatError(error) }, 500);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
});

console.log(`[slide-export] listening on http://127.0.0.1:${PORT}`);

async function handleSlideExport(request: Request): Promise<Response> {
  assertRequiredEnvironment();

  const body = (await request.json()) as SlideExportRequest;
  const videoUrl = normalizeYouTubeUrl(body);
  const title = cleanText(body.title) || cleanText(body.videoId) || 'YouTube video';
  const workDir = await mkdtemp(join(tmpdir(), 'lenses-slides-'));

  try {
    const videoPath = join(workDir, 'video.mp4');
    const audioPath = join(workDir, 'audio.mp3');
    const frameDir = join(workDir, 'frames');
    await mkdir(frameDir, { recursive: true });

    logProgress('downloading video with yt-dlp');
    await downloadVideo(videoUrl, videoPath);

    logProgress('extracting audio with ffmpeg');
    await extractAudio(videoPath, audioPath);

    logProgress('extracting candidate frames with ffmpeg');
    const candidateFrames = await extractCandidateFrames(videoPath, frameDir);
    logProgress(
      `extracted ${candidateFrames.length} candidate frames at ${FRAME_INTERVAL_SECONDS}s intervals`
    );

    logProgress(`pre-filtering ${candidateFrames.length} frames`);
    const prefilteredFrames = await prefilterFrames(candidateFrames);
    if (prefilteredFrames.length === 0) {
      throw new Error('No usable video frames were found after pre-filtering.');
    }
    logProgress(
      `pre-filter kept ${prefilteredFrames.length}/${candidateFrames.length} frames`
    );

    logProgress('grouping frames by visual similarity without OCR');
    const frameGroups = groupSimilarFrames(prefilteredFrames);
    if (frameGroups.length === 0) {
      throw new Error('No visual frame groups were found after pre-filtering.');
    }
    logProgress(
      `created ${frameGroups.length} visual groups from ${prefilteredFrames.length} frames`
    );

    logProgress('starting ElevenLabs transcription and Gemini group selection in parallel');
    logProgress('transcribing audio with ElevenLabs');
    logProgress(
      `selecting representatives for ${frameGroups.length} visual groups with Gemini`
    );
    const [transcript, decisions] = await Promise.all([
      transcribeWithElevenLabs(audioPath),
      classifyFrameGroupsWithGemini(frameGroups),
    ]);
    logProgress(
      `ElevenLabs returned ${transcript.words.length} words across ${transcript.segments.length} transcript segments`
    );
    logProgress(
      `Gemini returned ${decisions.size} group decisions with ${countKeptDecisions(decisions)} kept groups`
    );

    const slides = mergeSlidesWithTranscript(frameGroups, decisions);
    if (slides.length === 0) {
      throw new Error('Gemini did not find any useful slide frames in this video.');
    }
    logProgress(`merged ${slides.length} slide frames into the transcript`);

    logProgress(`rendering HTML with ${slides.length} interspersed slide figures`);
    const html = await renderHandout({
      title,
      videoUrl,
      transcript,
      slides,
    });
    const fileName = `${sanitizeFileName(title)}-slides.html`;

    return new Response(html, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'x-lenses-filename': fileName,
      },
    });
  } finally {
    if (process.env.SLIDE_EXPORT_KEEP_WORKDIR !== '1') {
      await rm(workDir, { recursive: true, force: true });
    } else {
      console.log(`[slide-export] kept work directory: ${workDir}`);
    }
  }
}

async function handleGeminiVideoSlideExport(request: Request): Promise<Response> {
  assertRequiredEnvironment();

  const body = (await request.json()) as SlideExportRequest;
  const videoUrl = normalizeYouTubeUrl(body);
  const title = cleanText(body.title) || cleanText(body.videoId) || 'YouTube video';
  const workDir = await mkdtemp(join(tmpdir(), 'lenses-gemini-video-slides-'));

  try {
    const videoPath = join(workDir, 'video.mp4');
    const audioPath = join(workDir, 'audio.mp3');
    const frameDir = join(workDir, 'video-slide-frames');
    await mkdir(frameDir, { recursive: true });

    logProgress('downloading video with yt-dlp for Gemini video analysis');
    await downloadVideo(videoUrl, videoPath);

    logProgress('starting audio extraction/transcription and Gemini whole-video analysis in parallel');
    const [transcript, videoDecisions] = await Promise.all([
      extractAudio(videoPath, audioPath).then(() => {
        logProgress('transcribing audio with ElevenLabs');
        return transcribeWithElevenLabs(audioPath);
      }),
      analyzeVideoWithGemini(videoPath, videoUrl),
    ]);
    logProgress(
      `ElevenLabs returned ${transcript.words.length} words across ${transcript.segments.length} transcript segments`
    );
    logProgress(
      `Gemini video analysis returned ${videoDecisions.length} kept slide moments`
    );

    if (videoDecisions.length === 0) {
      throw new Error('Gemini did not find any useful slide moments in this video.');
    }

    logProgress(`extracting ${videoDecisions.length} representative frames with ffmpeg`);
    const slides = await extractSlidesFromVideoDecisions(
      videoPath,
      frameDir,
      videoDecisions
    );
    if (slides.length === 0) {
      throw new Error('Could not extract any representative frames from Gemini timestamps.');
    }

    logProgress(`rendering HTML with ${slides.length} Gemini video slide figures`);
    const html = await renderHandout({
      title,
      videoUrl,
      transcript,
      slides,
    });
    const fileName = `${sanitizeFileName(title)}-gemini-video-slides.html`;

    return new Response(html, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'x-lenses-filename': fileName,
      },
    });
  } finally {
    if (process.env.SLIDE_EXPORT_KEEP_WORKDIR !== '1') {
      await rm(workDir, { recursive: true, force: true });
    } else {
      console.log(`[slide-export] kept work directory: ${workDir}`);
    }
  }
}

function assertRequiredEnvironment(): void {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY must be set for slide export.');
  }

  if (!getGeminiApiKey()) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY must be set for slide export.');
  }
}

function normalizeYouTubeUrl(body: SlideExportRequest): string {
  const videoId = cleanText(body.videoId);
  if (videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  const rawUrl = cleanText(body.videoUrl);
  if (!rawUrl) {
    throw new Error('A YouTube video ID or URL is required.');
  }

  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^www\./, '');
  const isAllowedHost = host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  if (!isAllowedHost) {
    throw new Error('Only YouTube URLs are supported.');
  }

  return url.toString();
}

async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  await runCommand('yt-dlp', [
    '--no-playlist',
    '--force-overwrites',
    '--no-warnings',
    '-f',
    'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/best[ext=mp4]/best',
    '--merge-output-format',
    'mp4',
    '-o',
    outputPath,
    videoUrl,
  ]);
}

async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    audioPath,
  ]);
}

async function extractCandidateFrames(
  videoPath: string,
  frameDir: string
): Promise<CandidateFrame[]> {
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-vf',
    formatFpsFilter(FRAME_INTERVAL_SECONDS),
    '-q:v',
    '4',
    join(frameDir, 'frame-%06d.jpg'),
  ]);

  const files = (await readdir(frameDir))
    .filter((file) => file.endsWith('.jpg'))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error('ffmpeg did not extract any candidate frames.');
  }

  return files.map((fileName, index) => ({
    frameIndex: index + 1,
    fileName,
    path: join(frameDir, fileName),
    timestamp: index * FRAME_INTERVAL_SECONDS,
  }));
}

async function prefilterFrames(frames: CandidateFrame[]): Promise<PrefilteredFrame[]> {
  const accepted: PrefilteredFrame[] = [];
  let rejectedBlank = 0;
  const logEvery = Math.max(100, Math.floor(frames.length / 10));

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const stats = await getFrameStats(frame.path);

    if (stats.mean < 8 || stats.mean > 248 || stats.stdDev < 4) {
      rejectedBlank += 1;
      if ((index + 1) % logEvery === 0 || index + 1 === frames.length) {
        logProgress(
          `pre-filter progress ${index + 1}/${frames.length}: kept ${accepted.length}, blank/flat ${rejectedBlank}`
        );
      }
      continue;
    }

    accepted.push({
      ...frame,
      hash: stats.hash,
      mean: stats.mean,
      stdDev: stats.stdDev,
    });

    if ((index + 1) % logEvery === 0 || index + 1 === frames.length) {
      logProgress(
        `pre-filter progress ${index + 1}/${frames.length}: kept ${accepted.length}, blank/flat ${rejectedBlank}`
      );
    }
  }

  logProgress(
    `pre-filter summary: kept ${accepted.length}, removed ${rejectedBlank} blank/flat frames`
  );

  return accepted;
}

async function getFrameStats(path: string): Promise<{
  hash: bigint;
  mean: number;
  stdDev: number;
}> {
  const { stdout } = await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    '-vf',
    `scale=${FINGERPRINT_WIDTH}:${FINGERPRINT_HEIGHT},format=gray`,
    '-f',
    'rawvideo',
    '-',
  ]);
  const expectedPixels = FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT;
  const pixels = Array.from(stdout.subarray(0, expectedPixels));

  if (pixels.length < expectedPixels) {
    throw new Error(`Could not fingerprint frame ${path}.`);
  }

  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const variance =
    pixels.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / pixels.length;
  const stdDev = Math.sqrt(variance);
  const hash = buildDifferenceHash(pixels);

  return { hash, mean, stdDev };
}

function buildDifferenceHash(pixels: number[]): bigint {
  let hash = 0n;
  let bitIndex = 0;

  for (let y = 0; y < FINGERPRINT_HEIGHT; y += 1) {
    const rowOffset = y * FINGERPRINT_WIDTH;
    for (let x = 0; x < FINGERPRINT_WIDTH - 1; x += 1) {
      const left = pixels[rowOffset + x];
      const right = pixels[rowOffset + x + 1];
      if (left > right) {
        hash |= 1n << BigInt(bitIndex);
      }
      bitIndex += 1;
    }
  }

  return hash;
}

function groupSimilarFrames(frames: PrefilteredFrame[]): FrameGroup[] {
  if (frames.length === 0) return [];

  const groups: FrameGroup[] = [];
  let currentFrames: PrefilteredFrame[] = [frames[0]];

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previousFrame = currentFrames[currentFrames.length - 1];

    if (areFramesVisuallySimilar(previousFrame, frame)) {
      currentFrames.push(frame);
      continue;
    }

    groups.push(createFrameGroup(groups.length + 1, currentFrames));
    currentFrames = [frame];
  }

  groups.push(createFrameGroup(groups.length + 1, currentFrames));
  return groups;
}

function createFrameGroup(groupIndex: number, frames: PrefilteredFrame[]): FrameGroup {
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  return {
    groupIndex,
    frames,
    startTimestamp: firstFrame.timestamp,
    endTimestamp: lastFrame.timestamp,
  };
}

function areFramesVisuallySimilar(
  previousFrame: PrefilteredFrame,
  nextFrame: PrefilteredFrame
): boolean {
  return normalizedHammingDistance(previousFrame.hash, nextFrame.hash) <=
    SLIDE_GROUP_HASH_DISTANCE_RATIO;
}

function normalizedHammingDistance(left: bigint, right: bigint): number {
  return hammingDistance(left, right) / HASH_BIT_COUNT;
}

function selectGroupEvidenceFrames(group: FrameGroup): PrefilteredFrame[] {
  const frameLimit = Math.max(1, GEMINI_GROUP_FRAME_LIMIT);
  if (group.frames.length <= frameLimit) {
    return group.frames;
  }
  if (frameLimit === 1) {
    return [selectLocalRepresentativeFrame(group)];
  }

  const selected = new Map<number, PrefilteredFrame>();
  const addFrame = (frame: PrefilteredFrame | undefined) => {
    if (frame) selected.set(frame.frameIndex, frame);
  };
  const lastIndex = group.frames.length - 1;

  addFrame(group.frames[0]);
  addFrame(group.frames[Math.floor(lastIndex * 0.25)]);
  addFrame(group.frames[Math.floor(lastIndex * 0.5)]);
  addFrame(group.frames[Math.floor(lastIndex * 0.75)]);
  addFrame(group.frames[lastIndex]);
  addFrame(selectLocalRepresentativeFrame(group));

  for (let slot = 0; selected.size < frameLimit && slot < frameLimit; slot += 1) {
    const index = Math.round((lastIndex * slot) / (frameLimit - 1));
    addFrame(group.frames[index]);
  }
  for (const frame of group.frames) {
    if (selected.size >= frameLimit) break;
    addFrame(frame);
  }

  return Array.from(selected.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, frameLimit);
}

function selectLocalRepresentativeFrame(group: FrameGroup): PrefilteredFrame {
  return group.frames.reduce((best, frame) =>
    scoreRepresentativeFrame(group, frame) > scoreRepresentativeFrame(group, best)
      ? frame
      : best
  );
}

function scoreRepresentativeFrame(group: FrameGroup, frame: PrefilteredFrame): number {
  const midpoint = (group.startTimestamp + group.endTimestamp) / 2;
  const distanceFromMiddle = Math.abs(frame.timestamp - midpoint);
  return frame.stdDev - distanceFromMiddle * 0.02;
}

async function transcribeWithElevenLabs(audioPath: string): Promise<TranscriptData> {
  const audioBytes = await readFile(audioPath);
  logProgress(
    `ElevenLabs upload prepared (${formatBytes(audioBytes.byteLength)} audio file)`
  );
  const formData = new FormData();
  formData.set(
    'file',
    new File([new Uint8Array(audioBytes)], 'audio.mp3', { type: 'audio/mpeg' })
  );
  formData.set('model_id', ELEVENLABS_STT_MODEL);
  formData.set('timestamps_granularity', 'word');
  formData.set('diarize', 'false');
  formData.set('tag_audio_events', 'false');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
    },
    body: formData,
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`ElevenLabs transcription failed: ${responseText}`);
  }

  const data = JSON.parse(responseText) as Record<string, unknown>;
  const transcript = normalizeElevenLabsTranscript(data);
  logProgress(
    `ElevenLabs transcription complete (${transcript.words.length} words, ${transcript.text.length} chars)`
  );
  return transcript;
}

function normalizeElevenLabsTranscript(data: Record<string, unknown>): TranscriptData {
  const rawWords = Array.isArray(data.words) ? data.words : [];
  const words: TranscriptWord[] = rawWords
    .map((rawWord) => normalizeTranscriptWord(rawWord))
    .filter((word): word is TranscriptWord => Boolean(word));

  const text = typeof data.text === 'string' ? data.text : joinWords(words);
  return {
    text,
    words,
    segments: buildTranscriptSegments(words, text),
  };
}

function normalizeTranscriptWord(rawWord: unknown): TranscriptWord | null {
  if (!rawWord || typeof rawWord !== 'object') return null;

  const word = rawWord as Record<string, unknown>;
  const type = typeof word.type === 'string' ? word.type : '';
  const text = cleanText(word.text) || cleanText(word.word);
  if (!text || type === 'spacing') return null;

  const start = typeof word.start === 'number' ? word.start : 0;
  const end = typeof word.end === 'number' ? word.end : start;
  return { text, start, end };
}

function buildTranscriptSegments(
  words: TranscriptWord[],
  fallbackText: string
): TranscriptSegment[] {
  if (words.length === 0) {
    return fallbackText ? [{ text: fallbackText, start: 0, end: 0 }] : [];
  }

  const segments: TranscriptSegment[] = [];
  let currentWords: TranscriptWord[] = [];
  let segmentStart = words[0].start;

  for (const word of words) {
    const projectedText = joinWords([...currentWords, word]);
    const isLongSegment = projectedText.length > 260;
    const isLongDuration = word.start - segmentStart > 18;

    if (currentWords.length > 0 && (isLongSegment || isLongDuration)) {
      const lastWord = currentWords[currentWords.length - 1];
      segments.push({
        text: joinWords(currentWords),
        start: segmentStart,
        end: lastWord.end,
      });
      currentWords = [];
      segmentStart = word.start;
    }

    currentWords.push(word);
  }

  if (currentWords.length > 0) {
    const lastWord = currentWords[currentWords.length - 1];
    segments.push({
      text: joinWords(currentWords),
      start: segmentStart,
      end: lastWord.end,
    });
  }

  return segments;
}

async function classifyFrameGroupsWithGemini(
  groups: FrameGroup[]
): Promise<Map<number, GeminiGroupDecision>> {
  const decisions = new Map<number, GeminiGroupDecision>();

  for (const group of groups) {
    const evidenceFrames = selectGroupEvidenceFrames(group);
    logProgress(
      `Gemini group ${group.groupIndex}/${groups.length}: sending ${evidenceFrames.length}/${group.frames.length} evidence frames (${formatTimestamp(group.startTimestamp)}-${formatTimestamp(group.endTimestamp)})`
    );
    const decision = await classifyGeminiGroup(group, evidenceFrames);
    decisions.set(group.groupIndex, decision);
    logProgress(
      `Gemini group ${group.groupIndex}/${groups.length}: ${decision.keep ? 'kept' : 'rejected'}${decision.keep ? ` frame ${decision.chosenFrameIndex}` : ''}`
    );
  }

  return decisions;
}

async function classifyGeminiGroup(
  group: FrameGroup,
  evidenceFrames: PrefilteredFrame[]
): Promise<GeminiGroupDecision> {
  const parts: GeminiPart[] = [{ text: buildGeminiGroupPrompt(group, evidenceFrames) }];
  let imageBytes = 0;

  for (const frame of evidenceFrames) {
    const image = await readFile(frame.path);
    imageBytes += image.byteLength;
    parts.push({ text: `Frame ${frame.frameIndex} at ${formatTimestamp(frame.timestamp)}` });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: image.toString('base64'),
      },
    });
  }
  logProgress(
    `Gemini group ${group.groupIndex} payload includes ${evidenceFrames.length} images (${formatBytes(imageBytes)})`
  );

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(getGeminiApiKey()!)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1,
        },
      }),
    }
  );
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      buildGeminiErrorMessage(response.status, responseText, {
        model: GEMINI_MODEL,
        operation: 'Gemini frame filtering',
      })
    );
  }

  const payload = JSON.parse(responseText) as Record<string, unknown>;
  const text = extractGeminiText(payload);
  return parseGeminiGroupDecision(text, group);
}

async function analyzeVideoWithGemini(
  videoPath: string,
  videoUrl: string
): Promise<GeminiVideoSlideDecision[]> {
  logProgress('uploading whole video to Gemini Files API');
  const uploadedFile = await uploadGeminiVideoFile(videoPath);

  try {
    const activeFile = await waitForGeminiFile(uploadedFile);
    logProgress(`Gemini video file ready: ${activeFile.name}`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VIDEO_MODEL}:generateContent?key=${encodeURIComponent(getGeminiApiKey()!)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  file_data: {
                    mime_type: activeFile.mimeType,
                    file_uri: activeFile.uri,
                  },
                },
                { text: buildGeminiVideoPrompt(videoUrl) },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
          },
        }),
      }
    );
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        buildGeminiErrorMessage(response.status, responseText, {
          model: GEMINI_VIDEO_MODEL,
          operation: 'Gemini video analysis',
        })
      );
    }

    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const text = extractGeminiText(payload);
    const decisions = parseGeminiVideoDecisions(text);
    return decisions.slice(0, GEMINI_VIDEO_MAX_SLIDES);
  } finally {
    await deleteGeminiFile(uploadedFile.name);
  }
}

async function uploadGeminiVideoFile(videoPath: string): Promise<GeminiUploadedFile> {
  const videoBytes = await readFile(videoPath);
  logProgress(`Gemini upload prepared (${formatBytes(videoBytes.byteLength)} video file)`);
  const apiKey = getGeminiApiKey()!;
  const startResponse = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(videoBytes.byteLength),
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: {
          display_name: 'lenses-video.mp4',
        },
      }),
    }
  );

  if (!startResponse.ok) {
    throw new Error(`Gemini video upload start failed: ${await startResponse.text()}`);
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini video upload did not return an upload URL.');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(videoBytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: videoBytes,
  });
  const uploadText = await uploadResponse.text();

  if (!uploadResponse.ok) {
    throw new Error(`Gemini video upload failed: ${uploadText}`);
  }

  const payload = JSON.parse(uploadText) as Record<string, unknown>;
  return normalizeGeminiUploadedFile(payload);
}

async function waitForGeminiFile(file: GeminiUploadedFile): Promise<GeminiUploadedFile> {
  const startedAt = Date.now();
  let currentFile = file;

  while (currentFile.state === 'PROCESSING') {
    if (Date.now() - startedAt > GEMINI_FILE_PROCESSING_TIMEOUT_MS) {
      throw new Error(`Gemini file ${file.name} was still processing after the timeout.`);
    }

    logProgress(`Gemini video file still processing: ${file.name}`);
    await sleep(2000);
    currentFile = await getGeminiFile(file.name);
  }

  if (currentFile.state === 'FAILED') {
    throw new Error(`Gemini failed to process uploaded video ${file.name}.`);
  }

  return currentFile;
}

async function getGeminiFile(name: string): Promise<GeminiUploadedFile> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    {
      headers: {
        'x-goog-api-key': getGeminiApiKey()!,
      },
    }
  );
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini file lookup failed: ${responseText}`);
  }

  return normalizeGeminiUploadedFile(JSON.parse(responseText) as Record<string, unknown>);
}

async function deleteGeminiFile(name: string): Promise<void> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    {
      method: 'DELETE',
      headers: {
        'x-goog-api-key': getGeminiApiKey()!,
      },
    }
  );

  if (!response.ok) {
    logProgress(`could not delete Gemini video file ${name}: ${await response.text()}`);
  }
}

function normalizeGeminiUploadedFile(payload: Record<string, unknown>): GeminiUploadedFile {
  const file = (payload.file && typeof payload.file === 'object'
    ? payload.file
    : payload) as Record<string, unknown>;
  const name = cleanText(file.name);
  const uri = cleanText(file.uri);
  const mimeType = cleanText(file.mimeType) || cleanText(file.mime_type) || 'video/mp4';
  const state = cleanText(file.state);

  if (!name || !uri) {
    throw new Error('Gemini video upload returned invalid file metadata.');
  }

  return {
    name,
    uri,
    mimeType,
    state,
  };
}

function buildGeminiVideoPrompt(videoUrl: string): string {
  return [
    'Analyze the whole YouTube lecture or presentation video and identify useful slide, whiteboard, screenshare, diagram, chart, table, code, product-screen, or equation moments for a handout.',
    `Video URL for context: ${videoUrl}`,
    'Create one item per visually stable presentation state. Do not create a new item for every camera movement, speaker motion, cursor movement, compression change, or tiny animation.',
    'For incremental slide builds or equation/whiteboard builds, merge neighboring frames when they belong to the same conceptual slide or board state. Prefer the most complete useful state unless an intermediate state is meaningfully different.',
    'Reject talking-head-only moments, ads, end cards, loading screens, transitions, b-roll, blurred frames, and repeated duplicates.',
    'For each kept item, choose a representative timestamp in seconds where the visual content is clearest and least occluded.',
    'Extract visible text, equations, labels, and code using all visual information available across the item, not only the representative timestamp.',
    'Do not summarize the slide in visibleText. visibleText should contain actual visible content from the video.',
    `Return at most ${GEMINI_VIDEO_MAX_SLIDES} items.`,
    'Return only JSON. Use this exact shape:',
    '{"slides":[{"slideIndex":1,"keep":true,"startTimestamp":12.5,"endTimestamp":18.0,"representativeTimestamp":16.0,"title":"short title","visibleText":"visible slide text and equations gathered across the visual segment","contentType":"slide","reason":"brief reason"}]}',
    'All timestamps must be numbers in seconds.',
  ].join('\n');
}

function buildGeminiErrorMessage(
  status: number,
  responseText: string,
  context: { model: string; operation: string }
): string {
  if (status === 404) {
    return [
      `${context.operation} failed: model "${context.model}" is not available for v1beta generateContent.`,
      'Set the relevant Gemini model setting to one that supports generateContent.',
      `Original response: ${responseText}`,
    ].join(' ');
  }

  return `${context.operation} failed: ${responseText}`;
}

function countKeptDecisions(decisions: Map<number, GeminiGroupDecision>): number {
  let count = 0;
  for (const decision of decisions.values()) {
    if (decision.keep) count += 1;
  }
  return count;
}

function buildGeminiGroupPrompt(
  group: FrameGroup,
  evidenceFrames: PrefilteredFrame[]
): string {
  const labels = evidenceFrames
    .map((frame) => `- Frame ${frame.frameIndex}: ${formatTimestamp(frame.timestamp)}`)
    .join('\n');

  return [
    'You are analyzing one contiguous visual group from a YouTube lecture or presentation video.',
    `Group ${group.groupIndex} spans ${formatTimestamp(group.startTimestamp)}-${formatTimestamp(group.endTimestamp)} and contains ${group.frames.length} sampled frames.`,
    `You are seeing ${evidenceFrames.length} representative evidence frames from that group.`,
    'The local grouping used only visual similarity, not OCR or transcript text.',
    'Keep: slides, screenshares, whiteboards, diagrams, charts, tables, code, product screens, or other meaningful presentation visuals.',
    'Reject: talking heads, ads, end cards, loading screens, transitions, b-roll, blurred frames, and visual groups with no useful presentation content.',
    'Choose the single best representative frame for the handout from the labeled frames.',
    'Extract visible text, equations, labels, and code using every supplied frame in the group, not only the chosen representative. If later frames reveal text that was hidden or incomplete earlier, include the completed version.',
    'Do not summarize the slide in visibleText. visibleText should contain actual visible content from the images.',
    'Return only one JSON object. Use this exact shape:',
    '{"groupIndex":1,"keep":true,"chosenFrameIndex":1,"title":"short title","visibleText":"visible slide text and equations gathered across the group","contentType":"slide","reason":"brief reason"}',
    'Use the frameIndex from these labels:',
    labels,
  ].join('\n');
}

function extractGeminiText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0] as Record<string, unknown> | undefined;
  const content = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .map((part) => ((part as Record<string, unknown>).text as string | undefined) || '')
    .join('');

  if (!text.trim()) {
    throw new Error('Gemini returned an empty frame filtering response.');
  }

  return text;
}

function parseGeminiGroupDecision(text: string, group: FrameGroup): GeminiGroupDecision {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const cleaned = (fenced || text).trim();
  const parsed = parseJsonLenient(cleaned);

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const normalized = candidates
    .map((item) => normalizeGeminiGroupDecision(item, group))
    .find((item): item is GeminiGroupDecision => Boolean(item));

  if (!normalized) {
    throw new Error(`Could not parse Gemini group ${group.groupIndex} filtering JSON.`);
  }

  return normalized;
}

function parseGeminiVideoDecisions(text: string): GeminiVideoSlideDecision[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const cleaned = (fenced || text).trim();
  const parsed = parseJsonLenient(cleaned);

  const rawSlides = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>).slides ??
        (parsed as Record<string, unknown>).moments ??
        (parsed as Record<string, unknown>).segments)
      : [];

  if (!Array.isArray(rawSlides)) {
    throw new Error('Could not parse Gemini video slide JSON.');
  }

  return rawSlides
    .map((item, index) => normalizeGeminiVideoDecision(item, index + 1))
    .filter((item): item is GeminiVideoSlideDecision => Boolean(item))
    .filter((item) => item.keep)
    .sort(
      (left, right) =>
        left.representativeTimestamp - right.representativeTimestamp ||
        left.startTimestamp - right.startTimestamp
    );
}

function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    }

    throw new Error('Response did not contain JSON.');
  }
}

function normalizeGeminiGroupDecision(
  item: unknown,
  group: FrameGroup
): GeminiGroupDecision | null {
  if (!item || typeof item !== 'object') return null;

  const record = item as Record<string, unknown>;
  const groupIndex = Number(record.groupIndex ?? record.group_index ?? group.groupIndex);
  const chosenFrameIndex = Number(
    record.chosenFrameIndex ??
      record.chosen_frame_index ??
      record.frameIndex ??
      record.frame_index ??
      record.index
  );
  const fallbackFrame = selectLocalRepresentativeFrame(group);

  return {
    groupIndex: Number.isFinite(groupIndex) ? groupIndex : group.groupIndex,
    chosenFrameIndex: Number.isFinite(chosenFrameIndex)
      ? chosenFrameIndex
      : fallbackFrame.frameIndex,
    keep: record.keep === true,
    title: cleanText(record.title),
    visibleText: cleanText(record.visibleText) || cleanText(record.visible_text),
    summary: cleanText(record.summary),
    contentType: cleanText(record.contentType) || cleanText(record.content_type),
    reason: cleanText(record.reason),
  };
}

function normalizeGeminiVideoDecision(
  item: unknown,
  fallbackIndex: number
): GeminiVideoSlideDecision | null {
  if (!item || typeof item !== 'object') return null;

  const record = item as Record<string, unknown>;
  const parsedRepresentativeTimestamp = parseTimestampSeconds(
    record.representativeTimestamp ??
      record.representative_timestamp ??
      record.representativeTime ??
      record.representative_time ??
      record.timestamp ??
      record.time
  );
  if (parsedRepresentativeTimestamp === null) return null;
  const representativeTimestamp = parsedRepresentativeTimestamp;

  const startTimestamp =
    parseTimestampSeconds(record.startTimestamp ?? record.start_timestamp ?? record.start) ??
    representativeTimestamp;
  const endTimestamp =
    parseTimestampSeconds(record.endTimestamp ?? record.end_timestamp ?? record.end) ??
    representativeTimestamp;
  const slideIndex = Number(record.slideIndex ?? record.slide_index ?? record.index);

  return {
    slideIndex: Number.isFinite(slideIndex) ? slideIndex : fallbackIndex,
    keep: record.keep !== false,
    representativeTimestamp: Math.max(0, representativeTimestamp),
    startTimestamp: Math.max(0, startTimestamp),
    endTimestamp: Math.max(0, endTimestamp),
    title: cleanText(record.title),
    visibleText: cleanText(record.visibleText) || cleanText(record.visible_text),
    summary: cleanText(record.summary),
    contentType: cleanText(record.contentType) || cleanText(record.content_type),
    reason: cleanText(record.reason),
  };
}

function mergeSlidesWithTranscript(
  groups: FrameGroup[],
  decisions: Map<number, GeminiGroupDecision>
): MergedSlide[] {
  const kept = groups
    .map((group) => ({ group, decision: decisions.get(group.groupIndex) }))
    .filter(
      (item): item is { group: FrameGroup; decision: GeminiGroupDecision } =>
        item.decision?.keep === true
    )
    .sort((left, right) => left.group.startTimestamp - right.group.startTimestamp);
  const slides: MergedSlide[] = [];
  let previousVisualKey = '';

  for (let index = 0; index < kept.length; index += 1) {
    const { group, decision } = kept[index];
    const visualKey = normalizeVisualKey(decision);
    if (visualKey && visualKey === previousVisualKey) {
      continue;
    }
    const frame = findChosenFrame(group, decision.chosenFrameIndex);

    slides.push({
      frame,
      decision,
      title: getSlideTitle(decision, frame),
    });
    previousVisualKey = visualKey || previousVisualKey;
  }

  return slides;
}

function findChosenFrame(group: FrameGroup, chosenFrameIndex: number): PrefilteredFrame {
  return (
    group.frames.find((frame) => frame.frameIndex === chosenFrameIndex) ||
    selectLocalRepresentativeFrame(group)
  );
}

async function extractSlidesFromVideoDecisions(
  videoPath: string,
  frameDir: string,
  decisions: GeminiVideoSlideDecision[]
): Promise<MergedSlide[]> {
  const slides: MergedSlide[] = [];
  let previousVisualKey = '';

  for (const decision of decisions) {
    const visualKey = normalizeVisualKey(decision);
    if (visualKey && visualKey === previousVisualKey) {
      continue;
    }

    const fileName = `gemini-video-slide-${String(slides.length + 1).padStart(4, '0')}.jpg`;
    const outputPath = join(frameDir, fileName);
    await extractFrameAtTimestamp(
      videoPath,
      decision.representativeTimestamp,
      outputPath
    );
    const frame: CandidateFrame = {
      frameIndex: slides.length + 1,
      fileName,
      path: outputPath,
      timestamp: decision.representativeTimestamp,
    };

    slides.push({
      frame,
      decision,
      title: getSlideTitle(decision, frame),
    });
    previousVisualKey = visualKey || previousVisualKey;
  }

  return slides;
}

async function extractFrameAtTimestamp(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    formatFfmpegTimestamp(timestamp),
    '-i',
    videoPath,
    '-vf',
    'scale=in_range=auto:out_range=pc,format=yuvj420p',
    '-frames:v',
    '1',
    '-q:v',
    '4',
    outputPath,
  ]);
}

async function renderHandout(input: {
  title: string;
  videoUrl: string;
  transcript: TranscriptData;
  slides: MergedSlide[];
}): Promise<string> {
  const transcriptHtml = await renderContinuousTranscript(
    input.transcript,
    input.slides,
    input.videoUrl
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)} slides</title>`,
    '<style>',
    'body{margin:0;background:#f7f7f4;color:#181818;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;}',
    'header{padding:32px 6vw 24px;background:#111;color:#fff;}',
    'header h1{margin:0 0 8px;font-size:28px;line-height:1.15;}',
    'header p{margin:4px 0;color:#cfcfcf;}',
    'main{max-width:1040px;margin:0 auto;padding:28px 20px 56px;}',
    '.transcript-flow{font-size:18px;line-height:1.75;}',
    '.transcript-flow p{margin:0 0 14px;}',
    '.sentence{overflow-wrap:anywhere;}',
    '.slide-figure{margin:24px 0 28px;}',
    '.slide-heading{display:flex;gap:14px;align-items:baseline;margin:0 0 12px;}',
    '.slide-heading a{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0b6bcb;font-size:18px;text-decoration:none;flex-shrink:0;}',
    '.slide-heading a:hover{text-decoration:underline;}',
    '.slide-heading h2{margin:0;color:#181818;font-size:28px;line-height:1.2;}',
    '.slide-figure img{display:block;width:100%;height:auto;border-radius:6px;background:#eee;}',
    '.visible-text{margin:10px 0 0;color:#333;font-size:14px;}',
    '.visible-text summary{cursor:pointer;color:#0b6bcb;}',
    '.visible-text pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f1;border:1px solid #e4e4dc;border-radius:6px;padding:12px;}',
    'a{color:#0b6bcb;}',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    `<h1>${escapeHtml(input.title)}</h1>`,
    `<p><a href="${escapeHtml(input.videoUrl)}">${escapeHtml(input.videoUrl)}</a></p>`,
    '</header>',
    '<main>',
    '<article class="transcript-flow">',
    transcriptHtml,
    '</article>',
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}

async function renderContinuousTranscript(
  transcript: TranscriptData,
  slides: MergedSlide[],
  videoUrl: string
): Promise<string> {
  const sentences = buildTimedSentences(transcript);
  const slideHtmlBySentence = await buildSlideHtmlBySentence(sentences, slides, videoUrl);

  if (sentences.length === 0) {
    return [
      `<p>${escapeHtml(transcript.text)}</p>`,
      ...(slideHtmlBySentence.get(-1) || []),
    ].join('\n');
  }

  const blocks: string[] = [];
  const paragraphSentences: string[] = [];

  const flushParagraph = () => {
    if (paragraphSentences.length === 0) return;
    blocks.push(`<p>${paragraphSentences.join(' ')}</p>`);
    paragraphSentences.length = 0;
  };

  sentences.forEach((sentence, index) => {
    paragraphSentences.push(renderSentenceSpan(sentence));

    const slideHtml = slideHtmlBySentence.get(index) || [];
    if (slideHtml.length > 0) {
      flushParagraph();
      blocks.push(...slideHtml);
    }
  });

  flushParagraph();
  return blocks.join('\n');
}

function renderSentenceSpan(sentence: TimedSentence): string {
  return `<span class="sentence" data-start="${sentence.start.toFixed(2)}" data-end="${sentence.end.toFixed(2)}">${escapeHtml(sentence.text)}</span>`;
}

function buildTimedSentences(transcript: TranscriptData): TimedSentence[] {
  if (transcript.words.length === 0) {
    return transcript.text
      .split(/(?<=[.!?])\s+/)
      .map((text) => cleanText(text))
      .filter(Boolean)
      .map((text) => ({ text, start: 0, end: 0 }));
  }

  const sentences: TimedSentence[] = [];
  let sentenceWords: TranscriptWord[] = [];
  let sentenceStart = transcript.words[0].start;

  for (const word of transcript.words) {
    if (sentenceWords.length === 0) {
      sentenceStart = word.start;
    }

    sentenceWords.push(word);

    const text = joinWords(sentenceWords);
    const endsSentence = /[.!?]["')\]]?$/.test(word.text.trim());
    const isLongFallback = text.length > 320 || word.end - sentenceStart > 24;

    if (endsSentence || isLongFallback) {
      sentences.push({
        text,
        start: sentenceStart,
        end: word.end,
      });
      sentenceWords = [];
    }
  }

  if (sentenceWords.length > 0) {
    const lastWord = sentenceWords[sentenceWords.length - 1];
    sentences.push({
      text: joinWords(sentenceWords),
      start: sentenceStart,
      end: lastWord.end,
    });
  }

  return sentences;
}

async function buildSlideHtmlBySentence(
  sentences: TimedSentence[],
  slides: MergedSlide[],
  videoUrl: string
): Promise<Map<number, string[]>> {
  const slideHtmlBySentence = new Map<number, string[]>();

  for (const slide of slides) {
    const sentenceIndex = findSentenceIndexForSlide(sentences, slide.frame.timestamp);
    const image = await readFile(slide.frame.path);
    const existing = slideHtmlBySentence.get(sentenceIndex) || [];
    existing.push(renderSlideFigure(slide, image, videoUrl));
    slideHtmlBySentence.set(sentenceIndex, existing);
  }

  return slideHtmlBySentence;
}

function findSentenceIndexForSlide(sentences: TimedSentence[], timestamp: number): number {
  if (sentences.length === 0) return -1;

  const exactIndex = sentences.findIndex((sentence) => timestamp <= sentence.end);
  return exactIndex >= 0 ? exactIndex : sentences.length - 1;
}

function renderSlideFigure(slide: MergedSlide, image: Buffer, videoUrl: string): string {
  const visibleText = cleanText(slide.decision.visibleText);
  const timestamp = formatTimestamp(slide.frame.timestamp);
  const timestampUrl = buildTimestampUrl(videoUrl, slide.frame.timestamp);

  return [
    '<figure class="slide-figure">',
    '<div class="slide-heading">',
    `<a href="${escapeHtml(timestampUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(timestamp)}</a>`,
    `<h2>${escapeHtml(slide.title)}</h2>`,
    '</div>',
    `<img src="data:image/jpeg;base64,${image.toString('base64')}" alt="${escapeHtml(slide.title)}">`,
    visibleText
      ? [
          '<details class="visible-text">',
          '<summary>Visible text</summary>',
          `<pre>${escapeHtml(visibleText)}</pre>`,
          '</details>',
        ].join('\n')
      : '',
    '</figure>',
  ].join('\n');
}

function buildTimestampUrl(videoUrl: string, seconds: number): string {
  try {
    const url = new URL(videoUrl);
    url.searchParams.set('t', `${Math.max(0, Math.floor(seconds))}s`);
    return url.toString();
  } catch {
    const separator = videoUrl.includes('?') ? '&' : '?';
    return `${videoUrl}${separator}t=${Math.max(0, Math.floor(seconds))}s`;
  }
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let isSettled = false;

    const timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${COMMAND_TIMEOUT_MS}ms.`));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);

      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderrText}`));
        return;
      }

      resolve({
        stdout: Buffer.concat(stdout),
        stderr: stderrText,
      });
    });
  });
}

function hammingDistance(left: bigint, right: bigint): number {
  let value = left ^ right;
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

function normalizeVisualKey(decision: SlideDecision): string {
  return [decision.title, decision.visibleText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 220);
}

function getSlideTitle(decision: SlideDecision, frame: CandidateFrame): string {
  const title = cleanText(decision.title);
  if (title) return title.slice(0, 140);

  const firstVisibleLine = cleanText(decision.visibleText?.split('\n')[0]);
  if (firstVisibleLine) return firstVisibleLine.slice(0, 140);

  return `Slide at ${formatTimestamp(frame.timestamp)}`;
}

function joinWords(words: TranscriptWord[]): string {
  return words.reduce((output, word) => {
    const token = word.text.trim();
    if (!token) return output;
    if (!output) return token;
    if (/^[.,!?;:%)]/.test(token)) return `${output}${token}`;
    return `${output} ${token}`;
  }, '');
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const paddedSeconds = remainingSeconds.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

function formatFfmpegTimestamp(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

function parseTimestampSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(/s$/i, '');
  if (!cleaned) return null;

  if (cleaned.includes(':')) {
    const parts = cleaned.split(':').map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function sanitizeFileName(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || 'lenses';
}

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

function formatFpsFilter(intervalSeconds: number): string {
  const fps = 1 / intervalSeconds;
  const formattedFps = Number.isInteger(fps)
    ? fps.toString()
    : fps.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `fps=${formattedFps}`;
}

function readPositiveNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readPositiveInteger(name: string, fallback: number): number {
  return Math.floor(readPositiveNumber(name, fallback));
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: CORS_HEADERS,
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
