import { parseLensMarkdown } from "@lenses/shared";
import { claimExtractorMarkdown } from "@lenses/shared";

const sourceTracerMarkdown = `---
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
- primary | #629b64 | Primary source
- secondary | #498dc3 | Secondary source
- unsourced | #c35d55 | Needs source
- self_referential | #ca8e36 | Self-referential
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

export const localBuiltInLensMarkdowns = [
  claimExtractorMarkdown,
  sourceTracerMarkdown,
] as const;

export const localBuiltInLenses = localBuiltInLensMarkdowns.map((markdown) =>
  parseLensMarkdown(markdown)
);
