import * as Collapsible from "@radix-ui/react-collapsible";
import type { KeyboardEvent, MouseEvent } from "react";
import { parseTimestamp } from "../../lib/utils/time";
import type { ExtractedClaim } from "../../types/claims";
import { RetryIcon, StopIcon } from "./Icons";
import { FindingView } from "./FindingView";

interface ClaimsSectionProps {
  claims: ExtractedClaim[];
  status: string;
  isExtracting: boolean;
  progress: { current: number; total: number };
  canExtract: boolean;
  canToggleHighlights: boolean;
  isHighlightsHidden: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onToggleHighlightVisibility: () => void;
  onExtract: () => void;
  onCancel: () => void;
  onSeek: (seconds: number) => void;
  onPageJump: (pageNumber: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
  onVerifyClaim: (claim: ExtractedClaim) => void;
}

export function ClaimsSection({
  claims,
  status,
  isExtracting,
  progress,
  canExtract,
  canToggleHighlights,
  isHighlightsHidden,
  isOpen,
  onToggle,
  onToggleHighlightVisibility,
  onExtract,
  onCancel,
  onSeek,
  onPageJump,
  onSendToChat,
  onVerifyClaim,
}: ClaimsSectionProps) {
  const percentage =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasClaims = claims.length > 0;
  const highlightsAreHidden = canToggleHighlights && isHighlightsHidden;
  const visibilityAction = highlightsAreHidden ? "Show" : "Hide";
  const statusLabel = highlightsAreHidden ? "Hidden" : status;

  const handleStatusClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (!canToggleHighlights) return;
    event.stopPropagation();
    onToggleHighlightVisibility();
  };

  const handleStatusKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!canToggleHighlights) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onToggleHighlightVisibility();
  };

  return (
    <Collapsible.Root
      asChild
      open={isOpen}
      onOpenChange={(open) => {
        if (open !== isOpen) onToggle();
      }}
    >
      <section
        className={`acc-section ${isOpen ? "open" : ""} ${
          highlightsAreHidden ? "highlights-hidden" : ""
        }`}
        data-section="claims"
      >
        <div className="acc-head" data-acc="claims">
          <Collapsible.Trigger type="button" className="acc-trigger">
            <span className="acc-title">Claims</span>
          </Collapsible.Trigger>
          <span
            id="claims-status"
            className={`acc-count ${canToggleHighlights ? "acc-count--toggle" : ""} ${
              highlightsAreHidden ? "is-hidden" : ""
            }`}
            role={canToggleHighlights ? "switch" : undefined}
            aria-checked={canToggleHighlights ? !highlightsAreHidden : undefined}
            aria-label={canToggleHighlights ? `${visibilityAction} Claims highlights` : undefined}
            tabIndex={canToggleHighlights ? 0 : undefined}
            title={canToggleHighlights ? `${visibilityAction} Claims highlights` : undefined}
            onClick={handleStatusClick}
            onKeyDown={handleStatusKeyDown}
          >
            {statusLabel}
          </span>
          <div
            id="claims-progress"
            className={`claims-progress ${isExtracting ? "" : "hidden"}`}
            aria-live="polite"
            onClick={(event) => event.stopPropagation()}
          >
            <span id="claims-progress-text" className="claims-progress-text">
              {progress.total > 0
                ? `Extracting... ${progress.current}/${progress.total}`
                : "Extracting..."}
            </span>
            <div className="claims-progress-bar" aria-hidden="true">
              <div
                id="claims-progress-fill"
                className="claims-progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
              />
            </div>
            <button
              id="cancel-claims-extraction"
              className="claims-stop-btn"
              type="button"
              title="Stop extraction"
              aria-label="Stop extraction"
              onClick={onCancel}
            >
              <StopIcon />
            </button>
          </div>
          <button
            id="extract-claims"
            className={`acc-action ${
              hasClaims ? "acc-action--icon" : canExtract ? "acc-action--primary" : ""
            } ${isExtracting ? "hidden" : ""}`}
            type="button"
            disabled={!canExtract || isExtracting}
            title={hasClaims ? "Re-extract claims" : undefined}
            aria-label={hasClaims ? "Re-extract claims" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onExtract();
            }}
          >
            {hasClaims ? <RetryIcon size={13} /> : "Extract"}
          </button>
        </div>
        <Collapsible.Content asChild forceMount>
          <div className="acc-body">
            <div id="claims-list" className="claims-list">
              {claims.length === 0 && isExtracting ? <ClaimsLoadingPlaceholder /> : null}
              {claims.map((claim) => {
                // Transcript claims get a seek stamp, PDF claims get a page chip,
                // and ordinary webpage claims have no locator. Never turn the
                // legacy "--:--" placeholder into a seek-to-zero control.
                const page = claim.page;
                const hasTimestamp = page === undefined && claim.timestamp !== "--:--";
                return (
                  <FindingView
                    key={`${claim.timestamp}:${claim.claim}`}
                    variant="compact"
                    text={claim.claim}
                    timestampLabel={hasTimestamp ? claim.timestamp : undefined}
                    category={claim.category}
                    credibility={claim.verification?.credibility}
                    quotes={claim.quotes}
                    seekSeconds={hasTimestamp ? parseTimestamp(claim.timestamp) : undefined}
                    pageLabel={
                      page === undefined ? undefined : `p.${claim.pageLabel ?? page}`
                    }
                    onPageJump={page === undefined ? undefined : () => onPageJump(page)}
                    onSeek={onSeek}
                    onSendToChat={onSendToChat}
                    onVerify={() => onVerifyClaim(claim)}
                  />
                );
              })}
            </div>
          </div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}

function ClaimsLoadingPlaceholder() {
  return (
    <div className="claims-loading-placeholder">
      <span className="claims-loading-dot" aria-hidden="true" />
      <span>Extracting claims...</span>
    </div>
  );
}
