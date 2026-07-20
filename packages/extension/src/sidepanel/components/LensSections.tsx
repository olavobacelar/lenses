import * as Collapsible from "@radix-ui/react-collapsible";
import type { KeyboardEvent, MouseEvent } from "react";
import { LENS_META } from "../constants";
import type { LensFinding, LensRunState } from "../types";
import type { LensChunkProgress, LensSectionModel } from "../hooks/useLensRuns";
import { describeLensRunError, shouldOfferSettings } from "../hooks/useLensRuns";
import {
  reusedRunLabel,
  sectionCountLabel,
  sectionStatusClass,
  stoppedNoticeMessage,
  stoppedResumeAction,
  type StoppedResumeVariant,
} from "../lib/lens-run-lifecycle";
import { FindingView } from "./FindingView";
import { StopIcon } from "./Icons";

interface LensSectionsProps {
  sections: LensSectionModel[];
  openSection: string;
  hiddenHighlightLensIds: string[];
  onOpenSection: (section: string) => void;
  onToggleHighlightVisibility: (lensId: string) => void;
  onRetry: (lensId: string) => void;
  onResume: (lensId: string) => void;
  onCancel: (lensId: string) => void;
  onRefresh: () => void;
  onOpenOptions: () => void;
  onSeek: (seconds: number) => void;
  onPageJump: (pageNumber: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
  onPromote: () => void;
}

export function LensSections({
  sections,
  openSection,
  hiddenHighlightLensIds,
  onOpenSection,
  onToggleHighlightVisibility,
  onRetry,
  onResume,
  onCancel,
  onRefresh,
  onOpenOptions,
  onSeek,
  onPageJump,
  onSendToChat,
  onPromote,
}: LensSectionsProps) {
  return (
    <div id="lens-sections" className="lens-sections">
      {sections.map((section) => (
        <LensSection
          key={section.lensId}
          section={section}
          isOpen={openSection === section.lensId}
          isHighlightsHidden={hiddenHighlightLensIds.includes(section.lensId)}
          onOpen={() => onOpenSection(section.lensId)}
          onToggleHighlightVisibility={onToggleHighlightVisibility}
          onRetry={onRetry}
          onResume={onResume}
          onCancel={onCancel}
          onRefresh={onRefresh}
          onOpenOptions={onOpenOptions}
          onSeek={onSeek}
          onPageJump={onPageJump}
          onSendToChat={onSendToChat}
          onPromote={onPromote}
        />
      ))}
    </div>
  );
}

function LensSection({
  section,
  isOpen,
  isHighlightsHidden,
  onOpen,
  onToggleHighlightVisibility,
  onRetry,
  onResume,
  onCancel,
  onRefresh,
  onOpenOptions,
  onSeek,
  onPageJump,
  onSendToChat,
  onPromote,
}: {
  section: LensSectionModel;
  isOpen: boolean;
  isHighlightsHidden: boolean;
  onOpen: () => void;
  onToggleHighlightVisibility: (lensId: string) => void;
  onRetry: (lensId: string) => void;
  onResume: (lensId: string) => void;
  onCancel: (lensId: string) => void;
  onRefresh: () => void;
  onOpenOptions: () => void;
  onSeek: (seconds: number) => void;
  onPageJump: (pageNumber: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
  onPromote: () => void;
}) {
  const run = section.run;
  const statusClass = sectionStatusClass(section);
  const countText = sectionCountLabel(section);
  // Custom/user lenses carry their own generated name; built-ins use LENS_META.
  const title = section.name ?? LENS_META[section.lensId]?.name ?? section.lensId;
  const isPending =
    section.clientStatus === "naming" || section.clientStatus === "running";
  const progress = isPending ? section.chunkProgress : undefined;
  // The failed chip doubles as the retry control; body Retry stays as the
  // discoverable fallback.
  const isRetryChip =
    section.clientStatus === "failed" ||
    (!section.clientStatus && run?.status === "failed");
  const canToggleHighlights = hasHighlightableFindings(section) && !isPending;
  const highlightsAreHidden = canToggleHighlights && isHighlightsHidden;
  const visibilityAction = highlightsAreHidden ? "Show" : "Hide";
  const countLabel = highlightsAreHidden ? "Hidden" : countText;
  const reusedText = highlightsAreHidden ? undefined : reusedRunLabel(section);

  const handleCountClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (!canToggleHighlights) return;
    event.stopPropagation();
    onToggleHighlightVisibility(section.lensId);
  };

  const handleCountKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!canToggleHighlights) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onToggleHighlightVisibility(section.lensId);
  };

  return (
    <Collapsible.Root
      asChild
      open={isOpen}
      onOpenChange={(open) => {
        if (open !== isOpen) onOpen();
      }}
    >
      <section
        className={`acc-section ${statusClass} ${isOpen ? "open" : ""} ${
          highlightsAreHidden ? "highlights-hidden" : ""
        }`}
        data-section={section.lensId}
      >
        <div className="acc-head" data-acc={section.lensId}>
          <Collapsible.Trigger type="button" className="acc-trigger">
            <span className="acc-title">{title}</span>
          </Collapsible.Trigger>
          {isRetryChip ? (
            <button
              type="button"
              className="acc-count acc-count--retry"
              title={`Retry ${title}`}
              aria-label={`Retry ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onRetry(section.lensId);
              }}
            >
              <span className="acc-retry-rest">{countLabel}</span>
              <span className="acc-retry-hover">Retry</span>
            </button>
          ) : (
            <span
              className={`acc-count ${canToggleHighlights ? "acc-count--toggle" : ""} ${
                highlightsAreHidden ? "is-hidden" : ""
              }`}
              role={canToggleHighlights ? "switch" : undefined}
              aria-checked={canToggleHighlights ? !highlightsAreHidden : undefined}
              aria-label={canToggleHighlights ? `${visibilityAction} ${title} highlights` : undefined}
              tabIndex={canToggleHighlights ? 0 : undefined}
              title={canToggleHighlights ? `${visibilityAction} ${title} highlights` : undefined}
              onClick={handleCountClick}
              onKeyDown={handleCountKeyDown}
            >
              {isPending ? (
                <span className="lens-running-count">
                  <span className="lens-spinner" aria-hidden="true" />
                  {countLabel}
                </span>
              ) : (
                <>
                  {countLabel}
                  {reusedText ? (
                    <span className="acc-reused" title={reusedText}>
                      {` · ${reusedText}`}
                    </span>
                  ) : null}
                </>
              )}
            </span>
          )}
          {progress ? (
            <div
              className="claims-progress lens-chunk-progress"
              aria-live="polite"
              onClick={(event) => event.stopPropagation()}
            >
              <ChunkTicks
                progress={progress}
                label={`${progress.done} of ${progress.total} chunks done`}
              />
              <button
                className="claims-stop-btn"
                type="button"
                title="Stop extraction"
                aria-label={`Stop ${title} extraction`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCancel(section.lensId);
                }}
              >
                <StopIcon />
              </button>
            </div>
          ) : null}
        </div>
        <Collapsible.Content asChild forceMount>
          <div className="acc-body">
            {section.promotable ? (
              <div className="lens-promote">
                <button type="button" className="lens-promote-btn" onClick={onPromote}>
                  Pin as lens
                </button>
                <span className="lens-promote-hint">Keep this lens for later pages.</span>
              </div>
            ) : null}
            {isPending ? (
              section.findings.length > 0 ? (
                <FindingList
                  findings={section.findings}
                  onSeek={onSeek}
                  onPageJump={onPageJump}
                  onSendToChat={onSendToChat}
                />
              ) : (
                <LensRunSkeleton status={section.clientStatus} />
              )
            ) : run && run.status === "cancelled" ? (
              // Persisted stopped run: partial findings weren't kept on stop,
              // so the notice says so and offers a full re-run.
              <LensStoppedNotice
                coverage={run.chunkCoverage}
                variant="rerun"
                hasFindings={section.findings.length > 0}
                onResume={() => onResume(section.lensId)}
              />
            ) : run && run.status !== "completed" ? (
              run.status === "failed" ? (
                <LensError
                  run={run}
                  onRetry={() => onRetry(run.lensId)}
                  onOpenOptions={onOpenOptions}
                />
              ) : (
                <LensProgress run={run} onRefresh={onRefresh} />
              )
            ) : section.clientStatus === "stopped" ? (
              // Just-stopped run: partial findings live in memory this session,
              // so resume picks up the remaining chunks.
              <>
                <LensStoppedNotice
                  coverage={section.chunkProgress}
                  variant="resume"
                  hasFindings={section.findings.length > 0}
                  onResume={() => onResume(section.lensId)}
                />
                {section.findings.length > 0 ? (
                  <FindingList
                    findings={section.findings}
                    onSeek={onSeek}
                    onPageJump={onPageJump}
                    onSendToChat={onSendToChat}
                  />
                ) : null}
              </>
            ) : section.findings.length === 0 ? (
              <LensEmpty run={run} />
            ) : (
              <FindingList
                findings={section.findings}
                onSeek={onSeek}
                onPageJump={onPageJump}
                onSendToChat={onSendToChat}
              />
            )}
          </div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}

function FindingList({
  findings,
  onSeek,
  onPageJump,
  onSendToChat,
}: {
  findings: LensFinding[];
  onSeek: (seconds: number) => void;
  onPageJump: (pageNumber: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
}) {
  return (
    <div className="claims-list">
      {findings.map((finding, index) => (
        <FindingItem
          key={`${index}:${finding.text}`}
          finding={finding}
          onSeek={onSeek}
          onPageJump={onPageJump}
          onSendToChat={onSendToChat}
        />
      ))}
    </div>
  );
}

function hasHighlightableFindings(section: LensSectionModel): boolean {
  if (section.findings.length > 0) return true;
  return section.run?.status === "completed" && (section.run.findingCount ?? 0) > 0;
}

function LensRunSkeleton({ status }: { status: LensSectionModel["clientStatus"] }) {
  const title = status === "naming" ? "Preparing lens" : "Running lens";
  const message =
    status === "naming"
      ? "Naming your lens before it runs on the page."
      : "Highlighting matches on the page.";
  return (
    <div className="lens-run-message lens-run-message--running" role="status" aria-live="polite">
      <div className="lens-run-title">{title}</div>
      <p>{message}</p>
    </div>
  );
}

function LensError({
  run,
  onRetry,
  onOpenOptions,
}: {
  run: LensRunState;
  onRetry: () => void;
  onOpenOptions: () => void;
}) {
  const meta = LENS_META[run.lensId] ?? { name: run.lensId };
  return (
    <div className="lens-run-message lens-run-message--error">
      <div className="lens-run-title">Could not run {meta.name}</div>
      <p>{describeLensRunError(run.error)}</p>
      <div className="lens-run-actions">
        <button type="button" className="lens-run-action" onClick={onRetry}>
          Retry
        </button>
        {shouldOfferSettings(run.error) ? (
          <button type="button" className="lens-run-action" onClick={onOpenOptions}>
            Settings
          </button>
        ) : null}
      </div>
      <RunDetails run={run} />
    </div>
  );
}

function LensProgress({ run, onRefresh }: { run: LensRunState; onRefresh: () => void }) {
  return (
    <div className="lens-run-message">
      <div className="lens-run-title">{run.status === "pending" ? "Queued" : "Still running"}</div>
      <p>Refresh in a moment to check for results.</p>
      <div className="lens-run-actions">
        <button type="button" className="lens-run-action" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <RunDetails run={run} />
    </div>
  );
}

function LensEmpty({ run }: { run?: LensRunState }) {
  return (
    <div className="lens-run-message">
      <div className="lens-run-title">No findings</div>
      <p>The latest run completed without finding anything to show.</p>
      {run ? <RunDetails run={run} /> : null}
    </div>
  );
}

// Per-chunk progress: one tick per chunk, filled as chunks finish. The chunk at
// index `done` is the one in flight and pulses; chunks past it stay dim. Reads
// as discrete work, matching how runs actually execute.
function ChunkTicks({ progress, label }: { progress: LensChunkProgress; label: string }) {
  const total = Math.max(0, progress.total);
  const done = Math.max(0, Math.min(progress.done, total));
  return (
    <span
      className="chunk-ticks"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={label}
    >
      {Array.from({ length: total }, (_, index) => {
        const state = index < done ? "done" : index === done ? "active" : "";
        return <span key={index} className={`chunk-tick ${state}`} aria-hidden="true" />;
      })}
    </span>
  );
}

// Above a stopped run's findings: says how much of the source was inspected and
// offers to finish. "resume" carries the session's partial findings forward;
// "rerun" starts over because a persisted stopped run kept none.
function LensStoppedNotice({
  coverage,
  variant,
  hasFindings,
  onResume,
}: {
  coverage?: LensChunkProgress;
  variant: StoppedResumeVariant;
  hasFindings: boolean;
  onResume: () => void;
}) {
  return (
    <div className="lens-stopped-notice">
      <p>{stoppedNoticeMessage(variant, coverage, hasFindings)}</p>
      <button type="button" className="lens-run-action" onClick={onResume}>
        {stoppedResumeAction(variant)}
      </button>
    </div>
  );
}

function RunDetails({ run }: { run: LensRunState }) {
  const lines = [
    `runId: ${run.runId}`,
    `status: ${run.status}`,
    run.modelUsed ? `model: ${run.modelUsed}` : undefined,
    run.createdAt ? `created: ${new Date(run.createdAt).toLocaleString()}` : undefined,
    run.error ? `error: ${run.error}` : undefined,
  ].filter((line): line is string => !!line);

  return (
    <details className="lens-run-details">
      <summary>Technical details</summary>
      <pre>{lines.join("\n")}</pre>
    </details>
  );
}

/**
 * How a stacked finding presents its anchor. Transcript anchors fold into the
 * meta line ("5:01 | claim"); PDF anchors become a separate tappable page chip
 * next to a plain "category | confidence" meta, matching the evidence-bases
 * library's "Page N" labels (printed page label wins over the number).
 */
export function findingAnchorPresentation(finding: LensFinding): {
  metaLabel: string;
  seekSeconds?: number;
  pageNumber?: number;
  pageLabel?: string;
} {
  const anchor = finding.anchor;
  const confidenceMeta = `${finding.category} | ${Math.round(finding.confidence * 100)}%`;

  if (anchor?.kind === "transcript") {
    return {
      metaLabel: anchor.formatted
        ? `${anchor.formatted} | ${finding.category}`
        : confidenceMeta,
      seekSeconds: typeof anchor.timestamp === "number" ? anchor.timestamp : undefined,
    };
  }
  if (anchor?.kind === "pdf") {
    return {
      metaLabel: confidenceMeta,
      pageNumber: anchor.pageNumber,
      pageLabel: `Page ${anchor.pageLabel ?? anchor.pageNumber}`,
    };
  }
  return { metaLabel: confidenceMeta };
}

function FindingItem({
  finding,
  onSeek,
  onPageJump,
  onSendToChat,
}: {
  finding: LensFinding;
  onSeek: (seconds: number) => void;
  onPageJump: (pageNumber: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
}) {
  const verified = finding.enrichments?.find((entry) => entry.data?.credibility);
  const { metaLabel, seekSeconds, pageNumber, pageLabel } =
    findingAnchorPresentation(finding);

  return (
    <FindingView
      text={finding.text}
      metaLabel={metaLabel}
      credibility={verified?.data?.credibility}
      enrichmentNotes={(finding.enrichments ?? []).map((entry) => entry.summary)}
      quotes={finding.quotes}
      seekSeconds={seekSeconds}
      pageLabel={pageLabel}
      onPageJump={pageNumber === undefined ? undefined : () => onPageJump(pageNumber)}
      onSeek={onSeek}
      onSendToChat={onSendToChat}
    />
  );
}
