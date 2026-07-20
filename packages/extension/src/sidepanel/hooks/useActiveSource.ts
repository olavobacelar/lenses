import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUnsupportedSourcePage,
  type UnsupportedSourcePage,
} from "../../lib/source-panel-url";
import { fingerprintText } from "../../lib/evidence-bases";
import { fetchPdfSource, resolvePdfUrl } from "../../lib/pdf-source";
import type { TranscriptSegment, VideoTime } from "../../types/transcript";
import { getActiveTab, sendToActiveTab } from "../lib/chrome";
import { isYouTubeVideoUrl, transcriptToText } from "../lib/format";
import { parsePageTextResponse, parseTranscriptResponse } from "../schemas";
import type { PanelSource } from "../types";

interface UseActiveSourceOptions {
  showWarning: (message: string) => void;
  hideWarning: () => void;
}

/** A source that was recognized but could not be ingested: PDFs that exceed
 *  the 50 MB limit or fail to fetch, and pages that yield no extractable
 *  text. Rendered as a dedicated state card instead of only a warning
 *  banner. */
export interface SourceLoadError {
  kind: "pdf" | "page";
  message: string;
}

export function useActiveSource({ showWarning, hideWarning }: UseActiveSourceOptions) {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [source, setSource] = useState<PanelSource | null>(null);
  const [sourceError, setSourceError] = useState<SourceLoadError | null>(null);
  const [unsupportedPage, setUnsupportedPage] = useState<UnsupportedSourcePage | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentTime, setCurrentTime] = useState<VideoTime | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  const loadRequestIdRef = useRef(0);
  const reloadTimerRef = useRef<number | null>(null);

  const loadActiveSource = useCallback(
    async (force: boolean) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const isLatest = () => loadRequestIdRef.current === requestId;

      hideWarning();
      setIsLoadingSource(true);

      try {
        const tab = await getActiveTab();
        if (!isLatest()) return;

        const tabId = tab.id ?? null;
        if (!tabId || !tab.url) throw new Error("No active tab.");

        // Ingestion failures (50 MB limit, HTTP errors) become a dedicated
        // error state with a Retry, not just a warning banner. Scanned PDFs
        // are not warned about here — the source section marks OCR-required
        // pages inline, where the reader can see which pages are affected.
        const loadPdfSource = async (pdfUrl: string) => {
          try {
            const pdf = await fetchPdfSource(pdfUrl, tab.title ?? "PDF document");
            if (!isLatest()) return;
            setSource({
              key: `pdf:url:${pdfUrl}`,
              kind: "pdf",
              title: pdf.title,
              url: pdfUrl,
              text: pdf.text,
              scope: "page",
              sourceMetadata: {
                origin: "url",
                pageCount: String(pdf.pageCount),
              },
              fingerprint: pdf.fingerprint,
              pdfPages: pdf.pages,
            });
            setActiveTabId(tabId);
            setSourceError(null);
            setUnsupportedPage(null);
            setTranscript([]);
            setCurrentTime(null);
            setIsLoadingSource(false);
          } catch (error) {
            if (!isLatest()) return;
            setActiveTabId(tabId);
            setSource(null);
            setSourceError({ kind: "pdf", message: formatLoadError(error) });
            setUnsupportedPage(null);
            setTranscript([]);
            setCurrentTime(null);
            setIsLoadingSource(false);
          }
        };

        const pdfUrl = resolvePdfUrl(tab.url, tab.title);
        if (pdfUrl) {
          await loadPdfSource(pdfUrl);
          return;
        }

        const nextUnsupportedPage = getUnsupportedSourcePage(tab);
        if (nextUnsupportedPage) {
          setActiveTabId(tabId);
          setSource(null);
          setSourceError(null);
          setUnsupportedPage(nextUnsupportedPage);
          setTranscript([]);
          setCurrentTime(null);
          setIsLoadingSource(false);
          return;
        }

        const pageResponse = parsePageTextResponse(
          await sendToActiveTab<unknown>(tabId, { type: "get-page-text", force }, true)
        );
        if (!isLatest()) return;

        // PDFs served from extensionless URLs (arXiv's canonical /pdf/<id>
        // links) defeat the URL fast path above; the content script running in
        // Chrome's PDF embedder page still reports the real content type, so
        // such tabs are rerouted to PDF ingestion here.
        if (pageResponse.contentType === "application/pdf") {
          await loadPdfSource(tab.url);
          return;
        }

        const isYouTube =
          isYouTubeVideoUrl(tab.url) || pageResponse.sourceKind === "youtube_video";

        if (isYouTube) {
          const transcriptResponse = parseTranscriptResponse(
            await sendToActiveTab<unknown>(
              tabId,
              { action: force ? "refreshTranscript" : "getTranscript", force },
              true
            )
          );
          if (!isLatest()) return;

          const nextTranscript = transcriptResponse.transcript ?? [];
          const transcriptText = transcriptToText(nextTranscript);
          const sourceText = transcriptText || pageResponse.text || "";
          const fingerprint = await fingerprintText(
            nextTranscript.length > 0
              ? nextTranscript.map((segment) => segment.text).join("\n")
              : sourceText
          );
          if (!isLatest()) return;
          setActiveTabId(tabId);
          setSourceError(null);
          setUnsupportedPage(null);
          setTranscript(nextTranscript);
          setCurrentTime(null);
          setSource({
            key: transcriptResponse.videoId
              ? `youtube:${transcriptResponse.videoId}`
              : pageResponse.sourceKey ?? `url:${tab.url}`,
            kind: "youtube_video",
            title:
              transcriptResponse.metadata?.title ||
              pageResponse.sourceTitle ||
              tab.title ||
              "YouTube video",
            url: tab.url,
            text: sourceText,
            scope: nextTranscript.length > 0 ? "transcript" : "page",
            videoId: transcriptResponse.videoId ?? undefined,
            metadata: transcriptResponse.metadata,
            sourceMetadata: transcriptResponse.metadata?.channel
              ? { channel: transcriptResponse.metadata.channel }
              : undefined,
            fingerprint,
          });
        } else {
          const sourceText = pageResponse.text ?? "";

          // A page that yields no text gets the error card at load time; a
          // silent empty source would only surface once a run or chat send
          // trips over it.
          if (!sourceText.trim()) {
            setActiveTabId(tabId);
            setSource(null);
            setSourceError({
              kind: "page",
              message: "No text could be extracted from this page.",
            });
            setUnsupportedPage(null);
            setTranscript([]);
            setCurrentTime(null);
            setIsLoadingSource(false);
            return;
          }

          const fingerprint = await fingerprintText(sourceText);
          if (!isLatest()) return;
          setActiveTabId(tabId);
          setSourceError(null);
          setUnsupportedPage(null);
          setTranscript([]);
          setCurrentTime(null);
          setSource({
            key: pageResponse.sourceKey ?? `url:${tab.url}`,
            kind: "web_page",
            // Empty-string titles are real responses (frameset pages, viewer
            // shells), so fall through on blank, not just on missing.
            title: pageResponse.sourceTitle?.trim() || tab.title?.trim() || "Untitled",
            url: tab.url,
            text: sourceText,
            scope: pageResponse.scope ?? "page",
            sourceMetadata: sourceMetadataForUrl(tab.url),
            fingerprint,
          });
        }

        setIsLoadingSource(false);
      } catch (error) {
        if (!isLatest()) return;
        setIsLoadingSource(false);
        throw error;
      }
    },
    [hideWarning]
  );

  const reloadActiveSourceSoon = useCallback(() => {
    if (reloadTimerRef.current != null) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      loadActiveSource(false).catch((error) => showWarning(formatLoadError(error)));
    }, 150);
  }, [loadActiveSource, showWarning]);

  const updateCurrentTime = useCallback(async () => {
    if (!activeTabId || source?.kind !== "youtube_video") {
      setCurrentTime(null);
      return;
    }
    const result = await sendToActiveTab<{ time?: VideoTime | null }>(
      activeTabId,
      { action: "getCurrentTime" },
      false
    );
    setCurrentTime(result.time ?? null);
  }, [activeTabId, source?.kind]);

  const seekTo = useCallback(
    async (seconds: number) => {
      if (!activeTabId || source?.kind !== "youtube_video") return;
      await sendToActiveTab<{ success?: boolean }>(
        activeTabId,
        { action: "seekTo", seconds },
        false
      );
    },
    [activeTabId, source?.kind]
  );

  useEffect(() => {
    loadActiveSource(false).catch((error) => showWarning(formatLoadError(error)));
  }, [loadActiveSource, showWarning]);

  useEffect(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.tabs?.onActivated ||
      !chrome.tabs?.onUpdated
    ) {
      return;
    }

    const handleActivated = () => {
      reloadActiveSourceSoon();
    };

    const handleUpdated = (tabId: number, changeInfo: { url?: string; status?: string }) => {
      if (activeTabId == null || tabId !== activeTabId) return;
      if (changeInfo.url || changeInfo.status === "complete") {
        reloadActiveSourceSoon();
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [activeTabId, reloadActiveSourceSoon]);

  useEffect(() => {
    return () => {
      loadRequestIdRef.current += 1;
      if (reloadTimerRef.current != null) {
        window.clearTimeout(reloadTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void updateCurrentTime().catch(() => undefined);
    const timer = window.setInterval(() => {
      updateCurrentTime().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [updateCurrentTime]);

  return {
    activeTabId,
    source,
    sourceError,
    transcript,
    currentTime,
    isLoadingSource,
    unsupportedPage,
    loadActiveSource,
    seekTo,
  };
}

function formatLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceMetadataForUrl(rawUrl: string): Record<string, string> | undefined {
  try {
    return { host: new URL(rawUrl).hostname };
  } catch {
    return undefined;
  }
}
