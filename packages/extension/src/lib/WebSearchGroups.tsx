import { GlobeIcon } from "@radix-ui/react-icons";
import { getHostname } from "./RichText.js";
import { isSearchInFlight, type WebSearchEntry, type WebSearchResultRef } from "./web-search.js";

/**
 * Renders the model's web research — searches and page reads — grouped step by
 * step, like Claude's "Searched the web" block. Shared across the sidepanel, the
 * in-page chatbox, and the source callout so every surface presents it
 * identically.
 *
 * While the answer is still streaming (`live`), the steps stay expanded so the
 * user can watch queries, results, and fetches arrive. Once finalized they
 * collapse behind a disclosure to keep the transcript low-chrome.
 */
export function WebSearchGroups({
  searches,
  live = false,
}: {
  searches: WebSearchEntry[];
  live?: boolean;
}) {
  if (searches.length === 0) return null;

  const searchCount = searches.filter((entry) => entry.kind === "search").length;
  const fetchCount = searches.length - searchCount;
  const inFlight = live || isSearchInFlight(searches);
  const hasSearches = searchCount > 0;

  const summary = (
    <span className="lenses-websearch-summary">
      <GlobeIcon className="lenses-websearch-icon" aria-hidden="true" focusable="false" />
      <span className="lenses-websearch-label">
        {inFlight
          ? hasSearches
            ? "Searching the web"
            : "Reading the web"
          : hasSearches
            ? "Searched the web"
            : "Read the web"}
      </span>
      <span className="lenses-websearch-count">{summarizeSteps(searchCount, fetchCount)}</span>
    </span>
  );

  const body = (
    <ol className="lenses-websearch-list">
      {searches.map((entry, index) => (
        <SearchGroup key={`${index}:${entry.kind}:${entry.query || entry.url}`} entry={entry} />
      ))}
    </ol>
  );

  if (live) {
    return (
      <div className="lenses-websearch is-live">
        {summary}
        {body}
      </div>
    );
  }

  return (
    <details className="lenses-websearch">
      <summary className="lenses-websearch-trigger">{summary}</summary>
      {body}
    </details>
  );
}

function SearchGroup({ entry }: { entry: WebSearchEntry }) {
  const isFetch = entry.kind === "fetch";
  const label = isFetch
    ? entry.done
      ? "Read the page"
      : "Reading the page…"
    : entry.query || "Searching the web…";
  const count = entry.done
    ? isFetch
      ? "read"
      : formatResultCount(entry.results.length)
    : "…";
  // A fetch knows its url before the page title resolves, so fall back to it.
  const links =
    entry.results.length > 0
      ? entry.results
      : isFetch && entry.url
        ? [{ url: entry.url, title: "" }]
        : [];

  return (
    <li className={`lenses-websearch-group ${isFetch ? "is-fetch" : ""} ${entry.done ? "" : "is-pending"}`}>
      <div className="lenses-websearch-query-row">
        <span className="lenses-websearch-query">{label}</span>
        <span className="lenses-websearch-result-count">{count}</span>
      </div>
      <ResultLinks results={links.slice(0, 6)} />
    </li>
  );
}

function ResultLinks({ results }: { results: WebSearchResultRef[] }) {
  if (results.length === 0) return null;
  return (
    <ul className="lenses-websearch-results">
      {results.map((result) => {
        const domain = getHostname(result.url).replace(/^www\./, "");
        return (
          <li className="lenses-websearch-result" key={result.url}>
            <a
              className="lenses-websearch-result-link"
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="lenses-websearch-result-title">{result.title || result.url}</span>
              {domain ? <span className="lenses-websearch-result-domain">{domain}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function summarizeSteps(searchCount: number, fetchCount: number): string {
  const parts: string[] = [];
  if (searchCount > 0) {
    parts.push(searchCount === 1 ? "1 search" : `${searchCount} searches`);
  }
  if (fetchCount > 0) {
    parts.push(fetchCount === 1 ? "1 page" : `${fetchCount} pages`);
  }
  return parts.join(" · ");
}

function formatResultCount(count: number): string {
  if (count === 0) return "no results";
  return count === 1 ? "1 result" : `${count} results`;
}
