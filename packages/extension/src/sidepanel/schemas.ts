import { z } from "zod";
import { Anchor as AnchorSchema } from "@lenses/shared";
import type { ClaimCategory } from "../types/claims";
import type { TextSegment } from "../types/ai-content";
import type { TranscriptSegment, VideoMetadata, VideoTime } from "../types/transcript";
import type {
  LensFinding,
  LensRunsResponse,
  PageTextResponse,
  PanelMessage,
  SourceKind,
  SourceScope,
  TranscriptResponse,
} from "./types";

export const SourceKindSchema = z.enum(["web_page", "youtube_video", "pdf"]);
export const SourceScopeSchema = z.enum(["page", "selection", "transcript"]);

const TranscriptSegmentSchema: z.ZodType<TranscriptSegment> = z.object({
  text: z.string(),
  start: z.number(),
  duration: z.number(),
  formatted: z.string(),
});

const VideoMetadataSchema = z.object({
  title: z.string().optional().default(""),
  channel: z.string().optional().default(""),
});

const VideoTimeSchema: z.ZodType<VideoTime> = z.object({
  seconds: z.number(),
  formatted: z.string(),
  duration: z.number(),
  durationFormatted: z.string(),
});

const PageTextResponseSchema: z.ZodType<PageTextResponse> = z
  .object({
    text: z.string().nullable().optional(),
    sourceKind: SourceKindSchema.optional(),
    sourceTitle: z.string().optional(),
    sourceKey: z.string().optional(),
    scope: SourceScopeSchema.optional(),
    contentType: z.string().optional(),
  })
  .passthrough();

const TranscriptResponseSchema = z
  .object({
    isVideoPage: z.boolean(),
    transcript: z.array(TranscriptSegmentSchema).nullable(),
    videoId: z.string().nullable(),
    metadata: VideoMetadataSchema.nullable(),
  })
  .passthrough();

// No explicit z.ZodType<PanelMessage> annotation: the searches entry fields use
// .default() (to backfill `kind`/`url` onto searches persisted before web_fetch
// existed), which makes the schema's input type differ from its output type —
// incompatible with z.ZodType's input=output assumption. The inferred output
// still matches PanelMessage, and parsePanelMessages pins the return type.
const PanelMessageSchema = z
  .object({
    id: z.number(),
    role: z.enum(["user", "assistant", "system", "error"]),
    content: z.string(),
    timestamp: z.number(),
    action: z.literal("api-keys").optional(),
    screenshots: z.array(z.string()).optional(),
    videoTimestamp: VideoTimeSchema.nullable().optional(),
    thinkingText: z.string().optional(),
    meta: z.record(z.string()).optional(),
    activity: z
      .array(
        z.union([
          z.object({
            kind: z.literal("thinking"),
            text: z.string(),
            live: z.boolean().optional(),
          }),
          z.object({
            kind: z.literal("research"),
            live: z.boolean().optional(),
            searches: z.array(
              z.object({
                kind: z.enum(["search", "fetch"]).default("search"),
                query: z.string().default(""),
                url: z.string().default(""),
                results: z.array(z.object({ url: z.string(), title: z.string() })),
                done: z.boolean(),
              })
            ),
          }),
        ])
      )
      .optional()
      .catch(undefined),
    textSegments: z.custom<TextSegment[]>().optional(),
    // .catch keeps a malformed searches trace from dropping the whole message.
    searches: z
      .array(
        z.object({
          kind: z.enum(["search", "fetch"]).default("search"),
          query: z.string().default(""),
          url: z.string().default(""),
          results: z.array(z.object({ url: z.string(), title: z.string() })),
          done: z.boolean(),
        })
      )
      .optional()
      .catch(undefined),
  })
  .passthrough();

const LensFindingSchema: z.ZodType<LensFinding> = z.object({
  text: z.string(),
  category: z.string(),
  detail: z.string(),
  confidence: z.number(),
  sourceSpan: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
  anchor: AnchorSchema.optional(),
  quotes: z.array(z.string()).optional(),
  enrichments: z
    .array(
      z.object({
        lensId: z.string(),
        summary: z.string(),
        data: z.record(z.string()).optional(),
        sources: z.array(z.object({ url: z.string(), title: z.string() })).optional(),
      })
    )
    .optional(),
});

const LensRunStateSchema = z.object({
  runId: z.string(),
  lensId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  error: z.string().optional(),
  modelUsed: z.string().optional(),
  rawResponse: z.string().optional(),
  createdAt: z.number(),
  findingCount: z.number().optional(),
  findings: z.array(LensFindingSchema).default([]),
  chunkCoverage: z.object({ done: z.number(), total: z.number() }).optional(),
  initiatedFromEvidenceBaseId: z.string().optional(),
  initiatedFromEvidenceBaseTitle: z.string().optional(),
});

const LensRunsResponseSchema = z
  .object({
    runs: z.array(LensRunStateSchema).optional(),
    byLens: z.record(z.array(LensFindingSchema)).optional(),
    error: z.string().optional(),
  })
  .passthrough();

const CLAIM_CATEGORY_VALUES = new Set<ClaimCategory>([
  "statistic",
  "historical",
  "scientific",
  "quote",
  "prediction",
  "other",
]);

export function parsePageTextResponse(value: unknown): PageTextResponse {
  const result = PageTextResponseSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function parseTranscriptResponse(value: unknown): TranscriptResponse {
  const result = TranscriptResponseSchema.safeParse(value);
  return result.success
    ? result.data
    : { isVideoPage: false, transcript: null, videoId: null, metadata: null };
}

export function parsePanelMessages(value: unknown): PanelMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const result = PanelMessageSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

export function parseLensRunsResponse(value: unknown): LensRunsResponse {
  const result = LensRunsResponseSchema.safeParse(value);
  if (!result.success) return {};
  return {
    ...result.data,
    runs: result.data.runs?.map((run) => ({
      ...run,
      findings: run.findings ?? [],
    })),
  };
}

export function toClaimCategory(category: string): ClaimCategory {
  return CLAIM_CATEGORY_VALUES.has(category as ClaimCategory)
    ? (category as ClaimCategory)
    : "other";
}

export function isSourceKind(value: unknown): value is SourceKind {
  return SourceKindSchema.safeParse(value).success;
}

export function isSourceScope(value: unknown): value is SourceScope {
  return SourceScopeSchema.safeParse(value).success;
}
