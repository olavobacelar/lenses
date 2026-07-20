import { describe, it, expect } from "vitest";
import {
  extractOpenAISearchQuery,
  parseAnthropicSearchResults,
  parseFetchUrlJson,
  parseSearchQueryJson,
  parseWebFetchResult,
} from "../src/webSearch.js";

describe("parseAnthropicSearchResults", () => {
  it("maps a web_search_tool_result content array, deduping by url", () => {
    expect(
      parseAnthropicSearchResults([
        { type: "web_search_result", url: "https://a.com", title: "A" },
        { type: "web_search_result", url: "https://a.com", title: "dup" },
        { type: "web_search_result", url: "https://b.com", title: "" },
      ])
    ).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "https://b.com" },
    ]);
  });

  it("returns an empty list for an error block or non-array", () => {
    expect(parseAnthropicSearchResults({ error_code: "max_uses_exceeded" })).toEqual([]);
    expect(parseAnthropicSearchResults(null)).toEqual([]);
  });
});

describe("parseSearchQueryJson", () => {
  it("reads the query from a completed tool input", () => {
    expect(parseSearchQueryJson('{"query":"karuna meditation"}')).toBe("karuna meditation");
  });

  it("returns an empty string for partial or invalid json", () => {
    expect(parseSearchQueryJson('{"query":"kar')).toBe("");
    expect(parseSearchQueryJson("")).toBe("");
  });
});

describe("parseFetchUrlJson", () => {
  it("reads the url from a completed web_fetch tool input", () => {
    expect(parseFetchUrlJson('{"url":"https://example.com/article"}')).toBe(
      "https://example.com/article"
    );
  });

  it("returns an empty string for partial or invalid json", () => {
    expect(parseFetchUrlJson('{"url":"https://exa')).toBe("");
    expect(parseFetchUrlJson("")).toBe("");
  });
});

describe("parseWebFetchResult", () => {
  it("pulls the page url and nested document title", () => {
    expect(
      parseWebFetchResult({
        type: "web_fetch_result",
        url: "https://example.com/article",
        content: { type: "document", title: "The Article" },
      })
    ).toEqual({ url: "https://example.com/article", title: "The Article" });
  });

  it("returns null for an error block or missing url", () => {
    expect(parseWebFetchResult({ type: "web_fetch_tool_error" })).toBeNull();
    expect(parseWebFetchResult(null)).toBeNull();
  });
});

describe("extractOpenAISearchQuery", () => {
  it("reads the query off a web_search_call item action", () => {
    expect(
      extractOpenAISearchQuery({ type: "web_search_call", action: { type: "search", query: "q" } })
    ).toBe("q");
  });

  it("returns an empty string for unrelated items", () => {
    expect(extractOpenAISearchQuery({ type: "message" })).toBe("");
    expect(extractOpenAISearchQuery(undefined)).toBe("");
  });
});
