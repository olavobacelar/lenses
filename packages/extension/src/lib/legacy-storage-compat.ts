/**
 * Storage identities and values written by pre-1.0 releases.
 *
 * Keep every retired storage detail in this module so current product code can
 * use the public vocabulary. Remove these bridges after the 2.0.0 migration
 * window, once persistent local data has been copied and verified.
 */
export const LEGACY_STORAGE_COMPATIBILITY_REMOVAL_MILESTONE = "2.0.0";

export const LEGACY_MANAGED_MODE_STORAGE_VALUE = "hosted";
const CURRENT_MANAGED_MODE_VALUE = "managed";

/**
 * Dexie database names are storage identities. Renaming this value without a
 * copy migration would make existing Lens data appear to disappear.
 */
export const LENSES_LOCAL_DATABASE_NAME = "lensesLocalByok";

/** Upgrade the pre-1.0 app-mode value and persist the current vocabulary. */
export async function readMigratedAppAccessMode(
  storageKey: string,
  storage: Pick<chrome.storage.StorageArea, "get" | "set"> = chrome.storage.local
): Promise<unknown> {
  const stored = await storage.get(storageKey);
  const value = stored[storageKey];
  if (value !== LEGACY_MANAGED_MODE_STORAGE_VALUE) return value;
  await storage.set({ [storageKey]: CURRENT_MANAGED_MODE_VALUE });
  return CURRENT_MANAGED_MODE_VALUE;
}

/** Read the old per-mode evidence-base map before deleting it. */
export function readLegacyActiveEvidenceBaseId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const localValue = record.local_byok;
  if (typeof localValue === "string" && localValue) return localValue;
  const managedValue = record[LEGACY_MANAGED_MODE_STORAGE_VALUE];
  return typeof managedValue === "string" && managedValue ? managedValue : null;
}

/** Storage key used by the retired per-source sidebar conversation cache. */
export function legacyConversationStorageKey(sourceKey: string): string {
  return `lenses:source-panel:${sourceKey}:messages`;
}
