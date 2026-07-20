export const MAX_CITATION_PUBLISHER_URLS = 20;

/**
 * Isolate-runtime URL validation for publisher metadata requests. Literal IP
 * targets are rejected; the Node fetch action separately resolves every DNS
 * answer and pins the request to a verified public address.
 */
export function normalizePublicCitationUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (
      (parsed.protocol === "http:" && parsed.port && parsed.port !== "80") ||
      (parsed.protocol === "https:" && parsed.port && parsed.port !== "443")
    ) {
      return null;
    }

    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (!isAllowedPublicHostname(hostname)) return null;

    parsed.hostname = hostname;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isAllowedPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || !normalized.includes(".")) return false;
  if (normalized.includes(":") || /^\d+(?:\.\d+){3}$/.test(normalized)) return false;
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".example")
  ) {
    return false;
  }

  return normalized.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
  );
}
