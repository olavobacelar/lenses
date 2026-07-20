import { z } from "zod";
import { SourceScopeKind } from "./source.js";

export const LensAuthorType = z.enum(["builtin", "user", "managed"]);
export type LensAuthorType = z.infer<typeof LensAuthorType>;

export const LensFocusKind = z.enum(["source", "selection", "finding", "run"]);
export type LensFocusKind = z.infer<typeof LensFocusKind>;

/**
 * Whether a lens emits a list of items (most lenses) or a single holistic finding
 * about the whole source (a summary, a rating). Drives whether the sidebar renders
 * the lens's section as a list of rows or a single card.
 */
export const LensOutputKind = z.enum(["items", "holistic"]);
export type LensOutputKind = z.infer<typeof LensOutputKind>;

/**
 * Whether a source/selection lens should start on its own when applicable or
 * wait for an explicit user action.
 */
export const LensRunMode = z.enum(["manual", "auto"]);
export type LensRunMode = z.infer<typeof LensRunMode>;

/**
 * A finding-focused lens this lens offers as a follow-up on its findings (e.g. the
 * Claim Extractor suggests `verify-claim`). `auto: true` runs it eagerly after
 * extraction; `auto: false` (default) surfaces it as an on-demand action in chat.
 */
export const SuggestedEnrichment = z.object({
  lensId: z.string(),
  auto: z.boolean().default(false),
});
export type SuggestedEnrichment = z.infer<typeof SuggestedEnrichment>;

export const OutputCategory = z.object({
  name: z.string().describe("Stable category value emitted by the lens"),
  description: z.string().optional(),
  color: z.string().describe("CSS color for this category"),
  label: z.string().optional().describe("Human-readable label for the UI"),
});
export type OutputCategory = z.infer<typeof OutputCategory>;

export const HighlightRule = z.object({
  condition: z.string().describe("A key from the finding output to match on"),
  value: z.string().describe("The value to match"),
  color: z.string().describe("CSS color for the highlight"),
  label: z.string().optional().describe("Human-readable label for the legend"),
});
export type HighlightRule = z.infer<typeof HighlightRule>;

export const LensConfig = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  promptTemplate: z.string().describe("Prompt sent to the LLM with {{text}} placeholder"),
  outputInstructions: z
    .string()
    .describe("Instructions for the LLM on how to structure the JSON output"),
  highlightRules: z.array(HighlightRule),
  version: z.string().default("0.0.1"),
  authorType: LensAuthorType.default("builtin"),
  defaultModel: z.string().optional(),
  contentTypeHints: z.array(z.string()).default(["text"]),
  outputCategories: z.array(OutputCategory).default([]),
  fallbackColor: z.string().default("#64748b"),
  focus: LensFocusKind.default("source"),
  scope: z.array(SourceScopeKind).default(["page"]),
  itemNoun: z
    .string()
    .default("finding")
    .describe("Singular UI label for this lens's findings, e.g. 'claim'"),
  outputKind: LensOutputKind.default("items"),
  runMode: LensRunMode.default("manual").describe(
    "Whether the lens runs automatically when source content is available"
  ),
  triggers: z
    .array(z.string())
    .default([])
    .describe(
      "URL glob patterns (e.g. 'https://*.nytimes.com/*') that scope where this lens applies and auto-runs. Empty means every page."
    ),
  allowedDomains: z
    .array(z.string())
    .default([])
    .describe(
      "Domain allow-list for this lens. Empty means every domain; entries match the domain and its subdomains."
    ),
  tools: z
    .array(z.string())
    .default([])
    .describe("Primitive tools this lens may call, e.g. ['web_search']"),
  suggestedEnrichments: z.array(SuggestedEnrichment).default([]),
  visible: z
    .boolean()
    .default(true)
    .describe("Whether the lens appears in the picker; enrichment lenses set false"),
});
export type LensConfig = z.infer<typeof LensConfig>;
