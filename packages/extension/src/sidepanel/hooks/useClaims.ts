import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime, parseTimestamp } from "../../lib/utils/time";
import {
  chunkInspectionPlan,
  transcriptTimestampBelongsToChunk,
} from "../../lib/source-segments";
import { isLocalByokMode, readAppAccessMode } from "../../lib/app-mode";
import type { ExtractedClaim } from "../../types/claims";
import type { TranscriptSegment } from "../../types/transcript";
import {
  CLAIM_EXTRACTOR_LENS,
  CLAIM_EXTRACTOR_LENS_ID,
} from "../constants";
import { sendRuntimeMessage } from "../lib/chrome";
import {
  dedupeClaims,
  lensFindingToClaim,
  lensFindingsToClaimsForChunk,
} from "../lib/claims";
import { formatError } from "../lib/format";
import {
  groundLensFindings,
  prepareSourceForLensRuns,
  serializeChunkRawResponses,
  type PreparedLensRunSource,
} from "../lib/lens-run-chunks";
import { parseLensRunsResponse } from "../schemas";
import type { LensRunsResponse, PanelSource, RunLensResponse } from "../types";

interface UseClaimsOptions {
  source: PanelSource | null;
  transcript: TranscriptSegment[];
  showWarning: (message: string) => void;
  activeEvidenceBaseId?: string | null;
  // Fired when extraction's evidence run captures the current source into the
  // active base; `added` is true only the first time this source enters it.
  onSourceCaptured?: (added: boolean) => void;
}

export function useClaims({
  source,
  transcript,
  showWarning,
  activeEvidenceBaseId = null,
  onSourceCaptured,
}: UseClaimsOptions) {
  const [claims, setClaims] = useState<ExtractedClaim[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const claimsRef = useRef<ExtractedClaim[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const activePortRef = useRef<chrome.runtime.Port | null>(null);
  const activeRunRequestIdRef = useRef<string | null>(null);
  const autoExtractedKeysRef = useRef(new Set<string>());
  const extractClaimsRef = useRef<(() => Promise<void>) | null>(null);

  const setClaimsSync = useCallback((next: ExtractedClaim[]) => {
    claimsRef.current = next;
    setClaims(next);
  }, []);

  const loadPersistedClaims = useCallback(
    async (targetSource = source): Promise<ExtractedClaim[]> => {
      if (!targetSource) return [];

      const result = parseLensRunsResponse(
        await sendRuntimeMessage<unknown>({
          type: "get-source-findings",
          sourceUrl: targetSource.url,
          sourceKey: targetSource.key,
          lensIds: [CLAIM_EXTRACTOR_LENS_ID],
        }).catch((): LensRunsResponse => ({}))
      );

      const completedRun = (result.runs ?? []).find(
        (run) =>
          run.lensId === CLAIM_EXTRACTOR_LENS_ID && run.status === "completed"
      );
      const findings =
        completedRun?.findings ?? result.byLens?.[CLAIM_EXTRACTOR_LENS_ID] ?? [];
      const nextClaims = findings.map(lensFindingToClaim);
      setClaimsSync(nextClaims);
      return nextClaims;
    },
    [setClaimsSync, source]
  );

  const persistClaimsAsFindings = useCallback(
    async (
      nextClaims: ExtractedClaim[],
      prepared: PreparedLensRunSource,
      rawResponse?: string,
      runId?: string,
      modelUsed?: string
    ) => {
      if (!source) return;

      const findings = nextClaims.map((claim) => ({
        text: claim.claim,
        category: claim.category,
        detail: "Extracted from the transcript.",
        confidence: 1,
        anchor: {
          kind: "transcript" as const,
          timestamp: parseTimestamp(claim.timestamp),
          formatted: claim.timestamp,
        },
        quotes: claim.quotes,
      }));
      const grounded = await groundLensFindings(findings, prepared);

      const saved = await sendRuntimeMessage<{ error?: string }>({
        type: "save-findings",
        runId,
        lensId: CLAIM_EXTRACTOR_LENS_ID,
        sourceUrl: source.url,
        sourceKey: source.key,
        sourceKind: source.kind,
        sourceTitle: source.title,
        sourceExternalId: source.videoId,
        sourceMetadata: source.sourceMetadata,
        modelUsed,
        rawResponse,
        evidenceBaseId: activeEvidenceBaseId ?? undefined,
        fingerprint: prepared.fingerprint,
        evidenceRefs: grounded.evidenceRefs,
        findings: grounded.findings,
      });
      if (saved.error) throw new Error(saved.error);
    },
    [activeEvidenceBaseId, source]
  );

  const cancelExtraction = useCallback(() => {
    controllerRef.current?.abort();
    activePortRef.current?.disconnect();
    activePortRef.current = null;
    const runRequestId = activeRunRequestIdRef.current;
    if (runRequestId) {
      void sendRuntimeMessage({ type: "cancel-run-request", runRequestId });
    }
    setStatusOverride(claimsRef.current.length > 0 ? `${claimsRef.current.length} found` : "Stopped");
  }, []);

  const extractLocalClaimsForChunk = useCallback(
    (
      chunkText: string,
      startTime: string,
      endTime: string,
      previousClaims: string[],
      signal: AbortSignal
    ): Promise<{ claims: ExtractedClaim[]; rawResponse?: string }> =>
      new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(createClaimsExtractionAbortError());
          return;
        }

        const port = chrome.runtime.connect({ name: "claude-stream" });
        activePortRef.current = port;
        let settled = false;

        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          if (activePortRef.current === port) {
            activePortRef.current = null;
          }
        };

        const finish = (value: { claims: ExtractedClaim[]; rawResponse?: string }) => {
          if (settled) return;
          settled = true;
          cleanup();
          port.disconnect();
          resolve(value);
        };

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          port.disconnect();
          reject(error);
        };

        const onAbort = () => {
          fail(createClaimsExtractionAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });

        port.onMessage.addListener((event) => {
          if (event.type === "chunkClaimsDone") {
            finish({
              claims: Array.isArray(event.claims) ? event.claims : [],
              rawResponse: typeof event.rawResponse === "string" ? event.rawResponse : undefined,
            });
          }
          if (event.type === "chunkClaimsError") {
            fail(new Error(event.error ?? "Claim extraction failed."));
          }
        });

        port.onDisconnect.addListener(() => {
          chrome.runtime.lastError;
        });

        port.postMessage({
          action: "extractChunkClaims",
          chunkText,
          startTime,
          endTime,
          videoTitle: source?.title ?? "",
          previousClaims,
        });
      }),
    [source?.title]
  );

  const extractManagedClaimsForChunk = useCallback(
    async (
      chunk: PreparedLensRunSource["chunks"][number],
      signal: AbortSignal,
      runRequestId: string
    ): Promise<{ claims: ExtractedClaim[]; rawResponse?: string; modelUsed?: string }> => {
      if (!source) return { claims: [] };
      const result = await runManagedClaimRequestWithRetry(
        () =>
          withClaimsExtractionAbort(
            sendRuntimeMessage<RunLensResponse>({
              type: "run",
              lensId: CLAIM_EXTRACTOR_LENS_ID,
              text: chunk.text,
              sourceUrl: source.url,
              sourceKey: source.key,
              sourceKind: source.kind,
              sourceTitle: source.title,
              scope: source.scope,
              runRequestId,
              persist: false,
            }),
            signal
          ),
        signal
      );
      if (result.cancelled) throw createClaimsExtractionAbortError();
      if (result.error) throw new Error(result.error);
      return {
        claims: lensFindingsToClaimsForChunk(result.findings ?? [], chunk),
        rawResponse: result.rawResponse,
        modelUsed: result.modelUsed,
      };
    },
    [source]
  );

  const extractClaims = useCallback(async () => {
    if (!source || transcript.length === 0 || isExtracting) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsExtracting(true);
    setProgress({ current: 0, total: 0 });
    setStatusOverride(null);
    setClaimsSync([]);
    let statusAfterFinish: string | null = null;
    let evidenceRunId: string | undefined;
    let modelUsed: string | undefined;
    const localByok = isLocalByokMode(await readAppAccessMode());
    const runRequestId = localByok ? null : crypto.randomUUID();
    activeRunRequestIdRef.current = runRequestId;

    try {
      const prepared = await prepareSourceForLensRuns(source, transcript);
      const chunks = prepared.chunks;
      if (activeEvidenceBaseId) {
        const started = await sendRuntimeMessage<{
          runId?: string;
          evidenceBaseSourceAdded?: boolean;
          error?: string;
        }>({
          type: "start-evidence-run",
          lensId: CLAIM_EXTRACTOR_LENS_ID,
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
        if (started.error || !started.runId) {
          throw new Error(started.error || "Could not start evidence run");
        }
        evidenceRunId = started.runId;
        onSourceCaptured?.(started.evidenceBaseSourceAdded === true);
      }
      if (chunks.length === 0) throw new Error("No transcript text available.");
      setProgress({ current: 0, total: chunks.length });
      const found: ExtractedClaim[] = [];
      const rawResponses: Array<{ chunkIndex: number; rawResponse: string }> = [];
      let cancelled = false;

      for (let index = 0; index < chunks.length; index++) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }

        const chunk = chunks[index];
        setProgress({ current: index + 1, total: chunks.length });

        let chunkResult: {
          claims: ExtractedClaim[];
          rawResponse?: string;
          modelUsed?: string;
        };
        try {
          if (localByok) {
            const bounds = transcriptChunkBounds(chunk);
            chunkResult = await extractLocalClaimsForChunk(
              chunk.text,
              formatTime(bounds.start),
              formatTime(bounds.end),
              [],
              controller.signal
            );
          } else {
            chunkResult = await extractManagedClaimsForChunk(
              chunk,
              controller.signal,
              runRequestId!
            );
          }
        } catch (error) {
          if (isClaimsExtractionAbort(error) || controller.signal.aborted) {
            cancelled = true;
            break;
          }
          throw error;
        }

        const chunkClaims = chunkResult.claims.filter((claim) =>
          transcriptTimestampBelongsToChunk(chunk, parseTimestamp(claim.timestamp))
        );
        if (typeof chunkResult.rawResponse === "string") {
          rawResponses.push({ chunkIndex: index, rawResponse: chunkResult.rawResponse });
        }
        modelUsed = chunkResult.modelUsed ?? modelUsed;
        found.push(...dedupeClaims(chunkClaims, found));
        if (evidenceRunId) {
          const coverage = await sendRuntimeMessage<{ error?: string }>({
            type: "mark-evidence-run-chunk",
            runId: evidenceRunId,
            chunkIndex: index,
            status: "completed",
          });
          if (coverage.error) throw new Error(coverage.error);
        }
        setClaimsSync([...found]);
      }

      if (cancelled || controller.signal.aborted) {
        if (evidenceRunId) {
          await sendRuntimeMessage({
            type: "fail-evidence-run",
            runId: evidenceRunId,
            status: "cancelled",
          }).catch(() => undefined);
        }
        statusAfterFinish = found.length > 0 ? `${found.length} found` : "Stopped";
        return;
      }

      await persistClaimsAsFindings(
        found,
        prepared,
        serializeChunkRawResponses(rawResponses, chunks.length),
        evidenceRunId,
        modelUsed
      );
    } catch (error) {
      const message = formatError(error);
      if (evidenceRunId) {
        await sendRuntimeMessage({
          type: "fail-evidence-run",
          runId: evidenceRunId,
          status: "failed",
          error: message,
        }).catch(() => undefined);
      }
      showWarning(message);
    } finally {
      setIsExtracting(false);
      if (controllerRef.current === controller) controllerRef.current = null;
      if (activeRunRequestIdRef.current === runRequestId) {
        activeRunRequestIdRef.current = null;
      }
      setProgress({ current: 0, total: 0 });
      if (statusAfterFinish) setStatusOverride(statusAfterFinish);
    }
  }, [
    extractManagedClaimsForChunk,
    extractLocalClaimsForChunk,
    isExtracting,
    persistClaimsAsFindings,
    setClaimsSync,
    showWarning,
    source,
    transcript,
    activeEvidenceBaseId,
    onSourceCaptured,
  ]);

  useEffect(() => {
    extractClaimsRef.current = extractClaims;
  }, [extractClaims]);

  useEffect(() => {
    let cancelled = false;
    setClaimsSync([]);
    setStatusOverride(null);
    setProgress({ current: 0, total: 0 });

    async function restoreAndMaybeExtract() {
      if (!source) return;
      const persisted = await loadPersistedClaims(source);
      if (cancelled || persisted.length > 0) return;
      if (CLAIM_EXTRACTOR_LENS.runMode !== "auto") return;
      if (source.kind !== "youtube_video" || transcript.length === 0) return;
      if (autoExtractedKeysRef.current.has(source.key)) return;

      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (cancelled) return;
      if (autoExtractedKeysRef.current.has(source.key)) return;
      autoExtractedKeysRef.current.add(source.key);
      await extractClaimsRef.current?.();
    }

    void restoreAndMaybeExtract();
    return () => {
      cancelled = true;
    };
  }, [loadPersistedClaims, setClaimsSync, source, transcript.length]);

  const canExtract =
    !!source && source.kind === "youtube_video" && transcript.length > 0;
  const status = statusOverride ?? (claims.length > 0 ? `${claims.length} found` : "");

  return {
    claims,
    isExtracting,
    progress,
    status,
    canExtract,
    extractClaims,
    cancelExtraction,
    loadPersistedClaims,
  };
}

function isClaimsExtractionAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createClaimsExtractionAbortError(): Error {
  const error = new Error("Claims extraction stopped");
  error.name = "AbortError";
  return error;
}

function withClaimsExtractionAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createClaimsExtractionAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createClaimsExtractionAbortError());
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

async function runManagedClaimRequestWithRetry(
  request: () => Promise<RunLensResponse>,
  signal: AbortSignal
): Promise<RunLensResponse> {
  let lastResult: RunLensResponse | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await request();
      if (!result.error || !isRetryableClaimsTransportError(result.error) || attempt === 1) {
        return result;
      }
      lastResult = result;
    } catch (error) {
      if (signal.aborted || !isRetryableClaimsTransportError(error) || attempt === 1) {
        throw error;
      }
    }

    await waitForClaimsRetry(signal, 750);
  }

  return lastResult ?? { error: "Failed to fetch" };
}

function isRetryableClaimsTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "Failed to fetch" || message.includes("NetworkError when attempting to fetch");
}

function waitForClaimsRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.reject(createClaimsExtractionAbortError());

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(createClaimsExtractionAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function transcriptChunkBounds(chunk: PreparedLensRunSource["chunks"][number]): {
  start: number;
  end: number;
} {
  const anchors = chunk.mappings
    .map((mapping) => mapping.anchor)
    .filter((anchor) => anchor.kind === "transcript");
  if (anchors.length === 0) return { start: 0, end: 0 };
  return {
    start: anchors[0].timestamp,
    end: Math.max(...anchors.map((anchor) => anchor.timestamp + (anchor.duration ?? 0))),
  };
}
