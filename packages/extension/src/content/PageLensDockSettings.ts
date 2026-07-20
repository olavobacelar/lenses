import {
  hostFromUrl,
  pageDockMatchesUrl,
  PAGE_DOCK_ALLOWED_DOMAINS_KEY,
  PAGE_DOCK_DISABLED_HOSTS_KEY,
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_VISIBILITY_MODE_KEY,
  parsePageDockSettings,
  readPageDockDisabledHosts,
} from "../lib/page-dock-settings.js";

export { PAGE_DOCK_DISABLED_HOSTS_KEY, PAGE_DOCK_ENABLED_KEY };

export async function shouldShowPageLensDock(): Promise<boolean> {
  const settings = await readPageDockSettings();
  return pageDockMatchesUrl(settings, window.location.href);
}

export async function disablePageLensDockForCurrentSite(): Promise<void> {
  const host = hostFromUrl(window.location.href);
  if (!host) return;

  const stored = await chrome.storage.local
    .get(PAGE_DOCK_DISABLED_HOSTS_KEY)
    .catch(() => ({}) as Record<string, unknown>);
  const disabledHosts = new Set(readPageDockDisabledHosts(stored[PAGE_DOCK_DISABLED_HOSTS_KEY]));
  disabledHosts.add(host);
  await chrome.storage.local.set({
    [PAGE_DOCK_DISABLED_HOSTS_KEY]: Array.from(disabledHosts).sort(),
  });
}

export async function setPageLensDockEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [PAGE_DOCK_ENABLED_KEY]: enabled });
}

async function readPageDockSettings() {
  const stored = await chrome.storage.local
    .get([
      PAGE_DOCK_ENABLED_KEY,
      PAGE_DOCK_DISABLED_HOSTS_KEY,
      PAGE_DOCK_VISIBILITY_MODE_KEY,
      PAGE_DOCK_ALLOWED_DOMAINS_KEY,
    ])
    .catch(() => ({}) as Record<string, unknown>);
  return parsePageDockSettings(stored);
}
