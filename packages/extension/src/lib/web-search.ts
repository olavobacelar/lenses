/**
 * Web research grouping
 *
 * Before it answers, the model can run several web searches and read several
 * pages — Anthropic's server-side `web_search` and `web_fetch` tools loop
 * internally up to `max_uses` times, each result landing in the model's context
 * so the next step is informed by the last. The stream reports each step as a
 * `searching` start/end pair carrying a `kind` ("search" or "fetch") plus the
 * query/url and what it returned. These helpers fold that sequence into an
 * ordered list so every chat surface renders the same grouped "Searched the
 * web" trace from the same data.
 */

export type WebSearchKind = "search" | "fetch";

export interface WebSearchResultRef {
  url: string;
  title: string;
}

export interface WebSearchEntry {
  /** "search" = a web_search query; "fetch" = a web_fetch of one page. */
  kind: WebSearchKind;
  /** Search query (kind="search"). Empty for fetches. */
  query: string;
  /** Fetched page URL (kind="fetch"). Empty for searches. */
  url: string;
  /** Search results (kind="search") or the single fetched page (kind="fetch"). */
  results: WebSearchResultRef[];
  /** False while the step is in flight, true once its results have arrived. */
  done: boolean;
}

export interface WebSearchEvent {
  event: "start" | "end";
  /** Defaults to "search" so existing producers stay source-compatible. */
  kind?: WebSearchKind;
  query?: string;
  url?: string;
  title?: string;
  results?: WebSearchResultRef[];
}

/**
 * Fold one streamed step event into the running list. Searches and fetches run
 * sequentially, so a `start` opens a new entry and an `end` closes the most
 * recent open one of the same kind — pairing by recency rather than by id keeps
 * producers free of having to thread tool-use ids through the stream.
 */
export function foldSearchEvent(
  searches: WebSearchEntry[],
  event: WebSearchEvent
): WebSearchEntry[] {
  const kind: WebSearchKind = event.kind ?? "search";

  if (event.event === "start") {
    return [
      ...searches,
      {
        kind,
        query: event.query?.trim() ?? "",
        url: event.url?.trim() ?? "",
        results: [],
        done: false,
      },
    ];
  }

  const endResults = resultsFromEvent(kind, event);
  const openIndex = lastOpenIndex(searches, kind);
  if (openIndex < 0) {
    // A completion arrived without a matching start (e.g. a provider that only
    // reports completions). Record it directly so nothing is dropped.
    if (!event.query && !event.url && endResults.length === 0) return searches;
    return [
      ...searches,
      {
        kind,
        query: event.query?.trim() ?? "",
        url: event.url?.trim() ?? "",
        results: endResults,
        done: true,
      },
    ];
  }

  const next = [...searches];
  const open = next[openIndex];
  next[openIndex] = {
    kind: open.kind,
    query: open.query || (event.query?.trim() ?? ""),
    url: open.url || (event.url?.trim() ?? ""),
    results: endResults.length ? endResults : open.results,
    done: true,
  };
  return next;
}

/** True while any step is still in flight — drives the live indicator. */
export function isSearchInFlight(searches: WebSearchEntry[]): boolean {
  return searches.some((search) => !search.done);
}

function resultsFromEvent(kind: WebSearchKind, event: WebSearchEvent): WebSearchResultRef[] {
  if (kind === "fetch") {
    // A fetch reads one page; carry it as a single result so the renderer can
    // reuse the same link row as search results.
    const url = event.url?.trim() ?? "";
    if (!url) return [];
    return dedupeResults([{ url, title: event.title?.trim() ?? "" }]);
  }
  return dedupeResults(event.results ?? []);
}

function lastOpenIndex(searches: WebSearchEntry[], kind: WebSearchKind): number {
  for (let index = searches.length - 1; index >= 0; index--) {
    const entry = searches[index];
    if (!entry.done && entry.kind === kind) return index;
  }
  return -1;
}

function dedupeResults(results: WebSearchResultRef[]): WebSearchResultRef[] {
  const seen = new Set<string>();
  const deduped: WebSearchResultRef[] = [];
  for (const result of results) {
    const url = typeof result?.url === "string" ? result.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof result.title === "string" ? result.title.trim() : "";
    deduped.push({ url, title: title || url });
  }
  return deduped;
}

/**
 * Normalize the raw `content` array of an Anthropic `web_search_tool_result`
 * block into result refs. The block can also carry an error object instead of
 * an array, so non-array input yields an empty list.
 */
export function parseWebSearchResults(content: unknown): WebSearchResultRef[] {
  if (!Array.isArray(content)) return [];
  const results: WebSearchResultRef[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url) continue;
    const title = typeof record.title === "string" ? record.title : "";
    results.push({ url, title });
  }
  return dedupeResults(results);
}

/**
 * Pull the query string out of a `server_tool_use` web_search input. The input
 * is accumulated as partial JSON during streaming, so parsing can fail
 * mid-flight — callers get an empty string until the block completes.
 */
export function parseWebSearchQuery(toolInputJson: string): string {
  return parseToolInputField(toolInputJson, "query");
}

/** Pull the `url` out of a `server_tool_use` web_fetch input (see above). */
export function parseWebFetchUrl(toolInputJson: string): string {
  return parseToolInputField(toolInputJson, "url");
}

/**
 * Normalize an Anthropic `web_fetch_tool_result` block's `content` into a single
 * page ref. The block nests the page under `content.web_fetch_result` with the
 * url at the top and the title inside the document; errors carry no url.
 */
export function parseWebFetchResult(content: unknown): WebSearchResultRef | null {
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : "";
  if (!url) return null;
  const doc = record.content;
  const title =
    doc && typeof doc === "object" && typeof (doc as Record<string, unknown>).title === "string"
      ? ((doc as Record<string, unknown>).title as string)
      : "";
  return { url, title };
}

function parseToolInputField(toolInputJson: string, field: string): string {
  if (!toolInputJson.trim()) return "";
  try {
    const parsed = JSON.parse(toolInputJson) as Record<string, unknown>;
    return typeof parsed[field] === "string" ? (parsed[field] as string) : "";
  } catch {
    return "";
  }
}
