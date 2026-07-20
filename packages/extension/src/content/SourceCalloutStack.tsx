import { Cross2Icon } from "@radix-ui/react-icons";
import { useLayoutEffect, useRef } from "react";
import { TextSegmentsWithCitations, getHostname } from "../lib/RichText.js";
import { WebSearchGroups } from "../lib/WebSearchGroups.js";
import type { WebSearchEntry } from "../lib/web-search.js";

interface SourceCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface SourceTextSegment {
  text: string;
  citations: SourceCitation[];
}

export interface SourceCalloutView {
  id: string;
  left: number;
  top: number;
  width: number;
  status: "idle" | "loading" | "ready" | "empty" | "error";
  citations: SourceCitation[];
  answerText: string;
  textSegments: SourceTextSegment[];
  thinkingText: string;
  searching: boolean;
  searches: WebSearchEntry[];
  errorMessage?: string;
  debugMode: boolean;
}

export function SourceCalloutStack({
  callouts,
  onClose,
  onMeasure,
}: {
  callouts: SourceCalloutView[];
  onClose: (id: string) => void;
  onMeasure: (id: string, height: number) => void;
}) {
  return (
    <>
      {callouts.map((callout) => (
        <SourceCalloutCard
          key={callout.id}
          callout={callout}
          onClose={onClose}
          onMeasure={onMeasure}
        />
      ))}
    </>
  );
}

function SourceCalloutCard({
  callout,
  onClose,
  onMeasure,
}: {
  callout: SourceCalloutView;
  onClose: (id: string) => void;
  onMeasure: (id: string, height: number) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const hasIntermediateContent =
    __INTERNAL_TOOLS__ &&
    callout.debugMode &&
    (callout.status === "loading" ||
      callout.status === "idle" ||
      callout.searching ||
      callout.thinkingText.trim().length > 0 ||
      callout.answerText.trim().length > 0 ||
      callout.textSegments.length > 0);

  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height ?? 0;
    if (height > 0) onMeasure(callout.id, height);
  }, [callout, onMeasure]);

  return (
    <section
      ref={ref}
      className="lenses-source-callout"
      data-annotation-id={callout.id}
      style={{
        left: `${callout.left}px`,
        top: `${Math.round(callout.top)}px`,
        width: `${callout.width}px`,
      }}
    >
      <header className="lenses-source-callout-header">
        <button
          type="button"
          className="lenses-source-callout-close"
          aria-label="Close"
          title="Close"
          onClick={() => onClose(callout.id)}
        >
          <Cross2Icon aria-hidden="true" focusable="false" />
        </button>
      </header>

      {hasIntermediateContent ? <IntermediateSteps callout={callout} /> : null}
      <CalloutBody callout={callout} />
    </section>
  );
}

function IntermediateSteps({ callout }: { callout: SourceCalloutView }) {
  return (
    <details className="lenses-source-callout-intermediate">
      <summary>Intermediate steps</summary>

      {callout.status === "loading" || callout.status === "idle" ? (
        <p className="lenses-source-callout-status is-loading">Checking sources...</p>
      ) : null}

      {callout.searching ? (
        <p className="lenses-source-callout-status is-searching">Searching web...</p>
      ) : null}

      {callout.thinkingText.trim().length > 0 ? (
        <>
          <p className="lenses-source-callout-block-title">Reasoning</p>
          <pre className="lenses-source-callout-thinking-content">
            {callout.thinkingText}
          </pre>
        </>
      ) : null}

      {callout.answerText.trim().length > 0 || callout.textSegments.length > 0 ? (
        <>
          <p className="lenses-source-callout-block-title">Draft analysis</p>
          <div className="lenses-source-callout-answer">
            <TextSegmentsWithCitations
              segments={callout.textSegments}
              fallbackText={callout.answerText}
              grouped
            />
          </div>
        </>
      ) : null}
    </details>
  );
}

function CalloutBody({ callout }: { callout: SourceCalloutView }) {
  const searchGroups =
    callout.searches.length > 0 ? (
      <WebSearchGroups searches={callout.searches} live={callout.searching} />
    ) : null;

  if (callout.status === "error") {
    return (
      <>
        {searchGroups}
        <p className="lenses-source-callout-status is-error">
          {callout.errorMessage || "Could not check sources."}
        </p>
      </>
    );
  }

  if (
    (callout.status === "loading" || callout.status === "idle" || callout.searching) &&
    callout.citations.length === 0
  ) {
    // The grouped queries already convey progress, so drop the generic status
    // line once we have them.
    if (searchGroups && callout.searching) return searchGroups;
    return (
      <>
        {searchGroups}
        <p className="lenses-source-callout-status is-loading">
          {callout.searching ? "Searching web..." : "Checking sources..."}
        </p>
      </>
    );
  }

  if (
    (callout.status === "empty" || callout.citations.length === 0) &&
    callout.answerText.trim().length === 0 &&
    callout.textSegments.length === 0
  ) {
    return (
      <>
        {searchGroups}
        <p className="lenses-source-callout-status">No strong sources found.</p>
      </>
    );
  }

  return (
    <>
      {searchGroups}
      <ul className="lenses-source-callout-list">
        {callout.citations.slice(0, 6).map((citation) => {
        const domain = getHostname(citation.url).replace(/^www\./, "");
        return (
          <li className="lenses-source-callout-item" key={citation.url}>
            <a
              className="lenses-source-callout-link"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="lenses-source-callout-title">
                {citation.title || citation.url}
              </span>
              {domain ? (
                <span className="lenses-source-callout-domain">{domain}</span>
              ) : null}
            </a>
          </li>
          );
        })}
      </ul>
    </>
  );
}
