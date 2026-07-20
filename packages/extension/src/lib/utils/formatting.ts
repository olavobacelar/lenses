/**
 * Text formatting utilities
 */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Decode HTML entities in text
 */
export function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Convert basic markdown to HTML
 */
export function formatMarkdown(text: string): string {
  // Escape HTML first
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/\n---\n/g, '<hr>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Line breaks to paragraphs
  html = html
    .split('\n\n')
    .map((p) => `<p>${p}</p>`)
    .join('');
  html = html.replace(/<p><\/p>/g, '');

  return html;
}
