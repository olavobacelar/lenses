/**
 * Zod schemas for claims extraction and validation
 *
 * Used with provider structured-output features to ensure valid JSON responses
 * for claims extraction.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Claim Category
// ─────────────────────────────────────────────────────────────

export const ClaimCategorySchema = z.enum([
  'statistic',
  'historical',
  'scientific',
  'quote',
  'prediction',
  'other',
]);

// ─────────────────────────────────────────────────────────────
// Extracted Claim (from full transcript extraction)
// ─────────────────────────────────────────────────────────────

export const ExtractedClaimSchema = z.object({
  quotes: z.array(z.string()).describe('Direct quotes from the transcript supporting this claim'),
  claim: z.string().describe('The factual claim being made, reworded clearly'),
  timestamp: z.string().describe('Timestamp where the claim first appears (e.g., "3:45")'),
  category: ClaimCategorySchema.describe('Category of the claim'),
});

/** Schema for the full claims extraction output (structured outputs response) */
export const AllClaimsOutputSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
});

// ─────────────────────────────────────────────────────────────
// Simple Claim (from segment extraction)
// ─────────────────────────────────────────────────────────────

export const SimpleClaimSchema = z.object({
  claim: z.string(),
  timestamp: z.string(),
});

/** Schema for segment claims extraction output */
export const SegmentClaimsOutputSchema = z.object({
  claims: z.array(SimpleClaimSchema),
});

// ─────────────────────────────────────────────────────────────
// Provider-neutral JSON Schema format
// ─────────────────────────────────────────────────────────────

/**
 * JSON Schema for extracting all claims from full transcript.
 * Each provider client translates this into its native output-format option.
 */
export const ALL_CLAIMS_JSON_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quotes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Direct quotes from the transcript supporting this claim (can be multiple)',
            },
            claim: {
              type: 'string',
              description: 'The factual claim being made, reworded clearly',
            },
            timestamp: {
              type: 'string',
              description: 'Timestamp where the claim first appears (e.g., "3:45")',
            },
            category: {
              type: 'string',
              enum: ['statistic', 'historical', 'scientific', 'quote', 'prediction', 'other'],
              description: 'Category of the claim',
            },
          },
          required: ['quotes', 'claim', 'timestamp', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['claims'],
    additionalProperties: false,
  },
};

/**
 * JSON Schema for extracting claims from a single segment.
 */
export const SEGMENT_CLAIMS_JSON_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            timestamp: { type: 'string' },
          },
          required: ['claim', 'timestamp'],
          additionalProperties: false,
        },
      },
    },
    required: ['claims'],
    additionalProperties: false,
  },
};

// ─────────────────────────────────────────────────────────────
// Credibility Rating Schema (for verification follow-up)
// ─────────────────────────────────────────────────────────────

/**
 * JSON Schema for credibility rating.
 * Used as structured output for the follow-up verification call.
 */
export const CREDIBILITY_RATING_JSON_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      rating: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Credibility rating based on the verification analysis',
      },
    },
    required: ['rating'],
    additionalProperties: false,
  },
};

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Parse claims from a provider response JSON string.
 * Returns empty array if parsing fails.
 */
export function parseClaimsResponse(jsonString: string) {
  try {
    const data = JSON.parse(jsonString);
    const result = AllClaimsOutputSchema.safeParse(data);
    return result.success ? result.data.claims : [];
  } catch {
    return [];
  }
}

/**
 * Parse simple claims from a provider response JSON string.
 * Returns empty array if parsing fails.
 */
export function parseSegmentClaimsResponse(jsonString: string) {
  try {
    const data = JSON.parse(jsonString);
    const result = SegmentClaimsOutputSchema.safeParse(data);
    return result.success ? result.data.claims : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Inferred Types
// ─────────────────────────────────────────────────────────────

export type ParsedClaim = z.infer<typeof ExtractedClaimSchema>;
export type ParsedSimpleClaim = z.infer<typeof SimpleClaimSchema>;
export type ClaimCategory = z.infer<typeof ClaimCategorySchema>;
