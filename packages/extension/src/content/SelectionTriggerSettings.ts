import {
  parseSelectionTriggerSettings,
  selectionTriggerMatchesUrl,
  type SelectionTriggerSettings,
  SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY,
  SELECTION_TRIGGER_DISABLED_HOSTS_KEY,
  SELECTION_TRIGGER_DOMAIN_STYLES_KEY,
  SELECTION_TRIGGER_ENABLED_KEY,
  SELECTION_TRIGGER_STYLE_KEY,
  SELECTION_TRIGGER_VISIBILITY_MODE_KEY,
} from "../lib/selection-trigger-settings.js";

/** Storage keys the controller watches so it can refresh its cached settings. */
export const SELECTION_TRIGGER_STORAGE_KEYS = [
  SELECTION_TRIGGER_ENABLED_KEY,
  SELECTION_TRIGGER_VISIBILITY_MODE_KEY,
  SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY,
  SELECTION_TRIGGER_DISABLED_HOSTS_KEY,
  SELECTION_TRIGGER_STYLE_KEY,
  SELECTION_TRIGGER_DOMAIN_STYLES_KEY,
] as const;

/** Defaults used until the first storage read resolves (matches "show everywhere, immediately"). */
export function defaultSelectionTriggerSettings(): SelectionTriggerSettings {
  return parseSelectionTriggerSettings({});
}

export async function loadSelectionTriggerSettings(): Promise<SelectionTriggerSettings> {
  const stored = await chrome.storage.local
    .get([...SELECTION_TRIGGER_STORAGE_KEYS])
    .catch(() => ({}) as Record<string, unknown>);
  return parseSelectionTriggerSettings(stored);
}

export async function shouldShowSelectionTrigger(): Promise<boolean> {
  const settings = await loadSelectionTriggerSettings();
  return selectionTriggerMatchesUrl(settings, window.location.href);
}
