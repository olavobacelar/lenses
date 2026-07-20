import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_MANAGED_MODE_STORAGE_VALUE,
  LEGACY_STORAGE_COMPATIBILITY_REMOVAL_MILESTONE,
  legacyConversationStorageKey,
  readLegacyActiveEvidenceBaseId,
  readMigratedAppAccessMode,
} from "../src/lib/legacy-storage-compat.js";

describe("legacy storage compatibility", () => {
  it("documents when the bridge can be removed", () => {
    expect(LEGACY_STORAGE_COMPATIBILITY_REMOVAL_MILESTONE).toBe("2.0.0");
  });

  it("upgrades the retired managed-mode value and writes it back", async () => {
    const storageKey = "appAccessMode";
    const set = vi.fn(async () => undefined);
    const storage = {
      get: vi.fn(async () => ({
        [storageKey]: LEGACY_MANAGED_MODE_STORAGE_VALUE,
      })),
      set,
    } as unknown as Pick<chrome.storage.StorageArea, "get" | "set">;

    await expect(readMigratedAppAccessMode(storageKey, storage)).resolves.toBe("managed");
    expect(set).toHaveBeenCalledWith({ [storageKey]: "managed" });
  });

  it("does not rewrite current mode values", async () => {
    const storageKey = "appAccessMode";
    const set = vi.fn(async () => undefined);
    const storage = {
      get: vi.fn(async () => ({ [storageKey]: "local_byok" })),
      set,
    } as unknown as Pick<chrome.storage.StorageArea, "get" | "set">;

    await expect(readMigratedAppAccessMode(storageKey, storage)).resolves.toBe("local_byok");
    expect(set).not.toHaveBeenCalled();
  });

  it("recovers both forms of the retired per-mode evidence-base map", () => {
    expect(
      readLegacyActiveEvidenceBaseId({
        [LEGACY_MANAGED_MODE_STORAGE_VALUE]: "managed-evidence-base",
      })
    ).toBe("managed-evidence-base");
    expect(
      readLegacyActiveEvidenceBaseId({
        [LEGACY_MANAGED_MODE_STORAGE_VALUE]: "managed-evidence-base",
        local_byok: "local-evidence-base",
      })
    ).toBe("local-evidence-base");
  });

  it("keeps the previous conversation key available for one-time import", () => {
    expect(legacyConversationStorageKey("source-key")).toBe(
      "lenses:source-panel:source-key:messages"
    );
  });
});
