import { z } from "zod";
import {
  CHAT_ACTIONS_USE_SIDE_PANEL_KEY,
  DEFAULT_TEST_SOURCE_MAX_CITATIONS,
  DEFAULT_TEST_SOURCE_USE_CACHE,
} from "./constants";
import type {
  DebugDataResponse,
  DebugFinding,
  DebugRun,
  DebugViewPayload,
  DefuddleData,
  DefuddleResult,
  PageTextResult,
  PopupStorageState,
  ReadabilityData,
  ReadabilityResult,
} from "./types";

const SourceKindSchema = z.enum(["web_page", "youtube_video"]);
const SourceScopeSchema = z.enum(["page", "selection", "transcript"]);

const PopupStorageSchema = z
  .object({
    selectedLenses: z.array(z.string()).optional(),
    autoRun: z.boolean().optional(),
    autoAnalyze: z.boolean().optional(),
    debugMode: z.boolean().optional(),
    showDebugOptions: z.boolean().optional(),
    storePageLenses: z.boolean().optional(),
    "pageDock:enabled": z.boolean().optional(),
    [CHAT_ACTIONS_USE_SIDE_PANEL_KEY]: z.boolean().optional(),
    testSourceMaxCitations: z.number().optional(),
    testSourceUseCache: z.boolean().optional(),
  })
  .passthrough();

const SourceSpanSchema = z.object({
  start: z.number(),
  end: z.number(),
});

const DebugFindingSchema = z
  .object({
    text: z.string(),
    category: z.string(),
    detail: z.string(),
    confidence: z.number(),
    sourceSpan: SourceSpanSchema.optional(),
    runId: z.string().optional(),
    findingIndex: z.number().optional(),
    rawResponse: z.string().optional(),
    rawFinding: z.unknown().optional(),
  })
  .passthrough();

const DebugRunSchema = z
  .object({
    runId: z.string(),
    lensId: z.string(),
    sourceText: z.string().optional(),
    modelUsed: z.string().optional(),
    rawResponse: z.string().optional(),
    createdAt: z.number(),
    findings: z.array(DebugFindingSchema).default([]),
  })
  .passthrough();

const DebugDataResponseSchema = z
  .object({
    runs: z.array(DebugRunSchema).optional(),
    error: z.string().optional(),
  })
  .passthrough();

const DefuddleDataSchema = z
  .object({
    title: z.string().optional(),
    author: z.string().optional(),
    site: z.string().optional(),
    description: z.string().optional(),
    published: z.string().optional(),
    wordCount: z.number().optional(),
    parseTime: z.number().optional(),
    content: z.string().optional(),
    contentMarkdown: z.string().optional(),
  })
  .passthrough();

const ReadabilityDataSchema = z
  .object({
    title: z.string().optional(),
    byline: z.string().optional(),
    siteName: z.string().optional(),
    excerpt: z.string().optional(),
    length: z.number().optional(),
    textContent: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

const PageTextResponseSchema = z
  .object({
    text: z.string().nullable().optional(),
    sourceKind: SourceKindSchema.optional(),
    sourceTitle: z.string().optional(),
    sourceKey: z.string().optional(),
    scope: SourceScopeSchema.optional(),
  })
  .passthrough();

const DefuddleResponseSchema = z
  .object({
    result: DefuddleDataSchema.nullable().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const ReadabilityResponseSchema = z
  .object({
    result: ReadabilityDataSchema.nullable().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const DebugViewPayloadSchema = z.object({
  sourceUrl: z.string(),
  pageText: z.string(),
  runs: z.array(DebugRunSchema),
  defuddle: DefuddleDataSchema.nullable(),
  readability: ReadabilityDataSchema.nullable(),
  generatedAt: z.string(),
  theme: z.enum(["light", "dark"]),
});

export function parsePopupStorage(value: unknown): PopupStorageState {
  const result = PopupStorageSchema.safeParse(value);
  const stored = result.success ? result.data : {};
  const rawMaxCitations = Number(stored.testSourceMaxCitations);
  const maxCitations = Number.isFinite(rawMaxCitations)
    ? Math.max(1, Math.min(10, Math.trunc(rawMaxCitations)))
    : DEFAULT_TEST_SOURCE_MAX_CITATIONS;

  return {
    selectedLensIds: Array.isArray(stored.selectedLenses)
      ? stored.selectedLenses.filter((entry): entry is string => typeof entry === "string")
      : [],
    autoRun:
      typeof stored.autoRun === "boolean" ? stored.autoRun : stored.autoAnalyze === true,
    debugMode: __INTERNAL_TOOLS__ && stored.debugMode === true,
    showDebugOptions: __INTERNAL_TOOLS__ && stored.showDebugOptions === true,
    storePageLenses:
      typeof stored.storePageLenses === "boolean" ? stored.storePageLenses : true,
    pageDockEnabled:
      typeof stored["pageDock:enabled"] === "boolean" ? stored["pageDock:enabled"] : true,
    chatActionsUseSidePanel: stored[CHAT_ACTIONS_USE_SIDE_PANEL_KEY] === true,
    testSourceMaxCitations: maxCitations,
    testSourceUseCache:
      typeof stored.testSourceUseCache === "boolean"
        ? stored.testSourceUseCache
        : DEFAULT_TEST_SOURCE_USE_CACHE,
  };
}

export function parsePageTextResult(value: unknown, missingReceiver = false): PageTextResult {
  const result = PageTextResponseSchema.safeParse(value);
  if (!result.success) return { text: null, missingReceiver };
  return {
    text: result.data.text ?? null,
    missingReceiver,
    sourceKind: result.data.sourceKind,
    sourceTitle: result.data.sourceTitle,
    sourceKey: result.data.sourceKey,
    scope: result.data.scope,
  };
}

export function parseDefuddleResult(
  value: unknown,
  missingReceiver = false,
  fallbackError?: string
): DefuddleResult {
  const result = DefuddleResponseSchema.safeParse(value);
  if (!result.success) {
    return { result: null, missingReceiver, error: fallbackError };
  }
  return {
    result: result.data.result ?? null,
    missingReceiver,
    error: result.data.error ?? fallbackError,
  };
}

export function parseReadabilityResult(
  value: unknown,
  missingReceiver = false,
  fallbackError?: string
): ReadabilityResult {
  const result = ReadabilityResponseSchema.safeParse(value);
  if (!result.success) {
    return { result: null, missingReceiver, error: fallbackError };
  }
  return {
    result: result.data.result ?? null,
    missingReceiver,
    error: result.data.error ?? fallbackError,
  };
}

export function parseDebugDataResponse(value: unknown): DebugDataResponse {
  const result = DebugDataResponseSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function parseDebugViewPayload(value: unknown): DebugViewPayload | null {
  const result = DebugViewPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}
