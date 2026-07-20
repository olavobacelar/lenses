import {
  domainFromUrl,
  domainMatchesAllowedDomain,
  normalizeDomainList,
} from "@lenses/shared";

export const PAGE_DOCK_ENABLED_KEY = "pageDock:enabled";
export const PAGE_DOCK_DISABLED_HOSTS_KEY = "pageDock:disabledHosts";
export const PAGE_DOCK_VISIBILITY_MODE_KEY = "pageDock:visibilityMode";
export const PAGE_DOCK_ALLOWED_DOMAINS_KEY = "pageDock:allowedDomains";

// chrome.storage.local keys that influence whether the in-page dock shows. The
// content script re-syncs its mount whenever any of these change so toggling the
// dock from the popup, a keyboard command, or the context menu takes effect
// without a page reload.
export const PAGE_DOCK_SETTINGS_KEYS = [
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_DISABLED_HOSTS_KEY,
  PAGE_DOCK_VISIBILITY_MODE_KEY,
  PAGE_DOCK_ALLOWED_DOMAINS_KEY,
] as const;

// Shared id for the "show/hide page dock" entry added to the toolbar-icon and
// page right-click menus, plus the keyboard command that flips the same setting.
export const PAGE_DOCK_TOGGLE_MENU_ID = "lenses-toggle-page-dock";
export const PAGE_DOCK_TOGGLE_COMMAND = "toggle-page-dock";

export type PageDockVisibilityMode = "all" | "selected";

export interface PageDockSettings {
  enabled: boolean;
  visibilityMode: PageDockVisibilityMode;
  allowedDomains: string[];
  disabledHosts: string[];
}

export function parsePageDockSettings(value: Record<string, unknown>): PageDockSettings {
  return {
    enabled: value[PAGE_DOCK_ENABLED_KEY] !== false,
    visibilityMode: parsePageDockVisibilityMode(value[PAGE_DOCK_VISIBILITY_MODE_KEY]),
    allowedDomains: readPageDockAllowedDomains(value[PAGE_DOCK_ALLOWED_DOMAINS_KEY]),
    disabledHosts: readPageDockDisabledHosts(value[PAGE_DOCK_DISABLED_HOSTS_KEY]),
  };
}

export function pageDockMatchesUrl(settings: PageDockSettings, url: string): boolean {
  if (!settings.enabled) return false;

  const host = hostFromUrl(url);
  if (host && settings.disabledHosts.includes(host)) return false;

  if (settings.visibilityMode === "all") return true;

  const domain = domainFromUrl(url);
  if (!domain || settings.allowedDomains.length === 0) return false;
  return settings.allowedDomains.some((allowedDomain) =>
    domainMatchesAllowedDomain(domain, allowedDomain)
  );
}

export function parsePageDockVisibilityMode(value: unknown): PageDockVisibilityMode {
  return value === "selected" ? "selected" : "all";
}

// The dock is enabled unless the stored value is explicitly `false`, so a missing
// key (fresh install) reads as enabled — matching parsePageDockSettings.
export function pageDockEnabledFromStorage(value: Record<string, unknown>): boolean {
  return value[PAGE_DOCK_ENABLED_KEY] !== false;
}

export function pageDockToggleTitle(enabled: boolean): string {
  return enabled ? "Hide Lenses page dock" : "Show Lenses page dock";
}

export function readPageDockAllowedDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeDomainList(value.filter((entry): entry is string => typeof entry === "string"));
}

export function readPageDockDisabledHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const host = normalizePageDockHost(entry);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

export function normalizePageDockHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  let host = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0] ?? "";
  host = host.split("@").pop() ?? "";
  host = host.split(":")[0] ?? "";
  host = host.replace(/^\.+|\.+$/g, "");

  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

export function hostFromUrl(url: string): string | null {
  try {
    return normalizePageDockHost(new URL(url).hostname);
  } catch {
    return null;
  }
}
