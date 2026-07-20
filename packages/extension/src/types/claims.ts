/**
 * Claims extraction and verification types
 */

/** Category of a factual claim */
export type ClaimCategory =
  | 'statistic'
  | 'historical'
  | 'scientific'
  | 'quote'
  | 'prediction'
  | 'other';

/** A factual claim extracted from a source */
export interface ExtractedClaim {
  /** Direct quotes from the source supporting this claim */
  quotes: string[];
  /** The factual claim being made, reworded clearly */
  claim: string;
  /** Timestamp for transcript sources, or "--:--" when the source is not time-addressable */
  timestamp: string;
  /** Category of the claim */
  category: ClaimCategory;
  /** PDF page the claim is anchored to (1-based), for PDF sources */
  page?: number;
  /** Printed page label when it differs from the number (e.g., "iv") */
  pageLabel?: string;
  /** Optional verification result (added after verification) */
  verification?: ClaimVerification;
}

/** Result of verifying a claim via web search */
export interface ClaimVerification {
  /** Credibility rating based on search results */
  credibility: 'low' | 'medium' | 'high';
  /** Explanation of the verification */
  explanation: string;
  /** Sources used in verification */
  sources: Array<{
    url: string;
    title: string;
  }>;
}

/** Legacy claim format (for backward compatibility with some UI components) */
export interface SimpleClaim {
  claim: string;
  timestamp: string;
}

/** Progress state during claims extraction */
export interface ClaimsExtractionProgress {
  isExtracting: boolean;
  currentChunk: number;
  totalChunks: number;
  claimsFound: number;
}

/** Category icons mapping for UI */
export const CATEGORY_ICONS: Record<ClaimCategory, string> = {
  statistic: '#',
  historical: 'H',
  scientific: 'S',
  quote: '"',
  prediction: '>',
  other: '*',
};
