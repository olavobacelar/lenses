const ICON_COLORS = [
  "#315b7d",
  "#496f5d",
  "#755b3f",
  "#674f75",
  "#7a4b55",
  "#4d6670",
] as const;

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function colorForHostname(hostname: string): string {
  let hash = 0;
  for (const character of hostname) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return ICON_COLORS[Math.abs(hash) % ICON_COLORS.length];
}

/**
 * Return a deterministic, self-contained source mark. Citation rendering must
 * not disclose every cited hostname to a third-party favicon proxy.
 */
export function getLocalFaviconUrl(url: string): string {
  const hostname = hostnameFromUrl(url);
  const label = (hostname.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const color = colorForHostname(hostname || "source");
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    `<rect width="32" height="32" rx="7" fill="${color}"/>`,
    `<text x="16" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="650" fill="white">${label}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
