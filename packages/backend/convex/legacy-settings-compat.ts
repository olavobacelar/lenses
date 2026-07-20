/**
 * Schema keys retained so deployed pre-1.0 settings documents remain valid.
 * Remove this bridge after the 2.0.0 migration window and a verified document
 * backfill.
 */
export const BACKEND_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE = "2.0.0";

export const LEGACY_BACKEND_SETTINGS_FIELDS = {
  chatModel: "model",
  executionModel: "claimModel",
} as const;
