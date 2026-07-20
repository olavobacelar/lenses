import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { colorsForLens } from "../../lib/lens-colors";
import { LENS_META } from "../constants";
import { openOptionsPage, sendRuntimeMessage, sendToActiveTab } from "../lib/chrome";
import { formatError } from "../lib/format";
import {
  dedupeChunkFindings,
  groundLensFindings,
  mergeChunkFindings,
  prepareSourceForLensRuns,
  serializeChunkRawResponses,
} from "../lib/lens-run-chunks";
import { chunkInspectionPlan } from "../../lib/source-segments";
import { parseLensRunsResponse } from "../schemas";
import type { LensFinding, LensRunState, PanelSource, RunLensResponse } from "../types";
import type { TranscriptSegment } from "../../types/transcript";
import {
  canPromote,
  type ActiveCustomLens,
  type CustomLensStatus,
} from "../../lib/custom-lens";

type LensClientStatus = CustomLensStatus | "stopped";

export interface LensChunkProgress {
  // Chunks fully processed. The chunk at index `done` is the one in flight;
  // the header renders it as active rather than counting it as finished.
  done: number;
  total: number;
}

export interface LensSectionModel {
  lensId: string;
  run?: LensRunState;
  findings: LensFinding[];
  // Display name for custom/user lenses; built-ins fall back to LENS_META.
  name?: string;
  // Set for client-side transitions before backend findings are available so
  // built-ins and one-offs share the same accordion status pipeline.
  clientStatus?: LensClientStatus;
  chunkProgress?: LensChunkProgress;
  // Marks the completed one-off that can still be pinned as a permanent lens.
  promotable?: boolean;
  // The persisted run was initiated from a different evidence base than the
  // active one; the originating base's title when it still exists.
  reused?: boolean;
  reusedFromTitle?: string;
}

const EMPTY_EXTRA_IDS: string[] = [];
const EMPTY_DEDICATED_IDS: readonly string[] = [];
const EMPTY_LENS_NAMES: Record<string, string> = {};

interface UseLensRunsOptions {
  source: PanelSource | null;
  transcript: TranscriptSegment[];
  activeTabId: number | null;
  showWarning: (message: string) => void;
  // Promoted user lenses + the active completed one-off, fetched on top of the
  // built-ins so their stored findings surface as accordion sections.
  extraLensIds?: string[];
  // Lenses with their own dedicated section. They use the same runner and are
  // tracked here, but stay out of the generic LensSections accordion.
  dedicatedLensIds?: readonly string[];
  // lensId → generated name, used to title the extra sections.
  lensNames?: Record<string, string>;
  // Active one-off lens state; useLensRuns owns how it appears in the accordion.
  activeLens?: ActiveCustomLens | null;
  activeEvidenceBaseId?: string | null;
  // Fired once per run when the active base captures the current source; `added`
  // is true only the first time this source enters the base.
  onSourceCaptured?: (added: boolean) => void;
}

export function useLensRuns({
  source,
  transcript,
  activeTabId,
  showWarning,
  extraLensIds = EMPTY_EXTRA_IDS,
  dedicatedLensIds = EMPTY_DEDICATED_IDS,
  lensNames = EMPTY_LENS_NAMES,
  activeLens = null,
  activeEvidenceBaseId = null,
  onSourceCaptured,
}: UseLensRunsOptions) {
  const [persistedSections, setPersistedSections] = useState<LensSectionModel[]>([]);
  const [clientSections, setClientSections] = useState<Record<string, LensSectionModel>>(
    {}
  );
  const [firstFailedLensId, setFirstFailedLensId] = useState<string | null>(null);
  const activeChunkControllers = useRef(new Map<string, AbortController>());
  const currentSourceKeyRef = useRef(source?.key);
  const findingsLoadRequestIdRef = useRef(0);
  currentSourceKeyRef.current = source?.key;
  // Where each stopped run left off, so "Run remaining chunks" can pick up the
  // tail instead of redoing inspected chunks. Valid only for the current
  // source: chunking is deterministic per source text, and the map is cleared
  // whenever the source changes.
  const resumableRuns = useRef(
    new Map<string, { done: number; total: number; findings: LensFinding[] }>()
  );

  const builtInIds = useMemo(() => Object.keys(LENS_META), []);
  // Extras render first (newly created/promoted lenses surface at the top),
  // then the built-ins in their canonical order.
  const sectionLensIds = useMemo(
    () => [...extraLensIds, ...builtInIds],
    [extraLensIds, builtInIds]
  );
  const trackedLensIds = useMemo(
    () => Array.from(new Set([...dedicatedLensIds, ...sectionLensIds])),
    [dedicatedLensIds, sectionLensIds]
  );
  const trackedLensIdSet = useMemo(() => new Set(trackedLensIds), [trackedLensIds]);
  const sectionLensIdSet = useMemo(() => new Set(sectionLensIds), [sectionLensIds]);

  const allSections = useMemo(
    () =>
      mergeLensSections({
        persistedSections,
        clientSections,
        activeLens,
        lensIds: trackedLensIds,
      }),
    [activeLens, clientSections, persistedSections, trackedLensIds]
  );
  const sections = useMemo(
    () =>
      allSections.filter(
        (section) =>
          sectionLensIdSet.has(section.lensId) || section.lensId === activeLens?.lensId
      ),
    [activeLens?.lensId, allSections, sectionLensIdSet]
  );

  const markLensRunsStarted = useCallback(
    (ids: readonly string[]) => {
      const nextIds = ids.filter((lensId) => trackedLensIdSet.has(lensId));
      if (nextIds.length === 0) return;
      setClientSections((current) => {
        const next = { ...current };
        for (const lensId of nextIds) {
          next[lensId] = {
            lensId,
            name: lensNames[lensId],
            findings: [],
            clientStatus: "running",
          };
        }
        return next;
      });
    },
    [lensNames, trackedLensIdSet]
  );

  const markLensRunsCompleted = useCallback(
    (ids: readonly string[]) => {
      const nextIds = ids.filter((lensId) => trackedLensIdSet.has(lensId));
      if (nextIds.length === 0) return;
      setClientSections((current) => {
        const next = { ...current };
        for (const lensId of nextIds) {
          next[lensId] = {
            ...(next[lensId] ?? { lensId, name: lensNames[lensId], findings: [] }),
            clientStatus: "completed",
            chunkProgress: undefined,
          };
        }
        return next;
      });
    },
    [lensNames, trackedLensIdSet]
  );

  const markLensRunsFailed = useCallback(
    (ids: readonly string[], error?: string) => {
      const nextIds = ids.filter((lensId) => trackedLensIdSet.has(lensId));
      if (nextIds.length === 0) return;
      setClientSections((current) => {
        const next = { ...current };
        for (const lensId of nextIds) {
          next[lensId] = {
            lensId,
            name: lensNames[lensId],
            findings: [],
            run: failedClientRun(lensId, error),
          };
        }
        return next;
      });
      const firstSectionFailure = nextIds.find((lensId) => sectionLensIdSet.has(lensId));
      if (firstSectionFailure) {
        setFirstFailedLensId((current) => current ?? firstSectionFailure);
      }
    },
    [lensNames, sectionLensIdSet, trackedLensIdSet]
  );

  const setLensRunProgress = useCallback(
    (
      lensId: string,
      progress: LensChunkProgress,
      findings: LensFinding[] = []
    ) => {
      if (!trackedLensIdSet.has(lensId)) return;
      setClientSections((current) => ({
        ...current,
        [lensId]: {
          lensId,
          name: lensNames[lensId],
          findings,
          clientStatus: "running",
          chunkProgress: progress,
        },
      }));
    },
    [lensNames, trackedLensIdSet]
  );

  const markLensRunStopped = useCallback(
    (lensId: string, findings: LensFinding[], progress?: LensChunkProgress) => {
      if (!trackedLensIdSet.has(lensId)) return;
      setClientSections((current) => ({
        ...current,
        [lensId]: {
          lensId,
          name: lensNames[lensId],
          findings,
          clientStatus: "stopped",
          // Coverage stays on the stopped section so the header can say how
          // far the run got ("5 · 3/7") instead of presenting partial
          // findings as a full result.
          chunkProgress: progress,
        },
      }));
    },
    [lensNames, trackedLensIdSet]
  );

  const cancelLensRun = useCallback((lensId: string) => {
    activeChunkControllers.current.get(lensId)?.abort();
  }, []);

  const loadLensFindings = useCallback(async () => {
    const requestedSourceKey = source?.key;
    // A run started for the previous tab may reach its final refresh after the
    // source has changed. Do not let that old closure supersede the current
    // source's findings request.
    if (requestedSourceKey !== currentSourceKeyRef.current) return;
    const requestId = findingsLoadRequestIdRef.current + 1;
    findingsLoadRequestIdRef.current = requestId;
    const isLatest = () =>
      findingsLoadRequestIdRef.current === requestId &&
      currentSourceKeyRef.current === requestedSourceKey;

    setPersistedSections([]);
    setFirstFailedLensId(null);
    if (!source) return;

    const result = parseLensRunsResponse(
      await sendRuntimeMessage<unknown>({
        type: "get-source-findings",
        sourceUrl: source.url,
        sourceKey: source.key,
        lensIds: trackedLensIds,
      }).catch((error): unknown => ({ error: formatError(error) }))
    );
    if (!isLatest()) return;

    if (result.error) {
      showWarning(`Could not load lens runs: ${describeLensRunError(result.error)}`);
    }

    const byLens = result.byLens ?? {};
    const runsByLens = new Map((result.runs ?? []).map((run) => [run.lensId, run]));
    const nextSections: LensSectionModel[] = [];
    let firstFailed: string | null = null;

    for (const lensId of trackedLensIds) {
      const name = lensNames[lensId];
      const run = runsByLens.get(lensId);
      if (run) {
        // A run counts as reused when it was executed from a different
        // evidence base than the one active here — it arrived via the shared
        // source fingerprint, not a run the user started in this workspace.
        const reused =
          !!activeEvidenceBaseId &&
          !!run.initiatedFromEvidenceBaseId &&
          run.initiatedFromEvidenceBaseId !== activeEvidenceBaseId;
        nextSections.push({
          lensId,
          run,
          findings: run.findings,
          name,
          reused: reused || undefined,
          reusedFromTitle: reused ? run.initiatedFromEvidenceBaseTitle : undefined,
        });
        if (run.status === "failed" && !firstFailed && sectionLensIdSet.has(lensId)) {
          firstFailed = lensId;
        }
        continue;
      }

      const findings = byLens[lensId];
      if (findings && findings.length > 0) {
        nextSections.push({ lensId, findings, name });
      }
    }

    setPersistedSections(nextSections);
    setFirstFailedLensId(firstFailed);
  }, [
    activeEvidenceBaseId,
    lensNames,
    sectionLensIdSet,
    showWarning,
    source,
    trackedLensIds,
  ]);

  const runLensIdsChunked = useCallback(
    async (
      requestedLensIds: readonly string[],
      options: { storePageLenses?: boolean; resume?: boolean } = {}
    ) => {
      if (!source) {
        showWarning("No source text available.");
        return;
      }
      if (!source.text.trim()) {
        showWarning("No source text available.");
        return;
      }

      const runLensIds = requestedLensIds.filter((lensId) => trackedLensIdSet.has(lensId));
      if (runLensIds.length === 0) return;

      const prepared = await prepareSourceForLensRuns(source, transcript);
      const isCurrentRunSource = () => currentSourceKeyRef.current === source.key;
      if (!isCurrentRunSource()) return;
      const chunks = prepared.chunks;

      const storePageLenses = options.storePageLenses ?? true;
      for (const lensId of runLensIds) {
        if (!isCurrentRunSource()) break;
        // Resume only when the stopped run's chunking still matches — a total
        // mismatch means the source text changed under us, so start over.
        const resumeState = options.resume ? resumableRuns.current.get(lensId) : undefined;
        const startAt =
          resumeState && resumeState.total === chunks.length ? resumeState.done : 0;
        resumableRuns.current.delete(lensId);

        const controller = new AbortController();
        const ensureCurrentRunSource = () => {
          if (controller.signal.aborted || !isCurrentRunSource()) {
            throw createAbortError();
          }
        };
        const runRequestId = crypto.randomUUID();
        activeChunkControllers.current.get(lensId)?.abort();
        activeChunkControllers.current.set(lensId, controller);

        const mergedFindings: LensFinding[] =
          startAt > 0 && resumeState ? [...resumeState.findings] : [];
        const rawResponses: Array<{ chunkIndex: number; rawResponse: string }> = [];
        let modelUsed: string | undefined;
        let evidenceRunId: string | undefined;
        let completedChunks = startAt;
        const customLens =
          activeLens?.lensId === lensId
            ? { instruction: activeLens.instruction, name: activeLens.name }
            : undefined;

        setLensRunProgress(lensId, { done: startAt, total: chunks.length }, [
          ...mergedFindings,
        ]);
        if (activeTabId) {
          void sendToActiveTab(activeTabId, { type: "clear-lens-results", lensId }, false).catch(
            () => undefined
          );
        }

        try {
          ensureCurrentRunSource();
          if (activeEvidenceBaseId) {
            const started = await sendRuntimeMessage<{
              runId?: string;
              evidenceBaseSourceAdded?: boolean;
              error?: string;
            }>({
              type: "start-evidence-run",
              lensId,
              runRequestId,
              evidenceBaseId: activeEvidenceBaseId,
              sourceKey: source.key,
              kind: source.kind,
              url: source.url,
              title: source.title,
              externalId: source.videoId,
              metadata: source.sourceMetadata,
              fingerprint: prepared.fingerprint,
              scope: source.scope,
              chunkingVersion: prepared.chunkingVersion,
              segments: prepared.descriptors,
              inspections: chunkInspectionPlan(chunks),
            });
            ensureCurrentRunSource();
            if (started.error || !started.runId) {
              throw new Error(started.error || "Could not start evidence run");
            }
            evidenceRunId = started.runId;
            onSourceCaptured?.(started.evidenceBaseSourceAdded === true);

            // A resumed run's output includes the findings carried over from
            // the chunks the stopped run already inspected this session, so
            // its manifest records those chunks as covered.
            for (let index = 0; index < startAt; index++) {
              const coverage = await sendRuntimeMessage<{ error?: string }>({
                type: "mark-evidence-run-chunk",
                runId: evidenceRunId,
                chunkIndex: index,
                status: "completed",
              });
              ensureCurrentRunSource();
              if (coverage.error) throw new Error(coverage.error);
            }
          }

          if (chunks.length === 0) {
            throw new Error(
              source.kind === "pdf"
                ? "This PDF has no extractable text; OCR is required."
                : "No source text available."
            );
          }

          for (let index = startAt; index < chunks.length; index++) {
            ensureCurrentRunSource();

            // The chunk being requested stays out of `done` until it resolves;
            // the header shows it as in flight instead.
            const chunk = chunks[index];
            setLensRunProgress(
              lensId,
              { done: index, total: chunks.length },
              [...mergedFindings]
            );

            const result = await withAbort(
              sendRuntimeMessage<RunLensResponse>({
                type: "run",
                lensId,
                text: chunk.text,
                sourceKind: source.kind,
                sourceTitle: source.title,
                scope: source.scope,
                customLens,
                runRequestId,
                persist: false,
              }),
              controller.signal
            );
            ensureCurrentRunSource();

            if (result.cancelled) throw createAbortError();
            if (result.error) throw new Error(result.error);
            modelUsed = result.modelUsed ?? modelUsed;
            if (typeof result.rawResponse === "string") {
              rawResponses.push({ chunkIndex: index, rawResponse: result.rawResponse });
            }
            mergedFindings.push(...mergeChunkFindings(chunk, result.findings ?? []));

            if (evidenceRunId) {
              const coverage = await sendRuntimeMessage<{ error?: string }>({
                type: "mark-evidence-run-chunk",
                runId: evidenceRunId,
                chunkIndex: index,
                status: "completed",
              });
              ensureCurrentRunSource();
              if (coverage.error) throw new Error(coverage.error);
            }

            const deduped = dedupeChunkFindings(mergedFindings);
            mergedFindings.splice(0, mergedFindings.length, ...deduped);
            completedChunks = index + 1;
            setLensRunProgress(
              lensId,
              { done: completedChunks, total: chunks.length },
              [...mergedFindings]
            );
          }

          const grounded = await groundLensFindings(mergedFindings, prepared);
          ensureCurrentRunSource();
          mergedFindings.splice(0, mergedFindings.length, ...grounded.findings);
          const saved = storePageLenses || activeEvidenceBaseId
            ? await sendRuntimeMessage<{
                error?: string;
                evidenceBaseSourceAdded?: boolean;
              }>({
                type: "save-findings",
                runId: evidenceRunId,
                lensId,
                sourceUrl: source.url,
                sourceKey: source.key,
                sourceKind: source.kind,
                sourceTitle: source.title,
                sourceExternalId: source.videoId,
                sourceMetadata: source.sourceMetadata,
                modelUsed,
                rawResponse: serializeChunkRawResponses(rawResponses, chunks.length),
                evidenceBaseId: activeEvidenceBaseId ?? undefined,
                fingerprint: prepared.fingerprint,
                evidenceRefs: grounded.evidenceRefs,
                findings: mergedFindings,
              })
            : undefined;
          if (saved?.error) throw new Error(saved.error);
          // Persistence may have completed while the person switched tabs. In
          // that case the old result is valid for its source, but it must not
          // update or highlight the newly active source.
          if (!isCurrentRunSource() || controller.signal.aborted) continue;

          if (activeTabId && source.kind !== "pdf" && mergedFindings.length > 0) {
            void sendToActiveTab(
              activeTabId,
              {
                type: "highlight",
                findings: mergedFindings,
                lensId,
                colors: colorsForLens(lensId),
                sourceText: source.text,
              },
              false
            ).catch(() => undefined);
          }

          markLensRunsCompleted([lensId]);
        } catch (error) {
          if (isAbortError(error)) {
            void sendRuntimeMessage({
              type: "cancel-run-request",
              runRequestId,
            });
            if (evidenceRunId) {
              void sendRuntimeMessage({
                type: "fail-evidence-run",
                runId: evidenceRunId,
                status: "cancelled",
              });
            }
            if (isCurrentRunSource()) {
              resumableRuns.current.set(lensId, {
                done: completedChunks,
                total: chunks.length,
                findings: [...mergedFindings],
              });
              markLensRunStopped(lensId, [...mergedFindings], {
                done: completedChunks,
                total: chunks.length,
              });
            }
            continue;
          }

          const message = formatError(error);
          if (evidenceRunId) {
            void sendRuntimeMessage({
              type: "fail-evidence-run",
              runId: evidenceRunId,
              status: "failed",
              error: message,
            });
          }
          if (isCurrentRunSource()) {
            markLensRunsFailed([lensId], message);
            showWarning(describeLensRunError(message));
          }
          continue;
        } finally {
          if (activeChunkControllers.current.get(lensId) === controller) {
            activeChunkControllers.current.delete(lensId);
          }
        }
      }

      await loadLensFindings();
    },
    [
      activeLens,
      activeEvidenceBaseId,
      activeTabId,
      loadLensFindings,
      markLensRunStopped,
      markLensRunsCompleted,
      markLensRunsFailed,
      onSourceCaptured,
      setLensRunProgress,
      showWarning,
      source,
      transcript,
      trackedLensIdSet,
    ]
  );

  const retryLensRun = useCallback(
    async (lensId: string) => {
      await runLensIdsChunked([lensId]);
    },
    [runLensIdsChunked]
  );

  // Picks up a stopped run at the first uninspected chunk, carrying its
  // partial findings forward; falls back to a full run when nothing is
  // resumable (persisted cancelled runs, changed source).
  const resumeLensRun = useCallback(
    async (lensId: string) => {
      await runLensIdsChunked([lensId], { resume: true });
    },
    [runLensIdsChunked]
  );

  useEffect(() => {
    void loadLensFindings();
  }, [loadLensFindings]);

  useEffect(() => {
    for (const controller of activeChunkControllers.current.values()) {
      controller.abort();
    }
    activeChunkControllers.current.clear();
    resumableRuns.current.clear();
    setClientSections({});
  }, [source?.key]);

  useEffect(
    () => () => {
      findingsLoadRequestIdRef.current += 1;
      for (const controller of activeChunkControllers.current.values()) {
        controller.abort();
      }
      activeChunkControllers.current.clear();
    },
    []
  );

  return {
    allSections,
    sections,
    firstFailedLensId,
    loadLensFindings,
    markLensRunsStarted,
    markLensRunsCompleted,
    markLensRunsFailed,
    runLensIdsChunked,
    cancelLensRun,
    retryLensRun,
    resumeLensRun,
    openOptionsPage,
  };
}

function mergeLensSections({
  persistedSections,
  clientSections,
  activeLens,
  lensIds,
}: {
  persistedSections: LensSectionModel[];
  clientSections: Record<string, LensSectionModel>;
  activeLens: ActiveCustomLens | null;
  lensIds: string[];
}): LensSectionModel[] {
  const byId = new Map(persistedSections.map((section) => [section.lensId, section]));

  for (const clientSection of Object.values(clientSections)) {
    const persisted = byId.get(clientSection.lensId);
    if (clientSection.clientStatus === "completed" && persisted) continue;
    byId.set(clientSection.lensId, clientSection);
  }

  if (activeLens) {
    const persisted = byId.get(activeLens.lensId);
    if (activeLens.status === "completed" && persisted) {
      byId.set(activeLens.lensId, {
        ...persisted,
        name: activeLens.name,
        promotable: canPromote(activeLens),
      });
    } else {
      byId.set(activeLens.lensId, {
        lensId: activeLens.lensId,
        name: activeLens.name,
        clientStatus: activeLens.status,
        findings: [],
        promotable: canPromote(activeLens),
      });
    }
  }

  const orderedIds = [...lensIds];
  if (activeLens && !orderedIds.includes(activeLens.lensId)) {
    orderedIds.unshift(activeLens.lensId);
  }
  for (const lensId of Object.keys(clientSections)) {
    if (!orderedIds.includes(lensId)) orderedIds.push(lensId);
  }

  return orderedIds
    .map((lensId) => byId.get(lensId))
    .filter((section): section is LensSectionModel => !!section);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function createAbortError(): Error {
  const error = new Error("Stopped");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function failedClientRun(lensId: string, error?: string): LensRunState {
  return {
    runId: `client:${lensId}:${Date.now()}`,
    lensId,
    status: "failed",
    error,
    createdAt: Date.now(),
    findingCount: 0,
    findings: [],
  };
}

export function describeLensRunError(error?: string): string {
  const raw = (error ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("api key")) {
    if (lower.includes("openai")) return "No OpenAI API key set. Add your key in Settings.";
    return "No Anthropic API key set. Add your key in Settings.";
  }
  if (lower.includes("convex url")) {
    return "Backend not configured. Set the Convex URL in Settings.";
  }
  if (lower.includes("api error (401)") || lower.includes("api error (403)")) {
    return "The model provider rejected the request. Check your API key in Settings.";
  }
  if (lower.includes("api error (429)") || lower.includes("rate limit")) {
    return "The model provider is rate limiting requests. Wait a moment, then retry.";
  }
  if (lower.includes("schema") || lower.includes("parse") || lower.includes("validation")) {
    return "The model response did not match the lens format. Retry, or inspect technical details.";
  }
  if (
    lower.includes("receiving end does not exist") ||
    lower.includes("could not establish connection")
  ) {
    return "Could not reach the page. Reload it, then run again.";
  }
  return raw || "The lens run failed.";
}

export function shouldOfferSettings(error?: string): boolean {
  const lower = (error ?? "").toLowerCase();
  return (
    lower.includes("api key") ||
    lower.includes("convex url") ||
    lower.includes("api error (401)") ||
    lower.includes("api error (403)")
  );
}
