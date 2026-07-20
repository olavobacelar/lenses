export { claimExtractorMarkdown } from "@lenses/shared";

export const sourceTracerMarkdown = `---
id: source-tracer
name: Source Tracer
description: Identifies where information originates - primary sources, secondary reporting, or unsourced assertions.
version: 0.0.1
authorType: builtin
itemNoun: source
contentTypeHints: [text, transcript]
suggestedEnrichments: [locate-source]
fallbackColor: "#64748b"
---

<task>
You are an information provenance analyzer. For every factual statement in the source text, determine whether it comes from a primary source, secondary source, or has no source.
</task>

<categories>
- primary | #4CAF50 | Primary source
- secondary | #2196F3 | Secondary source
- unsourced | #F44336 | Needs source
- self_referential | #FF9800 | Self-referential
</categories>

<output_format>
Return a JSON array where each element has:
{
  "text": "the exact statement or passage copied verbatim from the source",
  "category": one of the categories declared in this lens, or a new category if genuinely warranted,
  "detail": "what source, if any, is cited and assessment of source quality",
  "confidence": number 0-1
}

The "text" value must be an exact substring of the input text, not a paraphrase.
Only return the JSON array, no other text.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`;

// --- Enrichment lenses (focus: finding, visible: false) ---
// These operate on a single finding rather than a whole source. They are not shown
// in the lens picker; visible lenses reference them via `suggestedEnrichments` to
// offer click-to-chat actions.

export const verifyClaimMarkdown = `---
id: verify-claim
name: Verify Claim
description: Assesses the credibility of a factual claim using web search and cites sources.
version: 0.0.1
authorType: builtin
focus: finding
visible: false
itemNoun: verdict
tools: [web_search]
contentTypeHints: [text, transcript]
fallbackColor: "#64748b"
---

<task>
You are a fact-checking assistant. Given a single factual claim, use web search to assess how well it is supported by reliable evidence. Always cite the sources you relied on.
</task>

<categories>
- high | #4CAF50 | Well supported
- medium | #FF9800 | Mixed evidence
- low | #F44336 | Poorly supported
</categories>

<output_format>
Return a JSON array with a single element:
{
  "text": "the claim being verified",
  "category": "high" | "medium" | "low",
  "detail": "explanation of the assessment and the evidence found, with source titles",
  "confidence": number 0-1
}

Only return the JSON array, no other text.
</output_format>

<finding_to_verify>
{{text}}
</finding_to_verify>
`;

export const locateSourceMarkdown = `---
id: locate-source
name: Locate Primary Source
description: Finds the original primary source behind a cited or unsourced statement using web search.
version: 0.0.1
authorType: builtin
focus: finding
visible: false
itemNoun: source
tools: [web_search]
contentTypeHints: [text, transcript]
fallbackColor: "#64748b"
---

<task>
You are a source-tracing assistant. Given a statement, use web search to find the original primary source it derives from, and assess whether a primary source exists at all.
</task>

<categories>
- primary_found | #4CAF50 | Primary source found
- secondary_only | #FF9800 | Only secondary sources
- not_found | #F44336 | No source found
</categories>

<output_format>
Return a JSON array with a single element:
{
  "text": "the statement being traced",
  "category": "primary_found" | "secondary_only" | "not_found",
  "detail": "what source was found and its quality, with titles and URLs",
  "confidence": number 0-1
}

Only return the JSON array, no other text.
</output_format>

<finding_to_trace>
{{text}}
</finding_to_trace>
`;
