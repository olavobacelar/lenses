/**
 * Claims Extraction Prompts
 *
 * Prompt builders for claim extraction from transcripts.
 */

/**
 * Build prompt for extracting ALL claims from a full transcript
 */
export function buildAllClaimsExtractionPrompt(transcriptText: string, videoTitle: string): string {
  return `You are analyzing a YouTube video transcript to extract EVERY verifiable factual claim.

VIDEO: ${videoTitle || 'Unknown'}

TRANSCRIPT:
${transcriptText}

IMPORTANT: Extract EVERY factual claim from this transcript. Be exhaustive - do not skip any claims. Go through the entire transcript from start to finish and identify ALL verifiable statements.

For each claim:
1. Include exact quotes from the transcript that support the claim (can be multiple quotes if the argument spans different parts)
2. Reword the claim clearly and concisely
3. Note the timestamp where the claim first appears
4. Categorize the claim type

Categories:
- statistic: Numbers, percentages, quantities
- historical: Past events, dates, historical facts
- scientific: Scientific claims, research findings
- quote: Attributed statements from people
- prediction: Future predictions or forecasts
- other: Other verifiable claims

What counts as a claim:
- Any statement that can be fact-checked
- Names, dates, numbers, statistics
- References to events, companies, people, products
- Technical assertions
- Comparisons or rankings
- Cause-and-effect statements

Do NOT skip claims just because they seem minor. Extract everything that is verifiable.

Return all claims found. If no verifiable claims exist, return an empty claims array.`;
}

/**
 * Build prompt for extracting claims from a transcript chunk
 */
export function buildChunkClaimsExtractionPrompt(
  chunkText: string,
  startTime: string,
  endTime: string,
  videoTitle: string,
  previousClaims: string[] = []
): string {
  let previousClaimsSection = '';
  if (previousClaims.length > 0) {
    previousClaimsSection = `
PREVIOUSLY EXTRACTED CLAIMS (do NOT repeat these):
${previousClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

`;
  }

  return `You are analyzing a chunk of a YouTube video transcript to extract verifiable factual claims.

VIDEO: ${videoTitle || 'Unknown'}
CHUNK: ${startTime} to ${endTime}

${previousClaimsSection}TRANSCRIPT CHUNK:
${chunkText}

IMPORTANT: Extract ALL factual claims from this chunk. Be exhaustive.
${previousClaims.length > 0 ? 'Do NOT extract claims that are semantically equivalent to the previously extracted claims listed above.' : ''}

For each claim:
1. Include exact quotes from the transcript that support the claim (can be multiple quotes)
2. Reword the claim clearly and concisely
3. Note the timestamp where the claim first appears
4. Categorize the claim type

Categories:
- statistic: Numbers, percentages, quantities
- historical: Past events, dates, historical facts
- scientific: Scientific claims, research findings
- quote: Attributed statements from people
- prediction: Future predictions or forecasts
- other: Other verifiable claims

Return all claims found. If no verifiable claims exist, return an empty claims array.`;
}

/**
 * Build prompt for extracting claims from a segment around current time
 */
export function buildSegmentClaimExtractionPrompt(
  transcriptSegment: string,
  currentTime: string,
  startTime: string,
  endTime: string
): string {
  return `You are analyzing a video transcript segment to extract verifiable factual claims.

Current timestamp: ${currentTime}
Transcript segment (from ${startTime} to ${endTime}):
${transcriptSegment}

Extract factual claims that can be verified. For each claim:
1. State the claim concisely (one sentence)
2. Note the approximate timestamp where it appears

Prioritize claims by:
- Proximity to ${currentTime} (closer = higher priority)
- Specificity (specific facts > general assertions)
- Verifiability (dates, numbers, names, events)

Return maximum 5 claims. If no verifiable claims exist, return empty claims array.`;
}
