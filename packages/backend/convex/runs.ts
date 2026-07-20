"use node";

import { internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Effect } from "effect";
import type { LensConfig } from "@lenses/shared";
import { getBuiltInLens } from "../src/lenses/registry.js";
import {
  buildCustomLensConfig,
  buildLensNamePrompt,
  fallbackLensName,
  normalizeGeneratedLensName,
} from "../src/lenses/customLens.js";
import {
  runFindingPipeline,
  callModel,
  formatPipelineError,
} from "../src/findings/pipeline.js";
import {
  resolveManagedProviderApiKey,
  resolveLensProviderModel,
  resolveProviderModel,
  resolveModelProvider,
  type ModelProvider,
} from "../src/findings/model.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface LensChatSettings {
  webSearch: boolean;
  requireCitations: boolean;
}

const DEFAULT_LENS_CHAT_SETTINGS: LensChatSettings = {
  webSearch: false,
  requireCitations: false,
};

const LENS_CHAT_SETTINGS: Record<string, LensChatSettings> = {
  // Source Tracer answers may verify attribution with managed web search.
  "source-tracer": { webSearch: true, requireCitations: true },
};

interface WebCitation {
  url: string;
  title: string;
  citedText?: string;
}

interface RunLensResponse {
  findings: Array<{
    text: string;
    category: string;
    detail: string;
    confidence: number;
    sourceSpan?: { start: number; end: number };
  }>;
  modelUsed: string;
  citationsIncomplete?: boolean;
  missingCitationIndices?: number[];
  /** True when the run was stopped because requestCancel landed first. */
  cancelled?: boolean;
}

/**
 * Cancel polling cadence. Trades roundtrip latency-on-cancel against the
 * cost of background queries — 750ms means a cancel takes at most ~750ms
 * to land but each ~6s run only fires ~8 cheap state queries.
 */
const CANCEL_POLL_INTERVAL_MS = 750;

export const run = internalAction({
  args: {
    text: v.string(),
    lensId: v.string(),
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("openai"))),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("xhigh"),
        v.literal("max")
      )
    ),
    testing: v.optional(v.boolean()),
    // One-off Lens instructions are validated and built for this request only.
    customLens: v.optional(
      v.object({
        instruction: v.string(),
        name: v.optional(v.string()),
      })
    ),
    // Opaque request id used by the managed cancel route while the
    // provider call is in flight.
    runRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RunLensResponse> => {
    const requestProvider = resolveModelProvider(args.provider);
    let lensConfig: LensConfig | undefined;
    if (args.customLens) {
      try {
        lensConfig = buildCustomLensConfig({
          instruction: args.customLens.instruction,
          name: args.customLens.name,
          lensId: args.lensId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    } else {
      lensConfig = getBuiltInLens(args.lensId);
    }

    if (!lensConfig) {
      throw new Error(`Lens "${args.lensId}" not found`);
    }

    const { provider, model } = resolveLensProviderModel({
      provider: requestProvider,
      testing: args.testing ?? false,
      settingsModel: args.model,
      lensDefaultModel: lensConfig.defaultModel,
    });
    const apiKey = resolveManagedProviderApiKey({ provider });
    if (!apiKey) {
      throw new Error(`No ${provider === "openai" ? "OpenAI" : "Anthropic"} API key configured`);
    }

    const runId = args.runRequestId
      ? await ctx.runMutation(internal.runHelpers.createManagedTrackingRun, {
          lensId: args.lensId,
          runRequestId: args.runRequestId,
        })
      : undefined;
    let cancelPoll: CancelPollHandle | undefined;
    try {
      if (runId) {
        await ctx.runMutation(internal.runHelpers.markRunning, { runId });
      }

      // AbortController wired to the pipeline's upstream LLM calls. The
      // content-free polling row carries only cancellation state and is always
      // removed by the outer finally block.
      const controller = new AbortController();
      cancelPoll = runId
        ? startCancelPoller(ctx, runId, controller)
        : { stop: () => {}, get cancelled() { return false; } };

      const program = runFindingPipeline(lensConfig, args.text, apiKey, {
        testing: args.testing ?? false,
        provider,
        model,
        reasoningEffort: args.reasoningEffort,
        signal: controller.signal,
        maxOutputTokens: 8_192,
      });
      let result;
      try {
        result = await Effect.runPromise(program);
      } catch (error) {
        cancelPoll.stop();
        if (cancelPoll.cancelled || isAbortLikeError(error)) {
          if (runId) {
            await ctx.runMutation(internal.runHelpers.markCancelled, { runId });
          }
          return {
            findings: [],
            modelUsed: model,
            cancelled: true,
          };
        }
        throw new Error(formatPipelineError(error));
      }
      cancelPoll.stop();

      // Honour a cancel signal that landed just after the provider resolved.
      if (cancelPoll.cancelled) {
        if (runId) {
          await ctx.runMutation(internal.runHelpers.markCancelled, { runId });
        }
        return {
          findings: [],
          modelUsed: model,
          cancelled: true,
        };
      }

      return {
        findings: result.findings,
        modelUsed: result.modelUsed,
        citationsIncomplete: result.citationsIncomplete,
        missingCitationIndices: result.missingCitationIndices,
      };
    } finally {
      cancelPoll?.stop();
      if (runId) await removeManagedTrackingRun(ctx, runId);
    }
  },
});

async function removeManagedTrackingRun(ctx: ActionCtx, runId: Id<"runs">) {
  await ctx.runMutation(internal.runHelpers.removeManagedTrackingRun, { runId });
}

// Produce a short 2-3 word name for a free-text lens instruction. This runs the
// same model path a lens run uses (resolveProviderModel + callModel), so naming
// inherits the user's provider/model choice and uses only the managed server key. The
// call is best-effort: any failure falls back to a name derived from the
// instruction so creating a lens never blocks on the naming model.
export const generateLensName = internalAction({
  args: {
    instruction: v.string(),
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("openai"))),
    model: v.optional(v.string()),
    testing: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<{ name: string }> => {
    const instruction = args.instruction.trim();
    if (!instruction) return { name: "Custom Lens" };

    const { provider, model } = resolveProviderModel({
      provider: args.provider,
      testing: args.testing ?? false,
      model: args.model,
    });
    const apiKey = resolveManagedProviderApiKey({ provider });
    if (!apiKey) return { name: fallbackLensName(instruction) };

    const raw = await Effect.runPromise(
      callModel(buildLensNamePrompt(instruction), apiKey, provider, model, {
        maxOutputTokens: 64,
      })
    ).catch(() => "");

    const name = normalizeGeneratedLensName(raw);
    return { name: name === "Custom Lens" ? fallbackLensName(instruction) : name };
  },
});

const ChatMessageRole = v.union(v.literal("user"), v.literal("assistant"));

export const askFindingQuestion = internalAction({
  args: {
    question: v.string(),
    sourceUrl: v.optional(v.string()),
    targetLensId: v.optional(v.string()),
    testing: v.optional(v.boolean()),
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("openai"))),
    model: v.optional(v.string()),
    conversation: v.optional(
      v.array(
        v.object({
          role: ChatMessageRole,
          content: v.string(),
        })
      )
    ),
    annotations: v.array(
      v.object({
        lensId: v.string(),
        label: v.string(),
        category: v.string(),
        text: v.string(),
        detail: v.string(),
        confidence: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const provider = resolveModelProvider(args.provider);
    const apiKey = resolveManagedProviderApiKey({ provider });
    if (!apiKey) {
      throw new Error(`${provider === "openai" ? "OPENAI" : "ANTHROPIC"}_API_KEY environment variable is not set`);
    }

    const question = args.question.trim();
    if (!question) {
      throw new Error("Question cannot be empty");
    }

    if (args.annotations.length === 0) {
      throw new Error("Missing annotation context");
    }

    const lensNames = getLensNamesForAnnotations(args.annotations);
    const annotationContext = formatAnnotationContext(args.annotations, lensNames);
    const sourceContext = args.sourceUrl
      ? `Source URL: ${args.sourceUrl}`
      : "Source URL: unknown";
    const targetLensId = resolveTargetLensId(args.targetLensId, args.annotations);
    const chatSettings = resolveLensChatSettings(targetLensId);

    const conversation = (args.conversation ?? [])
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }))
      .filter((message) => message.content.length > 0)
      .slice(-12);

    const systemPrompt = buildAskFindingSystemPrompt(chatSettings);

    const contextMessage =
      `${sourceContext}\n\nAnnotation context:\n${annotationContext}\n\n` +
      (chatSettings.webSearch
        ? "Use web search when needed to verify claims. Be explicit about uncertainty."
        : "Use concise, practical language. Include alternative interpretations when relevant.");

    const { model } = resolveProviderModel({
      provider,
      testing: args.testing ?? false,
      model: args.model,
      purpose: "chat",
    });
    const response = await createAskFindingResponse({
      apiKey,
      provider,
      model,
      systemPrompt,
      messages: [
        { role: "user" as const, content: contextMessage },
        ...conversation,
        { role: "user" as const, content: question },
      ],
      webSearch: chatSettings.webSearch,
    });
    const answerText = extractTextFromContentBlocks(response.content);
    if (!answerText) {
      throw new Error("Unexpected LLM response format");
    }
    const citations = extractWebCitations(response.content);
    const answer = appendCitationSection(answerText, citations, chatSettings.requireCitations);

    return {
      answer,
      modelUsed: response.model ?? model,
    };
  },
});

function getLensNamesForAnnotations(annotations: Array<{ lensId: string }>) {
  const lensNameMap = new Map<string, string>();
  const uniqueLensIds = [...new Set(annotations.map((annotation) => annotation.lensId))];

  for (const lensId of uniqueLensIds) {
    const builtInLens = getBuiltInLens(lensId);
    if (builtInLens) {
      lensNameMap.set(lensId, builtInLens.name);
      continue;
    }

    lensNameMap.set(lensId, lensId);
  }

  return lensNameMap;
}

function formatAnnotationContext(
  annotations: Array<{
    lensId: string;
    label: string;
    category: string;
    text: string;
    detail: string;
    confidence: number;
  }>,
  lensNames: Map<string, string>
) {
  return annotations
    .map((annotation, index) => {
      const confidence = Math.round(annotation.confidence * 100);
      const lensName = lensNames.get(annotation.lensId) ?? annotation.lensId;
      return (
        `${index + 1}. Lens: ${lensName}\n` +
        `   Label: ${annotation.label}\n` +
        `   Category: ${annotation.category}\n` +
        `   Confidence: ${confidence}%\n` +
        `   Text: "${annotation.text}"\n` +
        `   Detail: ${annotation.detail}`
      );
    })
    .join("\n\n");
}

function resolveTargetLensId(
  targetLensId: string | undefined,
  annotations: Array<{ lensId: string }>
) {
  if (targetLensId && annotations.some((annotation) => annotation.lensId === targetLensId)) {
    return targetLensId;
  }
  return annotations[0]?.lensId;
}

function resolveLensChatSettings(targetLensId: string | undefined): LensChatSettings {
  if (!targetLensId) return DEFAULT_LENS_CHAT_SETTINGS;
  return LENS_CHAT_SETTINGS[targetLensId] ?? DEFAULT_LENS_CHAT_SETTINGS;
}

function buildAskFindingSystemPrompt(settings: LensChatSettings): string {
  const basePrompt =
    "You help users investigate highlighted issues in text. " +
    "Ground answers in the provided annotation context and avoid inventing facts. " +
    "If context is insufficient, say what is missing and suggest verification steps.";

  if (!settings.webSearch) {
    return basePrompt;
  }

  return (
    `${basePrompt} ` +
    "You can use web search. For factual or sourcing questions, check reliable sources before answering. " +
    "Prefer primary sources and high-quality reporting. " +
    "If evidence is mixed or weak, clearly say that."
  );
}

async function createAskFindingResponse(args: {
  apiKey: string;
  provider: ModelProvider;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  webSearch: boolean;
}): Promise<{ content: unknown[]; model?: string }> {
  if (args.provider === "openai") {
    const body: Record<string, unknown> = {
      model: args.model,
      instructions: args.systemPrompt,
      input: args.messages,
      max_output_tokens: 1200,
    };

    if (args.webSearch) {
      body.tools = [{ type: "web_search" }];
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MANAGED_PROVIDER_REJECTED: OpenAI request failed (${response.status})`);
    }

    const parsed = (await response.json()) as Record<string, unknown>;
    return {
      content: extractOpenAIContentBlocks(parsed),
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: 1200,
    system: args.systemPrompt,
    messages: args.messages,
  };

  if (args.webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`MANAGED_PROVIDER_REJECTED: Anthropic request failed (${response.status})`);
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  return {
    content: Array.isArray(parsed.content) ? parsed.content : [],
    model: typeof parsed.model === "string" ? parsed.model : undefined,
  };
}

function extractOpenAIContentBlocks(response: Record<string, unknown>): unknown[] {
  const output = response.output;
  if (!Array.isArray(output)) return [];
  const blocks: unknown[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "message" || !Array.isArray(record.content)) continue;
    for (const content of record.content) {
      if (!content || typeof content !== "object") continue;
      const contentRecord = content as Record<string, unknown>;
      if (contentRecord.type !== "output_text") continue;
      blocks.push({
        type: "text",
        text: typeof contentRecord.text === "string" ? contentRecord.text : "",
        citations: Array.isArray(contentRecord.annotations)
          ? contentRecord.annotations.map(mapOpenAIAnnotationToCitation).filter(Boolean)
          : [],
      });
    }
  }

  return blocks;
}

function mapOpenAIAnnotationToCitation(annotation: unknown) {
  const citation = parseCitation(annotation);
  if (!citation) return null;
  return {
    type: "web_search_result_location",
    url: citation.url,
    title: citation.title,
    cited_text: citation.citedText,
  };
}

function extractTextFromContentBlocks(contentBlocks: unknown[]): string {
  const chunks: string[] = [];

  for (const block of contentBlocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type !== "text") continue;
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      chunks.push(record.text.trim());
    }
  }

  return chunks.join("\n\n").trim();
}

function extractWebCitations(contentBlocks: unknown[]): WebCitation[] {
  const deduped = new Map<string, WebCitation>();

  for (const block of contentBlocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const citations = record.citations;
    if (!Array.isArray(citations)) continue;

    for (const citation of citations) {
      const parsedCitation = parseCitation(citation);
      if (!parsedCitation) continue;

      const key = `${parsedCitation.url}|${parsedCitation.title}`;
      if (!deduped.has(key)) {
        deduped.set(key, parsedCitation);
      }
    }
  }

  return Array.from(deduped.values());
}

function parseCitation(citation: unknown): WebCitation | null {
  if (!citation || typeof citation !== "object") return null;
  const record = citation as Record<string, unknown>;
  const nested =
    record.type === "url_citation" && record.url_citation && typeof record.url_citation === "object"
      ? (record.url_citation as Record<string, unknown>)
      : record;

  const rawUrl = typeof nested.url === "string" ? nested.url.trim() : "";
  if (!rawUrl) return null;

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(rawUrl).toString();
  } catch {
    return null;
  }

  const title =
    typeof nested.title === "string" && nested.title.trim()
      ? nested.title.trim()
      : new URL(normalizedUrl).hostname;

  const citedText =
    typeof nested.cited_text === "string" && nested.cited_text.trim()
      ? nested.cited_text.trim()
      : undefined;

  return {
    url: normalizedUrl,
    title,
    citedText,
  };
}

function appendCitationSection(
  answer: string,
  citations: WebCitation[],
  requireCitations: boolean
): string {
  void citations;
  void requireCitations;
  return answer.trim();
}

interface CancelPollHandle {
  /** Stop the background polling loop. Idempotent. */
  stop: () => void;
  /** True once the poller observed a cancel request and tripped the controller. */
  cancelled: boolean;
}

/**
 * Poll the runs row for `cancelRequestedAt`. When the field appears, abort
 * the controller so the in-flight LLM call's fetch tears down. The polling
 * promise itself is fire-and-forget — its result is read via the returned
 * handle (`cancelled` flag and `stop()`). We deliberately don't await it.
 */
function startCancelPoller(
  ctx: ActionCtx,
  runId: Id<"runs">,
  controller: AbortController
): CancelPollHandle {
  let stopped = false;
  const handle: CancelPollHandle = {
    stop: () => {
      stopped = true;
    },
    cancelled: false,
  };

  void (async () => {
    while (!stopped) {
      await sleep(CANCEL_POLL_INTERVAL_MS);
      if (stopped) return;
      try {
        const state = await ctx.runQuery(
          internal.runHelpers.getCancelStateByRunId,
          { runId }
        );
        if (state?.cancelRequestedAt) {
          handle.cancelled = true;
          stopped = true;
          controller.abort();
          return;
        }
        // If something else (rare) flipped the row to a terminal state, stop
        // polling — there's nothing to cancel anymore.
        if (state?.status === "completed" || state?.status === "failed") return;
      } catch {
        // Transient query failure: try again next tick rather than tearing
        // down the run on what may be a flake.
      }
    }
  })();

  return handle;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detects the family of errors fetch/SDK calls throw when an AbortSignal
 * fires. Some get wrapped through Effect's tryPromise into our tagged
 * LLMAbortedError; others escape directly from the SDK as DOMException
 * or APIUserAbortError. We treat any of them the same.
 */
function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { _tag?: unknown; name?: unknown; message?: unknown };
  if (candidate._tag === "LLMAbortedError") return true;
  if (candidate.name === "AbortError") return true;
  if (typeof candidate.message === "string" && /aborted|cancel/i.test(candidate.message)) {
    return true;
  }
  return false;
}
