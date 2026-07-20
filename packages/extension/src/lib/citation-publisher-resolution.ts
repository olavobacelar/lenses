export interface CitationPublisherResolution {
  publishers?: Record<string, string>;
  authoritativeUrls?: string[];
}

export function parseCitationPublisherResolution(
  response: CitationPublisherResolution | undefined,
  transportFailed = false
): {
  publishers: Record<string, string>;
  authoritativeUrls: ReadonlySet<string>;
} {
  if (transportFailed || !response) {
    return { publishers: {}, authoritativeUrls: new Set() };
  }

  const publishers =
    response.publishers &&
    typeof response.publishers === "object" &&
    !Array.isArray(response.publishers)
      ? response.publishers
      : {};
  const authoritativeUrls = new Set(
    Array.isArray(response.authoritativeUrls)
      ? response.authoritativeUrls.filter((url): url is string => typeof url === "string")
      : []
  );

  return { publishers, authoritativeUrls };
}
