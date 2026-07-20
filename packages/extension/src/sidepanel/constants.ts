import { claimExtractorMarkdown, parseLensMarkdown } from "@lenses/shared";

export const DEFAULT_SLIDE_EXPORT_SERVER_URL = "http://127.0.0.1:8765";
export const MAX_ATTACHMENTS = 3;
// Cap raw file size so a base64 attachment stays below provider request limits.
export const MAX_ATTACHMENT_MB = 20;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
export const CLAIM_EXTRACTOR_LENS_ID = "claim-extractor";
export const CLAIM_EXTRACTOR_LENS = parseLensMarkdown(claimExtractorMarkdown);
export const SELECTED_LENSES_KEY = "selectedLenses";
export const STORE_PAGE_LENSES_KEY = "storePageLenses";
export const UNIFIED_PANEL_KEY = "experimentalUnifiedPanel";

// The shared one-off custom lens id, kept in sync with the backend builder
// (packages/backend/src/lenses/customLens.ts). A fresh per-creation id is derived
// from this prefix so distinct one-off lenses don't overwrite each other's runs.
export const CUSTOM_LENS_ID = "custom-lens";
export const CUSTOM_LENS_COLOR = "#4f8df9";

// chrome.storage.local keys for the lens-creation feature. The active one-off
// lens is mirrored here so it survives a panel reload and is visible to other
// surfaces; the promoted lens list is cached for instant render before the
// backend list query returns.
export const ACTIVE_CUSTOM_LENS_KEY = "customLens:active";
export const USER_LENSES_CACHE_KEY = "userLenses";

export const LENS_META: Record<string, { name: string }> = {
  "source-tracer": { name: "Sources" },
};
