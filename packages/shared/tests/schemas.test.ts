import { describe, it, expect } from "vitest";
import {
  ExtractedClaim,
  ExtractionResult,
  ClaimType,
  Verifiability,
  LensConfig,
  Finding,
  RunResult,
  Anchor,
  Enrichment,
  claimExtractorMarkdown,
  parseLensMarkdown,
} from "../src/index.js";

describe("ClaimType schema", () => {
  it("accepts valid claim types", () => {
    expect(ClaimType.parse("empirical")).toBe("empirical");
    expect(ClaimType.parse("causal")).toBe("causal");
    expect(ClaimType.parse("comparative")).toBe("comparative");
    expect(ClaimType.parse("predictive")).toBe("predictive");
    expect(ClaimType.parse("normative")).toBe("normative");
  });

  it("rejects invalid claim types", () => {
    expect(() => ClaimType.parse("opinion")).toThrow();
    expect(() => ClaimType.parse("")).toThrow();
  });
});

describe("ExtractedClaim schema", () => {
  it("accepts a valid claim", () => {
    const claim = ExtractedClaim.parse({
      text: "Remote workers are 13% more productive",
      category: "empirical",
      detail: "Productivity claim attributed to a study",
      attribution: "Stanford study",
      verifiability: "high",
      confidence: 0.9,
    });

    expect(claim.text).toBe("Remote workers are 13% more productive");
    expect(claim.attribution).toBe("Stanford study");
  });

  it("accepts lens-defined claim categories outside the built-in suggestions", () => {
    const claim = ExtractedClaim.parse({
      text: "The paper relies on the author's previous work",
      category: "self_citation",
      detail: "A user-authored lens can define this claim category",
      attribution: null,
      verifiability: "medium",
      confidence: 0.8,
    });

    expect(claim.category).toBe("self_citation");
  });

  it("accepts null attribution", () => {
    const claim = ExtractedClaim.parse({
      text: "The economy is improving",
      category: "empirical",
      detail: "General economic claim without direct source",
      attribution: null,
      verifiability: "medium",
      confidence: 0.7,
    });

    expect(claim.attribution).toBeNull();
  });

  it("accepts optional sourceSpan", () => {
    const claim = ExtractedClaim.parse({
      text: "Test claim",
      category: "causal",
      detail: "Test causal claim",
      attribution: null,
      verifiability: "low",
      confidence: 0.5,
      sourceSpan: { start: 10, end: 25 },
    });

    expect(claim.sourceSpan?.start).toBe(10);
  });

  it("rejects confidence outside 0-1 range", () => {
    expect(() =>
      ExtractedClaim.parse({
        text: "Test",
        category: "empirical",
        detail: "Test claim detail",
        attribution: null,
        verifiability: "high",
        confidence: 1.5,
      })
    ).toThrow();
  });
});

describe("LensConfig schema", () => {
  it("accepts a valid lens config", () => {
    const lens = LensConfig.parse({
      id: "test-lens",
      name: "Test Lens",
      description: "A test lens",
      promptTemplate: "Analyze this: {{text}}",
      outputInstructions: "Return JSON array",
      highlightRules: [
        { condition: "category", value: "test", color: "#ff0000" },
      ],
    });

    expect(lens.id).toBe("test-lens");
    expect(lens.version).toBe("0.0.1"); // default
  });

  it("accepts skill-style lens markdown", () => {
    const lens = parseLensMarkdown(`---
id: self-citation-detector
name: Self-Citation Detector
description: Highlights self-citation patterns.
version: 1.0.0
authorType: user
contentTypeHints: [text, transcript]
---

<task>
Find places where an author cites their own previous work.
</task>

<categories>
- cites_own_paper | #E91E63 | Cites own paper
- cites_own_book | #9C27B0 | Cites own book
</categories>

<output_format>
Return a JSON array with text, category, detail, and confidence.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`);

    expect(lens.id).toBe("self-citation-detector");
    expect(lens.authorType).toBe("user");
    expect(lens.contentTypeHints).toEqual(["text", "transcript"]);
    expect(lens.outputCategories.map((category) => category.name)).toEqual([
      "cites_own_paper",
      "cites_own_book",
    ]);
    expect(lens.promptTemplate).toContain("{{text}}");
    expect(lens.promptTemplate).not.toContain("<output_format>");
  });

  it("defaults the new lens fields", () => {
    const lens = LensConfig.parse({
      id: "test-lens",
      name: "Test Lens",
      description: "A test lens",
      promptTemplate: "Analyze this: {{text}}",
      outputInstructions: "Return JSON array",
      highlightRules: [
        { condition: "category", value: "test", color: "#ff0000" },
      ],
    });

    expect(lens.itemNoun).toBe("finding");
    expect(lens.outputKind).toBe("items");
    expect(lens.runMode).toBe("manual");
    expect(lens.allowedDomains).toEqual([]);
    expect(lens.tools).toEqual([]);
    expect(lens.suggestedEnrichments).toEqual([]);
    expect(lens.visible).toBe(true);
  });

  it("parses a lens run mode from markdown", () => {
    const lens = parseLensMarkdown(`---
id: auto-claim-extractor
name: Auto Claim Extractor
description: Extracts factual claims.
runMode: auto
---

<categories>
- empirical | #4CAF50 | Empirical claim
</categories>

<output_format>
Return a JSON array.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`);

    expect(lens.runMode).toBe("auto");
  });

  it("treats legacy autoRun frontmatter as auto run mode", () => {
    const lens = parseLensMarkdown(`---
id: url-triggered-lens
name: URL Triggered Lens
description: Runs automatically on matching pages.
autoRun: true
---

<categories>
- match | #4CAF50 | Match
</categories>

<output_format>
Return a JSON array.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`);

    expect(lens.runMode).toBe("auto");
  });

  it("declares Claim Extractor as an auto-running lens", () => {
    const lens = parseLensMarkdown(claimExtractorMarkdown);
    expect(lens.id).toBe("claim-extractor");
    expect(lens.runMode).toBe("auto");
  });

  it("parses itemNoun and suggestedEnrichments from markdown", () => {
    const lens = parseLensMarkdown(`---
id: claim-extractor
name: Claim Extractor
description: Extracts factual claims.
itemNoun: claim
contentTypeHints: [text, transcript]
suggestedEnrichments: [verify-claim]
---

<categories>
- empirical | #4CAF50 | Empirical claim
</categories>

<output_format>
Return a JSON array with text, category, detail, and confidence.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`);

    expect(lens.itemNoun).toBe("claim");
    expect(lens.suggestedEnrichments).toEqual([
      { lensId: "verify-claim", auto: false },
    ]);
    expect(lens.visible).toBe(true);
  });

  it("parses a hidden finding-focused enrichment lens with tools", () => {
    const lens = parseLensMarkdown(`---
id: verify-claim
name: Verify Claim
description: Assesses credibility via web search.
focus: finding
visible: false
itemNoun: verdict
tools: [web_search]
---

<categories>
- high | #4CAF50 | Well supported
- low | #F44336 | Poorly supported
</categories>

<output_format>
Return a JSON array with text, category, detail, and confidence.
</output_format>

<finding_to_verify>
{{text}}
</finding_to_verify>
`);

    expect(lens.focus).toBe("finding");
    expect(lens.visible).toBe(false);
    expect(lens.itemNoun).toBe("verdict");
    expect(lens.tools).toEqual(["web_search"]);
  });

  it("parses an eager enrichment flagged with :auto", () => {
    const lens = parseLensMarkdown(`---
id: claim-extractor
name: Claim Extractor
description: Extracts factual claims.
suggestedEnrichments: [verify-claim:auto]
---

<categories>
- empirical | #4CAF50 | Empirical claim
</categories>

<output_format>
Return a JSON array.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`);

    expect(lens.suggestedEnrichments).toEqual([
      { lensId: "verify-claim", auto: true },
    ]);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      LensConfig.parse({
        id: "test",
        name: "Test",
      })
    ).toThrow();
  });
});

describe("Finding schema", () => {
  it("accepts valid findings", () => {
    const finding = Finding.parse({
      text: "studies show that",
      category: "weasel_word",
      detail: "Vague attribution without specific study citation",
      confidence: 0.85,
    });

    expect(finding.category).toBe("weasel_word");
  });

  it("accepts findings with sourceSpan", () => {
    const finding = Finding.parse({
      text: "test",
      category: "empirical",
      detail: "detail",
      confidence: 0.5,
      sourceSpan: { start: 0, end: 4 },
    });

    expect(finding.sourceSpan?.start).toBe(0);
  });

  it("defaults enrichments to an empty array", () => {
    const finding = Finding.parse({
      text: "studies show that",
      category: "weasel_word",
      detail: "Vague attribution",
      confidence: 0.85,
    });

    expect(finding.enrichments).toEqual([]);
  });

  it("accepts a transcript anchor and quotes", () => {
    const finding = Finding.parse({
      text: "80% of studies rely on self-reported data",
      category: "empirical",
      detail: "Statistic stated in the video",
      confidence: 0.9,
      anchor: { kind: "transcript", timestamp: 200, formatted: "03:20" },
      quotes: ["About 80% of these studies rely on people remembering"],
    });

    expect(finding.anchor).toEqual({
      kind: "transcript",
      timestamp: 200,
      formatted: "03:20",
    });
    expect(finding.quotes).toHaveLength(1);
  });

  it("accepts a transcript claim as a unified finding with a verification enrichment", () => {
    const finding = Finding.parse({
      text: "The trial found a 23% reduction in cardiac events",
      category: "empirical",
      detail: "Headline statistic",
      confidence: 0.93,
      anchor: { kind: "text", start: 10, end: 60 },
      enrichments: [
        {
          lensId: "verify-claim",
          summary: "Well supported by the cited trial",
          data: { credibility: "high" },
          sources: [{ url: "https://example.com/trial", title: "5-year trial" }],
          at: 1748400000000,
        },
      ],
    });

    expect(finding.enrichments[0].lensId).toBe("verify-claim");
    expect(finding.enrichments[0].data.credibility).toBe("high");
    expect(finding.enrichments[0].addedBy).toBe("agent"); // default
  });
});

describe("Anchor schema", () => {
  it("accepts text, transcript, PDF, and none variants", () => {
    expect(Anchor.parse({ kind: "text", start: 0, end: 5 }).kind).toBe("text");
    expect(
      Anchor.parse({ kind: "transcript", timestamp: 12, formatted: "00:12" }).kind
    ).toBe("transcript");
    expect(
      Anchor.parse({
        kind: "pdf",
        pageNumber: 2,
        start: 4,
        end: 9,
        rects: [{ x: 10, y: 20, width: 30, height: 8 }],
      }).kind
    ).toBe("pdf");
    expect(Anchor.parse({ kind: "none" }).kind).toBe("none");
  });

  it("rejects an unknown anchor kind", () => {
    expect(() => Anchor.parse({ kind: "page", n: 3 })).toThrow();
  });
});

describe("Enrichment schema", () => {
  it("defaults data, sources, and addedBy", () => {
    const enrichment = Enrichment.parse({
      lensId: "verify-claim",
      summary: "Mixed evidence",
      at: 1748400000000,
    });

    expect(enrichment.data).toEqual({});
    expect(enrichment.sources).toEqual([]);
    expect(enrichment.addedBy).toBe("agent");
  });
});

describe("RunResult schema", () => {
  it("accepts a full run result", () => {
    const result = RunResult.parse({
      lensId: "claim-extractor",
      findings: [
        {
          text: "GDP grew by 3%",
          category: "empirical",
          detail: "Quantified economic claim",
          confidence: 0.95,
        },
      ],
      textLength: 500,
      modelUsed: "claude-sonnet-4-20250514",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.lensId).toBe("claim-extractor");
  });
});
