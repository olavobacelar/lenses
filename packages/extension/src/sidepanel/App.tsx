import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initTheme } from "../lib/theme";
import type { ExtractedClaim } from "../types/claims";
import { Header } from "./components/Header";
import { EvidenceBaseBar } from "./components/EvidenceBaseBar";
import { ApiKeyBanner, WarningBanner } from "./components/Banners";
import { ClaimsSection } from "./components/ClaimsSection";
import { LensSections } from "./components/LensSections";
import { CustomLensToast } from "./components/CustomLensToast";
import { SourceSection, type PdfJumpRequest } from "./components/SourceSection";
import { ChatDock } from "./components/ChatDock";
import { FileWarningIcon } from "./components/Icons";
import { useActiveSource, type SourceLoadError } from "./hooks/useActiveSource";
import { useApiKeyStatus } from "./hooks/useApiKeyStatus";
import { useAttachments } from "./hooks/useAttachments";
import { useChat } from "./hooks/useChat";
import { useControlBay } from "./hooks/useControlBay";
import { useCustomLenses } from "./hooks/useCustomLenses";
import { useChatDockReservation } from "./hooks/useChatDockReservation";
import { useLensRuns } from "./hooks/useLensRuns";
import { useEvidenceBases } from "./hooks/useEvidenceBases";
import { useEvidenceCapture } from "./hooks/useEvidenceCapture";
import { usePendingLensRun } from "./hooks/usePendingLensRun";
import { useSlideExport } from "./hooks/useSlideExport";
import { canPromote } from "../lib/custom-lens";
import { isAppModeChangedMessage } from "../lib/app-mode";
import type { UnsupportedSourcePage } from "../lib/source-panel-url";
import { CLAIM_EXTRACTOR_LENS_ID } from "./constants";
import { openEvidenceBaseLibrary, openOptionsPage, sendToActiveTab } from "./lib/chrome";
import { canRunClaimExtractor, lensFindingToClaim } from "./lib/claims";
import { formatError } from "./lib/format";
import type { PanelMessage } from "./types";

const CLAIMS_LENS_IDS = [CLAIM_EXTRACTOR_LENS_ID] as const;

export function App() {
  const [warning, setWarning] = useState("");
  const [openSection, setOpenSection] = useState("");
  const [pdfJump, setPdfJump] = useState<PdfJumpRequest | null>(null);
  const [chatDraft, setChatDraft] = useState({ id: 0, text: "" });
  const [hiddenHighlightLensIds, setHiddenHighlightLensIds] = useState<string[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const accordionRef = useRef<HTMLDivElement>(null);

  const showWarning = useCallback((message: string) => setWarning(message), []);
  const hideWarning = useCallback(() => setWarning(""), []);
  const stageChatDraft = useCallback((text: string) => {
    setChatDraft({ id: Date.now(), text });
  }, []);

  useEffect(() => {
    initTheme({ fastCache: true });
  }, []);

  const sourceState = useActiveSource({ showWarning, hideWarning });
  const {
    activeTabId,
    source,
    sourceError,
    transcript,
    currentTime,
    isLoadingSource,
    unsupportedPage,
    loadActiveSource,
    seekTo: seekToSource,
  } = sourceState;
  const evidenceBases = useEvidenceBases({ showWarning });
  const evidenceCapture = useEvidenceCapture({
    activeEvidenceBaseId: evidenceBases.activeEvidenceBaseId,
    activeEvidenceBaseTitle: evidenceBases.activeEvidenceBase?.title,
    sourceKey: source?.key,
    onError: showWarning,
  });
  const apiKey = useApiKeyStatus();
  const attachments = useAttachments({
    activeTabId,
    source,
    showWarning,
  });
  const chat = useChat({
    activeTabId,
    source,
    transcript,
    currentTime,
    showWarning,
    onApiKeyMissing: apiKey.markMissingApiKey,
    onDraft: stageChatDraft,
  });
  // Owns the one-off-lens lifecycle; declared before useLensRuns so its extra
  // lens ids/names feed the findings fetch that renders the accordion sections.
  const customLenses = useCustomLenses({ showWarning });
  const lensRuns = useLensRuns({
    source,
    transcript,
    activeTabId,
    showWarning,
    extraLensIds: customLenses.extraLensIds,
    dedicatedLensIds: CLAIMS_LENS_IDS,
    lensNames: customLenses.lensNames,
    activeLens: customLenses.activeLens,
    activeEvidenceBaseId: evidenceBases.activeEvidenceBaseId,
    onSourceCaptured: evidenceCapture.handleCaptured,
  });
  const claimSection = lensRuns.allSections.find(
    (section) => section.lensId === CLAIM_EXTRACTOR_LENS_ID
  );
  const claimFindings = claimSection?.findings;
  const extractedClaims = useMemo(
    () => (claimFindings ?? []).map(lensFindingToClaim),
    [claimFindings]
  );
  const isExtractingClaims = claimSection?.clientStatus === "running";
  const claimProgress = {
    current: claimSection?.chunkProgress?.done ?? 0,
    total: claimSection?.chunkProgress?.total ?? 0,
  };
  const claimStatus =
    claimSection?.clientStatus === "stopped" || claimSection?.run?.status === "cancelled"
      ? "Stopped"
      : claimSection?.run?.status === "failed"
        ? "Failed"
        : extractedClaims.length > 0
          ? `${extractedClaims.length} found`
          : "";
  const slides = useSlideExport({
    source,
    showWarning,
  });

  const refreshFindings = useCallback(async () => {
    await lensRuns.loadLensFindings();
  }, [lensRuns.loadLensFindings]);

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isAppModeChangedMessage(message)) return;

      hideWarning();
      lensRuns.cancelLensRun(CLAIM_EXTRACTOR_LENS_ID);
      setOpenSection("");
      setHiddenHighlightLensIds([]);
      void apiKey.checkApiKey().catch(() => undefined);
      void customLenses.refreshForAppModeChange().catch((error) => {
        showWarning(formatError(error));
      });
      void chat.restoreMessages().catch(() => undefined);
      void loadActiveSource(true)
        .then(() => refreshFindings())
        .catch((error) => showWarning(formatError(error)));
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [
    apiKey.checkApiKey,
    chat.restoreMessages,
    customLenses.refreshForAppModeChange,
    hideWarning,
    lensRuns.cancelLensRun,
    loadActiveSource,
    refreshFindings,
    showWarning,
  ]);

  // Bound at call time (not capture time) so the one-off flow can refresh the
  // accordion once its run completes without useCustomLenses depending on
  // lensRuns — breaking the hook cycle.
  const onCreateLens = useCallback(
    (instruction: string, options?: { storePageLenses?: boolean }) =>
      customLenses.createFromInstruction(instruction, refreshFindings, options),
    [customLenses.createFromInstruction, refreshFindings]
  );

  const runSidebarLensIds = useCallback(
    async (
      lensIds: readonly string[],
      options?: { storePageLenses?: boolean }
    ) => {
      await lensRuns.runLensIdsChunked(lensIds, options);
    },
    [lensRuns.runLensIdsChunked]
  );

  const controlBay = useControlBay({
    sendChat: (question) => chat.sendChat(question),
    refreshFindings,
    showWarning,
    onLensRunStart: lensRuns.markLensRunsStarted,
    onLensRunComplete: lensRuns.markLensRunsCompleted,
    onLensRunError: lensRuns.markLensRunsFailed,
    onRunLensIds: runSidebarLensIds,
    onCreateLens,
    userLenses: customLenses.userLenses,
  });

  usePendingLensRun({
    activeTabId,
    sourceReady: !!source,
    isRunning: controlBay.isRunning,
    runPendingLensRun: controlBay.runPendingLensRun,
    showWarning,
  });

  const promoteActive = useCallback(() => {
    customLenses.promoteActive().catch((error) => showWarning(formatError(error)));
  }, [customLenses, showWarning]);

  useEffect(() => {
    document.body.classList.toggle("unified", controlBay.isUnified);
    return () => document.body.classList.remove("unified");
  }, [controlBay.isUnified]);

  useEffect(() => {
    if (lensRuns.firstFailedLensId) setOpenSection(lensRuns.firstFailedLensId);
  }, [lensRuns.firstFailedLensId]);

  useEffect(() => {
    setHiddenHighlightLensIds([]);
    setPdfJump(null);
  }, [source?.key]);

  // Surface a freshly created one-off by expanding its section as it appears.
  const activeLensId = customLenses.activeLens?.lensId;
  useEffect(() => {
    if (activeLensId) setOpenSection(activeLensId);
  }, [activeLensId]);

  const toggleSection = useCallback((section: string) => {
    setOpenSection((current) => (current === section ? "" : section));
  }, []);

  const toggleLensHighlightVisibility = useCallback(
    (lensId: string) => {
      if (!activeTabId) {
        showWarning("No active tab.");
        return;
      }

      const isHidden = hiddenHighlightLensIds.includes(lensId);
      const nextHidden = !isHidden;
      setHiddenHighlightLensIds((current) =>
        nextHidden
          ? Array.from(new Set([...current, lensId]))
          : current.filter((id) => id !== lensId)
      );

      sendToActiveTab<{ ok?: boolean }>(
        activeTabId,
        {
          type: "set-lens-highlight-visibility",
          lensId,
          visible: isHidden,
        },
        false
      ).catch((error) => {
        setHiddenHighlightLensIds((current) =>
          isHidden
            ? Array.from(new Set([...current, lensId]))
            : current.filter((id) => id !== lensId)
        );
        showWarning(formatError(error));
      });
    },
    [activeTabId, hiddenHighlightLensIds, showWarning]
  );

  const seekTo = useCallback(
    (seconds: number) => {
      seekToSource(seconds).catch((error) => showWarning(formatError(error)));
    },
    [seekToSource, showWarning]
  );

  // A page chip navigates the panel's own copy of the PDF text (the extension
  // cannot scroll Chrome's built-in viewer): open the source section and hand
  // the scroll target to SourceSection. Date.now() makes repeat jumps to the
  // same page re-fire.
  const jumpToPdfPage = useCallback((pageNumber: number) => {
    setOpenSection("source");
    setPdfJump({ id: Date.now(), pageNumber });
  }, []);

  const sendFindingToChat = useCallback((text: string, quotes?: string[]) => {
    const quoteText = quotes && quotes.length > 0 ? `\n\nQuotes:\n${quotes.join("\n")}` : "";
    setChatDraft({
      id: Date.now(),
      text: `About this: "${text}"${quoteText}\n\n`,
    });
  }, []);

  const rewindMessageToComposer = useCallback(
    (message: PanelMessage) => {
      if (message.role !== "user") return;
      const rewound = chat.rewindToMessage(message.id);
      if (!rewound) return;
      attachments.restoreAttachments(message.screenshots ?? [], message.videoTimestamp);
      setChatDraft({
        id: Date.now(),
        text: message.content,
      });
    },
    [attachments, chat]
  );

  const retryMessage = useCallback(
    (message: PanelMessage) => {
      if (message.role !== "assistant") return;
      chat
        .retryFromMessage(message.id)
        .catch((error) => showWarning(formatError(error)));
    },
    [chat, showWarning]
  );

  const verifyClaim = useCallback(
    (claim: ExtractedClaim) => {
      const quoteText =
        claim.quotes.length > 0 ? `\n\nQuotes:\n${claim.quotes.join("\n")}` : "";
      chat
        .sendChat(`Verify this claim using the source and web search:\n\n${claim.claim}${quoteText}`)
        .catch((error) => showWarning(formatError(error)));
    },
    [chat, showWarning]
  );

  const reloadSource = useCallback(() => {
    loadActiveSource(true).catch((error) => showWarning(formatError(error)));
  }, [loadActiveSource, showWarning]);

  // Cap the sections so the composer + a sliver of chat history always fit.
  // Deps cover what changes the header/banner block above the accordion (which
  // shifts its top edge without resizing the panel).
  useChatDockReservation(panelRef, accordionRef, [
    unsupportedPage,
    sourceError,
    source?.key,
    warning,
    apiKey.hasApiKey,
    customLenses.created,
  ]);

  return (
    <main className="panel-shell" ref={panelRef}>
      {/* Top bar: the evidence base opens the panel as its workspace (first row),
          with the current page demoted to a secondary line directly beneath it. */}
      <div className="panel-topbar">
        <EvidenceBaseBar
          evidenceBases={evidenceBases.evidenceBases}
          activeEvidenceBaseId={evidenceBases.activeEvidenceBaseId}
          isLoading={evidenceBases.isLoading}
          sourceInBase={evidenceCapture.sourceInBase}
          onSelect={evidenceBases.setActiveEvidenceBaseId}
          onCreate={evidenceBases.createEvidenceBase}
          onOpenLibrary={() =>
            openEvidenceBaseLibrary(evidenceBases.activeEvidenceBaseId ?? undefined)
          }
          onOpenOptions={openOptionsPage}
          onError={showWarning}
        />
        <Header
          source={source}
          unsupportedPage={unsupportedPage}
          isLoading={isLoadingSource}
          onReload={reloadSource}
        />
      </div>
      <WarningBanner message={warning} />
      {evidenceCapture.toast ? (
        <div
          className="evidence-capture-toast"
          role="status"
          onClick={evidenceCapture.dismissToast}
        >
          <span>{evidenceCapture.toast}</span>
        </div>
      ) : null}
      {unsupportedPage ? (
        <UnsupportedPageState page={unsupportedPage} />
      ) : (
        <>
          <ApiKeyBanner visible={!apiKey.hasApiKey} onOpenSettings={apiKey.openApiKeySettings} />
          <CustomLensToast
            created={customLenses.created}
            canPromote={canPromote(customLenses.activeLens)}
            onPromote={promoteActive}
            onDismiss={customLenses.dismissCreated}
          />

          {sourceError ? (
            <SourceErrorState error={sourceError} onRetry={reloadSource} />
          ) : (
            <div className="accordion" ref={accordionRef}>
              <ClaimsSection
                claims={extractedClaims}
                status={slides.slideStatus ?? claimStatus}
                isExtracting={isExtractingClaims}
                progress={claimProgress}
                canExtract={!isLoadingSource && canRunClaimExtractor(source, transcript)}
                canToggleHighlights={
                  extractedClaims.length > 0 && !isExtractingClaims && !slides.slideStatus
                }
                isHighlightsHidden={hiddenHighlightLensIds.includes(CLAIM_EXTRACTOR_LENS_ID)}
                isOpen={openSection === "claims"}
                onToggle={() => toggleSection("claims")}
                onToggleHighlightVisibility={() =>
                  toggleLensHighlightVisibility(CLAIM_EXTRACTOR_LENS_ID)
                }
                onExtract={() => void runSidebarLensIds(CLAIMS_LENS_IDS)}
                onCancel={() => lensRuns.cancelLensRun(CLAIM_EXTRACTOR_LENS_ID)}
                onSeek={seekTo}
                onPageJump={jumpToPdfPage}
                onSendToChat={sendFindingToChat}
                onVerifyClaim={verifyClaim}
              />
              <LensSections
                sections={lensRuns.sections}
                openSection={openSection}
                hiddenHighlightLensIds={hiddenHighlightLensIds}
                onOpenSection={toggleSection}
                onToggleHighlightVisibility={toggleLensHighlightVisibility}
                onRetry={(lensId) => {
                  lensRuns.retryLensRun(lensId).catch((error) => showWarning(formatError(error)));
                }}
                onResume={(lensId) => {
                  lensRuns.resumeLensRun(lensId).catch((error) => showWarning(formatError(error)));
                }}
                onCancel={lensRuns.cancelLensRun}
                onRefresh={() => {
                  lensRuns.loadLensFindings().catch((error) => showWarning(formatError(error)));
                }}
                onOpenOptions={openOptionsPage}
                onSeek={seekTo}
                onPageJump={jumpToPdfPage}
                onSendToChat={sendFindingToChat}
                onPromote={promoteActive}
              />
              <SourceSection
                source={source}
                transcript={transcript}
                currentTime={currentTime}
                isOpen={openSection === "source"}
                onToggle={() => toggleSection("source")}
                onSeek={seekTo}
                pdfJump={pdfJump}
              />
            </div>
          )}

          <ChatDock
            source={source}
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            attachments={attachments.attachments}
            draft={chatDraft}
            modelControls={controlBay}
            exportingPipeline={slides.exportingPipeline}
            contextualChat={chat.contextualChat}
            onClearContext={chat.clearContextualChat}
            onSend={chat.sendChat}
            onClearChat={chat.clearChat}
            onRetryMessage={retryMessage}
            onRewindMessage={rewindMessageToComposer}
            onClearAttachments={attachments.clearAttachments}
            onRemoveAttachment={attachments.removeAttachment}
            onStageFile={attachments.stageFile}
            onCaptureScreenshot={attachments.captureScreenshot}
            onExportSlides={(pipeline) => void slides.exportSlides(pipeline)}
            onSeek={seekTo}
            onOpenApiKeys={chat.openApiKeySettings}
            showWarning={showWarning}
          />
        </>
      )}
    </main>
  );
}

function UnsupportedPageState({
  page,
}: {
  page: UnsupportedSourcePage;
}) {
  return (
    <section className="unsupported-source-state" aria-live="polite">
      <div>
        <h2>{page.title}</h2>
        <p>{page.message}</p>
      </div>
    </section>
  );
}

// Source ingestion failure (PDF over the 50 MB limit, HTTP error, page with
// no extractable text): a real state card in place of the sections, with the
// specific reason and a retry. Chat stays available below — only the
// source-bound sections are meaningless without a source.
function SourceErrorState({
  error,
  onRetry,
}: {
  error: SourceLoadError;
  onRetry: () => void;
}) {
  return (
    <section className="unsupported-source-state source-error-state" aria-live="polite">
      <div>
        <FileWarningIcon />
        <h2>Couldn&rsquo;t read this {error.kind === "pdf" ? "PDF" : "page"}</h2>
        <p>{error.message}</p>
        <button type="button" className="source-error-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    </section>
  );
}
