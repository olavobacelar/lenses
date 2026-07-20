import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  buildPrompt,
  parseResponse,
  buildCitationPrompt,
  buildCitationRepairPrompt,
  parseCitationResponse,
  enrichWithCitations,
  formatPipelineError,
  PromptConstructionError,
  ParseError,
} from "../src/findings/pipeline.js";
import type { LensConfig } from "@lenses/shared";
import { claimExtractor } from "../src/lenses/built-in/claim-extractor.js";
import { builtInLenses } from "../src/lenses/registry.js";

describe("buildPrompt", () => {
  it("replaces {{text}} placeholder in prompt template", async () => {
    const result = await Effect.runPromise(
      buildPrompt(claimExtractor, "The economy grew by 3% last year.")
    );

    expect(result).toContain("The economy grew by 3% last year.");
    expect(result).not.toContain("{{text}}");
    expect(result).toContain(claimExtractor.outputInstructions);
  });

  it("fails if prompt template has no {{text}} placeholder", async () => {
    const badLens: LensConfig = {
      id: "bad",
      name: "Bad Lens",
      description: "Missing placeholder",
      promptTemplate: "Analyze this text without a placeholder",
      outputInstructions: "Return JSON",
      highlightRules: [],
      version: "0.0.1",
    };

    const result = await Effect.runPromiseExit(buildPrompt(badLens, "test"));
    expect(result._tag).toBe("Failure");
  });

  it("works with all built-in lenses", async () => {
    const text = "Some sample text to analyze.";
    for (const lens of builtInLenses) {
      const result = await Effect.runPromise(buildPrompt(lens, text));
      expect(result).toContain(text);
      expect(result).toContain(lens.outputInstructions);
    }
  });
});

describe("parseResponse", () => {
  it("parses a valid JSON array response", async () => {
    const raw = JSON.stringify([
      {
        text: "GDP grew by 3%",
        category: "empirical",
        detail: "Quantified economic claim",
        confidence: 0.95,
        sourceSpan: { start: 0, end: 14 },
      },
    ]);

    const findings = await Effect.runPromise(parseResponse(raw));
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe("GDP grew by 3%");
    expect(findings[0].category).toBe("empirical");
  });

  it("extracts JSON from markdown code block", async () => {
    const raw = `Here are the claims I found:

\`\`\`json
[
  {
    "text": "unemployment fell",
    "category": "empirical",
    "detail": "Labor market claim",
    "confidence": 0.8
  }
]
\`\`\``;

    const findings = await Effect.runPromise(parseResponse(raw));
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe("unemployment fell");
  });

  it("parses multiple findings", async () => {
    const raw = JSON.stringify([
      {
        text: "claim one",
        category: "empirical",
        detail: "detail one",
        confidence: 0.9,
      },
      {
        text: "claim two",
        category: "causal",
        detail: "detail two",
        confidence: 0.7,
      },
      {
        text: "claim three",
        category: "normative",
        detail: "detail three",
        confidence: 0.6,
      },
    ]);

    const findings = await Effect.runPromise(parseResponse(raw));
    expect(findings).toHaveLength(3);
  });

  it("fails on non-JSON response", async () => {
    const result = await Effect.runPromiseExit(
      parseResponse("I couldn't find any claims in this text.")
    );
    expect(result._tag).toBe("Failure");
  });

  it("fails on invalid JSON", async () => {
    const result = await Effect.runPromiseExit(
      parseResponse("[{invalid json}]")
    );
    expect(result._tag).toBe("Failure");
  });

  it("fails on schema validation errors", async () => {
    const raw = JSON.stringify([
      {
        text: "claim",
        // missing required fields: category, detail, confidence
      },
    ]);

    const result = await Effect.runPromiseExit(parseResponse(raw));
    expect(result._tag).toBe("Failure");
  });
});

describe("formatPipelineError", () => {
  it("surfaces the reason from tagged pipeline errors", async () => {
    try {
      await Effect.runPromise(parseResponse("I couldn't find any claims in this text."));
      throw new Error("Expected parseResponse to fail");
    } catch (error) {
      expect(formatPipelineError(error)).toBe(
        "ParseError: No JSON array found in response"
      );
    }
  });

  it("falls back to normal Error messages", () => {
    expect(formatPipelineError(new Error("plain failure"))).toBe("plain failure");
  });
});

describe("buildCitationPrompt", () => {
  it("lists findings with numbered format", () => {
    const findings = [
      { text: "GDP grew 3%", category: "empirical", detail: "Economic claim", confidence: 0.9 },
      { text: "X causes Y", category: "causal", detail: "Causal link", confidence: 0.8 },
    ];

    const prompt = buildCitationPrompt(findings);
    expect(prompt).toContain('1. [empirical] "GDP grew 3%"');
    expect(prompt).toContain('2. [causal] "X causes Y"');
    expect(prompt).toContain("quote the exact passage");
  });
});

describe("buildCitationRepairPrompt", () => {
  it("includes only missing numbered findings", () => {
    const findings = [
      { text: "GDP grew 3%", category: "empirical", detail: "Economic claim", confidence: 0.9 },
      { text: "X causes Y", category: "causal", detail: "Causal link", confidence: 0.8 },
      { text: "Taxes changed", category: "empirical", detail: "Policy claim", confidence: 0.7 },
    ];

    const prompt = buildCitationRepairPrompt(findings, [1, 2]);
    expect(prompt).toContain('2. [causal] "X causes Y"');
    expect(prompt).toContain('3. [empirical] "Taxes changed"');
    expect(prompt).not.toContain('1. [empirical] "GDP grew 3%"');
  });
});

describe("parseCitationResponse", () => {
  it("collects citations by item number", () => {
    const blocks = [
      { type: "text", text: "1. Here is the passage:" },
      {
        type: "text",
        text: "GDP grew by 3% last year",
        citations: [
          {
            type: "char_location",
            cited_text: "GDP grew by 3% last year",
            start_char_index: 10,
            end_char_index: 34,
          },
        ],
      },
      { type: "text", text: "\n\n2. The second item:" },
      {
        type: "text",
        text: "X causes Y in most studies",
        citations: [
          {
            type: "char_location",
            cited_text: "X causes Y in most studies",
            start_char_index: 50,
            end_char_index: 76,
          },
        ],
      },
    ];

    const result = parseCitationResponse(blocks, 2);
    expect(result.size).toBe(2);

    const first = result.get(0)!;
    expect(first.citedText).toBe("GDP grew by 3% last year");
    expect(first.start).toBe(10);
    expect(first.end).toBe(34);

    const second = result.get(1)!;
    expect(second.citedText).toBe("X causes Y in most studies");
    expect(second.start).toBe(50);
    expect(second.end).toBe(76);
  });

  it("takes the first citation per item when multiple exist", () => {
    const blocks = [
      { type: "text", text: "1." },
      {
        type: "text",
        text: "first quote",
        citations: [
          { type: "char_location", cited_text: "first quote", start_char_index: 0, end_char_index: 11 },
        ],
      },
      {
        type: "text",
        text: "second quote for same item",
        citations: [
          { type: "char_location", cited_text: "second quote", start_char_index: 20, end_char_index: 32 },
        ],
      },
    ];

    const result = parseCitationResponse(blocks, 1);
    expect(result.get(0)!.citedText).toBe("first quote");
  });

  it("ignores citations before any item number is detected", () => {
    const blocks = [
      {
        type: "text",
        text: "Here are the results:",
        citations: [
          { type: "char_location", cited_text: "orphan", start_char_index: 0, end_char_index: 6 },
        ],
      },
      { type: "text", text: "\n1." },
      {
        type: "text",
        text: "actual quote",
        citations: [
          { type: "char_location", cited_text: "actual quote", start_char_index: 10, end_char_index: 22 },
        ],
      },
    ];

    const result = parseCitationResponse(blocks, 1);
    expect(result.size).toBe(1);
    expect(result.get(0)!.citedText).toBe("actual quote");
  });

  it("ignores item numbers out of range", () => {
    const blocks = [
      { type: "text", text: "5." },
      {
        type: "text",
        text: "out of range",
        citations: [
          { type: "char_location", cited_text: "out of range", start_char_index: 0, end_char_index: 12 },
        ],
      },
    ];

    const result = parseCitationResponse(blocks, 2);
    expect(result.size).toBe(0);
  });

  it("handles blocks with no citations", () => {
    const blocks = [
      { type: "text", text: "1. No citations here" },
      { type: "text", text: "2. Also no citations" },
    ];

    const result = parseCitationResponse(blocks, 2);
    expect(result.size).toBe(0);
  });

  it("handles 'Item N:' format", () => {
    const blocks = [
      { type: "text", text: "Item 1:" },
      {
        type: "text",
        text: "the passage",
        citations: [
          { type: "char_location", cited_text: "the passage", start_char_index: 5, end_char_index: 16 },
        ],
      },
    ];

    const result = parseCitationResponse(blocks, 1);
    expect(result.size).toBe(1);
    expect(result.get(0)!.citedText).toBe("the passage");
  });
});

describe("enrichWithCitations", () => {
  const findings = [
    { text: "Claim one", category: "empirical", detail: "Detail one", confidence: 0.9 },
    { text: "Claim two", category: "causal", detail: "Detail two", confidence: 0.8 },
  ];

  const citation = (text: string, start: number, end: number) => ({
    type: "char_location",
    cited_text: text,
    start_char_index: start,
    end_char_index: end,
  });

  it("does not retry when all findings are cited on first pass", async () => {
    const prompts: string[] = [];
    const result = await Effect.runPromise(
      enrichWithCitations(findings, "source", "test-key", "test-model", {
        requestCitations: async (prompt) => {
          prompts.push(prompt);
          return [
            { type: "text", text: "1." },
            { type: "text", text: "quote one", citations: [citation("quote one", 0, 8)] },
            { type: "text", text: "2." },
            { type: "text", text: "quote two", citations: [citation("quote two", 9, 17)] },
          ];
        },
      })
    );

    expect(prompts).toHaveLength(1);
    expect(result.citationsIncomplete).toBe(false);
    expect(result.missingCitationIndices).toEqual([]);
    expect(result.findings[0].sourceSpan).toEqual({ start: 0, end: 8 });
    expect(result.findings[1].sourceSpan).toEqual({ start: 9, end: 17 });
  });

  it("retries once and fills missing citations", async () => {
    const prompts: string[] = [];
    let callCount = 0;
    const result = await Effect.runPromise(
      enrichWithCitations(findings, "source", "test-key", "test-model", {
        requestCitations: async (prompt) => {
          prompts.push(prompt);
          callCount += 1;
          if (callCount === 1) {
            return [
              { type: "text", text: "1." },
              { type: "text", text: "quote one", citations: [citation("quote one", 0, 8)] },
            ];
          }
          return [
            { type: "text", text: "2." },
            { type: "text", text: "quote two", citations: [citation("quote two", 9, 17)] },
          ];
        },
      })
    );

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('2. [causal] "Claim two"');
    expect(result.citationsIncomplete).toBe(false);
    expect(result.missingCitationIndices).toEqual([]);
    expect(result.findings[1].sourceSpan).toEqual({ start: 9, end: 17 });
  });

  it("flags incomplete citations when still missing after one retry", async () => {
    const prompts: string[] = [];
    let callCount = 0;
    const result = await Effect.runPromise(
      enrichWithCitations(findings, "source", "test-key", "test-model", {
        requestCitations: async (prompt) => {
          prompts.push(prompt);
          callCount += 1;
          if (callCount === 1) {
            return [
              { type: "text", text: "1." },
              { type: "text", text: "quote one", citations: [citation("quote one", 0, 8)] },
            ];
          }
          return [];
        },
      })
    );

    expect(prompts).toHaveLength(2);
    expect(result.citationsIncomplete).toBe(true);
    expect(result.missingCitationIndices).toEqual([1]);
    expect(result.findings[1].sourceSpan).toBeUndefined();
  });
});

describe("built-in lens configs", () => {
  it("all have unique IDs", () => {
    const ids = builtInLenses.map((lens) => lens.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all have {{text}} in their prompt templates", () => {
    for (const lens of builtInLenses) {
      expect(lens.promptTemplate).toContain("{{text}}");
    }
  });

  it("all have non-empty highlight rules", () => {
    for (const lens of builtInLenses) {
      expect(lens.highlightRules.length).toBeGreaterThan(0);
    }
  });

  it("all highlight rules have valid CSS colors", () => {
    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const lens of builtInLenses) {
      for (const rule of lens.highlightRules) {
        expect(rule.color).toMatch(colorRegex);
      }
    }
  });
});
