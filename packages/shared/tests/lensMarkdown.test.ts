import { describe, it, expect } from "vitest";
import {
  LensConfig,
  parseLensMarkdown,
  serializeLensMarkdown,
  claimExtractorMarkdown,
  domainAllowedByRule,
  domainFromUrl,
  lensAppliesToUrl,
  lensMatchesUrl,
  globToRegExp,
  normalizeDomain,
  setDomainAllowedForRule,
} from "../src/index.js";

// A compact, valid lens with the non-default fields we care about exercising:
// triggers, a custom scope, runMode auto, tools, and a visible:false flag.
const RICH_LENS_MARKDOWN = `---
id: date-finder
name: Date Finder
description: Highlights dates and deadlines on a page.
authorType: user
itemNoun: date
runMode: auto
scope: [page, selection]
allowedDomains: [nytimes.com, example.com]
triggers: ["https://*.nytimes.com/*", "https://example.com/blog/*"]
tools: [web_search]
fallbackColor: "#6366f1"
---

<task>
Find every date in the source text.
</task>

<categories>
- deadline | #F44336 | Deadline
- mention | #4CAF50 | Mention
</categories>

<output_format>
Return a JSON array of dates.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`;

describe("serializeLensMarkdown", () => {
  it("round-trips the built-in claim extractor through parse → serialize → parse", () => {
    const original = parseLensMarkdown(claimExtractorMarkdown);
    const reparsed = parseLensMarkdown(serializeLensMarkdown(original));
    expect(reparsed).toEqual(original);
  });

  it("round-trips a rich user lens, preserving triggers, scope, runMode, and tools", () => {
    const original = parseLensMarkdown(RICH_LENS_MARKDOWN);
    expect(original.triggers).toEqual([
      "https://*.nytimes.com/*",
      "https://example.com/blog/*",
    ]);
    expect(original.allowedDomains).toEqual(["nytimes.com", "example.com"]);
    expect(original.runMode).toBe("auto");
    expect(original.scope).toEqual(["page", "selection"]);

    const reparsed = parseLensMarkdown(serializeLensMarkdown(original));
    expect(reparsed).toEqual(original);
  });

  it("omits default fields but always emits id and name, plus a present description", () => {
    const config = LensConfig.parse({
      id: "minimal",
      name: "Minimal",
      description: "A minimal lens.",
      promptTemplate: "Look at {{text}}",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "match", color: "#000" }],
    });
    const markdown = serializeLensMarkdown(config);

    expect(markdown).toContain("id: minimal");
    expect(markdown).toContain("name: Minimal");
    expect(markdown).toContain("description: A minimal lens.");
    // Defaults are dropped to keep the export terse.
    expect(markdown).not.toContain("runMode:");
    expect(markdown).not.toContain("allowedDomains:");
    expect(markdown).not.toContain("triggers:");
    expect(markdown).not.toContain("scope:");
    expect(markdown).not.toContain("version:");
  });

  it("treats description as optional: omits it when blank and round-trips to empty", () => {
    const config = LensConfig.parse({
      id: "no-desc",
      name: "No Description",
      description: "",
      promptTemplate: "Look at {{text}}",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "match", color: "#000" }],
    });
    const markdown = serializeLensMarkdown(config);
    const parsed = parseLensMarkdown(markdown);

    expect(markdown).not.toContain("description:");
    expect(parsed.description).toBe("");
    // Stable round-trip: re-serializing the parsed config and parsing again is a
    // no-op, so an empty description survives storage without drifting.
    expect(parseLensMarkdown(serializeLensMarkdown(parsed))).toEqual(parsed);
  });

  it("emits triggers as a quoted inline array", () => {
    const config = LensConfig.parse({
      id: "scoped",
      name: "Scoped",
      description: "Scoped lens.",
      promptTemplate: "Look at {{text}}",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "match", color: "#000" }],
      triggers: ["https://*.example.com/*"],
    });
    expect(serializeLensMarkdown(config)).toContain(
      'triggers: ["https://*.example.com/*"]'
    );
  });

  it("emits allowed domains as a lens-level allow-list", () => {
    const config = LensConfig.parse({
      id: "scoped",
      name: "Scoped",
      description: "Scoped lens.",
      promptTemplate: "Look at {{text}}",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "match", color: "#000" }],
      allowedDomains: ["nytimes.com", "nature.com"],
    });
    expect(serializeLensMarkdown(config)).toContain(
      "allowedDomains: [nytimes.com, nature.com]"
    );
  });
});

describe("triggers parsing", () => {
  it("defaults to an empty list when no triggers frontmatter is present", () => {
    expect(parseLensMarkdown(claimExtractorMarkdown).triggers).toEqual([]);
  });
});

describe("lensMatchesUrl", () => {
  it("treats an empty trigger list as matching every page", () => {
    expect(lensMatchesUrl([], "https://anything.com/x")).toBe(true);
    expect(lensMatchesUrl(undefined, "https://anything.com/x")).toBe(true);
  });

  it("ignores blank patterns so a stray empty string does not widen scope", () => {
    expect(lensMatchesUrl(["   "], "https://anything.com/x")).toBe(true);
  });

  it("matches a wildcard subdomain + path glob", () => {
    const triggers = ["https://*.nytimes.com/*"];
    expect(lensMatchesUrl(triggers, "https://www.nytimes.com/2025/article")).toBe(true);
    expect(lensMatchesUrl(triggers, "https://cooking.nytimes.com/recipe")).toBe(true);
    expect(lensMatchesUrl(triggers, "https://nytimes.org/article")).toBe(false);
  });

  it("anchors the whole URL so a pattern is not a loose substring", () => {
    expect(lensMatchesUrl(["https://example.com/blog"], "https://example.com/blog")).toBe(
      true
    );
    expect(
      lensMatchesUrl(["https://example.com/blog"], "https://evil.com/?u=https://example.com/blog")
    ).toBe(false);
  });

  it("matches any one pattern in a multi-pattern allow-list", () => {
    const triggers = ["https://a.com/*", "https://b.com/*"];
    expect(lensMatchesUrl(triggers, "https://b.com/page")).toBe(true);
    expect(lensMatchesUrl(triggers, "https://c.com/page")).toBe(false);
  });

  it("escapes regex metacharacters so dots are literal", () => {
    // The '.' must not act as a regex wildcard: 'axample' should not match.
    expect(globToRegExp("https://example.com/*").test("https://example.com/x")).toBe(true);
    expect(globToRegExp("https://example.com/*").test("https://exampleXcom/x")).toBe(false);
  });

  it("supports '?' as a single-character wildcard", () => {
    expect(globToRegExp("https://example.com/?").test("https://example.com/a")).toBe(true);
    expect(globToRegExp("https://example.com/?").test("https://example.com/ab")).toBe(false);
  });
});

describe("lens domain rules", () => {
  it("normalizes a typed URL or wildcard into a domain", () => {
    expect(normalizeDomain("https://www.nytimes.com/section")).toBe("nytimes.com");
    expect(normalizeDomain("https://cooking.nytimes.com/recipe")).toBe("nytimes.com");
    expect(normalizeDomain("https://news.bbc.co.uk/story")).toBe("bbc.co.uk");
    expect(normalizeDomain("*.substack.com")).toBe("substack.com");
  });

  it("matches allowed domains against the domain and subdomains", () => {
    const lens = LensConfig.parse({
      id: "claim-extractor",
      name: "Claim Extractor",
      description: "Finds claims.",
      promptTemplate: "Look at {{text}}",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "match", color: "#000" }],
      allowedDomains: ["nytimes.com"],
    });

    expect(lensAppliesToUrl(lens, "https://www.nytimes.com/2026/article")).toBe(true);
    expect(lensAppliesToUrl(lens, "https://cooking.nytimes.com/recipe")).toBe(true);
    expect(lensAppliesToUrl(lens, "https://example.com/article")).toBe(false);
  });

  it("lets a domain-side editor add or remove a domain from a lens rule", () => {
    const rule = setDomainAllowedForRule(
      { mode: "domains", allowedDomains: ["nytimes.com"] },
      "www.nature.com",
      true
    );

    expect(rule.allowedDomains).toEqual(["nytimes.com", "nature.com"]);
    expect(domainAllowedByRule(rule, domainFromUrl("https://www.nature.com/a")!)).toBe(true);
    expect(
      setDomainAllowedForRule(rule, "nytimes.com", false).allowedDomains
    ).toEqual(["nature.com"]);
  });

  it("can hide an all-domain lens on one domain without disabling it everywhere", () => {
    const rule = setDomainAllowedForRule(
      { mode: "all", allowedDomains: [], blockedDomains: [] },
      "www.nytimes.com",
      false
    );

    expect(rule).toEqual({
      mode: "all",
      allowedDomains: [],
      blockedDomains: ["nytimes.com"],
    });
    expect(domainAllowedByRule(rule, domainFromUrl("https://www.nytimes.com/a")!)).toBe(false);
    expect(domainAllowedByRule(rule, domainFromUrl("https://www.nature.com/a")!)).toBe(true);
    expect(
      setDomainAllowedForRule(rule, "nytimes.com", true).blockedDomains
    ).toEqual([]);
  });
});
