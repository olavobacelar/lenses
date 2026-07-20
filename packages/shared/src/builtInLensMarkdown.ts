export const claimExtractorMarkdown = `---
id: claim-extractor
name: Claim Extractor
description: Extracts factual claims from text and rates their verifiability.
version: 0.0.1
authorType: builtin
itemNoun: claim
runMode: auto
contentTypeHints: [text, transcript]
suggestedEnrichments: [verify-claim]
fallbackColor: "#64748b"
---

<task>
You are a claim extraction engine. Analyze the source text and extract every distinct factual claim.

For each claim, determine:
- category: "empirical" (states a measurable fact), "causal" (asserts X causes Y), "comparative" (compares two things), "predictive" (forecasts the future), or "normative" (says how things should be)
- attribution: who made this claim, or null if the text presents it as its own assertion
- verifiability: "high" (can be checked against data/studies), "medium" (partially checkable), or "low" (subjective or vague)
- confidence: 0-1 how confident you are in the extraction accuracy
</task>

<categories>
- empirical | #4CAF50 | Empirical claim
- causal | #2196F3 | Causal claim
- comparative | #9C27B0 | Comparative claim
- predictive | #FF9800 | Predictive claim
- normative | #F44336 | Normative claim
</categories>

<output_format>
Return a JSON array where each element has:
{
  "text": "the claim as stated",
  "category": one of the categories declared in this lens, or a new category if genuinely warranted,
  "detail": "brief explanation of what makes this a claim and its attribution",
  "confidence": number 0-1
}

Only return the JSON array, no other text.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`;
