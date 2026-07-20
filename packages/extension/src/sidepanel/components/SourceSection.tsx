import { useEffect, useRef } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import type { PdfPageText } from "../../lib/pdf-source";
import type { TranscriptSegment, VideoTime } from "../../types/transcript";
import type { PanelSource } from "../types";
import { countWords, formatCompactNumber } from "../lib/format";

/** A page-chip click; the fresh id re-triggers the jump even for the same page. */
export interface PdfJumpRequest {
  id: number;
  pageNumber: number;
}

interface SourceSectionProps {
  source: PanelSource | null;
  transcript: TranscriptSegment[];
  currentTime: VideoTime | null;
  isOpen: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  pdfJump?: PdfJumpRequest | null;
}

export function SourceSection({
  source,
  transcript,
  currentTime,
  isOpen,
  onToggle,
  onSeek,
  pdfJump,
}: SourceSectionProps) {
  const isYouTube = source?.kind === "youtube_video";
  const isPdf = source?.kind === "pdf";
  const sourceLabel = isYouTube ? "Transcript" : isPdf ? "PDF text" : "Page text";
  const wordCount = formatCompactNumber(countWords(source?.text ?? ""));
  const pageCount = isPdf && source ? pdfPageCount(source) : 0;

  return (
    <Collapsible.Root
      asChild
      open={isOpen}
      onOpenChange={(open) => {
        if (open !== isOpen) onToggle();
      }}
    >
      <section className={`acc-section ${isOpen ? "open" : ""}`} data-section="source">
        <div className="acc-head" data-acc="source">
          <Collapsible.Trigger type="button" className="acc-trigger">
            <span className="acc-title">{source ? sourceLabel : "Source"}</span>
            {source ? (
              <span className="source-acc-meta">
                {pageCount > 0 ? (
                  <span className="acc-count">
                    {pageCount} {pageCount === 1 ? "page" : "pages"}
                  </span>
                ) : null}
                <span id="word-count" className="acc-count source-word-count">
                  {wordCount} words
                </span>
                {source?.kind === "youtube_video" ? (
                  <span id="video-time" className="acc-count">
                    {currentTime?.formatted ?? "--:--"}
                  </span>
                ) : null}
              </span>
            ) : null}
          </Collapsible.Trigger>
        </div>
        <Collapsible.Content asChild forceMount>
          <div className="acc-body">
            {!source ? null : isYouTube ? (
              <div id="transcript-list" className="transcript-list">
                <TranscriptRows source={source} transcript={transcript} onSeek={onSeek} />
              </div>
            ) : isPdf && (source.pdfPages?.length ?? 0) > 0 ? (
              <PdfPageList pages={source.pdfPages ?? []} jump={pdfJump ?? null} />
            ) : (
              <div id="source-text" className="source-text">
                <PageText source={source} />
              </div>
            )}
          </div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}

function pdfPageCount(source: PanelSource): number {
  const declared = Number(source.sourceMetadata?.pageCount);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return source.pdfPages?.length ?? 0;
}

function PageText({ source }: { source: PanelSource | null }) {
  const text = source?.text.trim();
  return <div className="source-text-content">{text || "No page text captured."}</div>;
}

/** Matches the .source-text container's top padding so a jump lands the page
 *  header flush with the top of the scroll viewport. */
const PDF_JUMP_TOP_PADDING = 8;

function PdfPageList({
  pages,
  jump,
}: {
  pages: PdfPageText[];
  jump: PdfJumpRequest | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const allScanned = pages.length > 0 && pages.every((page) => page.ocrRequired);

  // Scroll the panel's own copy of the text — the extension cannot scroll
  // Chrome's built-in PDF viewer, so this is all a page chip promises. The
  // rAF lets the section finish opening before we measure.
  useEffect(() => {
    if (!jump) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[data-pdf-page="${jump.pageNumber}"]`
      );
      if (!container || !target) return;
      container.scrollTop = Math.max(0, target.offsetTop - PDF_JUMP_TOP_PADDING);
      target.classList.remove("pdf-page-flash");
      // Force a reflow so a repeat jump to the same page restarts the pulse.
      void target.offsetWidth;
      target.classList.add("pdf-page-flash");
    });
    return () => cancelAnimationFrame(frame);
  }, [jump]);

  return (
    <div id="source-text" className="source-text source-text--pdf" ref={containerRef}>
      {allScanned ? (
        <div className="pdf-scan-note">
          Scanned PDF — the pages have no text layer. A lens run will record that
          OCR is required.
        </div>
      ) : null}
      {pages.map((page) => {
        const body = (page.bodyText ?? "").trim();
        const scanned = page.ocrRequired || !body;
        return (
          <section className="pdf-page" data-pdf-page={page.pageNumber} key={page.pageNumber}>
            <div className="pdf-page-head">
              Page {page.pageNumber}
              {scanned ? <span className="pdf-scan-tag">scan</span> : null}
            </div>
            <div className={`pdf-page-body ${scanned ? "pdf-page-body--empty" : ""}`}>
              {scanned ? "No text layer on this page (scanned image)." : body}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TranscriptRows({
  source,
  transcript,
  onSeek,
}: {
  source: PanelSource | null;
  transcript: TranscriptSegment[];
  onSeek: (seconds: number) => void;
}) {
  if (transcript.length === 0) {
    return (
      <div className="transcript-empty">
        {source?.kind === "youtube_video" ? "No transcript available." : "Transcript not available."}
      </div>
    );
  }

  return (
    <>
      {transcript.map((segment) => (
        <div className="transcript-row" key={`${segment.start}:${segment.text}`}>
          <button
            type="button"
            className="timestamp"
            onClick={() => onSeek(segment.start)}
          >
            {segment.formatted}
          </button>
          <div>{segment.text}</div>
        </div>
      ))}
    </>
  );
}
