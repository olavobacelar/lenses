import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendActivityThinkingDelta,
  finishActivityThinking,
  foldActivitySearchEvent,
  startActivityThinking,
  type ChatActivityItem,
} from "../src/lib/chat-activity.js";
import {
  foldSearchEvent,
  isSearchInFlight,
  parseWebFetchResult,
  parseWebFetchUrl,
  parseWebSearchQuery,
  parseWebSearchResults,
  type WebSearchEntry,
} from "../src/lib/web-search.js";

const here = dirname(fileURLToPath(import.meta.url));
const extSrc = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(extSrc, ...parts), "utf-8");

describe("foldSearchEvent — searches", () => {
  it("opens a pending search on start, carrying the query", () => {
    const searches = foldSearchEvent([], { event: "start", query: "shinzen young karuna" });
    expect(searches).toEqual([
      { kind: "search", query: "shinzen young karuna", url: "", results: [], done: false },
    ]);
    expect(isSearchInFlight(searches)).toBe(true);
  });

  it("closes the open search on end, attaching results and marking done", () => {
    let searches: WebSearchEntry[] = foldSearchEvent([], { event: "start", query: "q1" });
    searches = foldSearchEvent(searches, {
      event: "end",
      query: "q1",
      results: [{ url: "https://a.com/x", title: "A" }],
    });
    expect(searches).toEqual([
      {
        kind: "search",
        query: "q1",
        url: "",
        results: [{ url: "https://a.com/x", title: "A" }],
        done: true,
      },
    ]);
    expect(isSearchInFlight(searches)).toBe(false);
  });

  it("keeps multiple sequential searches in order", () => {
    let searches: WebSearchEntry[] = [];
    searches = foldSearchEvent(searches, { event: "start", query: "first" });
    searches = foldSearchEvent(searches, {
      event: "end",
      query: "first",
      results: [{ url: "https://a.com", title: "A" }],
    });
    searches = foldSearchEvent(searches, { event: "start", query: "second" });
    searches = foldSearchEvent(searches, {
      event: "end",
      query: "second",
      results: [{ url: "https://b.com", title: "B" }],
    });

    expect(searches.map((s) => s.query)).toEqual(["first", "second"]);
    expect(searches.every((s) => s.done)).toBe(true);
  });

  it("fills the query at end when the start lacked one (OpenAI ordering)", () => {
    let searches: WebSearchEntry[] = foldSearchEvent([], { event: "start" });
    expect(searches[0].query).toBe("");
    searches = foldSearchEvent(searches, { event: "end", query: "late query" });
    expect(searches[0]).toEqual({
      kind: "search",
      query: "late query",
      url: "",
      results: [],
      done: true,
    });
  });

  it("records a completion that arrives without a matching start", () => {
    const searches = foldSearchEvent([], {
      event: "end",
      query: "orphan",
      results: [{ url: "https://c.com", title: "C" }],
    });
    expect(searches).toEqual([
      {
        kind: "search",
        query: "orphan",
        url: "",
        results: [{ url: "https://c.com", title: "C" }],
        done: true,
      },
    ]);
  });

  it("ignores an empty end with no open search", () => {
    expect(foldSearchEvent([], { event: "end" })).toEqual([]);
  });

  it("dedupes results by url and falls back to the url for a missing title", () => {
    let searches: WebSearchEntry[] = foldSearchEvent([], { event: "start", query: "q" });
    searches = foldSearchEvent(searches, {
      event: "end",
      results: [
        { url: "https://a.com", title: "A" },
        { url: "https://a.com", title: "A dup" },
        { url: "https://b.com", title: "" },
      ],
    });
    expect(searches[0].results).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "https://b.com" },
    ]);
  });
});

describe("foldSearchEvent — fetches", () => {
  it("opens a pending fetch on start, carrying the url", () => {
    const searches = foldSearchEvent([], {
      event: "start",
      kind: "fetch",
      url: "https://example.com/article",
    });
    expect(searches).toEqual([
      { kind: "fetch", query: "", url: "https://example.com/article", results: [], done: false },
    ]);
    expect(isSearchInFlight(searches)).toBe(true);
  });

  it("closes the open fetch on end, carrying the page as its single result", () => {
    let searches: WebSearchEntry[] = foldSearchEvent([], {
      event: "start",
      kind: "fetch",
      url: "https://example.com/article",
    });
    searches = foldSearchEvent(searches, {
      event: "end",
      kind: "fetch",
      url: "https://example.com/article",
      title: "The Article",
    });
    expect(searches).toEqual([
      {
        kind: "fetch",
        query: "",
        url: "https://example.com/article",
        results: [{ url: "https://example.com/article", title: "The Article" }],
        done: true,
      },
    ]);
  });

  it("interleaves searches and fetches in order, pairing each end to its own kind", () => {
    let steps: WebSearchEntry[] = [];
    steps = foldSearchEvent(steps, { event: "start", kind: "search", query: "topic" });
    // a fetch opens while the search is still open; its end must close the fetch
    steps = foldSearchEvent(steps, { event: "start", kind: "fetch", url: "https://p.com" });
    steps = foldSearchEvent(steps, {
      event: "end",
      kind: "fetch",
      url: "https://p.com",
      title: "P",
    });
    steps = foldSearchEvent(steps, {
      event: "end",
      kind: "search",
      query: "topic",
      results: [{ url: "https://s.com", title: "S" }],
    });

    expect(steps.map((s) => s.kind)).toEqual(["search", "fetch"]);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[0].results).toEqual([{ url: "https://s.com", title: "S" }]);
    expect(steps[1].results).toEqual([{ url: "https://p.com", title: "P" }]);
  });
});

describe("chat activity timeline folding", () => {
  it("keeps thinking and research rounds in stream order", () => {
    let activity: ChatActivityItem[] = [];
    activity = startActivityThinking(activity);
    activity = appendActivityThinkingDelta(activity, "Plan first.");
    activity = finishActivityThinking(activity);
    activity = foldActivitySearchEvent(activity, { event: "start", query: "first" });
    activity = foldActivitySearchEvent(activity, {
      event: "end",
      query: "first",
      results: [{ url: "https://first.test", title: "First" }],
    });
    activity = startActivityThinking(activity);
    activity = appendActivityThinkingDelta(activity, "Need a second pass.");
    activity = finishActivityThinking(activity);
    activity = foldActivitySearchEvent(activity, { event: "start", query: "second" });
    activity = foldActivitySearchEvent(activity, {
      event: "end",
      query: "second",
      results: [{ url: "https://second.test", title: "Second" }],
    });

    expect(activity.map((item) => item.kind)).toEqual([
      "thinking",
      "research",
      "thinking",
      "research",
    ]);
    expect(activity[0]).toMatchObject({ kind: "thinking", text: "Plan first.", live: false });
    expect(activity[1]).toMatchObject({
      kind: "research",
      live: false,
      searches: [{ query: "first", done: true }],
    });
    expect(activity[2]).toMatchObject({
      kind: "thinking",
      text: "Need a second pass.",
      live: false,
    });
    expect(activity[3]).toMatchObject({
      kind: "research",
      live: false,
      searches: [{ query: "second", done: true }],
    });
  });

  it("groups adjacent search and fetch events into the same research block", () => {
    let activity: ChatActivityItem[] = [];
    activity = foldActivitySearchEvent(activity, { event: "start", query: "topic" });
    activity = foldActivitySearchEvent(activity, {
      event: "start",
      kind: "fetch",
      url: "https://page.test",
    });
    activity = foldActivitySearchEvent(activity, {
      event: "end",
      kind: "fetch",
      url: "https://page.test",
      title: "Page",
    });
    activity = foldActivitySearchEvent(activity, {
      event: "end",
      query: "topic",
      results: [{ url: "https://result.test", title: "Result" }],
    });

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      kind: "research",
      live: false,
      searches: [
        { kind: "search", query: "topic", done: true },
        { kind: "fetch", url: "https://page.test", done: true },
      ],
    });
  });
});

describe("parseWebSearchResults", () => {
  it("maps an Anthropic web_search_tool_result content array", () => {
    const results = parseWebSearchResults([
      { type: "web_search_result", url: "https://a.com", title: "A" },
      { type: "web_search_result", url: "https://b.com", title: "B" },
    ]);
    expect(results).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
    ]);
  });

  it("returns an empty list for a non-array (e.g. an error block)", () => {
    expect(parseWebSearchResults({ type: "web_search_tool_result_error" })).toEqual([]);
    expect(parseWebSearchResults(undefined)).toEqual([]);
  });
});

describe("parseWebFetchResult / parseWebFetchUrl", () => {
  it("pulls the page url and nested document title from a web_fetch_result", () => {
    expect(
      parseWebFetchResult({
        type: "web_fetch_result",
        url: "https://example.com/article",
        content: { type: "document", title: "The Article" },
        retrieved_at: "2026-01-01T00:00:00Z",
      })
    ).toEqual({ url: "https://example.com/article", title: "The Article" });
  });

  it("returns null for an error block or missing url", () => {
    expect(parseWebFetchResult({ type: "web_fetch_tool_error", error_code: "url_not_accessible" })).toBeNull();
    expect(parseWebFetchResult(undefined)).toBeNull();
  });

  it("reads the url from a completed web_fetch tool input", () => {
    expect(parseWebFetchUrl('{"url":"https://example.com"}')).toBe("https://example.com");
    expect(parseWebFetchUrl('{"url":"https://exa')).toBe("");
  });
});

describe("parseWebSearchQuery", () => {
  it("reads the query from a completed tool input", () => {
    expect(parseWebSearchQuery('{"query":"meditation karuna"}')).toBe("meditation karuna");
  });

  it("returns an empty string for partial or invalid json", () => {
    expect(parseWebSearchQuery('{"query":"hal')).toBe("");
    expect(parseWebSearchQuery("")).toBe("");
  });
});

describe("the grouped web-research view is shared from lib/ across surfaces", () => {
  it("lives in lib/, beside the other shared renderers", () => {
    expect(existsSync(join(extSrc, "lib", "WebSearchGroups.tsx"))).toBe(true);
    expect(existsSync(join(extSrc, "lib", "web-search.ts"))).toBe(true);
  });

  it("is rendered by the sidepanel, the in-page chatbox, and the source callout", () => {
    expect(read("sidepanel", "components", "MessageList.tsx")).toContain("ChatMessageList");
    expect(read("content", "ChatboxView.tsx")).toContain("ChatMessageList");
    expect(read("lib", "ChatUi.tsx")).toContain("WebSearchGroups");
    expect(read("content", "SourceCalloutStack.tsx")).toContain("WebSearchGroups");
  });

  it("renders fetched pages, not only searches", () => {
    expect(read("lib", "WebSearchGroups.tsx")).toContain("Read the page");
  });

  it("each surface folds the stream events with the shared helper", () => {
    // The fold itself lives in the shared chat-stream reducer; both chat
    // surfaces route their port events through it. (content.ts also calls
    // foldSearchEvent directly for the source-callout one-shot stream.)
    expect(read("lib", "chat-stream.ts")).toContain("foldSearchEvent");
    expect(read("sidepanel", "hooks", "useChat.ts")).toContain("applyChatStreamEvent");
    expect(read("content", "content.ts")).toContain("applyChatStreamEvent");
  });
});

describe("web_fetch is wired into every producer", () => {
  it("is declared as a tool on the sidepanel + source paths", () => {
    expect(read("background", "assistant-streaming.ts")).toContain("web_fetch_20250910");
    expect(read("background", "source-stream.ts")).toContain("web_fetch_20250910");
  });

  it("is parsed by the Anthropic sidepanel stream processor", () => {
    expect(read("background", "api", "stream-processor.ts")).toContain("web_fetch_tool_result");
  });

  it("is dropped on the OpenAI path (Anthropic-only tool)", () => {
    expect(read("background", "api", "openai-client.ts")).toContain("web_fetch");
  });
});
