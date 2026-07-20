export const DEFAULT_CONVEX_URL = "https://deafening-guineapig-157.convex.cloud";
export const CONVEX_URL_STORAGE_KEY = "convexUrl";

/**
 * Convert a Convex API base URL (`*.convex.cloud`) into its HTTP-action site
 * origin (`*.convex.site`), where the streaming endpoints live.
 */
export function getConvexSiteBaseUrl(convexApiBaseUrl: string): string {
  try {
    const parsed = new URL(convexApiBaseUrl);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.origin;
  } catch {
    return convexApiBaseUrl.replace(/\/+$/, "");
  }
}

export async function readConfiguredConvexUrl(): Promise<string> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return DEFAULT_CONVEX_URL;
  }

  try {
    const result = await chrome.storage.local.get(CONVEX_URL_STORAGE_KEY);
    const configured = result[CONVEX_URL_STORAGE_KEY];
    return typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_CONVEX_URL;
  } catch {
    return DEFAULT_CONVEX_URL;
  }
}
