import { LensConfig, parseLensMarkdown } from "@lenses/shared";

// A custom lens runs as a single-category highlighter: the user describes, in
// free text, what to find, and the model returns matching spans all under one
// "match" category. Keeping a single fixed category means the extension can
// pick a predictable highlight color without knowing the categories ahead of
// time (unlike the built-in lenses, whose categories are hard-coded).
export const CUSTOM_LENS_ID = "custom-lens";
export const CUSTOM_LENS_CATEGORY = "match";
export const CUSTOM_LENS_COLOR = "#6366f1";

// User text is embedded into the lens prompt, so it must not be able to inject
// markdown section headers or XML-style tags that the lens-markdown parser
// treats as structural (## categories, <output_format>, ...). Stripping angle
// brackets and leading heading markers neutralizes that without mangling the
// natural-language instruction the model reads.
function sanitizeInstruction(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[<>]/g, " ")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\{\{\s*text\s*\}\}/g, "the source text")
    .trim();
}

function sanitizeName(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n:]+/g, " ")
    .replace(/[<>"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Custom Lens";
}

// Cap on the number of words a generated lens name may have. The UI shows the
// name in a single accordion chip beside built-in lenses ("Claims", "Sources"),
// so a 2-3 word title keeps the row from wrapping.
const LENS_NAME_MAX_WORDS = 3;

function toTitleCaseWord(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase();
}

// Normalize a model-produced lens name into the compact 2-3 word Title Case form
// the UI expects. The model occasionally wraps the name in quotes, adds trailing
// punctuation, or returns a whole sentence, so we strip non-word edges, collapse
// whitespace, cap the word count, and Title Case each word. An empty result
// falls back to the generic label rather than rendering a blank chip.
export function normalizeGeneratedLensName(raw: string | undefined): string {
  const collapsed = (raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
  const words = collapsed.split(" ").filter((word) => word.length > 0);
  if (words.length === 0) return "Custom Lens";
  return words.slice(0, LENS_NAME_MAX_WORDS).map(toTitleCaseWord).join(" ");
}

// A deterministic name derived from the instruction itself, used when the naming
// model call fails or is skipped. Keeping it here (next to the model-output
// normalizer) means both the happy path and the fallback produce the same shape.
export function fallbackLensName(instruction: string): string {
  const normalized = normalizeGeneratedLensName(instruction);
  return normalized === "Custom Lens" ? "Custom Lens" : normalized;
}

// The prompt that turns a free-text lens instruction into a short title. It runs
// through the same callModel path as a lens run (see runs:generateLensName), so
// naming reuses the finding pipeline's model wiring rather than a separate one.
export function buildLensNamePrompt(instruction: string): string {
  const cleaned = sanitizeInstruction(instruction);
  return `You name highlighting lenses. A lens highlights spans of a document that match an instruction.

Give a concise ${LENS_NAME_MAX_WORDS === 3 ? "2-3" : LENS_NAME_MAX_WORDS} word name in Title Case, with no punctuation and no quotes, for a lens with this instruction:

"${cleaned}"

Reply with only the name.`;
}

export function buildCustomLensMarkdown(options: {
  instruction: string;
  lensId?: string;
  name?: string;
}): string {
  const instruction = sanitizeInstruction(options.instruction);
  if (!instruction) {
    throw new Error("Custom lens instruction cannot be empty");
  }
  const lensId = options.lensId?.trim() || CUSTOM_LENS_ID;
  const name = sanitizeName(options.name);

  return `---
id: ${lensId}
name: ${name}
description: Custom lens defined from the popup composer.
version: 0.0.1
authorType: user
itemNoun: finding
contentTypeHints: [text, transcript]
fallbackColor: "${CUSTOM_LENS_COLOR}"
---

<task>
You are a custom highlighting lens. Find every span of the source text that matches this instruction:

"${instruction}"

For each matching span, copy the exact text verbatim and explain briefly why it matches.
Be precise: only highlight spans that genuinely match the instruction. If nothing matches, return an empty array.
</task>

<categories>
- ${CUSTOM_LENS_CATEGORY} | ${CUSTOM_LENS_COLOR} | Match
</categories>

<output_format>
Return a JSON array where each element has:
{
  "text": "the exact span copied verbatim from the source",
  "category": "${CUSTOM_LENS_CATEGORY}",
  "detail": "why this span matches the instruction",
  "confidence": number between 0 and 1
}

Only return the JSON array, no other text.
</output_format>

<text_to_analyze>
{{text}}
</text_to_analyze>
`;
}

// Convenience wrapper used by the run action: build the markdown and parse it
// into a LensConfig the finding pipeline can execute.
export function buildCustomLensConfig(options: {
  instruction: string;
  lensId?: string;
  name?: string;
}): LensConfig {
  return parseLensMarkdown(buildCustomLensMarkdown(options));
}
