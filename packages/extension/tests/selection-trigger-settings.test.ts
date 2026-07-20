import { describe, expect, it } from "vitest";
import {
  parseSelectionTriggerSettings,
  readSelectionTriggerDomainStyles,
  resolveSelectionTriggerStyle,
  selectionTriggerMatchesUrl,
  SELECTION_TRIGGER_DOMAIN_STYLES_KEY,
  SELECTION_TRIGGER_STYLE_KEY,
  type SelectionTriggerSettings,
} from "../src/lib/selection-trigger-settings";

function settings(overrides: Partial<SelectionTriggerSettings> = {}): SelectionTriggerSettings {
  return {
    enabled: true,
    visibilityMode: "all",
    allowedDomains: [],
    disabledHosts: [],
    style: "immediate",
    domainStyles: [],
    ...overrides,
  };
}

describe("readSelectionTriggerDomainStyles", () => {
  it("normalizes domains and keeps the chosen style", () => {
    const rules = readSelectionTriggerDomainStyles([
      { domain: "https://www.NYTimes.com/world", style: "modifier" },
    ]);
    expect(rules).toEqual([{ domain: "nytimes.com", style: "modifier" }]);
  });

  it("drops entries without a usable domain and dedupes by normalized domain", () => {
    const rules = readSelectionTriggerDomainStyles([
      { domain: "", style: "modifier" },
      { domain: "example.com", style: "modifier" },
      { domain: "www.example.com", style: "immediate" },
      { style: "modifier" },
      "not-an-object",
    ]);
    expect(rules).toEqual([{ domain: "example.com", style: "modifier" }]);
  });

  it("falls back to immediate for an unknown or legacy style", () => {
    const rules = readSelectionTriggerDomainStyles([
      { domain: "a.com", style: "bogus" },
      { domain: "b.com", style: "manual" },
    ]);
    expect(rules).toEqual([
      { domain: "a.com", style: "immediate" },
      { domain: "b.com", style: "immediate" },
    ]);
  });

  it("returns an empty list for non-array input", () => {
    expect(readSelectionTriggerDomainStyles(undefined)).toEqual([]);
    expect(readSelectionTriggerDomainStyles("nope")).toEqual([]);
  });
});

describe("resolveSelectionTriggerStyle", () => {
  it("uses a matching override, including subdomains", () => {
    const resolved = resolveSelectionTriggerStyle(
      settings({ style: "immediate", domainStyles: [{ domain: "nytimes.com", style: "modifier" }] }),
      "https://www.nytimes.com/2026/article"
    );
    expect(resolved).toBe("modifier");
  });

  it("falls back to the global default when no override matches", () => {
    const resolved = resolveSelectionTriggerStyle(
      settings({ style: "modifier", domainStyles: [{ domain: "nytimes.com", style: "immediate" }] }),
      "https://example.com/page"
    );
    expect(resolved).toBe("modifier");
  });

  it("returns the first matching override when several could apply", () => {
    const resolved = resolveSelectionTriggerStyle(
      settings({
        domainStyles: [
          { domain: "example.com", style: "modifier" },
          { domain: "example.com", style: "immediate" },
        ],
      }),
      "https://example.com"
    );
    expect(resolved).toBe("modifier");
  });
});

describe("parseSelectionTriggerSettings", () => {
  it("reads the global style and per-domain overrides from storage", () => {
    const parsed = parseSelectionTriggerSettings({
      [SELECTION_TRIGGER_STYLE_KEY]: "modifier",
      [SELECTION_TRIGGER_DOMAIN_STYLES_KEY]: [{ domain: "example.com", style: "immediate" }],
    });
    expect(parsed.style).toBe("modifier");
    expect(parsed.domainStyles).toEqual([{ domain: "example.com", style: "immediate" }]);
  });

  it("defaults to immediate with no overrides", () => {
    const parsed = parseSelectionTriggerSettings({});
    expect(parsed.style).toBe("immediate");
    expect(parsed.domainStyles).toEqual([]);
  });
});

describe("selectionTriggerMatchesUrl with overrides present", () => {
  it("gating is independent of per-domain style overrides", () => {
    const config = settings({
      visibilityMode: "selected",
      allowedDomains: ["example.com"],
      domainStyles: [{ domain: "other.com", style: "modifier" }],
    });
    expect(selectionTriggerMatchesUrl(config, "https://example.com")).toBe(true);
    expect(selectionTriggerMatchesUrl(config, "https://other.com")).toBe(false);
  });
});
