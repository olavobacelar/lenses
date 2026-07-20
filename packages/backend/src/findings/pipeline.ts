import { Effect, Data } from "effect";
import { z } from "zod";
import { Finding, maxOutputTokensForLensRun, type LensConfig } from "@lenses/shared";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../convex/_generated/server.js";
import { resolveProviderModel, type ModelProvider } from "./model.js";

const FIRST_PASS_FINDING_LIMIT = 3;

function logPipelineDiagnostic(event: string, details: Record<string, unknown> = {}) {
  if (env.LENSES_MANAGED_DIAGNOSTICS !== "true") return;
  console.warn("[Lenses][managed-pipeline]", event, details);
}

// --- Typed Errors ---

export class LensNotFoundError extends Data.TaggedError("LensNotFoundError")<{
  readonly lensId: string;
}> {}

export class PromptConstructionError extends Data.TaggedError(
  "PromptConstructionError"
)<{
  readonly reason: string;
}> {}

export class LLMCallError extends Data.TaggedError("LLMCallError")<{
  readonly reason: string;
  readonly statusCode?: number;
}> {}

/**
 * Raised when an LLM call was aborted via the caller-supplied AbortSignal.
 * Kept distinct from LLMCallError so the action layer can detect cancellation
 * and mark the run as cancelled (silent) rather than failed (toasted).
 */
export class LLMAbortedError extends Data.TaggedError("LLMAbortedError")<{
  readonly reason: string;
}> {}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; constructor?: { name?: unknown } };
  const name = record.name;
  // The Anthropic SDK catches the raw fetch AbortError and rethrows it as
  // its own APIUserAbortError, so we recognise both shapes. Anything else
  // (network failures, JSON parse errors) is not an abort.
  if (name === "AbortError" || name === "APIUserAbortError") return true;
  if (record.constructor?.name === "APIUserAbortError") return true;
  return false;
}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly reason: string;
}> {}

export function formatPipelineError(error: unknown): string {
  const pipelineError = readPipelineErrorWithReason(error);
  if (pipelineError) {
    return `${pipelineError._tag}: ${pipelineError.reason}`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  const fallback = String(error);
  return fallback === "[object Object]" ? "Unknown pipeline error" : fallback;
}

function readPipelineErrorWithReason(
  error: unknown
): { _tag: string; reason: string } | null {
  if (isPipelineErrorWithReason(error)) return error;
  if (!error || typeof error !== "object") return null;

  const record = error as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    const value = record[key];
    if (!value || typeof value !== "object") continue;
    const cause = value as { error?: unknown; failure?: unknown };
    if (isPipelineErrorWithReason(cause.error)) return cause.error;
    if (isPipelineErrorWithReason(cause.failure)) return cause.failure;
  }

  return null;
}

function isPipelineErrorWithReason(
  error: unknown
): error is { _tag: string; reason: string } {
  if (!error || typeof error !== "object") return false;
  const record = error as { _tag?: unknown; reason?: unknown };
  return (
    "_tag" in error &&
    "reason" in error &&
    typeof record._tag === "string" &&
    typeof record.reason === "string" &&
    record.reason.trim().length > 0
  );
}

// --- Pipeline Steps ---

export function buildPrompt(
  lens: LensConfig,
  text: string,
  options?: { testing?: boolean }
): Effect.Effect<string, PromptConstructionError> {
  return Effect.gen(function* () {
    if (!lens.promptTemplate.includes("{{text}}")) {
      return yield* new PromptConstructionError({
        reason: `Lens "${lens.id}" prompt template missing {{text}} placeholder`,
      });
    }

    const prompt = lens.promptTemplate.replace("{{text}}", text);
    if (!options?.testing) {
      return `${prompt}\n\n${lens.outputInstructions}`;
    }

    return (
      `${prompt}\n\n${lens.outputInstructions}\n\n` +
      `Only include the first ${FIRST_PASS_FINDING_LIMIT} findings in document order. ` +
      `If you find more than ${FIRST_PASS_FINDING_LIMIT}, discard the rest.`
    );
  });
}

export interface LLMCallOptions {
  /** Caller-supplied AbortSignal. Aborting yields LLMAbortedError, not LLMCallError. */
  signal?: AbortSignal;
  reasoningEffort?: ReasoningEffort;
  /** Optional caller ceiling used by the managed service spend backstop. */
  maxOutputTokens?: number;
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

function supportsClaudeEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized === "claude-fable-5" ||
    normalized === "claude-opus-4-8" ||
    normalized === "claude-sonnet-5"
  );
}

function supportsOpenAIReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("chatgpt-") ||
    /^o\d/.test(normalized)
  );
}

export function callClaude(
  prompt: string,
  apiKey: string,
  model: string,
  options?: LLMCallOptions
): Effect.Effect<string, LLMCallError | LLMAbortedError> {
  const maxTokens = Math.min(
    maxOutputTokensForLensRun("anthropic", model),
    options?.maxOutputTokens ?? Number.POSITIVE_INFINITY
  );
  return Effect.tryPromise({
    try: async () => {
      if (options?.signal?.aborted) {
        throw new LLMAbortedError({ reason: "Claude call aborted" });
      }
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream(
        ({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
          ...(supportsClaudeEffort(model) && options?.reasoningEffort
            ? { output_config: { effort: options.reasoningEffort } }
            : {}),
        } as any),
        // The stream helper forwards the signal and accumulates a final
        // message. Streaming is required for long/high-effort generations;
        // closing it also stops further output tokens server-side on cancel.
        { signal: options?.signal }
      );
      const message = await stream.finalMessage();

      const block = message.content.find((content) => content.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("Claude response did not contain text");
      }
      return block.text;
    },
    catch: (error) => {
      if (error instanceof LLMAbortedError) return error;
      if (isAbortError(error)) {
        return new LLMAbortedError({ reason: "Claude call aborted" });
      }
      const status =
        error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;
      return new LLMCallError({
        reason: status
          ? `MANAGED_PROVIDER_REJECTED: Anthropic request failed (${status})`
          : error instanceof Error
            ? error.message
            : String(error),
        statusCode: status,
      });
    },
  });
}

export function callOpenAI(
  prompt: string,
  apiKey: string,
  model: string,
  options?: LLMCallOptions
): Effect.Effect<string, LLMCallError | LLMAbortedError> {
  const maxOutputTokens = Math.min(
    maxOutputTokensForLensRun("openai", model),
    options?.maxOutputTokens ?? Number.POSITIVE_INFINITY
  );
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_output_tokens: maxOutputTokens,
          ...(supportsOpenAIReasoningEffort(model) &&
          options?.reasoningEffort
            ? { reasoning: { effort: options.reasoningEffort } }
            : {}),
          input: prompt,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`MANAGED_PROVIDER_REJECTED: OpenAI request failed (${response.status})`);
      }

      return extractOpenAIOutputText(await response.json());
    },
    catch: (error) => {
      if (isAbortError(error)) {
        return new LLMAbortedError({ reason: "OpenAI call aborted" });
      }
      return new LLMCallError({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  });
}

function extractOpenAIOutputText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type !== "message" || !Array.isArray(itemRecord.content)) continue;
    for (const content of itemRecord.content) {
      if (!content || typeof content !== "object") continue;
      const contentRecord = content as Record<string, unknown>;
      if (contentRecord.type === "output_text" && typeof contentRecord.text === "string") {
        chunks.push(contentRecord.text);
      }
    }
  }

  return chunks.join("\n\n").trim();
}

export function callModel(
  prompt: string,
  apiKey: string,
  provider: ModelProvider,
  model: string,
  options?: LLMCallOptions
): Effect.Effect<string, LLMCallError | LLMAbortedError> {
  return provider === "openai"
    ? callOpenAI(prompt, apiKey, model, options)
    : callClaude(prompt, apiKey, model, options);
}

export function parseResponse(
  raw: string
): Effect.Effect<z.infer<typeof Finding>[], ParseError> {
  return Effect.gen(function* () {
    // Extract JSON array from the response (Claude sometimes wraps it in markdown)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return yield* new ParseError({
        reason: "No JSON array found in response",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return yield* new ParseError({
        reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const result = z.array(Finding).safeParse(parsed);
    if (!result.success) {
      return yield* new ParseError({
        reason: `Schema validation failed: ${result.error.message}`,
      });
    }

    return result.data;
  });
}

// --- Pass 2: Citation Enrichment ---

export class CitationEnrichmentError extends Data.TaggedError(
  "CitationEnrichmentError"
)<{
  readonly reason: string;
}> {}

export interface CollectedCitation {
  citedText: string;
  start: number;
  end: number;
}

interface CitationContentBlock {
  type: string;
  text?: string;
  citations?: unknown[];
}

interface CitationEnrichmentResult {
  findings: z.infer<typeof Finding>[];
  citationsIncomplete: boolean;
  missingCitationIndices: number[];
}

type CitationRequester = (prompt: string) => Promise<CitationContentBlock[]>;

export function buildCitationPrompt(
  findings: z.infer<typeof Finding>[]
): string {
  const findingLines = findings
    .map(
      (finding, i) =>
        `${i + 1}. [${finding.category}] "${finding.text}" — ${finding.detail}`
    )
    .join("\n");

  return (
    `The following findings were identified in the document:\n\n${findingLines}\n\n` +
    `For EACH numbered finding above, quote the exact passage from the document that contains it. ` +
    `Use the finding number as a heading (e.g. "1.", "2.", etc).`
  );
}

export function buildCitationRepairPrompt(
  findings: z.infer<typeof Finding>[],
  missingCitationIndices: number[]
): string {
  const missingLines = missingCitationIndices
    .map((index) => {
      const finding = findings[index];
      if (!finding) return null;
      return `${index + 1}. [${finding.category}] "${finding.text}" — ${finding.detail}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  return (
    `Some findings are still missing citations:\n\n${missingLines}\n\n` +
    `For EACH numbered finding above, quote the exact passage from the document that contains it. ` +
    `Only include the numbered findings listed above. Use the finding number as a heading.`
  );
}

export function parseCitationResponse(
  contentBlocks: CitationContentBlock[],
  findingCount: number
): Map<number, CollectedCitation> {
  const citationsByFinding = new Map<number, CollectedCitation>();
  let currentFinding: number | null = null;

  for (const block of contentBlocks) {
    if (block.type !== "text" || !block.text) continue;

    // Detect finding number references (e.g. "1.", "Item 1:", "#1")
    const numberMatches = block.text.matchAll(/(?:^|\n)\s*(?:Item\s+)?#?(\d+)[.:)\s]/gi);
    for (const m of numberMatches) {
      const num = parseInt(m[1], 10) - 1;
      if (num >= 0 && num < findingCount) {
        currentFinding = num;
      }
    }

    // Collect citations from this block
    const citations = block.citations as
      | Array<{
          type: string;
          cited_text: string;
          start_char_index: number;
          end_char_index: number;
        }>
      | undefined;

    if (citations && currentFinding !== null) {
      for (const cit of citations) {
        if (cit.type === "char_location" && !citationsByFinding.has(currentFinding)) {
          citationsByFinding.set(currentFinding, {
            citedText: cit.cited_text,
            start: cit.start_char_index,
            end: cit.end_char_index,
          });
        }
      }
    }
  }

  return citationsByFinding;
}

export function findMissingCitationIndices(
  findingCount: number,
  citationsByFinding: Map<number, CollectedCitation>
): number[] {
  const missing: number[] = [];
  for (let i = 0; i < findingCount; i += 1) {
    if (!citationsByFinding.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}

export function mergeCitationMaps(
  base: Map<number, CollectedCitation>,
  overlay: Map<number, CollectedCitation>
): Map<number, CollectedCitation> {
  const merged = new Map(base);
  for (const [index, citation] of overlay) {
    if (!merged.has(index)) {
      merged.set(index, citation);
    }
  }
  return merged;
}

export function applyCitationMapToFindings(
  findings: z.infer<typeof Finding>[],
  citationsByFinding: Map<number, CollectedCitation>
): z.infer<typeof Finding>[] {
  return findings.map((finding, i) => {
    const citation = citationsByFinding.get(i);
    if (!citation) return finding;
    return {
      ...finding,
      text: citation.citedText,
      sourceSpan: { start: citation.start, end: citation.end },
    };
  });
}

export function enrichWithLocalSourceSpans(
  findings: z.infer<typeof Finding>[],
  sourceText: string
): CitationEnrichmentResult {
  const citationsByFinding = new Map<number, CollectedCitation>();

  findings.forEach((finding, index) => {
    const text = finding.text.trim();
    if (!text) return;
    const start = sourceText.indexOf(text);
    if (start < 0) return;
    citationsByFinding.set(index, {
      citedText: text,
      start,
      end: start + text.length,
    });
  });

  const missingCitationIndices = findMissingCitationIndices(findings.length, citationsByFinding);
  return {
    findings: applyCitationMapToFindings(findings, citationsByFinding),
    citationsIncomplete: missingCitationIndices.length > 0,
    missingCitationIndices,
  };
}

function createCitationRequester(
  client: Anthropic,
  model: string,
  sourceText: string,
  options?: LLMCallOptions
): CitationRequester {
  return async (prompt: string) => {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "text",
                  media_type: "text/plain",
                  data: sourceText,
                },
                title: "Source text",
                citations: { enabled: true },
              } as any,
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      },
      { signal: options?.signal }
    );
    return response.content as CitationContentBlock[];
  };
}

export function enrichWithCitations(
  findings: z.infer<typeof Finding>[],
  sourceText: string,
  apiKey: string,
  model: string,
  options?: { requestCitations?: CitationRequester; signal?: AbortSignal }
): Effect.Effect<CitationEnrichmentResult, CitationEnrichmentError | LLMAbortedError> {
  if (findings.length === 0) {
    return Effect.succeed({
      findings,
      citationsIncomplete: false,
      missingCitationIndices: [],
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const client = new Anthropic({ apiKey });
      const requestCitations =
        options?.requestCitations ??
        createCitationRequester(client, model, sourceText, { signal: options?.signal });

      const firstPassCitations = parseCitationResponse(
        await requestCitations(buildCitationPrompt(findings)),
        findings.length
      );
      const missingAfterFirstPass = findMissingCitationIndices(
        findings.length,
        firstPassCitations
      );

      let combinedCitations = firstPassCitations;
      if (missingAfterFirstPass.length > 0) {
        const repairCitations = parseCitationResponse(
          await requestCitations(
            buildCitationRepairPrompt(findings, missingAfterFirstPass)
          ),
          findings.length
        );
        combinedCitations = mergeCitationMaps(firstPassCitations, repairCitations);
      }

      const missingCitationIndices = findMissingCitationIndices(
        findings.length,
        combinedCitations
      );

      return {
        findings: applyCitationMapToFindings(findings, combinedCitations),
        citationsIncomplete: missingCitationIndices.length > 0,
        missingCitationIndices,
      };
    },
    catch: (error) => {
      if (isAbortError(error)) {
        return new LLMAbortedError({ reason: "Citation enrichment aborted" });
      }
      return new CitationEnrichmentError({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  });
}

// --- Full Pipeline ---

export type RunPipelineError =
  | PromptConstructionError
  | LLMCallError
  | LLMAbortedError
  | ParseError;

export interface RunPipelineResult {
  findings: z.infer<typeof Finding>[];
  modelUsed: string;
  citationsIncomplete: boolean;
  missingCitationIndices: number[];
}

export function runFindingPipeline(
  lens: LensConfig,
  text: string,
  apiKey: string,
  options?: {
    testing?: boolean;
    provider?: ModelProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    /**
     * AbortSignal forwarded to every upstream LLM call (findings pass and
     * citation enrichment). When aborted, the pipeline fails with
     * LLMAbortedError so the action can mark the run cancelled.
     */
    signal?: AbortSignal;
    maxOutputTokens?: number;
  }
): Effect.Effect<RunPipelineResult, RunPipelineError> {
  return Effect.gen(function* () {
    const testing = options?.testing ?? false;
    const { provider, model } = resolveProviderModel({
      provider: options?.provider,
      testing,
      model: options?.model,
    });
    const signal = options?.signal;

    // Pass 1: Extract findings with metadata (category, confidence, detail)
    const prompt = yield* buildPrompt(lens, text, { testing });
    const rawResponse = yield* callModel(prompt, apiKey, provider, model, {
      signal,
      reasoningEffort: options?.reasoningEffort,
      maxOutputTokens: options?.maxOutputTokens,
    });
    const parsedFindings = yield* parseResponse(rawResponse);
    const findings = testing
      ? parsedFindings.slice(0, FIRST_PASS_FINDING_LIMIT)
      : parsedFindings;

    // Pass 2: Enrich with verified citations (graceful fallback on most
    // errors). Abort propagates — a cancel during citation enrichment is the
    // user explicitly stopping, not a citation problem to swallow.
    let citationResult: CitationEnrichmentResult;
    if (provider === "openai") {
      citationResult = enrichWithLocalSourceSpans(findings, text);
    } else {
      citationResult = yield* enrichWithCitations(findings, text, apiKey, model, {
        signal,
      }).pipe(
        Effect.catchTag("CitationEnrichmentError", () => {
          logPipelineDiagnostic("citation_enrichment_failed");
          return Effect.succeed({
            findings,
            citationsIncomplete: true,
            missingCitationIndices: findings.map((_, index) => index),
          });
        })
      );
    }

    if (citationResult.citationsIncomplete) {
      logPipelineDiagnostic("citation_enrichment_incomplete", {
        missingFindingNumbers: citationResult.missingCitationIndices.map((index) => index + 1),
      });
    }

    return {
      findings: citationResult.findings,
      modelUsed: model,
      citationsIncomplete: citationResult.citationsIncomplete,
      missingCitationIndices: citationResult.missingCitationIndices,
    };
  });
}
