export const SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE =
  "The source panel is not available on Lenses settings.";
export const UNSUPPORTED_SOURCE_PAGE_MESSAGE =
  "This page cannot be analyzed. Only http and https URLs are supported.";
export const NO_ACTIVE_SOURCE_PAGE_MESSAGE =
  "Open an http or https page to use Lenses.";

export interface SourceTabLike {
  title?: string;
  url?: string;
}

export interface UnsupportedSourcePage {
  title: string;
  message: string;
  url?: string;
}

export function isSourcePanelSupportedUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getUnsupportedSourcePage(
  tab: SourceTabLike | null | undefined
): UnsupportedSourcePage | null {
  if (isSourcePanelSupportedUrl(tab?.url)) return null;

  return {
    title: titleForUnsupportedSourcePage(tab),
    message: tab?.url ? UNSUPPORTED_SOURCE_PAGE_MESSAGE : NO_ACTIVE_SOURCE_PAGE_MESSAGE,
    url: tab?.url,
  };
}

export function isExtensionOptionsPageUrl(
  rawUrl: string | undefined,
  optionsPageUrl: string
): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    const optionsUrl = new URL(optionsPageUrl);
    return url.origin === optionsUrl.origin && url.pathname === optionsUrl.pathname;
  } catch {
    return false;
  }
}

function titleForUnsupportedSourcePage(tab: SourceTabLike | null | undefined): string {
  const title = tab?.title?.trim();
  if (title) return title;
  if (!tab?.url) return "No active page";

  try {
    const url = new URL(tab.url);
    if (url.protocol === "chrome:") return "Browser page";
    if (url.protocol === "chrome-extension:") return "Extension page";
  } catch {
    return "Unsupported page";
  }

  return "Unsupported page";
}
