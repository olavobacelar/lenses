import { normalizeDomain } from "@lenses/shared";

/**
 * Per-domain pin store for lenses and annotations.
 *
 * A pin on (domain D, lens L) means: "auto-run L whenever the popup opens on D".
 * Pinning is independent of the lens visibility / domain-rule system in
 * `lens-domain-rules.ts` — that one controls *whether a lens can appear on a
 * domain at all*, this one controls *whether it auto-runs without a click*.
 *
 * Storage key in chrome.storage.sync; sync chosen because pins are small,
 * personal, and useful across devices.
 */

export const PINNED_IDS_BY_DOMAIN_KEY = "pinnedIdsByDomain";

export interface PinSet {
  lensIds: string[];
  annotationIds: string[];
}

export type PinnedIdsByDomain = Record<string, PinSet>;

const EMPTY_PIN_SET: PinSet = { lensIds: [], annotationIds: [] };

/**
 * Derive the canonical pin key for a URL. Returns null when the URL has no
 * usable host (chrome:// pages, blob:, malformed strings) — callers should
 * skip pin operations in those cases.
 *
 * Subdomain collapsing (news.nytimes.com → nytimes.com) is intentional: most
 * users want one pin to cover a whole site, not separate pins per subdomain.
 *
 * Only http(s) URLs yield a pin key. normalizeDomain on its own would happily
 * extract a "host" from `chrome://settings` ("settings"), which is meaningless
 * as a pin scope.
 */
export function pinKeyFromUrl(url: string): string | null {
  if (typeof url !== "string") return null;
  if (!/^https?:\/\//i.test(url.trim())) return null;
  return normalizeDomain(url);
}

/**
 * Validate untyped storage data into a known-good PinnedIdsByDomain. Tolerant
 * by design — anything malformed is silently dropped rather than throwing, so
 * a single bad row never corrupts the user's whole pin map.
 */
export function parsePinnedIdsByDomain(value: unknown): PinnedIdsByDomain {
  if (!value || typeof value !== "object") return {};
  const result: PinnedIdsByDomain = {};
  for (const [rawDomain, rawSet] of Object.entries(value as Record<string, unknown>)) {
    const domain = normalizeDomain(rawDomain);
    if (!domain) continue;
    if (!rawSet || typeof rawSet !== "object") continue;
    const set = rawSet as Record<string, unknown>;
    const lensIds = sanitizeIdList(set.lensIds);
    const annotationIds = sanitizeIdList(set.annotationIds);
    if (lensIds.length === 0 && annotationIds.length === 0) continue;
    result[domain] = { lensIds, annotationIds };
  }
  return result;
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Read the pinned ids for a single domain. Returns empty arrays when missing. */
export function pinsForDomain(map: PinnedIdsByDomain, domain: string): PinSet {
  const normalized = normalizeDomain(domain);
  if (!normalized) return EMPTY_PIN_SET;
  return map[normalized] ?? EMPTY_PIN_SET;
}

export function isLensPinned(
  map: PinnedIdsByDomain,
  domain: string,
  lensId: string
): boolean {
  return pinsForDomain(map, domain).lensIds.includes(lensId);
}

export function isAnnotationPinned(
  map: PinnedIdsByDomain,
  domain: string,
  annotationId: string
): boolean {
  return pinsForDomain(map, domain).annotationIds.includes(annotationId);
}

/** Toggle a lens pin. Returns a new map (never mutates). */
export function toggleLensPin(
  map: PinnedIdsByDomain,
  domain: string,
  lensId: string
): PinnedIdsByDomain {
  return updateIdList(map, domain, "lensIds", lensId);
}

/** Toggle an annotation pin. Returns a new map (never mutates). */
export function toggleAnnotationPin(
  map: PinnedIdsByDomain,
  domain: string,
  annotationId: string
): PinnedIdsByDomain {
  return updateIdList(map, domain, "annotationIds", annotationId);
}

function updateIdList(
  map: PinnedIdsByDomain,
  domain: string,
  field: "lensIds" | "annotationIds",
  id: string
): PinnedIdsByDomain {
  const normalized = normalizeDomain(domain);
  if (!normalized) return map;
  const trimmed = id.trim();
  if (!trimmed) return map;

  const current = map[normalized] ?? EMPTY_PIN_SET;
  const list = current[field];
  const hasIt = list.includes(trimmed);
  const nextList = hasIt ? list.filter((entry) => entry !== trimmed) : [...list, trimmed];

  const nextSet: PinSet =
    field === "lensIds"
      ? { lensIds: nextList, annotationIds: current.annotationIds }
      : { lensIds: current.lensIds, annotationIds: nextList };

  // Drop the domain entry entirely when both lists are empty so the storage
  // map doesn't accumulate dead keys over time.
  const next = { ...map };
  if (nextSet.lensIds.length === 0 && nextSet.annotationIds.length === 0) {
    delete next[normalized];
  } else {
    next[normalized] = nextSet;
  }
  return next;
}

// ─────────────────────────────────────────────────────────────
// Async storage helpers — thin chrome.storage.sync wrappers
// ─────────────────────────────────────────────────────────────

export async function readPinnedIdsByDomain(): Promise<PinnedIdsByDomain> {
  const result = await chrome.storage.sync.get(PINNED_IDS_BY_DOMAIN_KEY);
  return parsePinnedIdsByDomain(result?.[PINNED_IDS_BY_DOMAIN_KEY]);
}

export async function writePinnedIdsByDomain(map: PinnedIdsByDomain): Promise<void> {
  // Re-parse on write so we never persist malformed shapes, even if a caller
  // hands us something weird.
  const sanitized = parsePinnedIdsByDomain(map);
  await chrome.storage.sync.set({ [PINNED_IDS_BY_DOMAIN_KEY]: sanitized });
}

export async function toggleLensPinForUrl(url: string, lensId: string): Promise<void> {
  const domain = pinKeyFromUrl(url);
  if (!domain) return;
  const current = await readPinnedIdsByDomain();
  await writePinnedIdsByDomain(toggleLensPin(current, domain, lensId));
}

export async function toggleAnnotationPinForUrl(
  url: string,
  annotationId: string
): Promise<void> {
  const domain = pinKeyFromUrl(url);
  if (!domain) return;
  const current = await readPinnedIdsByDomain();
  await writePinnedIdsByDomain(toggleAnnotationPin(current, domain, annotationId));
}
