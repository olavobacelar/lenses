const MAX_PUBLIC_ERROR_LENGTH = 500;

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
];

/**
 * Keeps actionable error context while preventing request bodies and credentials
 * from crossing an extension UI boundary.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let message = raw.trim();
  if (!message) return fallback;

  const payloadStart = message.search(
    /\b(?:Object|Arguments?|Args|Body|Payload|Request)\s*:\s*\{/i
  );
  if (payloadStart >= 0) message = message.slice(0, payloadStart).trim();

  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[redacted]");
  }

  message = message.replace(/\s+/g, " ").trim();
  if (!message) return fallback;
  return message.length > MAX_PUBLIC_ERROR_LENGTH
    ? `${message.slice(0, MAX_PUBLIC_ERROR_LENGTH - 3)}...`
    : message;
}
