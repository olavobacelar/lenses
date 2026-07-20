import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseCitationPublisherResolution } from "./citation-publisher-resolution";
import { getLocalFaviconUrl } from "./local-favicon";

export interface RichCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface RichTextSegment {
  text: string;
  citations: RichCitation[];
}

export function TextSegmentsWithCitations({
  segments,
  fallbackText,
  grouped = false,
}: {
  segments: RichTextSegment[];
  fallbackText: string;
  /** When true, co-located citations collapse into one pill with a paginated
   *  popover instead of one badge per citation. */
  grouped?: boolean;
}) {
  if (segments.length === 0) {
    return <span>{renderInlineMarkdownWithBreaks(fallbackText)}</span>;
  }

  const rendered: ReactNode[] = grouped
    ? buildCitationTokens(segments).map((token) =>
        token.kind === "text" ? (
          <span key={token.key}>{renderInlineMarkdownWithBreaks(token.text)}</span>
        ) : (
          <CitationGroup key={token.key} citations={token.citations} />
        )
      )
    : segments.flatMap((segment, segmentIndex) => {
        const nodes: ReactNode[] = [];
        if (segment.text) {
          nodes.push(
            <span key={`text-${segmentIndex}`}>
              {renderInlineMarkdownWithBreaks(segment.text)}
            </span>
          );
        }
        segment.citations.forEach((citation, citationIndex) => {
          const badge = buildCitationBadge(citation, `citation-${segmentIndex}-${citationIndex}`);
          if (badge) nodes.push(badge);
        });
        return nodes;
      });

  if (rendered.length === 0 && fallbackText.trim().length > 0) {
    return <span>{renderInlineMarkdownWithBreaks(fallbackText)}</span>;
  }

  return <>{rendered}</>;
}

type CitationToken =
  | { kind: "text"; text: string; key: string }
  | { kind: "citations"; citations: RichCitation[]; key: string };

/** Flatten segments into text runs and citation groups. Provider citation events
 *  often arrive mid-sentence; queue them until the prose reaches a natural
 *  sentence/paragraph boundary so the visible chip sits at the end of a thought. */
export function buildCitationTokens(segments: RichTextSegment[]): CitationToken[] {
  const tokens: CitationToken[] = [];
  let pendingCitations: RichCitation[] = [];
  let nextTextKey = 0;
  let nextCitationKey = 0;

  const pushText = (text: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last?.kind === "text") {
      last.text += text;
    } else {
      tokens.push({ kind: "text", text, key: `text-${nextTextKey++}` });
    }
  };

  const flushCitations = () => {
    if (pendingCitations.length === 0) return;

    // Trailing newlines in the preceding text token would push the citation
    // chip onto a new line. Strip them here and re-push after the chip so
    // paragraph spacing is preserved but the chip sits inline.
    let trailingNewlines = "";
    const last = tokens[tokens.length - 1];
    if (last?.kind === "text") {
      last.text = last.text.replace(/\n+$/, (match) => {
        trailingNewlines = match;
        return "";
      });
      if (!last.text) tokens.pop();
    }

    tokens.push({
      kind: "citations",
      citations: dedupeByUrl(pendingCitations),
      key: `cite-${nextCitationKey++}`,
    });
    pendingCitations = [];

    if (trailingNewlines) {
      pushText(trailingNewlines);
    }
  };

  const pushTextAndFlushAtBoundary = (text: string) => {
    let remaining = text;
    while (remaining) {
      const boundaryIndex = pendingCitations.length > 0 ? citationBoundaryIndex(remaining) : -1;
      if (boundaryIndex < 0) {
        pushText(remaining);
        return;
      }

      pushText(remaining.slice(0, boundaryIndex));
      flushCitations();
      remaining = remaining.slice(boundaryIndex);
    }
  };

  segments.forEach((segment) => {
    pushTextAndFlushAtBoundary(segment.text);

    segment.citations.forEach((citation) => {
      const url = normalizeCitationUrl(citation.url);
      if (!url) return;
      pendingCitations.push({ ...citation, url });
    });

    if (pendingCitations.length > 0 && textEndsAtCitationBoundary(segment.text)) {
      flushCitations();
    }
  });

  flushCitations();
  return tokens;
}

function citationBoundaryIndex(text: string): number {
  const paragraphBreak = text.search(/\n\s*\n/);
  const sentenceMatch = /[.!?]["')\]]*(?:\s+|$)/.exec(text);
  if (paragraphBreak < 0 && !sentenceMatch) return -1;

  const paragraphIndex = paragraphBreak >= 0 ? paragraphBreak : Number.POSITIVE_INFINITY;
  const sentenceIndex = sentenceMatch
    ? sentenceMatch.index + sentenceMatch[0].length
    : Number.POSITIVE_INFINITY;
  return Math.min(paragraphIndex, sentenceIndex);
}

function textEndsAtCitationBoundary(text: string): boolean {
  return /(?:[.!?]["')\]]*\s*|\n\s*)$/.test(text);
}

function dedupeByUrl(citations: RichCitation[]): RichCitation[] {
  const seen = new Set<string>();
  const unique: RichCitation[] = [];
  for (const citation of citations) {
    if (seen.has(citation.url)) continue;
    seen.add(citation.url);
    unique.push(citation);
  }
  return unique;
}

function domainLabel(url: string): string {
  return getHostname(url).replace(/^www\./, "") || getDomainName(url);
}

/** Resolved publisher names (e.g. "Wikimedia Foundation, Inc.") keyed by URL,
 *  fetched once from the background resolver and shared across every pill so the
 *  same source isn't looked up twice. */
const publisherCache = new Map<string, string>();
const publisherMisses = new Set<string>();
const publisherInFlight = new Set<string>();

function resolveCitationPublishers(urls: string[]): Promise<void> {
  const pending = urls.filter(
    (url) =>
      !publisherCache.has(url) && !publisherMisses.has(url) && !publisherInFlight.has(url)
  );
  if (pending.length === 0) return Promise.resolve();
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return Promise.resolve();
  for (const url of pending) publisherInFlight.add(url);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "resolve-citation-publishers", urls: pending },
      (response?: {
        publishers?: Record<string, string>;
        authoritativeUrls?: string[];
      }) => {
        const failed = chrome.runtime.lastError;
        const { publishers, authoritativeUrls } = parseCitationPublisherResolution(
          response,
          Boolean(failed)
        );
        for (const url of pending) {
          const name = publishers[url];
          if (typeof name === "string" && name.trim().length > 0) {
            publisherCache.set(url, name.trim());
          } else if (authoritativeUrls.has(url)) {
            publisherMisses.add(url);
          }
          publisherInFlight.delete(url);
        }
        resolve();
      }
    );
  });
}

/** The pill renders inline, but its popover is portaled out so the chatbox's
 *  clipped, scrolling panel can't crop it: in a shadow surface we target the
 *  theme scope (keeps light/dark theming, escapes the panel), otherwise body. */
function resolvePopoverContainer(node: HTMLElement | null): HTMLElement {
  if (!node) return document.body;
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    return root.querySelector<HTMLElement>(".lenses-shadow-theme-scope") ?? document.body;
  }
  return document.body;
}

/** Aggregated inline citation: one pill (first source + "+N") that opens a
 *  paginated card cycling through every distinct source at this position. */
function CitationGroup({ citations }: { citations: RichCitation[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [, bumpResolved] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const count = citations.length;
  const first = citations[0];
  const current = citations[Math.min(index, count - 1)];
  const label = (url: string) => publisherCache.get(url) ?? domainLabel(url);

  // Hover-driven open/close with a short grace period, so moving the pointer from
  // the pill across the gap into the popover doesn't dismiss it.
  const cancelScheduledClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = () => {
    cancelScheduledClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  const urlsKey = citations.map((citation) => citation.url).join("|");
  useEffect(() => {
    let active = true;
    void resolveCitationPublishers(citations.map((citation) => citation.url)).then(() => {
      if (active) bumpResolved((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [urlsKey]);

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const rect = trigger.getBoundingClientRect();
      const popHeight = pop.offsetHeight || 120;
      const popWidth = pop.offsetWidth || 288;
      const margin = 8;
      const gap = 6;
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popWidth - margin));
      // Open above the source by default; drop below only when the card can't fit
      // above — i.e. the source sits too near the top of the viewport.
      const fitsAbove = rect.top - gap - margin >= popHeight;
      const top = fitsAbove ? rect.top - gap - popHeight : rect.bottom + gap;
      setCoords({ left, top });
    };
    place();
    // Re-measure after paint so the above/below choice uses the card's true
    // height (the first pass can run before a wrapped title has settled).
    raf = window.requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // Position once when opening (not per page) so paging through sources keeps
    // the card put under the cursor instead of jumping and triggering hover-close.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      // Use composedPath so clicks inside the popover are recognised even when it
      // is portaled into a shadow root (the chatbox): there event.target is
      // retargeted to the shadow host, which breaks a plain contains() check and
      // would dismiss the popover when its own arrows are clicked.
      const path = event.composedPath();
      const pop = popRef.current;
      const trigger = triggerRef.current;
      if ((pop && path.includes(pop)) || (trigger && path.includes(trigger))) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setCoords(null);
    }
  }, [open]);

  useEffect(() => () => cancelScheduledClose(), []);

  if (!first) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="citation-chip"
        aria-expanded={open}
        aria-label={`${count} source${count === 1 ? "" : "s"}`}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onFocus={openMenu}
        onClick={openMenu}
      >
        <img
          className="citation-chip-favicon"
          src={getLocalFaviconUrl(first.url)}
          alt=""
          loading="lazy"
        />
        <span className="citation-chip-name">{label(first.url)}</span>
        {count > 1 ? <span className="citation-chip-more">+{count - 1}</span> : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              className="citation-pop"
              role="dialog"
              style={
                coords
                  ? { left: coords.left, top: coords.top }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
              onMouseEnter={cancelScheduledClose}
              onMouseLeave={scheduleClose}
            >
              {count > 1 ? (
                <div className="citation-pop-head">
                  <div className="citation-pop-nav">
                    <button
                      type="button"
                      className="citation-pop-arrow"
                      aria-label="Previous source"
                      disabled={index === 0}
                      onClick={() => setIndex((value) => Math.max(0, value - 1))}
                    >
                      <NavArrow direction="left" />
                    </button>
                    <button
                      type="button"
                      className="citation-pop-arrow"
                      aria-label="Next source"
                      disabled={index >= count - 1}
                      onClick={() => setIndex((value) => Math.min(count - 1, value + 1))}
                    >
                      <NavArrow direction="right" />
                    </button>
                  </div>
                  <span className="citation-pop-count">
                    {index + 1}/{count}
                  </span>
                </div>
              ) : null}

              <a
                className="citation-pop-body"
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="citation-pop-source">
                  <img
                    className="citation-pop-favicon"
                    src={getLocalFaviconUrl(current.url)}
                    alt=""
                    loading="lazy"
                  />
                  <span className="citation-pop-domain">{label(current.url)}</span>
                </span>
                <span className="citation-pop-title">{current.title || current.url}</span>
                {current.citedText && current.citedText.trim().length > 0 ? (
                  <span className="citation-pop-snippet">{current.citedText.trim()}</span>
                ) : null}
              </a>
            </div>,
            resolvePopoverContainer(triggerRef.current)
          )
        : null}
    </>
  );
}

function NavArrow({ direction }: { direction: "left" | "right" }) {
  const d =
    direction === "left"
      ? "M12.5 8H3.5M3.5 8l3.5-3.5M3.5 8l3.5 3.5"
      : "M3.5 8h9M12.5 8L9 4.5M12.5 8L9 11.5";
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(
        <Heading key={blocks.length}>
          {renderInlineMarkdown(headingMatch[2].trim(), `h-${blocks.length}`)}
        </Heading>
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={blocks.length}>
          {renderInlineMarkdown(quoteLines.join(" "), `q-${blocks.length}`)}
        </blockquote>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(
          <li key={items.length}>
            {renderInlineMarkdown(
              lines[i].trim().replace(/^\d+\.\s+/, ""),
              `ol-${blocks.length}-${items.length}`
            )}
          </li>
        );
        i++;
      }
      blocks.push(<ol key={blocks.length}>{items}</ol>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(
          <li key={items.length}>
            {renderInlineMarkdown(
              lines[i].trim().replace(/^[-*]\s+/, ""),
              `ul-${blocks.length}-${items.length}`
            )}
          </li>
        );
        i++;
      }
      blocks.push(<ul key={blocks.length}>{items}</ul>);
      continue;
    }

    const paragraphLines = [trimmed];
    i++;
    while (i < lines.length && !isMarkdownBoundary(lines[i])) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={blocks.length}>
        {renderInlineMarkdown(paragraphLines.join(" "), `p-${blocks.length}`)}
      </p>
    );
  }

  return <>{blocks}</>;
}

function renderInlineMarkdownWithBreaks(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = value.split("\n");
  lines.forEach((line, lineIndex) => {
    nodes.push(...renderInlineMarkdown(line, `line-${lineIndex}`));
    if (lineIndex < lines.length - 1) {
      nodes.push(<br key={`br-${lineIndex}`} />);
    }
  });
  return nodes;
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tokenRegex.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      nodes.push(
        linkMatch ? (
          <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        ) : (
          token
        )
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes;
}

function buildCitationBadge(citation: RichCitation, key: string): ReactNode | null {
  const normalizedUrl = normalizeCitationUrl(citation.url);
  if (!normalizedUrl) return null;

  const domain = getDomainName(normalizedUrl);
  const hostname = getHostname(normalizedUrl) || domain;

  return (
    <a
      key={key}
      className="citation-badge"
      href={normalizedUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-citation-url={normalizedUrl}
    >
      <img
        className="citation-badge-favicon"
        src={getLocalFaviconUrl(normalizedUrl)}
        alt=""
        loading="lazy"
      />
      <span className="citation-source" data-fallback-label={domain}>
        {domain}
      </span>
      <span className="citation-tooltip">
        <span className="citation-tooltip-title">{citation.title || normalizedUrl}</span>
        <span className="citation-tooltip-source">
          <img src={getLocalFaviconUrl(normalizedUrl)} alt="" />
          <span>{hostname}</span>
        </span>
        {citation.citedText ? (
          <span className="citation-tooltip-quote">{citation.citedText}</span>
        ) : null}
      </span>
    </a>
  );
}

function isMarkdownBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  if (/^\d+\.\s+/.test(trimmed)) return true;
  if (/^[-*]\s+/.test(trimmed)) return true;
  return false;
}

function getDomainName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    if (parts.length > 2) return parts[parts.length - 2];
    return parts[0] || "source";
  } catch {
    return "source";
  }
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function normalizeCitationUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
