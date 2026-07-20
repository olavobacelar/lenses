import type { BuiltInLens, ComposerCopyByMode, PopupFixture } from "./types";
import { CHAT_ACTIONS_USE_SIDE_PANEL_KEY } from "../lib/chat-surface-settings";

export { CHAT_ACTIONS_USE_SIDE_PANEL_KEY };

export const STORAGE_KEY = "selectedLenses";
export const DEBUG_MODE_KEY = "debugMode";
export const SHOW_DEBUG_OPTIONS_KEY = "showDebugOptions";
export const STORE_PAGE_LENSES_KEY = "storePageLenses";
export const PAGE_DOCK_ENABLED_KEY = "pageDock:enabled";
export const PAGE_DOCK_DISABLED_HOSTS_KEY = "pageDock:disabledHosts";
export const TEST_SOURCE_MAX_CITATIONS_KEY = "testSourceMaxCitations";
export const TEST_SOURCE_USE_CACHE_KEY = "testSourceUseCache";
export const DEFAULT_TEST_SOURCE_MAX_CITATIONS = 3;
export const DEFAULT_TEST_SOURCE_USE_CACHE = true;

export const BUILT_IN_LENSES: BuiltInLens[] = [
  { id: "claim-extractor", label: "Claim Extractor" },
  { id: "source-tracer", label: "Source Tracer" },
];

export const POPUP_FIXTURES: PopupFixture[] = [
  {
    id: "source-check-synthetic",
    title: "Source check: synthetic sample",
    repoPath: "test/fixtures/source-check-synthetic.txt",
    bundlePath: "popup/fixtures/source-check-synthetic.txt",
  },
];

export const LENS_NAMES: Record<string, string> = {
  "claim-extractor": "Claim Extractor",
  "source-tracer": "Source Tracer",
};

export const COMPOSER_COPY: ComposerCopyByMode = {
  lens: {
    placeholder: "Describe what to highlight, e.g. every date and deadline",
    submit: "Run lens",
    hint: "Builds a one-off lens and highlights matching text on the page.",
  },
  ask: {
    placeholder: "Ask a question about this page\u2026",
    submit: "Ask",
    hint: "Answers in the side panel using the whole page as context.",
  },
};

export const POPUP_STORAGE_KEYS = [
  STORAGE_KEY,
  "autoRun",
  "autoAnalyze",
  DEBUG_MODE_KEY,
  SHOW_DEBUG_OPTIONS_KEY,
  STORE_PAGE_LENSES_KEY,
  PAGE_DOCK_ENABLED_KEY,
  CHAT_ACTIONS_USE_SIDE_PANEL_KEY,
  TEST_SOURCE_MAX_CITATIONS_KEY,
  TEST_SOURCE_USE_CACHE_KEY,
] as const;
