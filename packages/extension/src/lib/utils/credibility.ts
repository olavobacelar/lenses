/**
 * Credibility rating utilities
 */

export type CredibilityRating = 'low' | 'medium' | 'high';

/**
 * Extract credibility rating from text and return cleaned text + rating
 */
export function extractCredibilityRating(text: string): {
  text: string;
  rating: CredibilityRating | null;
} {
  const match = text.match(/\[CREDIBILITY:\s*(Low|Medium|High)\]\s*$/i);
  if (match) {
    return {
      text: text.slice(0, match.index).trim(),
      rating: match[1].toLowerCase() as CredibilityRating,
    };
  }
  return { text, rating: null };
}

/**
 * Get label for credibility rating
 */
export function getCredibilityLabel(rating: CredibilityRating): string {
  const labels: Record<CredibilityRating, string> = {
    low: 'Low Credibility',
    medium: 'Medium Credibility',
    high: 'High Credibility',
  };
  return labels[rating];
}

/**
 * Get icon for credibility rating
 */
export function getCredibilityIcon(rating: CredibilityRating): string {
  const icons: Record<CredibilityRating, string> = {
    low: '✗',
    medium: '~',
    high: '✓',
  };
  return icons[rating];
}
