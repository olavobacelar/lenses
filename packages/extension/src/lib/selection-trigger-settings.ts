import {
  domainFromUrl,
  domainMatchesAllowedDomain,
  normalizeDomainList,
} from "@lenses/shared";

export const SELECTION_TRIGGER_ENABLED_KEY = "selectionTrigger:enabled";
export const SELECTION_TRIGGER_VISIBILITY_MODE_KEY = "selectionTrigger:visibilityMode";
export const SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY = "selectionTrigger:allowedDomains";
export const SELECTION_TRIGGER_DISABLED_HOSTS_KEY = "selectionTrigger:disabledHosts";
export const SELECTION_TRIGGER_STYLE_KEY = "selectionTrigger:style";
export const SELECTION_TRIGGER_DOMAIN_STYLES_KEY = "selectionTrigger:domainStyles";

export type SelectionTriggerVisibilityMode = "all" | "selected";

/**
 * How the selection popup is summoned once a selection exists on an allowed
 * domain. `immediate` is the original behavior (show on selection release).
 * `modifier` only shows it when ⌥/Alt is held at release, so casual selecting
 * stays quiet. `manual` remains an internal keyboard-only style for legacy
 * settings, but it is no longer accepted from stored settings.
 */
export type SelectionTriggerStyle = "immediate" | "modifier" | "manual";

const SELECTION_TRIGGER_STYLES: readonly SelectionTriggerStyle[] = [
  "immediate",
  "modifier",
];

/** A per-domain override of the global trigger style. */
export interface SelectionTriggerDomainStyle {
  domain: string;
  style: SelectionTriggerStyle;
}

export interface SelectionTriggerSettings {
  enabled: boolean;
  visibilityMode: SelectionTriggerVisibilityMode;
  allowedDomains: string[];
  disabledHosts: string[];
  /** Default style used on any domain without a more specific override. */
  style: SelectionTriggerStyle;
  /** Per-domain style overrides, checked before falling back to `style`. */
  domainStyles: SelectionTriggerDomainStyle[];
}

export function parseSelectionTriggerSettings(
  value: Record<string, unknown>
): SelectionTriggerSettings {
  return {
    enabled: value[SELECTION_TRIGGER_ENABLED_KEY] !== false,
    visibilityMode: parseSelectionTriggerVisibilityMode(
      value[SELECTION_TRIGGER_VISIBILITY_MODE_KEY]
    ),
    allowedDomains: readSelectionTriggerAllowedDomains(
      value[SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY]
    ),
    disabledHosts: readSelectionTriggerDisabledHosts(
      value[SELECTION_TRIGGER_DISABLED_HOSTS_KEY]
    ),
    style: parseSelectionTriggerStyle(value[SELECTION_TRIGGER_STYLE_KEY]),
    domainStyles: readSelectionTriggerDomainStyles(
      value[SELECTION_TRIGGER_DOMAIN_STYLES_KEY]
    ),
  };
}

/**
 * Resolves the effective trigger style for `url`: the first matching per-domain
 * override (subdomains included) wins, otherwise the global default `style`.
 */
export function resolveSelectionTriggerStyle(
  settings: SelectionTriggerSettings,
  url: string
): SelectionTriggerStyle {
  const domain = domainFromUrl(url);
  if (domain) {
    const override = settings.domainStyles.find((rule) =>
      domainMatchesAllowedDomain(domain, rule.domain)
    );
    if (override) return override.style;
  }
  return settings.style;
}

export function readSelectionTriggerDomainStyles(
  value: unknown
): SelectionTriggerDomainStyle[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: SelectionTriggerDomainStyle[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const rawDomain = (entry as { domain?: unknown }).domain;
    if (typeof rawDomain !== "string") continue;
    const [domain] = normalizeDomainList([rawDomain]);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    rules.push({
      domain,
      style: parseSelectionTriggerStyle((entry as { style?: unknown }).style),
    });
  }
  return rules;
}

/**
 * Whether the popup is allowed to appear at all on `url` given the per-domain
 * settings. Trigger style (immediate/modifier/manual) is applied separately by
 * the controller — this answers only "is this site opted in?".
 */
export function selectionTriggerMatchesUrl(
  settings: SelectionTriggerSettings,
  url: string
): boolean {
  if (!settings.enabled) return false;

  const host = selectionTriggerHostFromUrl(url);
  if (host && settings.disabledHosts.includes(host)) return false;

  if (settings.visibilityMode === "all") return true;

  const domain = domainFromUrl(url);
  if (!domain || settings.allowedDomains.length === 0) return false;
  return settings.allowedDomains.some((allowedDomain) =>
    domainMatchesAllowedDomain(domain, allowedDomain)
  );
}

export function parseSelectionTriggerVisibilityMode(
  value: unknown
): SelectionTriggerVisibilityMode {
  return value === "selected" ? "selected" : "all";
}

export function parseSelectionTriggerStyle(value: unknown): SelectionTriggerStyle {
  return SELECTION_TRIGGER_STYLES.includes(value as SelectionTriggerStyle)
    ? (value as SelectionTriggerStyle)
    : "immediate";
}

export function readSelectionTriggerAllowedDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeDomainList(value.filter((entry): entry is string => typeof entry === "string"));
}

export function readSelectionTriggerDisabledHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const host = normalizeSelectionTriggerHost(entry);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

export function normalizeSelectionTriggerHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  let host = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  host = host.split("@").pop() ?? "";
  host = host.split(":")[0] ?? "";
  host = host.replace(/^\.+|\.+$/g, "");

  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

export function selectionTriggerHostFromUrl(url: string): string | null {
  try {
    return normalizeSelectionTriggerHost(new URL(url).hostname);
  } catch {
    return null;
  }
}
