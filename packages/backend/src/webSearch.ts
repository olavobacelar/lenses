/**
 * Web search stream helpers (backend producer side).
 *
 * The /ask-finding stream relays the model's web searches to the extension so
 * it can render them grouped. These pure helpers pull the query and results out
 * of the provider stream events; they mirror the extension's web-search helpers
 * so both sides agree on the wire shape `{ query, results: [{ url, title }] }`.
 */

export interface WebSearchResultRef {
  url: string;
  title: string;
}

/** Normalize an Anthropic `web_search_tool_result` content array into refs. */
export function parseAnthropicSearchResults(content: unknown): WebSearchResultRef[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  const results: WebSearchResultRef[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof record.title === "string" ? record.title : "";
    results.push({ url, title: title || url });
  }
  return results;
}

/** Read the `query` from an accumulated `server_tool_use` web_search input. */
export function parseSearchQueryJson(input: string): string {
  return parseToolInputField(input, "query");
}

/** Read the `url` from an accumulated `server_tool_use` web_fetch input. */
export function parseFetchUrlJson(input: string): string {
  return parseToolInputField(input, "url");
}

/**
 * Normalize an Anthropic `web_fetch_tool_result` block's `content` into a single
 * page ref. The page url sits at the top and the title nests in the document;
 * error blocks carry no url.
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

function parseToolInputField(input: string, field: string): string {
  if (!input.trim()) return "";
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    return typeof parsed[field] === "string" ? (parsed[field] as string) : "";
  } catch {
    return "";
  }
}

/** Read the search query off an OpenAI `web_search_call` output item. */
export function extractOpenAISearchQuery(item: Record<string, unknown> | undefined): string {
  if (!item || item.type !== "web_search_call") return "";
  const action = item.action;
  if (!action || typeof action !== "object") return "";
  const query = (action as Record<string, unknown>).query;
  return typeof query === "string" ? query : "";
}
