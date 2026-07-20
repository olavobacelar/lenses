/**
 * Thinking text processing utilities
 */

/**
 * Extract heading from thinking content (## Heading format)
 */
export function extractThinkingHeading(content: string): {
  title: string;
  content: string;
} {
  const headingMatch = content.match(/^#{1,2}\s+(.+?)(?:\n|$)/);
  if (headingMatch) {
    return {
      title: headingMatch[1].trim(),
      content: content.slice(headingMatch[0].length).trim(),
    };
  }
  return {
    title: 'Thought process',
    content,
  };
}

/**
 * Check if a heading is complete (has newline after it)
 */
export function hasCompleteHeading(content: string): boolean {
  if (/^#{1,2}\s/.test(content)) {
    return content.includes('\n');
  }
  return true;
}
