import { VerifyIcon } from "./Icons";

interface FindingViewProps {
  text: string;
  metaLabel?: string;
  credibility?: string;
  enrichmentNotes?: string[];
  quotes?: string[];
  seekSeconds?: number;
  onSeek: (seconds: number) => void;
  onSendToChat: (text: string, quotes?: string[]) => void;
  onVerify?: () => void;
  /** "compact" is the single-line Claims row; "default" is the stacked layout
   *  the other lens sections share. */
  variant?: "default" | "compact";
  /** Formatted timestamp shown as the seek chip in the compact variant. */
  timestampLabel?: string;
  /** Claim category, rendered as a colored dot in the compact variant. */
  category?: string;
  /** PDF page locator ("p.3" compact, "Page 3" stacked). Fills the timestamp
   *  slot for PDF-anchored findings; a timestamp always wins if both exist. */
  pageLabel?: string;
  /** Jumps the panel's own source text to the finding's page. The extension
   *  cannot scroll Chrome's built-in PDF viewer, so this is the only honest
   *  navigation a page chip can offer. */
  onPageJump?: () => void;
}

export function FindingView({
  text,
  metaLabel,
  credibility,
  enrichmentNotes,
  quotes,
  seekSeconds,
  onSeek,
  onSendToChat,
  onVerify,
  variant = "default",
  timestampLabel,
  category,
  pageLabel,
  onPageJump,
}: FindingViewProps) {
  const pageChip = pageLabel ? (
    <button
      type="button"
      className="claim-stamp"
      title={`Jump to ${pageLabel} in the source text`}
      aria-label={`Jump to ${pageLabel} in the source text`}
      onClick={onPageJump}
    >
      {pageLabel}
    </button>
  ) : null;

  // Compact single-line claim: a tappable timestamp doubles as the seek control
  // (no separate Seek button), category is a colored dot, and Verify stays quiet
  // until the row is hovered or focused.
  if (variant === "compact") {
    return (
      <article className="claim-row">
        {seekSeconds !== undefined && timestampLabel ? (
          <button
            type="button"
            className="claim-stamp"
            title={`Jump to ${timestampLabel}`}
            aria-label={`Jump to ${timestampLabel}`}
            onClick={() => onSeek(seekSeconds)}
          >
            {timestampLabel}
          </button>
        ) : (
          pageChip
        )}
        {category ? (
          <span
            className="claim-cat-dot"
            data-category={category}
            role="img"
            aria-label={`${category} claim`}
            title={category}
          />
        ) : null}
        <p
          className="claim-row-text"
          title="Send to chat"
          onClick={() => onSendToChat(text, quotes)}
        >
          {text}
        </p>
        <div className="claim-row-aside">
          {credibility ? (
            <span
              className="claim-cred-dot"
              data-credibility={credibility}
              role="img"
              aria-label={`${credibility} credibility`}
              title={`${credibility} credibility`}
            />
          ) : null}
          {onVerify ? (
            <button
              type="button"
              className="claim-verify"
              title="Verify"
              aria-label="Verify claim"
              onClick={onVerify}
            >
              <VerifyIcon />
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="claim-item">
      <div className="claim-meta">
        <span>{metaLabel}</span>
        {pageChip || credibility ? (
          <span className="claim-meta-aside">
            {pageChip}
            {credibility ? (
              <span className="claim-verdict" data-credibility={credibility}>
                {credibility} credibility
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <p
        className="claim-text"
        title="Send to chat"
        onClick={() => onSendToChat(text, quotes)}
      >
        {text}
      </p>

      {(enrichmentNotes ?? []).map((note, index) => (
        <div className="finding-enrichment" key={`${index}:${note}`}>
          {note}
        </div>
      ))}

      {seekSeconds !== undefined || onVerify ? (
        <div className="claim-actions">
          {seekSeconds !== undefined ? (
            <button
              type="button"
              className="claim-action"
              onClick={() => onSeek(seekSeconds)}
            >
              Seek
            </button>
          ) : null}
          {onVerify ? (
            <button type="button" className="claim-action" onClick={onVerify}>
              Verify
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
