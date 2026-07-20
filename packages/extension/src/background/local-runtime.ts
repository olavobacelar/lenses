import { Effect } from "effect";
import {
  Finding,
  LensConfig,
  maxOutputTokensForLensRun,
  parseLensMarkdown,
  serializeLensMarkdown,
  type FindingEvidenceRefInput,
  type SourceScopeKind,
} from "@lenses/shared";
import type { AiModel, ModelProvider } from "../types/ai-models";
import type { ReasoningEffort } from "../lib/reasoning-settings";
import { makeJsonAiCall } from "./api/ai-client";
import { localBuiltInLenses, localBuiltInLensMarkdowns } from "../lib/local-built-in-lenses";
import {
  localDb,
  type LocalConversationRow,
  type LocalFindingEvidenceRefRow,
  type LocalFindingRow,
  type LocalLensRow,
  type LocalRunRow,
  type LocalSavedSelectionRow,
} from "../lib/local-db";

export interface LocalAiSettings {
  provider: ModelProvider;
  apiKey?: string;
  model: AiModel;
  reasoningEffort?: ReasoningEffort;
}

export interface LocalRunRequest {
  lensId: string;
  text: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  sourceTitle?: string;
  scope?: SourceScopeKind;
  customLens?: { instruction: string; name?: string };
}

export interface LocalDebugFinding {
  text: string;
  category: string;
  detail: string;
  confidence: number;
  sourceSpan?: { start: number; end: number };
  anchor?: Record<string, unknown>;
  enrichments?: Array<Record<string, unknown>>;
  runId?: string;
  findingIndex?: number;
  rawResponse?: string;
  rawFinding?: unknown;
}

export interface LocalStoredRunState {
  runId: string;
  lensId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  modelUsed?: string;
  rawResponse?: string;
  createdAt: number;
  findingCount?: number;
  findings: LocalDebugFinding[];
  // Chunk-level coverage from the run's segment manifest, so the sidepanel can
  // say how much of the source a stopped run actually inspected.
  chunkCoverage?: { done: number; total: number };
  initiatedFromEvidenceBaseId?: string;
  initiatedFromEvidenceBaseTitle?: string;
}

export interface LocalSavedChatMessage {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  thinkingText?: string;
  textSegments?: unknown[];
  meta?: Record<string, string>;
  // Reasoning/research trace and seek stamp; stored as-is so restored threads
  // keep them.
  activity?: unknown[];
  searches?: unknown[];
  videoTimestamp?: { seconds: number; formatted: string };
}

export interface LocalConversationIdentity {
  sourceKey: string;
  sourceUrl?: string;
  sourceKind: "web_page" | "youtube_video" | "pdf";
  scope: "page" | "selection" | "transcript";
  focus: "source" | "selection" | "finding" | "run";
  focusRef?: string;
}

export interface LocalSavedSelectionInput {
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  scope?: "page" | "selection" | "transcript";
  url: string;
  selectedText: string;
  messages: LocalSavedChatMessage[];
  title: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  textStart?: number;
  textEnd?: number;
  pageTitle?: string;
}

interface LocalAskFindingRequest {
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  annotations: Array<{
    lensId: string;
    label: string;
    category: string;
    text: string;
    detail: string;
    confidence: number;
  }>;
}

let seededBuiltIns = false;

export async function ensureLocalBuiltInLenses(): Promise<void> {
  if (seededBuiltIns) return;
  const now = Date.now();
  await localDb.transaction("rw", localDb.lenses, async () => {
    for (let index = 0; index < localBuiltInLenses.length; index++) {
      const lens = localBuiltInLenses[index];
      const existing = await localDb.lenses.get(lens.id);
      if (existing && existing.isBuiltIn) continue;
      await localDb.lenses.put(
        lensToRow(lens, {
          isBuiltIn: true,
          markdown: localBuiltInLensMarkdowns[index],
          updatedAt: now,
        })
      );
    }
  });
  seededBuiltIns = true;
}

export async function listLocalLensRows(): Promise<unknown[]> {
  await ensureLocalBuiltInLenses();
  const rows = await localDb.lenses.orderBy("updatedAt").toArray();
  return rows.map((row) => row.row);
}

export async function saveLocalUserLens(request: {
  lensId: string;
  name: string;
  instruction: string;
}): Promise<{ lensId?: string; name?: string; error?: string }> {
  try {
    const lens = buildLocalCustomLensConfig({
      lensId: request.lensId,
      name: request.name,
      instruction: request.instruction,
    });
    const markdown = serializeLensMarkdown(lens);
    await localDb.lenses.put(
      lensToRow(lens, { isBuiltIn: false, markdown, updatedAt: Date.now() })
    );
    return { lensId: lens.id, name: lens.name };
  } catch (error) {
    return { error: formatError(error) };
  }
}

export async function saveLocalLensConfig(
  markdown: string
): Promise<{ lensId?: string; name?: string; error?: string }> {
  try {
    await ensureLocalBuiltInLenses();
    const parsed = parseLensMarkdown(markdown);
    const existing = await localDb.lenses.get(parsed.id);
    const lens =
      existing?.isBuiltIn === true
        ? { ...parsed, id: forkId(parsed.id), authorType: "user" as const }
        : {
            ...parsed,
            authorType: parsed.authorType === "builtin" ? ("user" as const) : parsed.authorType,
          };
    const canonicalMarkdown = serializeLensMarkdown(lens);
    await localDb.lenses.put(
      lensToRow(lens, {
        isBuiltIn: false,
        markdown: canonicalMarkdown,
        updatedAt: Date.now(),
      })
    );
    return { lensId: lens.id, name: lens.name };
  } catch (error) {
    return { error: formatError(error) };
  }
}

export async function deleteLocalUserLens(
  lensId: string
): Promise<{ deleted?: boolean; error?: string }> {
  const existing = await localDb.lenses.get(lensId);
  if (!existing) return { deleted: false };
  if (existing.isBuiltIn) return { error: "Built-in lenses cannot be deleted" };
  await localDb.lenses.delete(lensId);
  return { deleted: true };
}

export async function generateLocalLensName(
  instruction: string
): Promise<{ name?: string; error?: string }> {
  return { name: fallbackLensName(instruction) };
}

export async function runLocalLens(
  request: LocalRunRequest,
  aiSettings: LocalAiSettings,
  options?: { signal?: AbortSignal; testing?: boolean; persist?: boolean }
): Promise<
  | {
      findings: LocalDebugFinding[];
      runId?: string;
      rawResponse?: string;
      modelUsed?: string;
    }
  | { error: string; cancelled?: boolean }
> {
  if (!aiSettings.apiKey?.trim()) {
    return {
      error: `No ${aiSettings.provider === "openai" ? "OpenAI" : "Anthropic"} API key configured`,
    };
  }

  const lens = request.customLens
    ? buildLocalCustomLensConfig({
        lensId: request.lensId,
        name: request.customLens.name,
        instruction: request.customLens.instruction,
      })
    : await getLocalLensConfig(request.lensId);

  if (!lens) return { error: `Lens "${request.lensId}" not found` };

  const runId = makeLocalId("run");
  const now = Date.now();
  const shouldPersist = options?.persist !== false;
  if (shouldPersist) {
    const runRow: LocalRunRow = {
      runId,
      lensId: request.lensId,
      sourceUrl: request.sourceUrl,
      sourceKey: request.sourceKey,
      sourceKind: request.sourceKind,
      sourceTitle: request.sourceTitle,
      scope: request.scope,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    await localDb.runs.put(runRow);
  }

  try {
    const prompt = buildLocalLensPrompt(lens, request.text, options);
    const result = await Effect.runPromise(
      makeJsonAiCall<{ content: Array<{ text?: string }> }>({
        provider: aiSettings.provider,
        apiKey: aiSettings.apiKey.trim(),
        model: aiSettings.model,
        maxTokens: maxOutputTokensForLensRun(aiSettings.provider, aiSettings.model),
        reasoningEffort: aiSettings.reasoningEffort,
        system: "You are a structured extraction engine. Return only valid JSON.",
        messages: [{ role: "user", content: prompt }],
        signal: options?.signal,
      })
    );
    const rawResponse = result.content?.[0]?.text ?? "";
    const parsedFindings = parseLocalFindings(rawResponse);
    const diagnosticRawResponse = options?.testing ? rawResponse : undefined;
    const findings = enrichLocalFindings(
      parsedFindings,
      request.text,
      diagnosticRawResponse,
      runId
    );

    if (shouldPersist) {
      await localDb.transaction("rw", localDb.runs, localDb.findings, async () => {
        await localDb.runs.update(runId, {
          status: "completed",
          findingCount: findings.length,
          modelUsed: aiSettings.model,
          rawResponse: diagnosticRawResponse,
          updatedAt: Date.now(),
        });
        await localDb.findings.where("runId").equals(runId).delete();
        await localDb.findings.bulkAdd(
          findings.map((finding, index): LocalFindingRow => ({
            runId,
            lensId: request.lensId,
            sourceUrl: request.sourceUrl,
            sourceKey: request.sourceKey,
            sourceKind: request.sourceKind,
            findingIndex: index,
            finding: finding as unknown as Record<string, unknown>,
          }))
        );
      });
    }

    return { findings, runId, rawResponse, modelUsed: aiSettings.model };
  } catch (error) {
    if (isAbortLikeError(error)) {
      if (shouldPersist) {
        await localDb.runs.update(runId, { status: "cancelled", updatedAt: Date.now() });
      }
      return { error: "Cancelled", cancelled: true };
    }
    const message = formatError(error);
    if (shouldPersist) {
      await localDb.runs.update(runId, {
        status: "failed",
        error: message,
        updatedAt: Date.now(),
      });
    }
    return { error: message };
  }
}

export async function saveLocalFindings(req: {
  runId?: string;
  lensId: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  sourceTitle?: string;
  sourceExternalId?: string;
  sourceMetadata?: Record<string, string>;
  modelUsed?: string;
  rawResponse?: string;
  evidenceBaseId?: string;
  fingerprint?: {
    contentHash: string;
    fileHash?: string;
    extractionVersion: string;
    contentLength: number;
    observedAt: number;
  };
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  evidenceRefs?: FindingEvidenceRefInput[];
  findings: Array<Record<string, unknown>>;
}): Promise<
  | {
      runId?: string;
      findingCount?: number;
      evidenceBaseSourceAdded?: boolean;
      sourceId?: string;
      sourceFingerprintId?: string;
    }
  | { error: string }
> {
  const existingRun = req.runId ? await localDb.runs.get(req.runId) : undefined;
  if (req.runId && !existingRun) return { error: "Evidence run not found" };
  if (existingRun && existingRun.lensId !== req.lensId) {
    return { error: "Evidence run lens does not match the saved findings" };
  }
  if (req.evidenceBaseId && !existingRun) {
    return { error: "Evidence-base findings require a started evidence run" };
  }
  if (
    existingRun &&
    req.evidenceBaseId &&
    existingRun.initiatedFromEvidenceBaseId !== req.evidenceBaseId
  ) {
    return { error: "Evidence run does not belong to the selected evidence base" };
  }
  const storedLens = await localDb.lenses.get(req.lensId);
  const runId = existingRun?.runId ?? makeLocalId("run");
  const now = Date.now();
  await localDb.transaction(
    "rw",
    localDb.runs,
    localDb.findings,
    localDb.sourceSegments,
    localDb.findingEvidenceRefs,
    async () => {
      const previousFindings = existingRun
        ? await localDb.findings.where("runId").equals(runId).toArray()
        : [];
      for (const previousFinding of previousFindings) {
        if (previousFinding.id != null) {
          await localDb.findingEvidenceRefs.where("findingId").equals(previousFinding.id).delete();
        }
      }
      if (existingRun) await localDb.findings.where("runId").equals(runId).delete();
      await localDb.runs.put({
        ...existingRun,
        runId,
        lensId: req.lensId,
        sourceUrl: req.sourceUrl ?? existingRun?.sourceUrl,
        sourceKey: req.sourceKey ?? existingRun?.sourceKey,
        sourceKind: req.sourceKind ?? existingRun?.sourceKind,
        sourceTitle: req.sourceTitle ?? existingRun?.sourceTitle,
        sourceId: existingRun?.sourceId,
        sourceFingerprintId: existingRun?.sourceFingerprintId,
        initiatedFromEvidenceBaseId: existingRun?.initiatedFromEvidenceBaseId,
        lensVersion:
          req.lensVersion ??
          existingRun?.lensVersion ??
          (typeof storedLens?.row.version === "string" ? storedLens.row.version : undefined),
        lensMarkdownSnapshot:
          req.lensMarkdownSnapshot ?? existingRun?.lensMarkdownSnapshot ?? storedLens?.markdown,
        status: "completed",
        findingCount: req.findings.length,
        modelUsed: req.modelUsed,
        rawResponse: req.rawResponse,
        createdAt: existingRun?.createdAt ?? now,
        updatedAt: now,
      });
      const sourceFingerprintId = existingRun?.sourceFingerprintId;
      for (let index = 0; index < req.findings.length; index += 1) {
        const finding = req.findings[index];
        const findingId = await localDb.findings.add({
          runId,
          lensId: req.lensId,
          sourceUrl: req.sourceUrl ?? existingRun?.sourceUrl,
          sourceKey: req.sourceKey ?? existingRun?.sourceKey,
          sourceKind: req.sourceKind ?? existingRun?.sourceKind,
          findingIndex: index,
          finding: boundedLocalFinding(finding),
        } satisfies LocalFindingRow);
        const refs = (req.evidenceRefs ?? []).filter((ref) => ref.findingIndex === index);
        for (const ref of refs) {
          if (!sourceFingerprintId) throw new Error("Evidence references require a source fingerprint");
          const segment = await localDb.sourceSegments
            .where("[sourceFingerprintId+segmentKey]")
            .equals([sourceFingerprintId, ref.segmentKey])
            .first();
          if (!segment) throw new Error("Finding evidence references an unknown source segment");
          const exactQuote = ref.exactQuote.trim().slice(0, 500);
          if (!exactQuote) continue;
          const row: LocalFindingEvidenceRefRow = {
            id: makeLocalId("finding_evidence"),
            findingId,
            runId,
            sourceSegmentId: segment.id,
            segmentKey: ref.segmentKey,
            role: ref.role,
            exactQuote,
            quoteHash: ref.quoteHash,
            anchor: ref.anchor,
            relevanceNote: ref.relevanceNote?.trim().slice(0, 1000),
          };
          await localDb.findingEvidenceRefs.add(row);
        }
      }
    }
  );
  return {
    runId,
    findingCount: req.findings.length,
    evidenceBaseSourceAdded: false,
    sourceId: existingRun?.sourceId,
    sourceFingerprintId: existingRun?.sourceFingerprintId,
  };
}

function boundedLocalFinding(finding: Record<string, unknown>): Record<string, unknown> {
  const quotes = Array.isArray(finding.quotes)
    ? finding.quotes
        .filter((quote): quote is string => typeof quote === "string")
        .map((quote) => quote.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 8)
    : undefined;
  return {
    ...finding,
    ...(quotes && quotes.length > 0 ? { quotes } : { quotes: undefined }),
  };
}

export async function clearLocalFindingsForPage(
  sourceUrl: string
): Promise<{ deletedRuns: number; deletedFindings: number } | { error: string }> {
  const runs = await localDb.runs.where("sourceUrl").equals(sourceUrl).toArray();
  const runIds = runs.map((run) => run.runId);
  let deletedFindings = 0;
  await localDb.transaction(
    "rw",
    localDb.runs,
    localDb.findings,
    localDb.runSegmentRefs,
    localDb.findingEvidenceRefs,
    async () => {
    for (const runId of runIds) {
      const findings = await localDb.findings.where("runId").equals(runId).toArray();
      for (const finding of findings) {
        if (finding.id != null) {
          await localDb.findingEvidenceRefs.where("findingId").equals(finding.id).delete();
        }
      }
      deletedFindings += await localDb.findings.where("runId").equals(runId).delete();
      await localDb.runSegmentRefs.where("runId").equals(runId).delete();
    }
    await localDb.runs.bulkDelete(runIds);
    }
  );
  return { deletedRuns: runIds.length, deletedFindings };
}

export async function getLocalStoredRunStates(
  source: { sourceUrl: string; sourceKey?: string },
  lensIds: string[]
): Promise<LocalStoredRunState[]> {
  const sourceRuns = await runsForSource(source);
  const candidates = sourceRuns
    .filter((run) => lensIds.length === 0 || lensIds.includes(run.lensId))
    .sort((a, b) => b.createdAt - a.createdAt);
  // Latest non-cancelled run wins per lens; a cancelled run surfaces only when
  // it is all the lens has, so stopping a run never hides older completed
  // findings but a stop-then-reload still renders as "Stopped" with coverage.
  const latestByLens = new Map<string, LocalRunRow>();
  for (const run of candidates) {
    if (run.status === "cancelled") continue;
    if (!latestByLens.has(run.lensId)) latestByLens.set(run.lensId, run);
  }
  for (const run of candidates) {
    if (run.status !== "cancelled") continue;
    if (!latestByLens.has(run.lensId)) latestByLens.set(run.lensId, run);
  }

  const result: LocalStoredRunState[] = [];
  for (const run of latestByLens.values()) {
    result.push(await normalizeLocalStoredRun(run));
  }
  return result;
}

export async function getLocalDebugData(
  sourceUrl: string,
  lensIds: string[]
): Promise<{
  runs: Array<{
    runId: string;
    lensId: string;
    modelUsed?: string;
    rawResponse?: string;
    createdAt: number;
    findings: LocalDebugFinding[];
  }>;
}> {
  const runs = (await localDb.runs.where("sourceUrl").equals(sourceUrl).toArray())
    .filter((run) => lensIds.length === 0 || lensIds.includes(run.lensId))
    .sort((a, b) => b.createdAt - a.createdAt);

  return {
    runs: await Promise.all(
      runs.map(async (run) => {
        const normalized = await normalizeLocalStoredRun(run);
        return {
          runId: run.runId,
          lensId: run.lensId,
          modelUsed: run.modelUsed,
          rawResponse: run.rawResponse,
          createdAt: run.createdAt,
          findings: normalized.findings,
        };
      })
    ),
  };
}

export async function askLocalFindingQuestion(
  request: LocalAskFindingRequest,
  aiSettings: LocalAiSettings
): Promise<{ answer: string } | { error: string }> {
  if (!aiSettings.apiKey?.trim()) {
    return {
      error: `No ${aiSettings.provider === "openai" ? "OpenAI" : "Anthropic"} API key configured`,
    };
  }

  const annotationContext = request.annotations
    .map((annotation, index) => {
      const confidence = Math.round(annotation.confidence * 100);
      return (
        `${index + 1}. Lens: ${annotation.lensId}\n` +
        `   Label: ${annotation.label}\n` +
        `   Category: ${annotation.category}\n` +
        `   Confidence: ${confidence}%\n` +
        `   Text: "${annotation.text}"\n` +
        `   Detail: ${annotation.detail}`
      );
    })
    .join("\n\n");

  const result = await Effect.runPromise(
    makeJsonAiCall<{ content: Array<{ text?: string }> }>({
      provider: aiSettings.provider,
      apiKey: aiSettings.apiKey.trim(),
      model: aiSettings.model,
      maxTokens: 1200,
      reasoningEffort: aiSettings.reasoningEffort,
      system:
        "You help users investigate highlighted issues in text. Ground answers in the provided annotation context and avoid inventing facts.",
      messages: [
        {
          role: "user",
          content:
            `Source URL: ${request.sourceUrl ?? "unknown"}\n\n` +
            `Annotation context:\n${annotationContext}\n\n` +
            `Question: ${request.question}`,
        },
        ...(request.conversation ?? []),
      ],
    })
  ).catch((error) => ({ error: formatError(error) }));

  if ("error" in result) return { error: result.error };
  const answer = result.content?.[0]?.text?.trim() ?? "";
  return answer ? { answer } : { error: "Empty response from assistant" };
}

export async function createLocalSavedSelection(
  input: LocalSavedSelectionInput
): Promise<LocalSavedSelectionRow> {
  const now = Date.now();
  const row: LocalSavedSelectionRow = {
    id: makeLocalId("sel"),
    sourceKey: input.sourceKey,
    sourceKind: input.sourceKind,
    scope: input.scope,
    url: input.url,
    selectedText: input.selectedText,
    messages: input.messages as unknown as Array<Record<string, unknown>>,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    anchorPrefix: input.anchorPrefix,
    anchorSuffix: input.anchorSuffix,
    textStart: input.textStart,
    textEnd: input.textEnd,
    pageTitle: input.pageTitle,
  };
  await localDb.savedSelections.put(row);
  return row;
}

export async function updateLocalSavedSelection(
  id: string,
  messages: LocalSavedChatMessage[]
): Promise<{ ok: true; selection?: LocalSavedSelectionRow } | { error: string }> {
  const existing = await localDb.savedSelections.get(id);
  if (!existing) return { error: "Saved selection not found" };
  const selection = {
    ...existing,
    messages: messages as unknown as Array<Record<string, unknown>>,
    updatedAt: Date.now(),
  };
  await localDb.savedSelections.put(selection);
  return { ok: true, selection };
}

export async function deleteLocalSavedSelection(id: string): Promise<{ ok: true }> {
  await localDb.savedSelections.delete(id);
  return { ok: true };
}

export async function listLocalSavedSelections(
  url: string
): Promise<{ selections: LocalSavedSelectionRow[] }> {
  const selections = (await localDb.savedSelections.where("url").equals(url).toArray()).sort(
    (a, b) => b.createdAt - a.createdAt
  );
  return { selections };
}

export async function saveLocalConversation(
  identity: LocalConversationIdentity,
  messages: LocalSavedChatMessage[]
): Promise<{ ok: true; messageCount: number }> {
  const row: LocalConversationRow = {
    key: conversationKey(identity),
    sourceKey: identity.sourceKey,
    sourceUrl: identity.sourceUrl,
    sourceKind: identity.sourceKind,
    scope: identity.scope,
    focus: identity.focus,
    focusRef: normalizedFocusRef(identity.focusRef),
    messages: messages as unknown as Array<Record<string, unknown>>,
    updatedAt: Date.now(),
  };
  await localDb.conversations.put(row);
  return { ok: true, messageCount: messages.length };
}

export async function getLocalConversation(
  identity: LocalConversationIdentity
): Promise<{ messages: LocalSavedChatMessage[] }> {
  const row = await localDb.conversations.get(conversationKey(identity));
  return {
    messages: (row?.messages ?? []) as unknown as LocalSavedChatMessage[],
  };
}

async function getLocalLensConfig(lensId: string): Promise<LensConfig | null> {
  await ensureLocalBuiltInLenses();
  const row = await localDb.lenses.get(lensId);
  if (!row) return null;
  const parsed = LensConfig.safeParse({ ...row.row, id: row.lensId });
  return parsed.success ? parsed.data : null;
}

function lensToRow(
  lens: LensConfig,
  options: { isBuiltIn: boolean; markdown?: string; updatedAt: number }
): LocalLensRow {
  const { id: _id, ...rest } = lens;
  return {
    lensId: lens.id,
    markdown: options.markdown,
    isBuiltIn: options.isBuiltIn,
    updatedAt: options.updatedAt,
    row: {
      ...rest,
      lensId: lens.id,
      markdown: options.markdown,
      isBuiltIn: options.isBuiltIn,
    },
  };
}

function buildLocalCustomLensConfig(args: {
  lensId: string;
  name?: string;
  instruction: string;
}): LensConfig {
  const instruction = args.instruction.trim();
  const name = args.name?.trim() || fallbackLensName(instruction);
  return LensConfig.parse({
    id: args.lensId,
    name,
    description: `Finds text matching: ${instruction}`,
    promptTemplate:
      `Find every span of the source text that matches this instruction:\n\n` +
      `${instruction}\n\n<text_to_analyze>\n{{text}}\n</text_to_analyze>`,
    outputInstructions:
      'Return a JSON array where each element has:\n{\n  "text": "the exact span copied verbatim from the source",\n  "category": "match",\n  "detail": "why this span matches",\n  "confidence": number between 0 and 1\n}\n\nOnly return the JSON array, no other text.',
    highlightRules: [
      { condition: "category", value: "match", color: "#4f8df9", label: "Match" },
    ],
    outputCategories: [{ name: "match", color: "#4f8df9", label: "Match" }],
    version: "0.0.1",
    authorType: "user",
    contentTypeHints: ["text"],
    fallbackColor: "#4f8df9",
    focus: "source",
    scope: ["page"],
    itemNoun: "finding",
    outputKind: "items",
    runMode: "manual",
    visible: true,
  });
}

function buildLocalLensPrompt(
  lens: LensConfig,
  text: string,
  options?: { testing?: boolean }
): string {
  const prompt = lens.promptTemplate.replace("{{text}}", text);
  const limit = options?.testing
    ? "\n\nOnly include the first 3 findings in document order. If you find more than 3, discard the rest."
    : "";
  return `${prompt}\n\n${lens.outputInstructions}${limit}`;
}

function parseLocalFindings(rawResponse: string) {
  const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in response");
  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  const result = Finding.array().safeParse(parsed);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

function enrichLocalFindings(
  findings: Array<ReturnType<typeof parseLocalFindings>[number]>,
  sourceText: string,
  rawResponse: string | undefined,
  runId: string
): LocalDebugFinding[] {
  return findings.map((finding, index) => {
    const start = finding.text.trim() ? sourceText.indexOf(finding.text.trim()) : -1;
    const sourceSpan =
      finding.sourceSpan ??
      (start >= 0 ? { start, end: start + finding.text.trim().length } : undefined);
    const enriched: LocalDebugFinding = {
      ...finding,
      sourceSpan,
      runId,
      findingIndex: index,
      rawFinding: finding,
    };
    if (rawResponse !== undefined) enriched.rawResponse = rawResponse;
    return enriched;
  });
}

async function runsForSource(source: { sourceUrl: string; sourceKey?: string }) {
  const byUrl = await localDb.runs.where("sourceUrl").equals(source.sourceUrl).toArray();
  if (!source.sourceKey) return byUrl;
  const byKey = await localDb.runs.where("sourceKey").equals(source.sourceKey).toArray();
  const byId = new Map<string, LocalRunRow>();
  for (const run of [...byUrl, ...byKey]) byId.set(run.runId, run);
  return [...byId.values()];
}

async function normalizeLocalStoredRun(run: LocalRunRow): Promise<LocalStoredRunState> {
  const findingRows = await localDb.findings
    .where("runId")
    .equals(run.runId)
    .sortBy("findingIndex");
  const findings = findingRows.map((row) => ({
    ...(row.finding as unknown as LocalDebugFinding),
    runId: run.runId,
    findingIndex: row.findingIndex,
    rawResponse: run.rawResponse,
  }));
  return {
    runId: run.runId,
    lensId: run.lensId,
    status: run.status,
    error: run.error,
    modelUsed: run.modelUsed,
    rawResponse: run.rawResponse,
    createdAt: run.createdAt,
    findingCount: run.findingCount ?? findings.length,
    findings,
    chunkCoverage: await runChunkCoverage(run.runId),
    initiatedFromEvidenceBaseId: run.initiatedFromEvidenceBaseId,
    initiatedFromEvidenceBaseTitle: await evidenceBaseTitle(run.initiatedFromEvidenceBaseId),
  };
}

// A chunk counts as done only when every core segment inspected under it
// completed; context-halo segments don't affect coverage.
async function runChunkCoverage(
  runId: string
): Promise<{ done: number; total: number } | undefined> {
  const refs = await localDb.runSegmentRefs.where("runId").equals(runId).toArray();
  const chunkComplete = new Map<number, boolean>();
  for (const ref of refs) {
    if (ref.role !== "core") continue;
    const complete = ref.status === "completed";
    chunkComplete.set(ref.chunkIndex, (chunkComplete.get(ref.chunkIndex) ?? true) && complete);
  }
  if (chunkComplete.size === 0) return undefined;
  const done = [...chunkComplete.values()].filter(Boolean).length;
  return { done, total: chunkComplete.size };
}

async function evidenceBaseTitle(id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  return (await localDb.evidenceBases.get(id))?.title;
}

function conversationKey(identity: LocalConversationIdentity): string {
  return [
    identity.sourceKey,
    identity.sourceKind,
    identity.scope,
    identity.focus,
    normalizedFocusRef(identity.focusRef),
  ].join("::");
}

function normalizedFocusRef(focusRef?: string): string {
  return focusRef?.trim() || "";
}

function fallbackLensName(instruction: string): string {
  const words = instruction
    .trim()
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 3);
  if (words.length === 0) return "Custom Lens";
  return words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function forkId(builtInId: string): string {
  return builtInId.endsWith("-custom") ? builtInId : `${builtInId}-custom`;
}

function makeLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; _tag?: unknown; reason?: unknown };
  return record.name === "AbortError" || record._tag === "ApiAbortedError";
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "_tag" in error) {
    const record = error as { _tag?: unknown; message?: unknown; reason?: unknown };
    const message = typeof record.message === "string" ? record.message : record.reason;
    return `${String(record._tag)}${message ? `: ${String(message)}` : ""}`;
  }
  return String(error);
}
