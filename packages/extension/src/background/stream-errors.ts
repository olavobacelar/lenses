const MAX_ERROR_DETAIL_CHARS = 500;

export function formatStreamingApiError(options: {
  status: number;
  contentType?: string | null;
  bodyText?: string;
}): string {
  const bodyText = options.bodyText ?? "";
  const detail = extractErrorDetail(bodyText);

  if (options.status === 401 || options.status === 403) {
    return "AI provider rejected the API key. Check your API key settings.";
  }

  if (options.status === 429) {
    return "AI provider is rate-limiting requests. Try again in a moment.";
  }

  if (isHtmlLikeError(options.contentType, bodyText) || isEdgeErrorBody(bodyText)) {
    return fallbackMessageForStatus(options.status);
  }

  return detail || fallbackMessageForStatus(options.status);
}

function extractErrorDetail(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const jsonMessage = extractJsonErrorMessage(parsed);
    if (jsonMessage) return normalizeErrorDetail(jsonMessage);
  } catch {
    // Plain-text error bodies are handled below.
  }

  if (isHtmlLikeError(null, trimmed) || isEdgeErrorBody(trimmed)) {
    return null;
  }

  return normalizeErrorDetail(trimmed);
}

function extractJsonErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return null;
}

function normalizeErrorDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_DETAIL_CHARS);
}

function isHtmlLikeError(contentType: string | null | undefined, bodyText: string): boolean {
  const normalizedContentType = (contentType ?? "").toLowerCase();
  const normalizedBody = bodyText.slice(0, 500).toLowerCase();
  return (
    normalizedContentType.includes("text/html") ||
    normalizedBody.includes("<!doctype html") ||
    normalizedBody.includes("<html") ||
    normalizedBody.includes("</body>")
  );
}

function isEdgeErrorBody(bodyText: string): boolean {
  return /\bcloudflare\b|cf-error|cf-ray|error code:\s*50[0-9]/i.test(bodyText);
}

function fallbackMessageForStatus(status: number): string {
  if (status >= 500) {
    return "Chat failed because the AI service returned a temporary upstream error. Try again or choose another model.";
  }
  if (status >= 400) {
    return "Chat request was rejected. Try another model or check your API settings.";
  }
  return "Chat failed. Try again in a moment.";
}
