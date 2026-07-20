import type { LensConfig } from "./schemas/lens.js";

const COMMON_SECOND_LEVEL_TLDS = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org",
]);

// URL glob matching for lens "triggers" — the patterns that scope where a lens
// applies and auto-runs. Mirrors the familiar match-pattern / Obsidian Web
// Clipper trigger style: `*` matches any run of characters, `?` matches a single
// character, everything else is literal. Kept DOM-free so it can run in the
// service worker, the content script, or a unit test alike.

// Translate a single glob into an anchored, case-insensitive RegExp. Regex
// metacharacters in the pattern are escaped first so a literal `.` in a host
// stays literal; only `*` and `?` carry wildcard meaning.
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

// Whether `url` matches any of a lens's triggers. An empty (or all-blank) trigger
// list means "every page" — the lens is unscoped, matching today's behavior where
// a lens can run anywhere. A non-empty list is an allow-list: the URL must match
// at least one pattern.
export function lensMatchesUrl(
  triggers: readonly string[] | undefined,
  url: string
): boolean {
  const patterns = (triggers ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(url));
}

export type LensDomainMode = "all" | "domains";

export interface LensDomainRule {
  mode: LensDomainMode;
  allowedDomains: string[];
  blockedDomains?: string[];
}

export type LensDomainRules = Record<string, LensDomainRule>;

export function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  let host = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0] ?? "";
  host = host.split("@").pop() ?? "";
  host = host.split(":")[0] ?? "";

  host = host
    .replace(/^\*\./, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^www\./, "");

  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  return siteDomainFromHost(host);
}

export function domainFromUrl(url: string): string | null {
  return normalizeDomain(url);
}

export function normalizeDomainList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain);
  }
  return result;
}

function siteDomainFromHost(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");

  const tld = parts[parts.length - 1] ?? "";
  const secondLevel = parts[parts.length - 2] ?? "";
  if (
    tld.length === 2 &&
    COMMON_SECOND_LEVEL_TLDS.has(secondLevel) &&
    parts.length >= 3
  ) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

export function domainMatchesAllowedDomain(domain: string, allowedDomain: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedAllowed = normalizeDomain(allowedDomain);
  if (!normalizedDomain || !normalizedAllowed) return false;
  return (
    normalizedDomain === normalizedAllowed ||
    normalizedDomain.endsWith(`.${normalizedAllowed}`)
  );
}

export function allowedDomainsMatchUrl(
  allowedDomains: readonly string[] | undefined,
  url: string
): boolean {
  const domains = normalizeDomainList(allowedDomains);
  if (domains.length === 0) return true;
  const domain = domainFromUrl(url);
  if (!domain) return false;
  return domains.some((allowedDomain) =>
    domainMatchesAllowedDomain(domain, allowedDomain)
  );
}

export function defaultDomainRuleForLens(lens: Pick<LensConfig, "allowedDomains">): LensDomainRule {
  const allowedDomains = normalizeDomainList(lens.allowedDomains);
  return allowedDomains.length > 0
    ? { mode: "domains", allowedDomains }
    : { mode: "all", allowedDomains: [], blockedDomains: [] };
}

export function parseLensDomainRules(value: unknown): LensDomainRules {
  if (!value || typeof value !== "object") return {};
  const rules: LensDomainRules = {};
  for (const [lensId, rawRule] of Object.entries(value)) {
    if (!rawRule || typeof rawRule !== "object") continue;
    const record = rawRule as Record<string, unknown>;
    const mode = record.mode === "domains" ? "domains" : "all";
    const allowedDomains = Array.isArray(record.allowedDomains)
      ? normalizeDomainList(record.allowedDomains.filter((entry): entry is string => typeof entry === "string"))
      : [];
    const blockedDomains = Array.isArray(record.blockedDomains)
      ? normalizeDomainList(record.blockedDomains.filter((entry): entry is string => typeof entry === "string"))
      : [];
    rules[lensId] = {
      mode,
      allowedDomains: mode === "domains" ? allowedDomains : [],
      blockedDomains: mode === "all" ? blockedDomains : [],
    };
  }
  return rules;
}

export function effectiveDomainRuleForLens(
  lens: Pick<LensConfig, "id" | "allowedDomains">,
  rules?: LensDomainRules
): LensDomainRule {
  return rules?.[lens.id] ?? defaultDomainRuleForLens(lens);
}

export function domainAllowedByRule(rule: LensDomainRule, domain: string): boolean {
  if (rule.mode === "all") {
    const blockedDomains = normalizeDomainList(rule.blockedDomains);
    return !blockedDomains.some((blockedDomain) =>
      domainMatchesAllowedDomain(domain, blockedDomain)
    );
  }
  return rule.allowedDomains.some((allowedDomain) =>
    domainMatchesAllowedDomain(domain, allowedDomain)
  );
}

export function setDomainAllowedForRule(
  rule: LensDomainRule,
  domain: string,
  allowed: boolean
): LensDomainRule {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return rule;

  if (rule.mode === "all") {
    const blockedDomains = normalizeDomainList(rule.blockedDomains);
    const nextBlocked = allowed
      ? blockedDomains.filter(
          (blockedDomain) => !domainMatchesAllowedDomain(normalizedDomain, blockedDomain)
        )
      : normalizeDomainList([...blockedDomains, normalizedDomain]);
    return { mode: "all", allowedDomains: [], blockedDomains: nextBlocked };
  }

  const allowedDomains = normalizeDomainList(rule.allowedDomains);
  const next = allowed
    ? normalizeDomainList([...allowedDomains, normalizedDomain])
    : allowedDomains.filter(
        (allowedDomain) => !domainMatchesAllowedDomain(normalizedDomain, allowedDomain)
      );

  return { mode: "domains", allowedDomains: next };
}

export function lensAppliesToUrl(
  lens: Pick<LensConfig, "id" | "allowedDomains" | "triggers">,
  url: string,
  rules?: LensDomainRules
): boolean {
  const domainRule = effectiveDomainRuleForLens(lens, rules);
  const domain = domainFromUrl(url);
  if (!domain || !domainAllowedByRule(domainRule, domain)) return false;
  return lensMatchesUrl(lens.triggers, url);
}
