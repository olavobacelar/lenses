import { z } from "zod";

export const PdfTextRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type PdfTextRect = z.infer<typeof PdfTextRect>;

/** How a finding or evidence excerpt attaches to a captured source version. */
export const Anchor = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("transcript"),
    timestamp: z.number().nonnegative(),
    duration: z.number().nonnegative().optional(),
    formatted: z.string().optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("pdf"),
    pageNumber: z.number().int().positive(),
    pageLabel: z.string().optional(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    rects: z.array(PdfTextRect).max(64).optional(),
    pageWidth: z.number().positive().optional(),
    pageHeight: z.number().positive().optional(),
    extractionVersion: z.string().optional(),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type Anchor = z.infer<typeof Anchor>;

/**
 * Canonical shape for a verification verdict. This is a convenience type for the
 * `verify-claim` enrichment lens; the system never switches on it — enrichments
 * are stored generically (see `Enrichment`) so new enrichment kinds need no code.
 */
export const Verification = z.object({
  credibility: z.enum(["low", "medium", "high"]),
  explanation: z.string(),
  sources: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .default([]),
});
export type Verification = z.infer<typeof Verification>;

/**
 * An enrichment is the result of running a finding-focused lens (one with
 * `focus: "finding"`) against a finding — e.g. verifying a claim, locating a
 * primary source, suggesting a rewrite. It is intentionally generic: `data` is a
 * loose string map (like the chat `meta` pattern) so adding a new enrichment kind
 * is a new lens (data), never a schema or code change.
 */
export const Enrichment = z.object({
  lensId: z.string().describe("The finding-focused lens that produced this"),
  summary: z.string().describe("Human-readable result"),
  data: z
    .record(z.string())
    .default({})
    .describe("Loose structured fields, e.g. { credibility: 'high' }"),
  sources: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .default([]),
  addedBy: z.enum(["agent", "user"]).default("agent"),
  at: z.number().describe("Unix ms timestamp"),
});
export type Enrichment = z.infer<typeof Enrichment>;

/**
 * The single artifact every lens produces. A claim is simply a Finding from
 * the Claim Extractor lens. `sourceSpan` is retained for backward
 * compatibility; new code should prefer `anchor`.
 */
export const Finding = z.object({
  text: z.string().describe("The matched text span from the source"),
  category: z.string().describe("Classification category from the lens"),
  detail: z.string().describe("Explanation or additional context"),
  confidence: z.number().min(0).max(1),
  anchor: Anchor.optional().describe(
    "How this finding attaches to its source (text/transcript/pdf/none)"
  ),
  sourceSpan: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional()
    .describe("Compatibility offset; prefer the source-aware `anchor`"),
  quotes: z
    .array(z.string())
    .optional()
    .describe("Supporting evidence spans copied from the source"),
  enrichments: z
    .array(Enrichment)
    .default([])
    .describe("Results of finding-focused lenses (verification, etc.)"),
});
export type Finding = z.infer<typeof Finding>;

export const RunResult = z.object({
  lensId: z.string(),
  findings: z.array(Finding),
  textLength: z.number(),
  modelUsed: z.string(),
});
export type RunResult = z.infer<typeof RunResult>;
