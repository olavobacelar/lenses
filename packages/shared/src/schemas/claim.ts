import { z } from "zod";
import { Finding } from "./finding.js";

export const ClaimType = z.enum([
  "empirical",
  "causal",
  "comparative",
  "predictive",
  "normative",
]);
export type ClaimType = z.infer<typeof ClaimType>;

export const Verifiability = z.enum(["high", "medium", "low"]);
export type Verifiability = z.infer<typeof Verifiability>;

export const ClaimFinding = Finding.extend({
  category: z
    .string()
    .describe("Claim category declared by the active lens, or a new category"),
  attribution: z
    .string()
    .nullable()
    .describe("Who made this claim, if identifiable"),
  verifiability: Verifiability,
});
export type ClaimFinding = z.infer<typeof ClaimFinding>;

export const ClaimExtractionResult = z.object({
  claims: z.array(ClaimFinding),
  textLength: z.number(),
  modelUsed: z.string(),
});
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionResult>;

// Backward-compatible aliases
export const ExtractedClaim = ClaimFinding;
export type ExtractedClaim = ClaimFinding;
export const ExtractionResult = ClaimExtractionResult;
export type ExtractionResult = ClaimExtractionResult;
