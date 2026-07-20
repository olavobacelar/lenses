import { describe, it, expect } from "vitest";
import { parseLensMarkdown } from "@lenses/shared";
import {
  draftFromConfig,
  draftToConfig,
  draftToMarkdown,
  emptyDraft,
  exportFilename,
  lensFromRow,
  listToInput,
  parseListInput,
  slugify,
  validateDraft,
} from "../src/lib/lens-library.js";

const SAMPLE_MARKDOWN = `---
id: date-finder
name: Date Finder
description: Highlights dates and deadlines.
authorType: user
itemNoun: date
runMode: auto
allowedDomains: [nytimes.com]
triggers: ["https://*.nytimes.com/*"]
---

<task>
Find every date in {{text}}.
</task>

<categories>
- deadline | #F44336 | Deadline
- mention | #4CAF50 | Mention
</categories>

<output_format>
Return a JSON array of dates.
</output_format>
`;

describe("emptyDraft", () => {
  it("produces a draft that is one name away from valid", () => {
    const draft = emptyDraft();
    expect(draft.promptTemplate).toContain("{{text}}");
    expect(draft.categories.length).toBeGreaterThan(0);
    expect(validateDraft(draft)).toContain("Name is required.");
  });
});

describe("draftFromConfig / draftToConfig round-trip", () => {
  it("preserves a lens through config → draft → config", () => {
    const original = parseLensMarkdown(SAMPLE_MARKDOWN);
    const rebuilt = draftToConfig(draftFromConfig(original));
    expect(rebuilt).toEqual(original);
  });

  it("carries allowed domains, triggers, and runMode into the draft", () => {
    const draft = draftFromConfig(parseLensMarkdown(SAMPLE_MARKDOWN));
    expect(draft.allowedDomains).toEqual(["nytimes.com"]);
    expect(draft.triggers).toEqual(["https://*.nytimes.com/*"]);
    expect(draft.runMode).toBe("auto");
    expect(draft.categories).toEqual([
      { value: "deadline", color: "#F44336", label: "Deadline" },
      { value: "mention", color: "#4CAF50", label: "Mention" },
    ]);
  });
});

describe("draftToMarkdown", () => {
  it("emits markdown that parses back to the same config", () => {
    const draft = draftFromConfig(parseLensMarkdown(SAMPLE_MARKDOWN));
    const markdown = draftToMarkdown(draft);
    expect(parseLensMarkdown(markdown)).toEqual(draftToConfig(draft));
    expect(markdown).toContain("allowedDomains: [nytimes.com]");
    expect(markdown).toContain('triggers: ["https://*.nytimes.com/*"]');
  });

  it("derives an id from the name when none is set", () => {
    const draft = emptyDraft();
    draft.name = "My New Lens";
    draft.description = "Does a thing.";
    expect(draftToConfig(draft).id).toBe("my-new-lens");
  });
});

describe("validateDraft", () => {
  it("flags a missing {{text}} placeholder", () => {
    const draft = emptyDraft();
    draft.name = "X";
    draft.description = "Y";
    draft.promptTemplate = "no placeholder here";
    expect(validateDraft(draft)).toContain(
      "Prompt must include the {{text}} placeholder."
    );
  });

  it("flags a draft with no usable category", () => {
    const draft = emptyDraft();
    draft.name = "X";
    draft.description = "Y";
    draft.categories = [{ value: "", color: "", label: "" }];
    expect(validateDraft(draft)).toContain(
      "Add at least one category with a value and color."
    );
  });

  it("returns no errors for a complete draft", () => {
    const draft = draftFromConfig(parseLensMarkdown(SAMPLE_MARKDOWN));
    expect(validateDraft(draft)).toEqual([]);
  });

  it("does not require a description", () => {
    const draft = emptyDraft();
    draft.name = "Nameless finder";
    draft.description = "";
    const errors = validateDraft(draft);
    expect(errors).not.toContain("Description is required.");
    expect(errors).toEqual([]);
  });

  it("round-trips a description-less draft through markdown", () => {
    const draft = emptyDraft();
    draft.name = "No Desc";
    draft.description = "";
    const markdown = draftToMarkdown(draft);
    expect(parseLensMarkdown(markdown).description).toBe("");
  });
});

describe("list input helpers", () => {
  it("splits on newlines and commas, trims, and dedupes", () => {
    expect(parseListInput("https://a.com/*\nhttps://b.com/*, https://a.com/*")).toEqual([
      "https://a.com/*",
      "https://b.com/*",
    ]);
  });

  it("round-trips through listToInput", () => {
    const list = ["https://a.com/*", "https://b.com/*"];
    expect(parseListInput(listToInput(list))).toEqual(list);
  });

  it("treats an all-blank input as an empty list", () => {
    expect(parseListInput("  \n , \n")).toEqual([]);
  });
});

describe("lensFromRow", () => {
  // Minimal row shape a Convex `lenses` document carries: lensId (not id), the
  // required config columns, plus the table-only fields the parser must ignore.
  function sampleRow(overrides: Record<string, unknown> = {}) {
    return {
      _id: "abc123",
      _creationTime: 1,
      lensId: "date-finder",
      name: "Date Finder",
      description: "Highlights dates.",
      promptTemplate: "Find dates in {{text}}.",
      outputInstructions: "Return JSON.",
      highlightRules: [{ condition: "category", value: "deadline", color: "#F44336" }],
      isBuiltIn: true,
      markdown: "---\nid: date-finder\n---\n",
      ...overrides,
    };
  }

  it("re-keys lensId to id and reports provenance", () => {
    const result = lensFromRow(sampleRow());
    expect(result).not.toBeNull();
    expect(result?.config.id).toBe("date-finder");
    expect(result?.isBuiltIn).toBe(true);
  });

  it("strips Convex-only columns so the config parses cleanly", () => {
    const result = lensFromRow(sampleRow({ isBuiltIn: false }));
    expect(result?.isBuiltIn).toBe(false);
    expect(result?.config).not.toHaveProperty("_id");
    expect(result?.config).not.toHaveProperty("markdown");
    expect(result?.config).not.toHaveProperty("lensId");
  });

  it("returns null for a malformed row instead of throwing", () => {
    expect(lensFromRow(null)).toBeNull();
    expect(lensFromRow({ name: "no lensId" })).toBeNull();
    expect(lensFromRow(sampleRow({ name: 123 }))).toBeNull();
  });
});

describe("slugify and exportFilename", () => {
  it("slugifies a name into a url-safe id", () => {
    expect(slugify("My New Lens!")).toBe("my-new-lens");
  });

  it("names the export file after the lens id", () => {
    const draft = emptyDraft();
    draft.id = "date-finder";
    expect(exportFilename(draft)).toBe("date-finder.md");
  });
});
