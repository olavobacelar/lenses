// Shared theme system — a single source of truth for the user's appearance
// preference across every surface (popup, side panel, options, the in-page
// injected UI, and the debug view).
//
// Design: the preference is one of "light" | "dark" | "system". We resolve
// "system" to a concrete light/dark value in JS and stamp it as a data
// attribute on the document root, so each stylesheet only needs one set of
// dark overrides (`[data-theme="dark"]`) and an explicit choice can override
// the OS setting. Extension pages use the `data-theme` attribute; the content
// script uses a namespaced `data-lenses-theme` so it never collides with a
// host page's own theming.

export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

// Synchronous mirror of the preference for extension pages. chrome.storage is
// async, which would flash the wrong theme for an instant on load; reading this
// from localStorage at startup lets us paint the correct theme immediately.
// Only extension-origin pages use this — never the content script, which would
// otherwise pollute arbitrary host-page localStorage.
const FAST_CACHE_KEY = "lenses:theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

// Pure resolution logic, kept free of DOM/chrome access so it can be unit
// tested directly.
export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): EffectiveTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "system") return "light";
  if (preference === "light") return "dark";
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function applyThemeToDocument(
  preference: ThemePreference,
  attribute = "data-theme"
): EffectiveTheme {
  const effective = resolveEffectiveTheme(preference, systemPrefersDark());
  document.documentElement.setAttribute(attribute, effective);
  return effective;
}

function readFastPreference(): ThemePreference | null {
  try {
    const value = window.localStorage.getItem(FAST_CACHE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

function writeFastPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(FAST_CACHE_KEY, preference);
  } catch {
    // localStorage may be unavailable (e.g. blocked); the chrome.storage
    // value remains the source of truth, so this is non-fatal.
  }
}

export function getThemePreference(): Promise<ThemePreference> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(THEME_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_THEME_PREFERENCE);
          return;
        }
        const value = result?.[THEME_STORAGE_KEY];
        resolve(isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE);
      });
    } catch {
      resolve(DEFAULT_THEME_PREFERENCE);
    }
  });
}

export function setThemePreference(preference: ThemePreference): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference }, () => {
        // Touch lastError so it isn't logged as unchecked.
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

export interface ThemeController {
  getPreference(): ThemePreference;
  setPreference(preference: ThemePreference): Promise<void>;
  destroy(): void;
}

export interface InitThemeOptions {
  // Attribute to stamp on <html>. Extension pages use the default "data-theme";
  // the content script passes "data-lenses-theme" to avoid host collisions.
  attribute?: string;
  // Enables the synchronous localStorage fast-path. Safe on extension-origin
  // pages; must stay false in content scripts (host-page localStorage).
  fastCache?: boolean;
  // Called whenever the resolved theme changes, including the initial paint and
  // changes made from other surfaces.
  onChange?: (preference: ThemePreference, effective: EffectiveTheme) => void;
}

// Wires up theming for a single surface: paints immediately, keeps the document
// in sync with cross-surface storage changes, and reacts to OS theme changes
// while in "system" mode. Returns a controller for reading/updating the
// preference (used by the in-UI theme selectors).
export function initTheme(options: InitThemeOptions = {}): ThemeController {
  const attribute = options.attribute ?? "data-theme";
  const useFastCache = options.fastCache ?? false;

  let preference: ThemePreference = useFastCache
    ? readFastPreference() ?? DEFAULT_THEME_PREFERENCE
    : DEFAULT_THEME_PREFERENCE;

  const apply = () => {
    const effective = applyThemeToDocument(preference, attribute);
    options.onChange?.(preference, effective);
  };

  // Paint synchronously with the best guess we have, then correct from the
  // authoritative chrome.storage value once it resolves.
  apply();

  void getThemePreference().then((stored) => {
    preference = stored;
    if (useFastCache) writeFastPreference(stored);
    apply();
  });

  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== "local") return;
    const change = changes[THEME_STORAGE_KEY];
    if (!change) return;
    preference = isThemePreference(change.newValue)
      ? change.newValue
      : DEFAULT_THEME_PREFERENCE;
    if (useFastCache) writeFastPreference(preference);
    apply();
  };

  try {
    chrome.storage.onChanged.addListener(storageListener);
  } catch {
    // Extension context may be unavailable; surface still shows its paint.
  }

  const media =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const mediaListener = () => {
    if (preference === "system") apply();
  };
  media?.addEventListener("change", mediaListener);

  return {
    getPreference: () => preference,
    setPreference: async (next) => {
      preference = next;
      if (useFastCache) writeFastPreference(next);
      apply();
      await setThemePreference(next);
    },
    destroy: () => {
      try {
        chrome.storage.onChanged.removeListener(storageListener);
      } catch {
        // ignore
      }
      media?.removeEventListener("change", mediaListener);
    },
  };
}
