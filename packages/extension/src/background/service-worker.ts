// Background service worker — handles Convex API calls and context menus
import { DEFAULT_CONVEX_URL, getConvexSiteBaseUrl } from "../lib/convex-url";
import { setupApiKeyMessageHandlers } from "./api-key-messages";
import {
  openSourcePanelFromActionContext,
  setupSourcePanelHandlers,
} from "./source-panel";
import { setupSourceStreamHandlers } from "./source-stream";
import { setupYouTubeHandlers } from "./youtube";
import { DEV_CONTEXT_CHECK_MESSAGE_TYPE } from "../lib/dev-reload";
import type { ModelProvider } from "../types/ai-models";
import {
  readAiSettingsStorage,
  readProviderApiKey,
} from "../lib/ai-settings-compat";
import {
  readStoredModelSettings,
  type StoredModelSettings,
} from "../lib/model-settings";
import {
  DEFAULT_MODEL_PROVIDER,
  LensConfig,
  lensAppliesToUrl,
  parseLensDomainRules,
  type Anchor,
  type FindingEvidenceRefInput,
  type LensDomainRules,
} from "@lenses/shared";
import {
  pendingAskKey,
  pendingLensRunKey,
  type PendingAsk,
  type PendingLensRun,
} from "../lib/composer";
import { LENS_DOMAIN_RULES_KEY } from "../lib/lens-domain-rules";
import {
  pageDockEnabledFromStorage,
  pageDockToggleTitle,
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_TOGGLE_COMMAND,
  PAGE_DOCK_TOGGLE_MENU_ID,
} from "../lib/page-dock-settings";
import { formatStreamingApiError } from "./stream-errors";
import {
  APP_ACCESS_MODE_STORAGE_KEY,
  APP_MODE_CHANGED_MESSAGE_TYPE,
  isLocalByokMode,
  parseAppAccessMode,
  readAppAccessMode,
  type AppAccessMode,
  type AppModeChangedMessage,
} from "../lib/app-mode";
import {
  askLocalFindingQuestion,
  clearLocalFindingsForPage,
  createLocalSavedSelection,
  deleteLocalSavedSelection,
  deleteLocalUserLens,
  generateLocalLensName,
  getLocalConversation,
  getLocalDebugData,
  getLocalStoredRunStates,
  listLocalLensRows,
  listLocalSavedSelections,
  runLocalLens,
  saveLocalConversation,
  saveLocalFindings,
  saveLocalLensConfig,
  saveLocalUserLens,
  updateLocalSavedSelection,
} from "./local-runtime";
import { streamLocalAskFindingOverPort } from "./local-finding-stream";
import {
  createEvidenceBase,
  deleteEvidenceBase,
  evidenceBaseHasSource,
  exportEvidenceBase,
  failEvidenceRun,
  getEvidenceBase,
  listEvidenceBases,
  markEvidenceRunChunk,
  previewDeleteEvidenceBase,
  startEvidenceRun,
  updateEvidenceBase,
} from "./evidence-base-api";
import { publicErrorMessage } from "../lib/public-error";
import { readManagedApiError } from "../lib/managed-api";
import {
  fingerprintText,
  readActiveEvidenceBaseId,
} from "../lib/evidence-bases";
import type {
  EvidenceRunChunkUpdate,
  EvidenceRunFailure,
  EvidenceRunStartInput,
} from "../lib/evidence-run";
import { withoutRetiredLensIds } from "../lib/control-bay";
import { normalizePublicHttpUrl } from "../lib/public-http-url";
import {
  chunkInspectionPlan,
  groundFindingsInSource,
  mergeFindingsFromExecutionChunk,
  prepareSegmentedSource,
  type PreparedSegmentedSource,
} from "../lib/source-segments";
import type { TranscriptSegment } from "../types/transcript";

// Build-time in the extension bundle; enabled when this module is exercised
// directly by source-level tests that do not run the bundler's substitutions.
const INTERNAL_TOOLS_ENABLED =
  typeof __INTERNAL_TOOLS__ === "undefined" ? true : __INTERNAL_TOOLS__;

// Contest builds ship only the side panel and selection popup: the toolbar
// popup and page dock are excluded from the artifact, so every code path that
// offers or opens them must stay off regardless of stored settings.
const CONTEST_BUILD =
  typeof __CONTEST_BUILD__ === "undefined" ? false : __CONTEST_BUILD__;

// --- Dev Reload ---
// When built with --watch, __DEV_RELOAD__ is true and this block connects to the
// build server's WebSocket. On rebuild, it reloads the unpacked extension from
// dist while leaving normal browser tabs alone; reload tabs manually when a
// content-script change needs to be reinjected.
if (__DEV_RELOAD__) {
  const RELOAD_PORT = 8234;

  function connectReload() {
    const ws = new WebSocket(`ws://localhost:${RELOAD_PORT}`);
    ws.onmessage = () => {
      console.log("[Lenses] Reloading extension...");
      void reloadExtensionForDev();
    };
    ws.onclose = () => setTimeout(connectReload, 2000);
  }

  function reloadExtensionForDev(): void {
    chrome.runtime.reload();
  }

  connectReload();
}

const CONVEX_URL = DEFAULT_CONVEX_URL;
const SHOW_DEBUG_OPTIONS_KEY = "showDebugOptions";
const STORE_PAGE_LENSES_KEY = "storePageLenses";
const TEST_SOURCE_MAX_CITATIONS_KEY = "testSourceMaxCitations";
const TEST_SOURCE_USE_CACHE_KEY = "testSourceUseCache";
const USER_LENS_ORDER_KEY = "userLensOrder";
const BUILT_IN_LENS_ORDER_KEY = "builtInLensOrder";
const ERASED_LENS_IDS_KEY = "erasedLensIds";
const ACTIVE_CUSTOM_LENS_KEY = "customLens:active";
const USER_LENSES_CACHE_KEY = "userLenses";
const DEFAULT_TEST_SOURCE_MAX_CITATIONS = 3;
const DEFAULT_TEST_SOURCE_USE_CACHE = true;
const SOURCE_CHECK_CACHE_KEY = "sourceCheckResponseCacheV1";
const SOURCE_CHECK_CACHE_MAX_ENTRIES = 200;
const DEBUG_OPTIONS_CONTEXT_MENU_ID = "toggle-debug-options";
const OPEN_ACTION_POPUP_MENU_ID = "open-lenses-main-popup";
const OPEN_SOURCE_PANEL_MENU_ID = "open-lenses-side-panel";
const UNIFIED_PANEL_SETTING_KEY = "experimentalUnifiedPanel";
const ACTION_POPUP_PATH = "popup/popup.html";

let currentUnifiedPanelEnabled = false;

function logFindingStreamDebug(event: string, details: Record<string, unknown> = {}) {
  if (!INTERNAL_TOOLS_ENABLED) return;
  console.log("[Lenses][sw][finding-stream]", event, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function sendTabMessage(tabId: number, message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Lenses] Could not deliver tab message", chrome.runtime.lastError.message);
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessageQuiet(message: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function sendTabMessageQuiet(tabId: number, message: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function isBroadcastableTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab.id === "number" && typeof tab.url === "string";
}

async function clearAiModeCache(): Promise<void> {
  await chrome.storage.local
    .remove(SOURCE_CHECK_CACHE_KEY)
    .catch((error) => {
      console.warn("[Lenses][sw] could not clear the AI-mode cache", error);
    });
}

async function broadcastAppModeChanged(mode: AppAccessMode): Promise<void> {
  const message: AppModeChangedMessage = {
    type: APP_MODE_CHANGED_MESSAGE_TYPE,
    mode,
  };

  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  await Promise.all([
    sendRuntimeMessageQuiet(message),
    ...tabs.filter(isBroadcastableTab).map((tab) => sendTabMessageQuiet(tab.id, message)),
  ]);
}

async function handleAppAccessModeChanged(mode: AppAccessMode): Promise<void> {
  await clearAiModeCache();
  await broadcastAppModeChanged(mode);
}

// --- Context Menu Setup ---

const LENS_COLORS: Record<string, Record<string, { color: string; label: string }>> = {
  "claim-extractor": {
    empirical: { color: "#629b64", label: "Empirical claim" },
    causal: { color: "#498dc3", label: "Causal claim" },
    comparative: { color: "#904c9c", label: "Comparative claim" },
    predictive: { color: "#ca8e36", label: "Predictive claim" },
    normative: { color: "#c35d55", label: "Normative claim" },
  },
  "source-tracer": {
    primary: { color: "#629b64", label: "Primary source" },
    secondary: { color: "#498dc3", label: "Secondary source" },
    unsourced: { color: "#c35d55", label: "Needs source" },
    self_referential: { color: "#ca8e36", label: "Self-referential" },
  },
};

// A custom lens produces findings under a single fixed "match" category, so the
// extension can supply a predictable highlight color without knowing the user's
// instruction ahead of time. These MUST stay in sync with the backend builder
// in packages/backend/src/lenses/customLens.ts (CUSTOM_LENS_ID / _CATEGORY /
// _COLOR), which is what actually generates the findings.
const CUSTOM_LENS_ID = "custom-lens";
const CUSTOM_LENS_CATEGORY = "match";
const CUSTOM_LENS_COLOR = "#4f8df9";
const CUSTOM_LENS_COLORS: Record<string, { color: string; label: string }> = {
  [CUSTOM_LENS_CATEGORY]: { color: CUSTOM_LENS_COLOR, label: "Match" },
};

// Highlight colors for a lens run: built-in lenses have per-category palettes;
// the one-off custom lens and any user-saved (promoted) lens share the single
// "match" color, since both are built from a free-text instruction and emit only
// that one category.
function colorsForLens(lensId: string): Record<string, { color: string; label: string }> {
  return LENS_COLORS[lensId] ?? CUSTOM_LENS_COLORS;
}

function installContextMenus(
  showDebugOptions: boolean,
  pageDockEnabled: boolean,
  unifiedPanelEnabled: boolean
) {
  chrome.contextMenus.removeAll(() => {
    // The only Lenses page/selection menu item: a way back to the dock when it's
    // off (the dock removes its in-page UI entirely once disabled). It is the
    // extension's sole item in these contexts, so Chrome shows it at the top
    // level rather than nesting it under a submenu. "selection" is included so it
    // stays reachable when right-clicking selected text — Chrome otherwise hides
    // "page" items over a selection.
    chrome.contextMenus.create({
      id: PAGE_DOCK_TOGGLE_MENU_ID,
      title: pageDockToggleTitle(pageDockEnabled),
      contexts: ["page", "selection", "action"],
    });

    // Contest builds have no toolbar popup, so the item that opens it is
    // suppressed; the side-panel item ("Open side panel") stays for everyone.
    if (!CONTEST_BUILD) {
      chrome.contextMenus.create({
        id: OPEN_ACTION_POPUP_MENU_ID,
        title: "Open main popup",
        contexts: ["action"],
        visible: unifiedPanelEnabled,
      });
    }

    chrome.contextMenus.create({
      id: OPEN_SOURCE_PANEL_MENU_ID,
      title: "Open side panel",
      contexts: ["action"],
      visible: !unifiedPanelEnabled,
    });

    if (INTERNAL_TOOLS_ENABLED) {
      chrome.contextMenus.create({
        id: DEBUG_OPTIONS_CONTEXT_MENU_ID,
        title: showDebugOptions ? "Hide debug options" : "Show debug options",
        contexts: ["action"],
      });
    }
  });
}

async function initializeContextMenus() {
  try {
    const [localResult, syncResult] = await Promise.all([
      chrome.storage.local.get([SHOW_DEBUG_OPTIONS_KEY, PAGE_DOCK_ENABLED_KEY]),
      chrome.storage.sync.get(UNIFIED_PANEL_SETTING_KEY),
    ]);
    const showDebugOptions = localResult[SHOW_DEBUG_OPTIONS_KEY] === true;
    if (typeof localResult[SHOW_DEBUG_OPTIONS_KEY] !== "boolean") {
      chrome.storage.local.set({ [SHOW_DEBUG_OPTIONS_KEY]: false });
    }
    const unifiedPanelEnabled = isUnifiedPanelEnabled(syncResult[UNIFIED_PANEL_SETTING_KEY]);
    currentUnifiedPanelEnabled = unifiedPanelEnabled;
    installContextMenus(
      showDebugOptions,
      pageDockEnabledFromStorage(localResult),
      unifiedPanelEnabled
    );
  } catch (error) {
    console.error("[Lenses][sw] initializeContextMenus failed", error);
  }
}

function updatePageDockToggleMenuTitle(enabled: boolean) {
  // Suppress "no such item" rejections when the menu hasn't been installed yet
  // (e.g. a storage change racing service-worker startup).
  chrome.contextMenus.update(
    PAGE_DOCK_TOGGLE_MENU_ID,
    { title: pageDockToggleTitle(enabled) },
    () => void chrome.runtime.lastError
  );
}

function updateDebugOptionsMenuTitle(showDebugOptions: boolean) {
  if (!INTERNAL_TOOLS_ENABLED) return;
  chrome.contextMenus.update(
    DEBUG_OPTIONS_CONTEXT_MENU_ID,
    { title: showDebugOptions ? "Hide debug options" : "Show debug options" },
    () => void chrome.runtime.lastError
  );
}

function updateActionSurfaceContextMenus(unifiedPanelEnabled: boolean) {
  chrome.contextMenus.update(
    OPEN_ACTION_POPUP_MENU_ID,
    { visible: unifiedPanelEnabled },
    () => void chrome.runtime.lastError
  );
  chrome.contextMenus.update(
    OPEN_SOURCE_PANEL_MENU_ID,
    { visible: !unifiedPanelEnabled },
    () => void chrome.runtime.lastError
  );
}

async function togglePageDockEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PAGE_DOCK_ENABLED_KEY);
  const next = !pageDockEnabledFromStorage(stored);
  await chrome.storage.local.set({ [PAGE_DOCK_ENABLED_KEY]: next });
  return next;
}

void initializeContextMenus();
setupApiKeyMessageHandlers();
setupSourcePanelHandlers();
setupSourceStreamHandlers();
setupYouTubeHandlers();
void initPanelMode();

// --- Toolbar open behavior (unified-panel experiment) ---
//
// Default: the toolbar icon opens the popup (manifest action.default_popup).
// When experimentalUnifiedPanel is on, the icon opens the side panel instead,
// which then hosts the popup's controls. Toggling this is the whole experiment,
// and it must be fully revertible — so we never edit the manifest. We flip two
// things at runtime and restore them when the flag goes off:
//   1. sidePanel.setPanelBehavior({ openPanelOnActionClick }) — make the icon
//      open the panel.
//   2. action.setPopup({ popup: "" }) — a configured popup takes precedence
//      over openPanelOnActionClick, so the popup must be cleared for the panel
//      to open on click; restoring the path returns to today's flow.
// setPopup state is per-session, so we re-apply from storage on every worker
// startup (this module runs top-level each time the worker wakes).
function isUnifiedPanelEnabled(value: unknown): boolean {
  // Contest builds have no popup for the icon to fall back to, so the panel
  // behavior is pinned on no matter what the stored experiment flag says.
  if (CONTEST_BUILD) return true;
  return value === true;
}

async function applyPanelMode(enabled: boolean): Promise<void> {
  currentUnifiedPanelEnabled = enabled;
  updateActionSurfaceContextMenus(enabled);

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enabled });
  } catch (error) {
    console.error("[Lenses][sw] setPanelBehavior failed", error);
  }
  try {
    await chrome.action.setPopup({ popup: enabled ? "" : ACTION_POPUP_PATH });
  } catch (error) {
    console.error("[Lenses][sw] setPopup failed", error);
  }
}

async function initPanelMode(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get(UNIFIED_PANEL_SETTING_KEY);
    await applyPanelMode(isUnifiedPanelEnabled(result[UNIFIED_PANEL_SETTING_KEY]));
  } catch (error) {
    console.error("[Lenses][sw] initPanelMode failed", error);
  }
}

async function openActionPopupFromContextMenu(tab?: chrome.tabs.Tab): Promise<void> {
  if (typeof chrome.action.openPopup !== "function") {
    console.error("[Lenses][sw] action.openPopup is not available in this Chrome version");
    return;
  }

  try {
    await chrome.action.setPopup({ popup: ACTION_POPUP_PATH });
    await chrome.action.openPopup(
      typeof tab?.windowId === "number" ? { windowId: tab.windowId } : undefined
    );
  } catch (error) {
    console.error("[Lenses][sw] openPopup failed", error);
  } finally {
    if (currentUnifiedPanelEnabled) {
      chrome.action.setPopup({ popup: "" }).catch((error) => {
        console.error("[Lenses][sw] restore side-panel popup mode failed", error);
      });
    }
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  const change = changes[UNIFIED_PANEL_SETTING_KEY];
  if (!change) return;
  void applyPanelMode(isUnifiedPanelEnabled(change.newValue));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId.toString();

  if (menuItemId === OPEN_ACTION_POPUP_MENU_ID) {
    await openActionPopupFromContextMenu(tab);
    return;
  }

  if (menuItemId === OPEN_SOURCE_PANEL_MENU_ID) {
    await openSourcePanelFromActionContext(tab);
    return;
  }

  if (INTERNAL_TOOLS_ENABLED && menuItemId === DEBUG_OPTIONS_CONTEXT_MENU_ID) {
    const stored = await chrome.storage.local.get(SHOW_DEBUG_OPTIONS_KEY);
    const showDebugOptions = stored[SHOW_DEBUG_OPTIONS_KEY] !== true;
    await chrome.storage.local.set({ [SHOW_DEBUG_OPTIONS_KEY]: showDebugOptions });
    updateDebugOptionsMenuTitle(showDebugOptions);
    return;
  }

  if (menuItemId === PAGE_DOCK_TOGGLE_MENU_ID) {
    await togglePageDockEnabled();
    return;
  }
});

// Keyboard command (default Ctrl/Cmd+Shift+L) flips the global dock setting; the
// content script's storage listener mounts or tears down the dock in response.
chrome.commands.onCommand.addListener((command) => {
  if (command !== PAGE_DOCK_TOGGLE_COMMAND) return;
  void togglePageDockEnabled();
});

// Keep the context-menu label in sync when the dock is toggled from anywhere
// (popup, keyboard command, undo toast), not just from the menu itself.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const enabledChange = changes[PAGE_DOCK_ENABLED_KEY];
  if (!enabledChange) return;
  updatePageDockToggleMenuTitle(
    pageDockEnabledFromStorage({ [PAGE_DOCK_ENABLED_KEY]: enabledChange.newValue })
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!INTERNAL_TOOLS_ENABLED) return;
  if (areaName !== "local") return;
  const debugOptionsChange = changes[SHOW_DEBUG_OPTIONS_KEY];
  if (!debugOptionsChange) return;
  updateDebugOptionsMenuTitle(debugOptionsChange.newValue === true);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const modeChange = changes[APP_ACCESS_MODE_STORAGE_KEY];
  if (!modeChange) return;
  void handleAppAccessModeChanged(parseAppAccessMode(modeChange.newValue));
});

interface RunRequest {
  type: "run";
  lensId: string;
  text: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  sourceTitle?: string;
  sourceExternalId?: string;
  sourceMetadata?: Record<string, string>;
  scope?: "page" | "selection" | "transcript";
  evidenceBaseId?: string;
  fingerprint?: {
    contentHash: string;
    fileHash?: string;
    extractionVersion: string;
    contentLength: number;
    observedAt: number;
  };
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  // When present, the backend builds an ad-hoc single-category lens from this
  // free-text instruction instead of looking lensId up in the registry.
  customLens?: { instruction: string; name?: string };
  // Chunked sidebar runs use transient per-chunk model calls, then save one
  // merged run separately.
  persist?: boolean;
  /** Client-supplied token used by the managed service's gated cancel route. */
  runRequestId?: string;
}

// Fired by the popup to run lenses over the active page entirely inside the
// service worker. The popup closes as soon as it opens the side panel, which
// would drop any sendMessage callbacks it was awaiting — so orchestration
// (fetch page text → clear → run → highlight) lives here where it survives the
// popup's lifecycle. Either lensIds (built-in lenses) or customLens is provided.
interface RunPageLensesRequest {
  type: "run-page-lenses";
  tabId?: number;
  lensIds?: string[];
  // lensId lets a one-off lens persist under its own id (e.g. "custom-<ts>") so
  // distinct custom lenses don't overwrite each other's stored findings; absent,
  // it falls back to the shared CUSTOM_LENS_ID slot.
  customLens?: { instruction: string; name?: string; lensId?: string };
  storePageLenses?: boolean;
  clearFirst?: boolean;
}

// User asked to stop an in-flight lens by clicking its pill again. The worker
// aborts its fetch and addresses the Convex run by request id so the upstream
// model call stops too.
interface CancelPageLensRequest {
  type: "cancel-page-lens";
  tabId?: number;
  lensId: string;
}

interface CancelRunRequest {
  type: "cancel-run-request";
  runRequestId: string;
}

interface GenerateLensNameRequest {
  type: "generate-lens-name";
  instruction: string;
}

interface SaveUserLensRequest {
  type: "save-user-lens";
  lensId: string;
  name: string;
  instruction: string;
}

interface ListUserLensesRequest {
  type: "list-user-lenses";
}

// Full lens library (built-ins + user lenses) for the master-detail editor. Each
// row carries the stored markdown when present, so the editor can hydrate the
// full prompt without re-deriving it.
interface ListLensesRequest {
  type: "list-lenses";
}

// Persist a full lens edited in the editor. The client serializes the draft to
// canonical markdown; the backend re-parses it (validating every field) and forks
// built-ins into user copies.
interface SaveLensConfigRequest {
  type: "save-lens-config";
  markdown: string;
}

interface DeleteUserLensRequest {
  type: "delete-user-lens";
  lensId: string;
}

interface EraseLensRequest {
  type: "erase-lens";
  lensId: string;
}

interface ReorderUserLensesRequest {
  type: "reorder-user-lenses";
  lensIds: string[];
}

interface ReorderBuiltInLensesRequest {
  type: "reorder-built-in-lenses";
  lensIds: string[];
}

// Open the master-detail editor (the settings page, Lenses view). Fired from the
// content-script rail, which can't open an extension page itself.
interface OpenLensEditorRequest {
  type: "open-lens-editor";
  lensId?: string;
}

interface RunSelectionLensRequest {
  type: "run-selection-lens";
  lensId: string;
  text: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video";
  sourceTitle?: string;
  scope?: "page" | "selection" | "transcript";
}

// Fired by the popup when the user asks a free-text question in "Ask" mode. The
// popup can't hand the question to the side panel directly: opening the panel
// tears the popup down before a sendMessage round-trip to the panel could land.
// Instead the worker stages the question in storage keyed by the active tab, and
// the side panel consumes it on load (see useChat in the sidepanel React app).
interface StageAskRequest {
  type: "stage-ask";
  question?: string;
  draft?: string;
  displayContent?: string;
  context?: PendingAsk["context"];
  targetLensId?: string;
}

interface StageLensRunRequest {
  type: "stage-lens-run";
  lensIds?: string[];
  customLens?: { instruction: string };
  storePageLenses?: boolean;
}

interface FindingEnrichment {
  lensId: string;
  summary: string;
  data?: Record<string, string>;
  sources?: Array<{ url: string; title: string }>;
  addedBy?: "agent" | "user";
  at?: number;
}

type FindingAnchor = Anchor;

interface DebugFinding {
  text: string;
  category: string;
  detail: string;
  confidence: number;
  sourceSpan?: { start: number; end: number };
  anchor?: FindingAnchor;
  quotes?: string[];
  enrichments?: FindingEnrichment[];
  runId?: string;
  findingIndex?: number;
  rawResponse?: string;
  rawFinding?: unknown;
}

type StoredRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface StoredRunState {
  runId: string;
  lensId: string;
  status: StoredRunStatus;
  error?: string;
  modelUsed?: string;
  rawResponse?: string;
  createdAt: number;
  findingCount?: number;
  findings: DebugFinding[];
  chunkCoverage?: { done: number; total: number };
  initiatedFromEvidenceBaseId?: string;
  initiatedFromEvidenceBaseTitle?: string;
}

interface PingRequest {
  type: "ping";
}

interface DevContextCheckRequest {
  type: typeof DEV_CONTEXT_CHECK_MESSAGE_TYPE;
}

interface AnnotationContext {
  lensId: string;
  label: string;
  category: string;
  text: string;
  detail: string;
  confidence: number;
}

interface AskAnnotationRequest {
  type: "ask-finding";
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  annotations: AnnotationContext[];
}

interface ClearPageStorageRequest {
  type: "clear-page-storage";
  sourceUrl: string;
}

interface GetPageDebugDataRequest {
  type: "get-page-debug-data";
  sourceUrl: string;
  lensIds?: string[];
}

interface GetSourceFindingsRequest {
  type: "get-source-findings";
  sourceUrl: string;
  sourceKey?: string;
  lensIds: string[];
}

interface RestorePageLensResultsRequest {
  type: "restore-page-lens-results";
  sourceUrl: string;
  sourceKey?: string;
  lensIds?: string[];
  sourceText: string;
}

interface SaveFindingsRequest {
  type: "save-findings";
  runId?: string;
  lensId: string;
  sourceUrl?: string;
  sourceKey?: string;
  sourceKind?: "web_page" | "youtube_video" | "pdf";
  sourceTitle?: string;
  sourceExternalId?: string;
  sourceMetadata?: Record<string, string>;
  modelUsed?: string;
  rawResponse?: string;
  evidenceBaseId?: string;
  fingerprint?: {
    contentHash: string;
    fileHash?: string;
    extractionVersion: string;
    contentLength: number;
    observedAt: number;
  };
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  evidenceRefs?: FindingEvidenceRefInput[];
  findings: Array<{
    text: string;
    category: string;
    detail: string;
    confidence: number;
    sourceSpan?: { start: number; end: number };
    anchor?: FindingAnchor;
    quotes?: string[];
  }>;
}

interface StartEvidenceRunRequest extends EvidenceRunStartInput {
  type: "start-evidence-run";
}

interface MarkEvidenceRunChunkRequest extends EvidenceRunChunkUpdate {
  type: "mark-evidence-run-chunk";
}

interface FailEvidenceRunRequest extends EvidenceRunFailure {
  type: "fail-evidence-run";
}

interface ListEvidenceBasesRequest {
  type: "list-evidence-bases";
}

interface CreateEvidenceBaseRequest {
  type: "create-evidence-base";
  title: string;
  description?: string;
  guidingQuestion?: string;
}

interface UpdateEvidenceBaseRequest extends Omit<CreateEvidenceBaseRequest, "type"> {
  type: "update-evidence-base";
  evidenceBaseId: string;
}

interface EvidenceBaseByIdRequest {
  type:
    | "get-evidence-base"
    | "preview-delete-evidence-base"
    | "delete-evidence-base"
    | "export-evidence-base";
  evidenceBaseId: string;
}

interface EvidenceBaseHasSourceRequest {
  type: "evidence-base-has-source";
  evidenceBaseId: string;
  sourceKey: string;
}

interface ResolveCitationPublishersRequest {
  type: "resolve-citation-publishers";
  urls: string[];
}

interface ClearSourceCheckCacheRequest {
  type: "clear-source-check-cache";
}

type SelectionMessageMeta = Record<string, string>;
type SelectionMode = "ask" | "explain" | "truth" | "summarize";

interface SavedChatMessage {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  thinkingText?: string;
  textSegments?: StreamTextSegment[];
  meta?: SelectionMessageMeta;
  // Reasoning/research trace and seek stamp; passed through opaquely to the
  // conversations store so restored threads keep them.
  activity?: unknown[];
  searches?: unknown[];
  videoTimestamp?: { seconds: number; formatted: string };
}

interface SavedSelectionRecord {
  id: string;
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  scope?: "page" | "selection" | "transcript";
  url: string;
  selectedText: string;
  messages: SavedChatMessage[];
  title: string;
  createdAt: number;
  anchorPrefix?: string;
  anchorSuffix?: string;
  textStart?: number;
  textEnd?: number;
  pageTitle?: string;
}

interface CreateSavedSelectionRequest {
  type: "create-saved-selection";
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  scope?: "page" | "selection" | "transcript";
  url: string;
  selectedText: string;
  messages: SavedChatMessage[];
  title: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  textStart?: number;
  textEnd?: number;
  pageTitle?: string;
}

interface UpdateSavedSelectionRequest {
  type: "update-saved-selection";
  id: string;
  messages: SavedChatMessage[];
}

interface DeleteSavedSelectionRequest {
  type: "delete-saved-selection";
  id: string;
}

interface GetSavedSelectionsRequest {
  type: "get-saved-selections";
  url: string;
}

interface ConversationIdentity {
  sourceKey: string;
  sourceUrl?: string;
  sourceKind: "web_page" | "youtube_video" | "pdf";
  scope: "page" | "selection" | "transcript";
  focus: "source" | "selection" | "finding" | "run";
  focusRef?: string;
}

interface SaveConversationRequest extends ConversationIdentity {
  type: "save-conversation";
  messages: SavedChatMessage[];
}

interface GetConversationRequest extends ConversationIdentity {
  type: "get-conversation";
}

interface AskFindingStreamPortRequest {
  action: "ask-finding-stream";
  question: string;
  sourceUrl?: string;
  targetLensId?: string;
  sourceCheckOptions?: SourceCheckStreamOptions;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  annotations: AnnotationContext[];
  selectionText?: string;
  pageContext?: string;
  selectionMode?: SelectionMode;
}

interface StreamCitation {
  url: string;
  title: string;
  citedText?: string;
}

interface StreamTextSegment {
  text: string;
  citations: StreamCitation[];
}

interface SourceCheckStreamOptions {
  maxCitations?: number;
  useCache?: boolean;
  forceRefresh?: boolean;
}

interface SourceCheckTestSettings {
  maxCitations: number;
  useCache: boolean;
}

interface CachedSourceCheckResponse {
  key: string;
  targetLensId?: string;
  fullText: string;
  citations: StreamCitation[];
  textSegments: StreamTextSegment[];
  thinkingText?: string;
  modelUsed?: string;
  createdAt: number;
}

type StreamPortEvent =
  | { type: "chunk"; text: string; textSegments?: StreamTextSegment[] }
  | { type: "thinking"; event: "start" | "delta" | "end"; text?: string; fullText?: string }
  | {
      type: "searching";
      event: "start" | "end";
      kind?: "search" | "fetch";
      query?: string;
      url?: string;
      title?: string;
      results?: Array<{ url: string; title: string }>;
    }
  | { type: "citations"; citations: StreamCitation[]; textSegments?: StreamTextSegment[] }
  | { type: "meta"; meta: SelectionMessageMeta }
  | {
      type: "done";
      fullText: string;
      citations?: StreamCitation[];
      textSegments?: StreamTextSegment[];
      modelUsed?: string;
      meta?: SelectionMessageMeta;
    }
  | { type: "error"; error: string };

type Message =
  | RunRequest
  | RunSelectionLensRequest
  | RunPageLensesRequest
  | CancelPageLensRequest
  | CancelRunRequest
  | GenerateLensNameRequest
  | SaveUserLensRequest
  | ListUserLensesRequest
  | ListLensesRequest
  | SaveLensConfigRequest
  | DeleteUserLensRequest
  | EraseLensRequest
  | ReorderUserLensesRequest
  | ReorderBuiltInLensesRequest
  | OpenLensEditorRequest
  | StageAskRequest
  | StageLensRunRequest
  | PingRequest
  | DevContextCheckRequest
  | AskAnnotationRequest
  | ClearPageStorageRequest
  | GetPageDebugDataRequest
  | GetSourceFindingsRequest
  | RestorePageLensResultsRequest
  | SaveFindingsRequest
  | StartEvidenceRunRequest
  | MarkEvidenceRunChunkRequest
  | FailEvidenceRunRequest
  | ListEvidenceBasesRequest
  | CreateEvidenceBaseRequest
  | UpdateEvidenceBaseRequest
  | EvidenceBaseByIdRequest
  | EvidenceBaseHasSourceRequest
  | ResolveCitationPublishersRequest
  | ClearSourceCheckCacheRequest
  | CreateSavedSelectionRequest
  | UpdateSavedSelectionRequest
  | DeleteSavedSelectionRequest
  | GetSavedSelectionsRequest
  | SaveConversationRequest
  | GetConversationRequest;

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === DEV_CONTEXT_CHECK_MESSAGE_TYPE) {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ping") {
      readAppAccessMode()
        .then((mode) => sendResponse({ ok: isLocalByokMode(mode) || !!CONVEX_URL }))
        .catch(() => sendResponse({ ok: !!CONVEX_URL }));
      return true; // Keep channel open for async response
    }

    if (message.type === "run") {
      handleRun(message).then(sendResponse).catch((error) => {
        sendResponse({ error: publicErrorMessage(error, "Run failed") });
      });
      return true; // Keep channel open for async response
    }

    if (message.type === "run-page-lenses") {
      // The popup typically closes before this resolves (it opens the side
      // panel right after firing), so the response may go nowhere — the run
      // still completes here in the worker. We answer anyway for callers that
      // stay open.
      runPageLensesForActiveTab({
        ...message,
        tabId: message.tabId ?? sender.tab?.id,
      })
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: publicErrorMessage(error, "Run failed") });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "cancel-page-lens") {
      const tabId = message.tabId ?? sender.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ cancelled: false });
        return false;
      }
      cancelPageLensRun(tabId, message.lensId)
        .then((cancelled) => sendResponse({ cancelled }))
        .catch(() => sendResponse({ cancelled: false }));
      return true; // Keep channel open for async Convex cancel call
    }

    if (message.type === "cancel-run-request") {
        requestManagedRunCancel(message.runRequestId)
        .then(() => sendResponse({ cancelled: true }))
        .catch(() => sendResponse({ cancelled: false }));
      return true;
    }

    if (message.type === "generate-lens-name") {
      generateLensName(message.instruction)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not name lens" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "save-user-lens") {
      saveUserLens(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not save lens" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "list-user-lenses") {
      listUserLenses()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not load lenses" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "list-lenses") {
      listLenses()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not load lenses" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "save-lens-config") {
      saveLensConfig(message.markdown)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not save lens" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "delete-user-lens") {
      deleteUserLens(message.lensId)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not delete lens" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "erase-lens") {
      eraseLens(message.lensId)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not delete lens" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "reorder-user-lenses") {
      reorderUserLenses(message.lensIds)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not reorder lenses" });
        });
      return true; // Keep channel open for async storage write
    }

    if (message.type === "reorder-built-in-lenses") {
      reorderBuiltInLenses(message.lensIds)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not reorder lenses" });
        });
      return true; // Keep channel open for async storage write
    }

    if (message.type === "open-lens-editor") {
      openLensEditor(message.lensId)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not open editor" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "stage-ask") {
      // Like run-page-lenses, the popup usually closes before this resolves; the
      // question is persisted to storage so the side panel can pick it up.
      stagePendingAsk(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not stage question" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "stage-lens-run") {
      // The popup opens the side panel immediately after this fire-and-forget
      // message. Persist the run intent so the panel can own the async run and
      // refresh its React state when the worker finishes.
      stagePendingLensRun(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not stage lens run" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "run-selection-lens") {
      handleRun({
        type: "run",
        lensId: message.lensId,
        text: message.text,
        sourceUrl: message.sourceUrl,
        sourceKey: message.sourceKey,
        sourceKind: message.sourceKind,
        sourceTitle: message.sourceTitle,
        scope: message.scope,
      })
        .then(async (result) => {
          const colors = colorsForLens(message.lensId);
          let highlightResponse: unknown;
          if ("findings" in result && sender.tab?.id && colors) {
            highlightResponse = await sendTabMessage(sender.tab.id, {
              type: "highlight",
              findings: result.findings,
              lensId: message.lensId,
              colors,
              autoSourceChecks: message.lensId === "source-tracer",
              selectedText: message.text,
              sourceText: message.text,
            });
          }
          sendResponse({
            ...result,
            ...(isRecord(highlightResponse) ? highlightResponse : {}),
          });
        })
        .catch((error) => {
          sendResponse({ error: error.message || "Run failed" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "ask-finding") {
      handleAskFinding(message).then(sendResponse).catch((error) => {
        sendResponse({ error: error.message || "Could not answer question" });
      });
      return true; // Keep channel open for async response
    }

    if (message.type === "clear-page-storage") {
      clearStoredFindingsForPage(message.sourceUrl)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not clear page storage" });
        });
      return true; // Keep channel open for async response
    }

    if (INTERNAL_TOOLS_ENABLED && message.type === "get-page-debug-data") {
      getPageDebugData(message.sourceUrl, message.lensIds ?? [])
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not load page debug data" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "get-source-findings") {
      getStoredRunStates(
        { sourceUrl: message.sourceUrl, sourceKey: message.sourceKey },
        message.lensIds
      )
        .then((runs) => {
          const byLens: Record<string, DebugFinding[]> = {};
          for (const run of runs) {
            if (run.status === "completed" && run.findings.length > 0) {
              byLens[run.lensId] = run.findings;
            }
          }
          sendResponse({ byLens, runs });
        })
        .catch((error) => {
          sendResponse({ error: error.message || "Could not load findings" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "restore-page-lens-results") {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ error: "No page tab to restore lens results into." });
        return true;
      }
      restoreStoredPageLensResultsForTab(tabId, message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not restore lens results" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "save-findings") {
      saveFindings(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || "Could not save findings" });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "start-evidence-run") {
      const { type: _type, ...input } = message;
      startEvidenceRun(input)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: publicErrorMessage(error, "Could not start evidence run") });
        });
      return true;
    }

    if (message.type === "mark-evidence-run-chunk") {
      const { type: _type, ...input } = message;
      markEvidenceRunChunk(input)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: publicErrorMessage(error, "Could not update evidence coverage") });
        });
      return true;
    }

    if (message.type === "fail-evidence-run") {
      const { type: _type, ...input } = message;
      failEvidenceRun(input)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: publicErrorMessage(error, "Could not finish evidence run") });
        });
      return true;
    }

    if (message.type === "list-evidence-bases") {
      listEvidenceBases()
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not load evidence bases" }));
      return true;
    }

    if (message.type === "create-evidence-base") {
      createEvidenceBase(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not create evidence base" }));
      return true;
    }

    if (message.type === "update-evidence-base") {
      updateEvidenceBase(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not update evidence base" }));
      return true;
    }

    if (message.type === "get-evidence-base") {
      getEvidenceBase(message.evidenceBaseId)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not load evidence base" }));
      return true;
    }

    if (message.type === "evidence-base-has-source") {
      evidenceBaseHasSource(message.evidenceBaseId, message.sourceKey)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ error: error.message || "Could not check evidence base membership" })
        );
      return true;
    }

    if (message.type === "preview-delete-evidence-base") {
      previewDeleteEvidenceBase(message.evidenceBaseId)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not inspect deletion" }));
      return true;
    }

    if (message.type === "delete-evidence-base") {
      deleteEvidenceBase(message.evidenceBaseId)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not delete evidence base" }));
      return true;
    }

    if (message.type === "export-evidence-base") {
      exportEvidenceBase(message.evidenceBaseId)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || "Could not export evidence base" }));
      return true;
    }

    if (message.type === "resolve-citation-publishers") {
      resolveCitationPublishers(message.urls)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        });
      return true; // Keep channel open for async response
    }

    if (INTERNAL_TOOLS_ENABLED && message.type === "clear-source-check-cache") {
      clearSourceCheckCache()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === "create-saved-selection") {
      createSavedSelection(message).then(sendResponse).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to save";
        console.warn("[Lenses] Failed to create saved selection", message);
        sendResponse({ error: message });
      });
      return true;
    }

    if (message.type === "update-saved-selection") {
      updateSavedSelection(message.id, message.messages).then(sendResponse).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to update";
        console.warn("[Lenses] Failed to update saved selection", message);
        sendResponse({ error: message });
      });
      return true;
    }

    if (message.type === "save-conversation") {
      saveConversation(message).then(sendResponse).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to save conversation";
        console.warn("[Lenses] Failed to save conversation", message);
        sendResponse({ error: message });
      });
      return true;
    }

    if (message.type === "get-conversation") {
      getConversation(message)
        .then(sendResponse)
        .catch(() => sendResponse({ messages: [] }));
      return true;
    }

    if (message.type === "delete-saved-selection") {
      deleteSavedSelection(message.id)
        .then(sendResponse)
        .catch(() => sendResponse({ error: "Failed to delete" }));
      return true;
    }

    if (message.type === "get-saved-selections") {
      getSavedSelections(message.url)
        .then(sendResponse)
        .catch(() => sendResponse({ selections: [] }));
      return true;
    }
  }
);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "lenses-finding-stream") return;

  let abortController: AbortController | null = null;
  logFindingStreamDebug("port_connected", { name: port.name });

  port.onMessage.addListener((message: AskFindingStreamPortRequest) => {
    if (message.action !== "ask-finding-stream") return;

    logFindingStreamDebug("port_request_received", {
      targetLensId: message.targetLensId,
      questionLength: message.question.length,
      annotationCount: message.annotations.length,
      conversationCount: message.conversation?.length ?? 0,
    });

    abortController?.abort();
    abortController = new AbortController();

    streamAskFindingOverPort(port, message, abortController.signal).catch((error) => {
      logFindingStreamDebug("stream_bridge_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        port.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        } satisfies StreamPortEvent);
      } catch {
        // Port is likely closed.
      }
    });
  });

  port.onDisconnect.addListener(() => {
    logFindingStreamDebug("port_disconnected");
    abortController?.abort();
    abortController = null;
  });
});

async function getConvexUrl(): Promise<string> {
  if (CONVEX_URL) return CONVEX_URL;

  return new Promise((resolve, reject) => {
    chrome.storage.local.get("convexUrl", (result) => {
      if (typeof result.convexUrl === "string") {
        resolve(result.convexUrl);
      } else {
        reject(
          new Error(
            "Convex URL not configured. Set it in extension settings."
          )
        );
      }
    });
  });
}

async function createSavedSelection(message: CreateSavedSelectionRequest): Promise<unknown> {
  return createLocalSavedSelection(message);
}

async function updateSavedSelection(
  id: string,
  messages: SavedChatMessage[]
): Promise<unknown> {
  return updateLocalSavedSelection(id, messages);
}

async function deleteSavedSelection(id: string): Promise<unknown> {
  return deleteLocalSavedSelection(id);
}

async function getSavedSelections(url: string): Promise<{ selections: SavedSelectionRecord[] }> {
  const result = await listLocalSavedSelections(url);
  return { selections: result.selections as unknown as SavedSelectionRecord[] };
}

async function saveConversation(message: SaveConversationRequest): Promise<unknown> {
  return saveLocalConversation(message, message.messages);
}

async function getConversation(
  message: GetConversationRequest
): Promise<{ messages: SavedChatMessage[] }> {
  const result = await getLocalConversation(message);
  return { messages: result.messages as SavedChatMessage[] };
}

const MAX_CITATION_PUBLISHER_URLS_PER_REQUEST = 20;
const MAX_CITATION_PUBLISHER_URLS_PER_MESSAGE = 40;
const citationPublisherCache = new Map<string, string>();
const citationPublisherMisses = new Set<string>();

async function resolveCitationPublishers(
  urls: string[]
): Promise<{ publishers: Record<string, string>; authoritativeUrls: string[] }> {
  logFindingStreamDebug("citation_publishers_resolve_start", {
    requestedUrlCount: urls.length,
  });

  const cacheKeyToUrls = new Map<string, Set<string>>();
  const cacheKeyToRepresentativeUrl = new Map<string, string>();

  for (const rawUrl of urls.slice(0, MAX_CITATION_PUBLISHER_URLS_PER_MESSAGE)) {
    const normalizedUrl = normalizePublicHttpUrl(rawUrl);
    if (!normalizedUrl) continue;

    const cacheKey = getPublisherCacheKey(normalizedUrl);

    const existingSet = cacheKeyToUrls.get(cacheKey);
    if (existingSet) {
      existingSet.add(normalizedUrl);
    } else {
      cacheKeyToUrls.set(cacheKey, new Set([normalizedUrl]));
    }

    if (!cacheKeyToRepresentativeUrl.has(cacheKey)) {
      cacheKeyToRepresentativeUrl.set(cacheKey, normalizedUrl);
    }
  }

  const publishers: Record<string, string> = {};
  const unresolved: Array<{ cacheKey: string; url: string }> = [];
  const authoritativeCacheKeys = new Set<string>();
  let cacheHitCount = 0;
  let backendHitCount = 0;

  for (const [cacheKey, urlSet] of cacheKeyToUrls.entries()) {
    const cached = citationPublisherCache.get(cacheKey);
    if (cached) {
      for (const normalizedUrl of urlSet) {
        publishers[normalizedUrl] = cached;
        cacheHitCount++;
      }
      continue;
    }

    if (citationPublisherMisses.has(cacheKey)) {
      authoritativeCacheKeys.add(cacheKey);
      continue;
    }

    const representativeUrl = cacheKeyToRepresentativeUrl.get(cacheKey);
    if (!representativeUrl) continue;
    unresolved.push({ cacheKey, url: representativeUrl });
  }

  const managedResolverEnabled = !isLocalByokMode(await readAppAccessMode());
  if (managedResolverEnabled && unresolved.length > 0) {
    for (let offset = 0; offset < unresolved.length; offset += MAX_CITATION_PUBLISHER_URLS_PER_REQUEST) {
      const batch = unresolved.slice(offset, offset + MAX_CITATION_PUBLISHER_URLS_PER_REQUEST);
      try {
        const backendResolved = await resolveCitationPublishersViaBackend(
          batch.map(({ url }) => url)
        );
        for (const { cacheKey, url } of batch) {
          authoritativeCacheKeys.add(cacheKey);
          const publisher = backendResolved[url];
          if (!publisher) continue;
          citationPublisherCache.set(cacheKey, publisher);
          citationPublisherMisses.delete(cacheKey);
          backendHitCount++;
        }
      } catch (error) {
        logFindingStreamDebug("citation_publisher_backend_error", {
          message: error instanceof Error ? error.message : String(error),
          unresolvedCount: batch.length,
        });
      }
    }
    logFindingStreamDebug("citation_publishers_backend_result", {
      requestedRepresentativeCount: unresolved.length,
      resolvedRepresentativeCount: backendHitCount,
    });
  }

  for (const { cacheKey } of unresolved) {
    const publisher = citationPublisherCache.get(cacheKey);
    if (!publisher) {
      if (authoritativeCacheKeys.has(cacheKey)) citationPublisherMisses.add(cacheKey);
      continue;
    }
    const matchingUrls = cacheKeyToUrls.get(cacheKey);
    if (!matchingUrls) continue;
    for (const normalizedUrl of matchingUrls) {
      publishers[normalizedUrl] = publisher;
    }
  }

  logFindingStreamDebug("citation_publishers_resolve_done", {
    uniqueCacheKeyCount: cacheKeyToUrls.size,
    unresolvedRepresentativeCount: unresolved.length,
    cacheHitCount,
    backendHitCount,
    finalResolvedUrlCount: Object.keys(publishers).length,
  });

  const authoritativeUrls: string[] = [];
  for (const cacheKey of authoritativeCacheKeys) {
    for (const url of cacheKeyToUrls.get(cacheKey) ?? []) authoritativeUrls.push(url);
  }

  return { publishers, authoritativeUrls };
}

function getPublisherCacheKey(normalizedUrl: string): string {
  try {
    return new URL(normalizedUrl).origin.toLowerCase();
  } catch {
    return normalizedUrl;
  }
}

async function resolveCitationPublishersViaBackend(
  urls: string[]
): Promise<Record<string, string>> {
  const convexUrl = await getConvexUrl();
  const convexSiteUrl = getConvexSiteBaseUrl(convexUrl);

  const response = await fetch(`${convexSiteUrl}/resolve-citation-publishers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    throw new Error(
      `Resolve citation publishers API error (${response.status}): ${await response.text()}`
    );
  }

  const payload = (await response.json()) as { publishers?: unknown };
  const publishers = payload.publishers;
  if (!publishers || typeof publishers !== "object" || Array.isArray(publishers)) {
    throw new Error("Resolve citation publishers API returned an invalid payload");
  }

  const normalized: Record<string, string> = {};
  for (const [rawUrl, rawPublisher] of Object.entries(publishers)) {
    const url = normalizePublicHttpUrl(rawUrl);
    if (!url) continue;
    if (typeof rawPublisher !== "string") continue;
    const publisher = rawPublisher.trim();
    if (!publisher) continue;
    normalized[url] = publisher;
  }

  logFindingStreamDebug("citation_publishers_backend_payload", {
    requestCount: urls.length,
    resolvedCount: Object.keys(normalized).length,
  });

  return normalized;
}

async function handleRun(
  request: RunRequest,
  options?: { signal?: AbortSignal }
): Promise<
  | {
      findings: DebugFinding[];
      runId?: string;
      rawResponse?: string;
      modelUsed?: string;
    }
  | { error: string; cancelled?: boolean }
> {
  const testing = await getTestingModeEnabled();
  const appMode = await readAppAccessMode();

  // Bound the source text before sending it to either provider.
  const maxChars = 30_000;
  const text =
    request.text.length > maxChars
      ? request.text.slice(0, maxChars) + "\n\n[Text truncated...]"
      : request.text;

  if (isLocalByokMode(appMode)) {
    const aiSettings = await getStoredLocalByokAiSettings("execution");
    return runLocalLens(
      {
        lensId: request.lensId,
        text,
        sourceUrl: request.sourceUrl,
        sourceKey: request.sourceKey,
        sourceKind: request.sourceKind,
        sourceTitle: request.sourceTitle,
        scope: request.scope,
        customLens: request.customLens,
      },
      {
        provider: aiSettings.provider,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        reasoningEffort: aiSettings.reasoningEffort,
      },
      { signal: options?.signal, testing, persist: request.persist }
    ) as Promise<
      | {
          findings: DebugFinding[];
          runId?: string;
          rawResponse?: string;
          modelUsed?: string;
        }
      | { error: string; cancelled?: boolean }
    >;
  }

  const aiSettings = await readStoredModelSettings("execution");
  const convexUrl = await getConvexUrl();
  const convexSiteUrl = getConvexSiteBaseUrl(convexUrl);

  // Managed mode performs model execution remotely but keeps the durable Lens,
  // run, finding, and evidence-base records in this browser. The service gets
  // only the fields needed to execute the Lens.
  let response: Response;
  try {
    response = await fetch(`${convexSiteUrl}/managed/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lensId: request.lensId,
        customLens: request.customLens,
        provider: aiSettings.provider,
        model: aiSettings.model,
        reasoningEffort: aiSettings.reasoningEffort,
        testing,
        runRequestId: request.runRequestId,
        persist: false,
      }),
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Cancelled", cancelled: true };
    }
    throw error;
  }

  if (!response.ok) {
    return {
      error: publicErrorMessage(
        await readManagedApiError(response, `Managed API error (${response.status})`),
        `API error (${response.status})`
      ),
    };
  }

  const result = await response.json();

  if (result.status === "error") {
    return { error: publicErrorMessage(result.errorMessage, "Run failed") };
  }

  // Convex tells us the run was cancelled by signalling cancelled:true in the
  // action's response. Surface as a typed cancelled result so the dock can
  // skip its "found no matches" toast for what was an intentional stop.
  if (result.value?.cancelled === true) {
    return { error: "Cancelled", cancelled: true };
  }

  const rawResponse =
    typeof result.value?.rawResponse === "string" ? result.value.rawResponse : undefined;
  const modelUsed =
    typeof result.value?.modelUsed === "string" ? result.value.modelUsed : undefined;
  const findings = enrichFindingsWithRaw(
    Array.isArray(result.value?.findings) ? result.value.findings : [],
    rawResponse,
    undefined
  );

  const saved =
    request.persist === false
      ? undefined
      : await saveFindings({
          type: "save-findings",
          lensId: request.lensId,
          sourceUrl: request.sourceUrl,
          sourceKey: request.sourceKey,
          sourceKind: request.sourceKind,
          sourceTitle: request.sourceTitle,
          sourceExternalId: request.sourceExternalId,
          sourceMetadata: request.sourceMetadata,
          evidenceBaseId: request.evidenceBaseId,
          fingerprint: request.fingerprint,
          lensVersion: request.lensVersion,
          lensMarkdownSnapshot: request.lensMarkdownSnapshot,
          modelUsed,
          rawResponse,
          findings: findingsForEvidenceBase(findings),
        });
  if (saved && "error" in saved) return { error: saved.error };

  const runId = saved && !("error" in saved) ? saved.runId : undefined;
  return { findings, runId, rawResponse, modelUsed };
}

// --- Page lens orchestration (popup-triggered) ---

interface PageTextForTab {
  text: string | null;
  sourceKind?: "web_page" | "youtube_video";
  sourceTitle?: string;
  sourceKey?: string;
  scope?: "page" | "selection" | "transcript";
}

function isYouTubeVideoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname.endsWith("youtube.com") &&
      (url.pathname.startsWith("/watch") || url.pathname.startsWith("/shorts/"))
    );
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/")[2] || null;
    }
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

function injectContentScript(tabId: number): Promise<boolean> {
  if (!chrome.scripting) return Promise.resolve(false);
  return chrome.scripting
    .executeScript({ target: { tabId }, files: ["content/content.js"] })
    .then(() =>
      chrome.scripting.insertCSS({ target: { tabId }, files: ["content/highlight.css"] })
    )
    .then(() => true)
    .catch((error) => {
      console.warn("[Lenses] Content script injection failed", error);
      return false;
    });
}

function requestPageText(tabId: number): Promise<PageTextForTab & { missingReceiver: boolean }> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "get-page-text" }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        const missingReceiver = (runtimeError.message ?? "").includes(
          "Receiving end does not exist"
        );
        resolve({ text: null, missingReceiver });
        return;
      }
      resolve({
        text: response?.text ?? null,
        missingReceiver: false,
        sourceKind: response?.sourceKind,
        sourceTitle: response?.sourceTitle,
        sourceKey: response?.sourceKey,
        scope: response?.scope,
      });
    });
  });
}

// Read the page text, recovering once if the content script is not yet present
// (e.g. the page loaded before the extension, or after an update). Mirrors the
// recovery the popup used to do before runs moved into the worker.
async function getPageTextForTab(tabId: number): Promise<PageTextForTab> {
  const firstTry = await requestPageText(tabId);
  if (firstTry.text || !firstTry.missingReceiver) return firstTry;

  const injected = await injectContentScript(tabId);
  if (!injected) return firstTry;
  return requestPageText(tabId);
}

function buildSourceMetadata(
  tab: chrome.tabs.Tab,
  pageText: PageTextForTab
): {
  sourceKind: "web_page" | "youtube_video";
  sourceTitle: string;
  sourceKey: string;
  scope: "page" | "selection" | "transcript";
} {
  const url = tab.url ?? "";
  const isYouTube =
    pageText.sourceKind === "youtube_video" || isYouTubeVideoUrl(url);
  const videoId = extractYouTubeVideoId(url);
  return {
    sourceKind: isYouTube ? "youtube_video" : "web_page",
    sourceTitle:
      pageText.sourceTitle ?? tab.title ?? (isYouTube ? "YouTube video" : "Web page"),
    sourceKey:
      pageText.sourceKey ??
      (isYouTube && videoId ? `youtube:${videoId}` : `url:${url}`),
    scope: pageText.scope ?? (isYouTube ? "transcript" : "page"),
  };
}

// In-flight page-lens runs keyed by `${tabId}:${lensId}`. We hold both the
// AbortController (to tear down the local HTTP request when the user cancels)
// and the runRequestId used by the managed cancel route to stop the upstream
// provider request.
interface PageLensRunHandle {
  controller: AbortController;
  runRequestId: string;
}
const pageLensRuns = new Map<string, PageLensRunHandle>();

function pageLensControllerKey(tabId: number, lensId: string): string {
  return `${tabId}:${lensId}`;
}

async function cancelPageLensRun(tabId: number, lensId: string): Promise<boolean> {
  const key = pageLensControllerKey(tabId, lensId);
  const handle = pageLensRuns.get(key);
  if (!handle) return false;
  // Order matters: tell the service to stop first so its cancel poller can abort
  // the upstream LLM fetch on the server side. Then close the local HTTP
  // request — if we did this in reverse, Convex would still finish the LLM
  // call and we'd lose the credit savings.
  void requestManagedRunCancel(handle.runRequestId).catch(() => undefined);
  handle.controller.abort();
  pageLensRuns.delete(key);
  return true;
}

async function requestManagedRunCancel(runRequestId: string): Promise<void> {
  if (isLocalByokMode(await readAppAccessMode())) return;
  const convexUrl = await getConvexUrl();
  if (!convexUrl) return;
  const siteUrl = getConvexSiteBaseUrl(convexUrl);
  const response = await fetch(`${siteUrl}/managed/cancel-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runRequestId }),
  });
  if (!response.ok) {
    throw new Error(await readManagedApiError(response, "Could not stop managed run"));
  }
}

async function runPageLensesForActiveTab(
  request: RunPageLensesRequest
): Promise<{
  ranLenses: number;
  error?: string;
  results: Array<{
    lensId: string;
    findingCount: number;
    renderedCount?: number;
    failedAnchorCount?: number;
    cancelled?: boolean;
  }>;
}> {
  const tab = request.tabId
    ? await chrome.tabs.get(request.tabId).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return { ranLenses: 0, error: "No active page to run lenses on.", results: [] };
  }
  const tabId = tab.id;

  // Each run targets one lens id. A custom lens uses the shared CUSTOM_LENS_ID
  // and carries its instruction; explicitly selected lenses run as chosen. Domain
  // rules decide defaults/auto-run elsewhere, but a manual run should honor the
  // current UI selection instead of filtering it a second time.
  const configuredLensIds = request.customLens
    ? []
    : cleanLensIds(request.lensIds ?? []);
  const lensRuns: Array<{ lensId: string; customLens?: { instruction: string; name?: string } }> =
    request.customLens
      ? [
          {
            lensId: request.customLens.lensId?.trim() || CUSTOM_LENS_ID,
            customLens: {
              instruction: request.customLens.instruction,
              name: request.customLens.name,
            },
          },
        ]
      : configuredLensIds.map((lensId) => ({ lensId }));

  if (lensRuns.length === 0) {
    return { ranLenses: 0, error: "No lenses selected.", results: [] };
  }

  const pageText = await getPageTextForTab(tabId);
  if (!pageText.text) {
    return { ranLenses: 0, error: "Couldn't read any text from this page.", results: [] };
  }

  const storePageLenses = request.storePageLenses ?? true;
  const sourceMetadata = buildSourceMetadata(tab, pageText);
  const evidenceBaseId = await readActiveEvidenceBaseId();
  const fingerprint = await fingerprintText(pageText.text);
  const lensProvenance = evidenceBaseId
    ? await loadLensRunProvenance()
    : new Map<string, LensRunProvenance>();
  const transcript =
    sourceMetadata.sourceKind === "youtube_video"
      ? await getTranscriptSegmentsForTab(tabId)
      : [];
  const preparedSource = await prepareSegmentedSource(
    {
      kind: sourceMetadata.sourceKind,
      text: pageText.text,
      fingerprint,
    },
    transcript
  );

  if (request.clearFirst !== false) {
    // Start from a clean slate so a full re-run doesn't stack on stale highlights.
    await sendTabMessage(tabId, { type: "clear", resetVisibility: false });
  }

  let ranLenses = 0;
  let lastError: string | undefined;
  const results: Array<{
    lensId: string;
    findingCount: number;
    renderedCount?: number;
    failedAnchorCount?: number;
    cancelled?: boolean;
  }> = [];
  for (const { lensId, customLens } of lensRuns) {
    // Each lens-run gets its own AbortController + runRequestId. The
    // controller tears down the local fetch on cancel; the runRequestId is
    // what the Convex backend uses to find and stop the corresponding row,
    // which stops unnecessary provider work. Cleanup runs in `finally` so
    // a mid-run cancel still removes the entry from the registry.
    const controllerKey = pageLensControllerKey(tabId, lensId);
    pageLensRuns.get(controllerKey)?.controller.abort();
    const controller = new AbortController();
    const runRequestId = crypto.randomUUID();
    const handle: PageLensRunHandle = { controller, runRequestId };
    pageLensRuns.set(controllerKey, handle);

    let result: Awaited<ReturnType<typeof handleRun>>;
    try {
      const provenance = evidenceBaseId ? lensProvenance.get(lensId) : undefined;
      const persistSourceIdentity = storePageLenses || Boolean(evidenceBaseId);
      result = await runChunkedPageLens({
        evidenceBaseId: evidenceBaseId ?? undefined,
        prepared: preparedSource,
        lensId,
        customLens,
        sourceUrl: tab.url,
        sourceKey: sourceMetadata.sourceKey,
        sourceKind: sourceMetadata.sourceKind,
        sourceTitle: sourceMetadata.sourceTitle,
        sourceExternalId:
          sourceMetadata.sourceKind === "youtube_video"
            ? extractYouTubeVideoId(tab.url) ?? undefined
            : undefined,
        sourceMetadata: { scope: sourceMetadata.scope },
        scope: sourceMetadata.scope,
        lensVersion: provenance?.version ?? (customLens ? "0.0.1" : undefined),
        lensMarkdownSnapshot: provenance?.markdown,
        persistResult: storePageLenses || Boolean(evidenceBaseId),
        persistSourceIdentity,
        runRequestId,
        signal: controller.signal,
      });
    } finally {
      // Only delete if this handle is still the registered one — a fresh
      // run for the same lens could have replaced us above.
      if (pageLensRuns.get(controllerKey) === handle) {
        pageLensRuns.delete(controllerKey);
      }
    }

    if ("error" in result) {
      if (result.cancelled) {
        results.push({ lensId, findingCount: 0, cancelled: true });
        continue;
      }
      lastError = publicErrorMessage(result.error, "Run failed");
      continue;
    }

    ranLenses++;
    let renderedCount: number | undefined;
    let failedAnchorCount: number | undefined;
    if (result.findings.length > 0) {
      const highlightResponse = await sendTabMessage(tabId, {
        type: "highlight",
        findings: result.findings,
        lensId,
        colors: colorsForLens(lensId),
        sourceText: pageText.text,
      });
      if (isRecord(highlightResponse) && typeof highlightResponse.renderedCount === "number") {
        renderedCount = highlightResponse.renderedCount;
      }
      if (isRecord(highlightResponse) && typeof highlightResponse.failedAnchorCount === "number") {
        failedAnchorCount = highlightResponse.failedAnchorCount;
      }
    }
    results.push({
      lensId,
      findingCount: result.findings.length,
      renderedCount,
      failedAnchorCount,
    });
  }

  return { ranLenses, error: ranLenses === 0 ? lastError : undefined, results };
}

async function runChunkedPageLens(args: {
  evidenceBaseId?: string;
  prepared: PreparedSegmentedSource;
  lensId: string;
  customLens?: { instruction: string; name?: string };
  sourceUrl: string;
  sourceKey: string;
  sourceKind: "web_page" | "youtube_video";
  sourceTitle?: string;
  sourceExternalId?: string;
  sourceMetadata?: Record<string, string>;
  scope: "page" | "selection" | "transcript";
  lensVersion?: string;
  lensMarkdownSnapshot?: string;
  persistResult: boolean;
  persistSourceIdentity: boolean;
  runRequestId: string;
  signal: AbortSignal;
}): Promise<Awaited<ReturnType<typeof handleRun>>> {
  let runId: string | undefined;
  try {
    if (args.evidenceBaseId) {
      const started = await startEvidenceRun({
        evidenceBaseId: args.evidenceBaseId,
        lensId: args.lensId,
        runRequestId: args.runRequestId,
        sourceKey: args.sourceKey,
        kind: args.sourceKind,
        url: args.sourceUrl,
        title: args.sourceTitle,
        externalId: args.sourceExternalId,
        metadata: args.sourceMetadata,
        fingerprint: args.prepared.fingerprint,
        scope: args.scope,
        lensVersion: args.lensVersion,
        lensMarkdownSnapshot: args.lensMarkdownSnapshot,
        chunkingVersion: args.prepared.chunkingVersion,
        segments: args.prepared.descriptors,
        inspections: chunkInspectionPlan(args.prepared.chunks),
      });
      runId = started.runId;
    }
    if (args.prepared.chunks.length === 0) {
      throw new Error("No extractable source text was available for this run");
    }

    const mergedFindings: DebugFinding[] = [];
    const rawResponses: Array<{ chunkIndex: number; rawResponse: string }> = [];
    let modelUsed: string | undefined;
    for (const chunk of args.prepared.chunks) {
      const result = await handleRun(
        {
          type: "run",
          lensId: args.lensId,
          text: chunk.text,
          sourceKind: args.sourceKind,
          sourceTitle: args.sourceTitle,
          scope: args.scope,
          customLens: args.customLens,
          runRequestId: args.runRequestId,
          persist: false,
        },
        { signal: args.signal }
      );
      if ("error" in result) {
        if (result.cancelled) {
          if (runId) await failEvidenceRun({ runId, status: "cancelled" });
          return result;
        }
        throw new Error(result.error);
      }
      modelUsed = result.modelUsed ?? modelUsed;
      if (result.rawResponse) {
        rawResponses.push({ chunkIndex: chunk.chunkIndex, rawResponse: result.rawResponse });
      }
      mergedFindings.push(
        ...mergeFindingsFromExecutionChunk(chunk, result.findings)
      );
      if (runId) {
        await markEvidenceRunChunk({
          runId,
          chunkIndex: chunk.chunkIndex,
          status: "completed",
        });
      }
    }

    const deduped = dedupePageFindings(mergedFindings);
    const grounded = await groundFindingsInSource(deduped, args.prepared);
    const rawResponse = serializePageChunkRawResponses(
      rawResponses,
      args.prepared.chunks.length
    );
    const saved = args.persistResult
      ? await saveFindings({
          type: "save-findings",
          runId,
          lensId: args.lensId,
          sourceUrl: args.persistSourceIdentity ? args.sourceUrl : undefined,
          sourceKey: args.persistSourceIdentity ? args.sourceKey : undefined,
          sourceKind: args.sourceKind,
          sourceTitle: args.sourceTitle,
          sourceExternalId: args.sourceExternalId,
          sourceMetadata: args.sourceMetadata,
          evidenceBaseId: args.evidenceBaseId,
          fingerprint: args.evidenceBaseId ? args.prepared.fingerprint : undefined,
          lensVersion: args.lensVersion,
          lensMarkdownSnapshot: args.lensMarkdownSnapshot,
          modelUsed,
          rawResponse,
          evidenceRefs: args.evidenceBaseId ? grounded.evidenceRefs : undefined,
          findings: findingsForEvidenceBase(grounded.findings),
        })
      : undefined;
    if (saved && "error" in saved) throw new Error(saved.error);
    return {
      runId: saved && !("error" in saved) ? saved.runId ?? runId : runId,
      findings: grounded.findings,
      rawResponse,
      modelUsed,
    };
  } catch (error) {
    const cancelled = args.signal.aborted || (error instanceof Error && error.name === "AbortError");
    if (runId) {
      await failEvidenceRun({
        runId,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? undefined : publicErrorMessage(error, "Run failed"),
      }).catch(() => undefined);
    }
    return cancelled
      ? { error: "Cancelled", cancelled: true }
      : { error: publicErrorMessage(error, "Run failed") };
  }
}

async function getTranscriptSegmentsForTab(tabId: number): Promise<TranscriptSegment[]> {
  const response = await sendTabMessage(tabId, { action: "getTranscript" }).catch(() => null);
  if (!isRecord(response) || !Array.isArray(response.transcript)) return [];
  return response.transcript.filter((value): value is TranscriptSegment => {
    if (!isRecord(value)) return false;
    return (
      typeof value.text === "string" &&
      typeof value.start === "number" &&
      typeof value.duration === "number" &&
      typeof value.formatted === "string"
    );
  });
}

function dedupePageFindings(findings: readonly DebugFinding[]): DebugFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const location = finding.sourceSpan
      ? `${finding.sourceSpan.start}:${finding.sourceSpan.end}`
      : finding.text;
    const key = `${finding.category}|${finding.text.toLowerCase().replace(/\s+/g, " ").trim()}|${location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializePageChunkRawResponses(
  responses: ReadonlyArray<{ chunkIndex: number; rawResponse: string }>,
  totalChunks: number
): string | undefined {
  if (responses.length === 0) return undefined;
  if (responses.length === 1 && totalChunks === 1 && responses[0].chunkIndex === 0) {
    return responses[0].rawResponse;
  }
  return JSON.stringify({
    format: "lenses.chunked-raw-response.v1",
    totalChunks,
    chunks: responses,
  });
}

interface LensRunProvenance {
  version?: string;
  markdown?: string;
}

async function loadLensRunProvenance(): Promise<Map<string, LensRunProvenance>> {
  const response = await listRawLenses().catch(() => ({ lenses: [] as unknown[] }));
  const provenance = new Map<string, LensRunProvenance>();
  for (const row of response.lenses ?? []) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.lensId !== "string") continue;
    provenance.set(record.lensId, {
      version: typeof record.version === "string" ? record.version : undefined,
      markdown: typeof record.markdown === "string" ? record.markdown : undefined,
    });
  }
  return provenance;
}

function findingsForEvidenceBase(
  findings: DebugFinding[]
): SaveFindingsRequest["findings"] {
  return findings.map((finding) => ({
    text: finding.text,
    category: finding.category,
    detail: finding.detail,
    confidence: finding.confidence,
    sourceSpan: finding.sourceSpan,
    anchor:
      finding.anchor ??
      (finding.sourceSpan
        ? {
            kind: "text",
            start: finding.sourceSpan.start,
            end: finding.sourceSpan.end,
          }
        : undefined),
    quotes: finding.quotes,
  }));
}

function cleanLensIds(lensIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const lensId of lensIds) {
    const trimmed = lensId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// Generate a short 2-3 word name for a free-text lens instruction by calling the
async function generateLensName(
  instruction: string
): Promise<{ name?: string; error?: string }> {
  if (isLocalByokMode(await readAppAccessMode())) {
    return generateLocalLensName(instruction);
  }
  return generateLensNameViaConvex(instruction);
}

async function saveUserLens(
  request: SaveUserLensRequest
): Promise<{ lensId?: string; name?: string; error?: string }> {
  return saveLocalUserLens(request);
}

async function listUserLenses(): Promise<{
  lenses?: Array<{ lensId: string; name: string }>;
  error?: string;
}> {
  const response = await listLenses();
  if (response.error) return { error: response.error };
  const lenses = (response.lenses ?? [])
    .filter(
      (row): row is { lensId: string; name?: unknown; isBuiltIn?: unknown } =>
        !!row &&
        typeof (row as { lensId?: unknown }).lensId === "string" &&
        (row as { isBuiltIn?: unknown }).isBuiltIn === false
    )
    .map((row) => ({
      lensId: row.lensId,
      name: typeof row.name === "string" ? row.name : row.lensId,
    }));
  return { lenses };
}

async function listLenses(): Promise<{
  lenses?: unknown[];
  error?: string;
}> {
  const response = await listRawLenses();
  if (response.error) return response;
  const visible = await filterErasedLenses(response.lenses ?? []);
  const userOrdered = await applyUserLensOrder(visible);
  return { lenses: await applyBuiltInLensOrder(userOrdered) };
}

async function reorderUserLenses(
  lensIds: readonly string[]
): Promise<{ lensIds?: string[]; error?: string }> {
  const clean = cleanLensIds(lensIds);
  await chrome.storage.local.set({ [USER_LENS_ORDER_KEY]: clean });
  return { lensIds: clean };
}

async function reorderBuiltInLenses(
  lensIds: readonly string[]
): Promise<{ lensIds?: string[]; error?: string }> {
  const clean = cleanLensIds(lensIds);
  await chrome.storage.local.set({ [BUILT_IN_LENS_ORDER_KEY]: clean });
  return { lensIds: clean };
}

async function removeUserLensFromOrder(lensId: string): Promise<void> {
  await removeLensIdFromStorageList(USER_LENS_ORDER_KEY, lensId);
}

async function removeBuiltInLensFromOrder(lensId: string): Promise<void> {
  await removeLensIdFromStorageList(BUILT_IN_LENS_ORDER_KEY, lensId);
}

async function removeLensIdFromStorageList(key: string, lensId: string): Promise<void> {
  const order = await readLensIdList(key);
  const next = order.filter((orderedLensId) => orderedLensId !== lensId);
  if (next.length !== order.length) await chrome.storage.local.set({ [key]: next });
}

async function readUserLensOrder(): Promise<string[]> {
  return readLensIdList(USER_LENS_ORDER_KEY);
}

async function readBuiltInLensOrder(): Promise<string[]> {
  return readLensIdList(BUILT_IN_LENS_ORDER_KEY);
}

async function readErasedLensIds(): Promise<string[]> {
  return readLensIdList(ERASED_LENS_IDS_KEY);
}

async function readLensIdList(key: string): Promise<string[]> {
  const stored = await chrome.storage.local
    .get(key)
    .catch(() => ({}) as Record<string, unknown>);
  const value = stored[key];
  return cleanLensIds(Array.isArray(value) ? value.filter(isString) : []);
}

async function applyUserLensOrder(rows: unknown[]): Promise<unknown[]> {
  const order = await readUserLensOrder();
  return applyLensOrder(rows, order, (identity) => !identity.isBuiltIn);
}

async function applyBuiltInLensOrder(rows: unknown[]): Promise<unknown[]> {
  const order = await readBuiltInLensOrder();
  return applyLensOrder(rows, order, (identity) => identity.isBuiltIn);
}

function applyLensOrder(
  rows: unknown[],
  order: readonly string[],
  matches: (identity: { lensId: string; isBuiltIn: boolean }) => boolean
): unknown[] {
  if (order.length === 0) return rows;

  const rank = new Map(order.map((lensId, index) => [lensId, index]));
  const decorated = rows.map((row, index) => ({
    row,
    index,
    identity: lensRowIdentity(row),
  }));
  const sortedRows = decorated
    .filter((item) => item.identity && matches(item.identity))
    .sort((a, b) => {
      const aRank = rank.get(a.identity?.lensId ?? "") ?? order.length + a.index;
      const bRank = rank.get(b.identity?.lensId ?? "") ?? order.length + b.index;
      return aRank - bRank || a.index - b.index;
    })
    .map((item) => item.row);

  let sortedIndex = 0;
  return decorated.map((item) => {
    if (item.identity && matches(item.identity)) return sortedRows[sortedIndex++];
    return item.row;
  });
}

async function filterErasedLenses(rows: unknown[]): Promise<unknown[]> {
  const erased = new Set(await readErasedLensIds());
  if (erased.size === 0) return rows;
  return rows.filter((row) => {
    const identity = lensRowIdentity(row);
    return !identity || !erased.has(identity.lensId);
  });
}

function lensRowIdentity(row: unknown): { lensId: string; isBuiltIn: boolean } | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.lensId !== "string") return null;
  return { lensId: record.lensId, isBuiltIn: record.isBuiltIn === true };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function listRawLenses(): Promise<{
  lenses?: unknown[];
  error?: string;
}> {
  return { lenses: await listLocalLensRows() };
}

async function saveLensConfig(
  markdown: string
): Promise<{ lensId?: string; name?: string; error?: string }> {
  return saveLocalLensConfig(markdown);
}

async function eraseLens(
  lensId: string
): Promise<{ erased?: boolean; deleted?: boolean; error?: string }> {
  const response = await listRawLenses();
  if (response.error) return { error: response.error };
  const target = (response.lenses ?? [])
    .map(lensRowIdentity)
    .find((identity) => identity?.lensId === lensId);

  if (target?.isBuiltIn) {
    await addErasedLensId(lensId);
    await removeBuiltInLensFromOrder(lensId);
    return { erased: true };
  }

  const result = await deleteUserLens(lensId);
  return { ...result, erased: result.deleted };
}

async function addErasedLensId(lensId: string): Promise<void> {
  const current = await readErasedLensIds();
  const next = cleanLensIds([...current, lensId]);
  await chrome.storage.local.set({ [ERASED_LENS_IDS_KEY]: next });
}

async function deleteUserLens(
  lensId: string
): Promise<{ deleted?: boolean; error?: string }> {
  const result = await deleteLocalUserLens(lensId);
  if (result.deleted) await removeUserLensFromOrder(lensId);
  return result;
}

// Lens names use the execution model and fall back to an instruction-derived
// name if the remote model call fails.
async function generateLensNameViaConvex(
  instruction: string
): Promise<{ name?: string; error?: string }> {
  const convexUrl = await getConvexUrl();
  const convexSiteUrl = getConvexSiteBaseUrl(convexUrl);
  const aiSettings = await readStoredModelSettings("execution");
  const testing = await getTestingModeEnabled();

  const response = await fetch(`${convexSiteUrl}/managed/generate-lens-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction,
      provider: aiSettings.provider,
      model: aiSettings.model,
      testing,
    }),
  });

  if (!response.ok) {
    return { error: await readManagedApiError(response, "Could not name lens") };
  }
  const result = await response.json();
  if (result.status === "error") {
    return { error: result.errorMessage || "Could not name lens" };
  }
  const name = typeof result.value?.name === "string" ? result.value.name : undefined;
  return { name };
}

async function lensConfigsById(): Promise<Map<string, LensConfig>> {
  const response = await listLenses();
  const rows = response.lenses ?? [];
  const byId = new Map<string, LensConfig>();
  for (const row of rows) {
    const lens = parseLensRow(row);
    if (lens) byId.set(lens.id, lens);
  }
  return byId;
}

function parseLensRow(row: unknown): LensConfig | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.lensId !== "string") return null;
  const parsed = LensConfig.safeParse({ ...record, id: record.lensId });
  return parsed.success ? parsed.data : null;
}

async function readLensDomainRules(): Promise<LensDomainRules> {
  const stored = await chrome.storage.local
    .get(LENS_DOMAIN_RULES_KEY)
    .catch(() => ({}) as Record<string, unknown>);
  return parseLensDomainRules(stored[LENS_DOMAIN_RULES_KEY]);
}

async function applicableLensIdsForUrl(
  lensIds: readonly string[],
  url: string,
  options: { requireAuto?: boolean } = {}
): Promise<string[]> {
  const activeLensIds = withoutRetiredLensIds(lensIds);
  if (activeLensIds.length === 0) return [];

  try {
    const [lenses, domainRules] = await Promise.all([
      lensConfigsById(),
      readLensDomainRules(),
    ]);
    return activeLensIds.filter((lensId) => {
      const lens = lenses.get(lensId);
      if (!lens) return true;
      if (options.requireAuto && lens.runMode !== "auto") return false;
      return lensAppliesToUrl(lens, url, domainRules);
    });
  } catch {
    return activeLensIds;
  }
}

// Open the editor in a tab. Deep-links to the Lenses view (and an optional lens)
// via the URL hash, which the settings app reads on load.
async function openLensEditor(lensId?: string): Promise<{ opened: boolean }> {
  const hash = lensId ? `#lenses/${encodeURIComponent(lensId)}` : "#lenses";
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`settings.html${hash}`),
  });
  return { opened: true };
}

// Persist an "Ask" question keyed by the active tab so the side panel can read
// it once it opens. We resolve the active tab here (rather than in the popup)
// because the popup must call sidePanel.open() synchronously inside the click to
// keep the user gesture — it has no spare async turn to look the tab up first.
async function stagePendingAsk(
  request: StageAskRequest
): Promise<{ staged: boolean; error?: string }> {
  const question =
    typeof request.question === "string" ? request.question.trim() : "";
  const draft = typeof request.draft === "string" ? request.draft : "";
  const displayContent =
    typeof request.displayContent === "string" ? request.displayContent.trim() : "";
  const targetLensId =
    typeof request.targetLensId === "string" ? request.targetLensId.trim() : "";
  if (!question && !draft.trim()) {
    return { staged: false, error: "Empty question." };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { staged: false, error: "No active tab to ask about." };

  const pending: PendingAsk = {
    ...(question ? { question } : null),
    ...(draft.trim() ? { draft } : null),
    ...(displayContent ? { displayContent } : null),
    ...(request.context ? { context: request.context } : null),
    ...(targetLensId ? { targetLensId } : null),
    createdAt: Date.now(),
  };
  await chrome.storage.local.set({ [pendingAskKey(tab.id)]: pending });
  return { staged: true };
}

async function stagePendingLensRun(
  request: StageLensRunRequest
): Promise<{ staged: boolean; error?: string }> {
  const lensIds = (request.lensIds ?? [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const customInstruction =
    typeof request.customLens?.instruction === "string"
      ? request.customLens.instruction.trim()
      : "";

  if (lensIds.length === 0 && !customInstruction) {
    return { staged: false, error: "No lenses selected." };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { staged: false, error: "No active tab to run lenses on." };

  const pending: PendingLensRun = {
    createdAt: Date.now(),
  };
  if (customInstruction) {
    pending.customLens = { instruction: customInstruction };
  } else {
    pending.lensIds = lensIds;
  }
  if (typeof request.storePageLenses === "boolean") {
    pending.storePageLenses = request.storePageLenses;
  }

  await chrome.storage.local.set({ [pendingLensRunKey(tab.id)]: pending });
  return { staged: true };
}

/** Local BYOK is the only runtime allowed to read a browser-stored provider key. */
async function getStoredLocalByokAiSettings(
  modelKind: "chat" | "execution" = "chat"
): Promise<StoredModelSettings & { apiKey?: string }> {
  const modelSettings = await readStoredModelSettings(modelKind);
  const keySettings = await readAiSettingsStorage();
  const apiKey = readProviderApiKey(keySettings, modelSettings.provider);

  return { ...modelSettings, apiKey };
}

async function saveFindings(
  req: SaveFindingsRequest
): Promise<
  | {
      runId?: string;
      findingCount?: number;
      evidenceBaseSourceAdded?: boolean;
      sourceId?: string;
      sourceFingerprintId?: string;
  }
  | { error: string }
> {
  const retainDiagnosticResponse = await getTestingModeEnabled();
  return saveLocalFindings({
    runId: req.runId,
    lensId: req.lensId,
    sourceUrl: req.sourceUrl,
    sourceKey: req.sourceKey,
    sourceKind: req.sourceKind,
    sourceTitle: req.sourceTitle,
    sourceExternalId: req.sourceExternalId,
    sourceMetadata: req.sourceMetadata,
    modelUsed: req.modelUsed,
    rawResponse: retainDiagnosticResponse ? req.rawResponse : undefined,
    evidenceBaseId: req.evidenceBaseId,
    fingerprint: req.fingerprint,
    lensVersion: req.lensVersion,
    lensMarkdownSnapshot: req.lensMarkdownSnapshot,
    evidenceRefs: req.evidenceRefs,
    findings: req.findings as unknown as Array<Record<string, unknown>>,
  });
}

async function clearStoredFindingsForPage(
  sourceUrl: string
): Promise<{ deletedRuns: number; deletedFindings: number } | { error: string }> {
  return clearLocalFindingsForPage(sourceUrl);
}

async function getTestingModeEnabled(): Promise<boolean> {
  if (!INTERNAL_TOOLS_ENABLED) return false;
  const settings = await chrome.storage.local.get(["debugMode"]);
  return settings.debugMode === true;
}

async function getSourceCheckTestSettings(): Promise<SourceCheckTestSettings> {
  const settings = await chrome.storage.local.get([
    TEST_SOURCE_MAX_CITATIONS_KEY,
    TEST_SOURCE_USE_CACHE_KEY,
  ]);

  const rawMax = Number(settings[TEST_SOURCE_MAX_CITATIONS_KEY]);
  const maxCitations = Number.isFinite(rawMax)
    ? Math.max(1, Math.min(10, Math.trunc(rawMax)))
    : DEFAULT_TEST_SOURCE_MAX_CITATIONS;

  const useCache =
    typeof settings[TEST_SOURCE_USE_CACHE_KEY] === "boolean"
      ? settings[TEST_SOURCE_USE_CACHE_KEY]
      : DEFAULT_TEST_SOURCE_USE_CACHE;

  return { maxCitations, useCache };
}

function normalizeSourceCheckRequestText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildSourceCheckCacheKey(
  request: AskFindingStreamPortRequest,
  maxCitations: number,
  aiSettings?: { provider: ModelProvider; model: string }
) {
  const annotations = request.annotations.map((annotation) => ({
    lensId: annotation.lensId,
    category: normalizeSourceCheckRequestText(annotation.category),
    label: normalizeSourceCheckRequestText(annotation.label),
    text: normalizeSourceCheckRequestText(annotation.text),
    detail: normalizeSourceCheckRequestText(annotation.detail),
  }));

  const keyPayload = JSON.stringify({
    targetLensId: request.targetLensId ?? "",
    sourceUrl: request.sourceUrl ?? "",
    question: normalizeSourceCheckRequestText(request.question),
    maxCitations,
    provider: aiSettings?.provider ?? DEFAULT_MODEL_PROVIDER,
    model: aiSettings?.model ?? "",
    annotations,
  });

  let hash = 2166136261;
  for (let i = 0; i < keyPayload.length; i++) {
    hash ^= keyPayload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sc:${(hash >>> 0).toString(36)}`;
}

async function readSourceCheckCacheStore() {
  const result = await chrome.storage.local.get([SOURCE_CHECK_CACHE_KEY]);
  const stored = result[SOURCE_CHECK_CACHE_KEY];
  if (!stored || typeof stored !== "object") {
    return {} as Record<string, CachedSourceCheckResponse>;
  }

  const entries = Object.entries(stored as Record<string, unknown>);
  const normalized: Record<string, CachedSourceCheckResponse> = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const record = value as Partial<CachedSourceCheckResponse>;
    if (typeof record.fullText !== "string") continue;
    normalized[key] = {
      key,
      targetLensId: typeof record.targetLensId === "string" ? record.targetLensId : undefined,
      fullText: record.fullText,
      citations: Array.isArray(record.citations)
        ? record.citations.filter((citation) => citation && typeof citation.url === "string")
        : [],
      textSegments: Array.isArray(record.textSegments)
        ? record.textSegments.filter((segment) => segment && typeof segment.text === "string")
        : [],
      thinkingText: typeof record.thinkingText === "string" ? record.thinkingText : undefined,
      modelUsed: typeof record.modelUsed === "string" ? record.modelUsed : undefined,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    };
  }

  return normalized;
}

async function writeSourceCheckCacheStore(cache: Record<string, CachedSourceCheckResponse>) {
  await chrome.storage.local.set({ [SOURCE_CHECK_CACHE_KEY]: cache });
}

async function getCachedSourceCheckResponse(cacheKey: string) {
  const cache = await readSourceCheckCacheStore();
  return cache[cacheKey] ?? null;
}

async function setCachedSourceCheckResponse(
  cacheKey: string,
  response: Omit<CachedSourceCheckResponse, "key" | "createdAt">
) {
  const cache = await readSourceCheckCacheStore();
  cache[cacheKey] = {
    key: cacheKey,
    createdAt: Date.now(),
    ...response,
  };

  const entries = Object.entries(cache).sort(
    (a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0)
  );

  if (entries.length > SOURCE_CHECK_CACHE_MAX_ENTRIES) {
    const trimmed = entries.slice(0, SOURCE_CHECK_CACHE_MAX_ENTRIES);
    const nextCache: Record<string, CachedSourceCheckResponse> = {};
    for (const [key, value] of trimmed) {
      nextCache[key] = value;
    }
    await writeSourceCheckCacheStore(nextCache);
    return;
  }

  await writeSourceCheckCacheStore(cache);
}

async function clearSourceCheckCache() {
  if (!INTERNAL_TOOLS_ENABLED) return { ok: false, clearedCount: 0 };
  const cache = await readSourceCheckCacheStore();
  const clearedCount = Object.keys(cache).length;
  await chrome.storage.local.remove(SOURCE_CHECK_CACHE_KEY);
  logFindingStreamDebug("source_check_cache_cleared", { clearedCount });
  return { ok: true, clearedCount };
}

function parseRawFindings(rawResponse?: string): unknown[] {
  if (!rawResponse) return [];

  try {
    const parsed = JSON.parse(rawResponse);
    const structured = rawFindingArray(parsed);
    if (structured) return structured;
  } catch {
    // Fall through to the legacy first-array extraction below.
  }

  const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rawFindingArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  if (Array.isArray(value.findings)) return value.findings;
  if (Array.isArray(value.claims)) return value.claims;
  if (
    value.format === "lenses.chunked-raw-response.v1" &&
    Array.isArray(value.chunks)
  ) {
    return value.chunks.flatMap((chunk) => {
      if (!isRecord(chunk) || typeof chunk.rawResponse !== "string") return [];
      return parseRawFindings(chunk.rawResponse);
    });
  }
  return null;
}

function enrichFindingsWithRaw(
  findings: unknown[],
  rawResponse?: string,
  runId?: string
): DebugFinding[] {
  const rawFindings = parseRawFindings(rawResponse);
  const enriched: DebugFinding[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    if (!finding || typeof finding !== "object") continue;

    const record = finding as Record<string, unknown>;
    const maybeIndex = record.findingIndex;
    const findingIndex =
      typeof maybeIndex === "number" && Number.isFinite(maybeIndex)
        ? maybeIndex
        : i;

    const enrichedFinding: DebugFinding = {
      text: typeof record.text === "string" ? record.text : "",
      category: typeof record.category === "string" ? record.category : "",
      detail: typeof record.detail === "string" ? record.detail : "",
      confidence: typeof record.confidence === "number" ? record.confidence : 0,
      sourceSpan:
        record.sourceSpan &&
        typeof record.sourceSpan === "object" &&
        typeof (record.sourceSpan as Record<string, unknown>).start === "number" &&
        typeof (record.sourceSpan as Record<string, unknown>).end === "number"
          ? {
              start: (record.sourceSpan as Record<string, number>).start,
              end: (record.sourceSpan as Record<string, number>).end,
            }
          : undefined,
      enrichments: Array.isArray(record.enrichments)
        ? (record.enrichments as FindingEnrichment[])
        : undefined,
      anchor:
        isRecord(record.anchor) &&
        (record.anchor.kind === "text" ||
          record.anchor.kind === "transcript" ||
          record.anchor.kind === "pdf")
          ? (record.anchor as unknown as FindingAnchor)
          : undefined,
      quotes: Array.isArray(record.quotes)
        ? record.quotes.filter((quote): quote is string => typeof quote === "string")
        : undefined,
      runId:
        typeof record.runId === "string" ? record.runId : runId,
      findingIndex,
      rawResponse:
        typeof record.rawResponse === "string" ? record.rawResponse : rawResponse,
      rawFinding:
        record.rawFinding !== undefined ? record.rawFinding : rawFindings[findingIndex] ?? null,
    };

    enriched.push(enrichedFinding);
  }

  return enriched;
}

async function getStoredFindings(
  source: { sourceUrl: string; sourceKey?: string },
  lensIds: string[]
): Promise<Record<string, DebugFinding[]>> {
  if (lensIds.length === 0) return {};

  const runs = await getLocalStoredRunStates(source, lensIds);
  const byLens: Record<string, DebugFinding[]> = {};
  for (const run of runs) {
    if (run.status === "completed" && run.findings.length > 0) {
      byLens[run.lensId] = run.findings as DebugFinding[];
    }
  }
  return byLens;
}

async function getStoredRunStates(
  source: { sourceUrl: string; sourceKey?: string },
  lensIds: string[]
): Promise<StoredRunState[]> {
  return getLocalStoredRunStates(source, lensIds) as Promise<StoredRunState[]>;
}

async function restoreStoredPageLensResultsForTab(
  tabId: number,
  req: RestorePageLensResultsRequest
): Promise<{
  restoredLenses: number;
  results: Array<{
    lensId: string;
    findingCount: number;
    renderedCount?: number;
    failedAnchorCount?: number;
  }>;
}> {
  const runs = await getStoredRunStates(
    { sourceUrl: req.sourceUrl, sourceKey: req.sourceKey },
    req.lensIds ?? []
  );
  const results: Array<{
    lensId: string;
    findingCount: number;
    renderedCount?: number;
    failedAnchorCount?: number;
  }> = [];

  for (const run of runs) {
    if (run.status !== "completed" || run.findings.length === 0) continue;

    const highlightResponse = await sendTabMessage(tabId, {
      type: "highlight",
      findings: run.findings,
      lensId: run.lensId,
      colors: colorsForLens(run.lensId),
      sourceText: req.sourceText,
    });
    const findingCount = run.findingCount ?? run.findings.length;
    const renderedCount =
      isRecord(highlightResponse) && typeof highlightResponse.renderedCount === "number"
        ? highlightResponse.renderedCount
        : undefined;
    const failedAnchorCount =
      isRecord(highlightResponse) && typeof highlightResponse.failedAnchorCount === "number"
        ? highlightResponse.failedAnchorCount
        : undefined;

    results.push({
      lensId: run.lensId,
      findingCount,
      renderedCount,
      failedAnchorCount,
    });
  }

  return { restoredLenses: results.length, results };
}

async function getPageDebugData(
  sourceUrl: string,
  lensIds: string[]
): Promise<
  | {
      runs: Array<{
        runId: string;
        lensId: string;
        modelUsed?: string;
        rawResponse?: string;
        createdAt: number;
        findings: DebugFinding[];
      }>;
    }
  | { error: string }
> {
  if (!INTERNAL_TOOLS_ENABLED) return { runs: [] };
  return getLocalDebugData(sourceUrl, lensIds) as Promise<{
    runs: Array<{
      runId: string;
      lensId: string;
      modelUsed?: string;
      rawResponse?: string;
      createdAt: number;
      findings: DebugFinding[];
    }>;
  }>;
}

async function handleAskFinding(
  request: AskAnnotationRequest
): Promise<{ answer: string } | { error: string }> {
  if (isLocalByokMode(await readAppAccessMode())) {
    const aiSettings = await getStoredLocalByokAiSettings();
    return askLocalFindingQuestion(
      {
        question: request.question,
        sourceUrl: request.sourceUrl,
        targetLensId: request.targetLensId,
        conversation: request.conversation,
        annotations: request.annotations,
      },
      {
        provider: aiSettings.provider,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        reasoningEffort: aiSettings.reasoningEffort,
      }
    );
  }

  const convexUrl = await getConvexUrl();
  const convexSiteUrl = getConvexSiteBaseUrl(convexUrl);
  const testing = await getTestingModeEnabled();
  const aiSettings = await readStoredModelSettings();

  const response = await fetch(`${convexSiteUrl}/managed/ask-finding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: request.question,
      sourceUrl: request.sourceUrl,
      targetLensId: request.targetLensId,
      testing,
      conversation: request.conversation,
      annotations: request.annotations,
      provider: aiSettings.provider,
      model: aiSettings.model,
    }),
  });

  if (!response.ok) {
    return { error: await readManagedApiError(response, "Question answering failed") };
  }

  const result = await response.json();
  if (result.status === "error") {
    return { error: result.errorMessage || "Question answering failed" };
  }

  const answer = result.value?.answer;
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return { error: "Empty response from assistant" };
  }

  return { answer };
}

async function streamAskFindingOverPort(
  port: chrome.runtime.Port,
  request: AskFindingStreamPortRequest,
  signal: AbortSignal
) {
  if (isLocalByokMode(await readAppAccessMode())) {
    // Parity with the managed stream: same prompt flavors, web tools, streamed
    // thinking, citations, and the structured verdict header — via the user's
    // own provider key.
    const aiSettings = await getStoredLocalByokAiSettings();
    await streamLocalAskFindingOverPort(
      port,
      {
        question: request.question,
        sourceUrl: request.sourceUrl,
        targetLensId: request.targetLensId,
        conversation: request.conversation,
        annotations: request.annotations,
        selectionText: request.selectionText,
        pageContext: request.pageContext,
        selectionMode: request.selectionMode,
      },
      aiSettings,
      signal
    );
    return;
  }

  const convexUrl = await getConvexUrl();
  const convexSiteUrl = getConvexSiteBaseUrl(convexUrl);
  const testing = await getTestingModeEnabled();
  const aiSettings = await readStoredModelSettings();
  const sourceCheckSettings = request.sourceCheckOptions
    ? await getSourceCheckTestSettings()
    : null;
  const sourceCheckMaxCitations = sourceCheckSettings?.maxCitations;
  const sourceCheckUseCache = sourceCheckSettings?.useCache ?? false;
  const sourceCheckCacheKey =
    sourceCheckSettings && sourceCheckUseCache
      ? buildSourceCheckCacheKey(request, sourceCheckSettings.maxCitations, aiSettings)
      : null;

  if (sourceCheckCacheKey && !(request.sourceCheckOptions?.forceRefresh ?? false)) {
    const cached = await getCachedSourceCheckResponse(sourceCheckCacheKey);
    if (cached) {
      logFindingStreamDebug("source_check_cache_hit", {
        key: sourceCheckCacheKey,
        targetLensId: request.targetLensId,
        citationCount: cached.citations.length,
        segmentCount: cached.textSegments.length,
      });
      port.postMessage({
        type: "done",
        fullText: cached.fullText,
        citations: cached.citations,
        textSegments: cached.textSegments,
        modelUsed: cached.modelUsed,
      } satisfies StreamPortEvent);
      return;
    }
  }

  logFindingStreamDebug("stream_start", {
    convexUrl,
    convexSiteUrl,
    endpoint: `${convexSiteUrl}/managed/ask-finding/stream`,
    targetLensId: request.targetLensId,
    testing,
    provider: aiSettings.provider,
    model: aiSettings.model,
    reasoningEffort: aiSettings.reasoningEffort,
    sourceCheckMaxCitations,
    sourceCheckUseCache,
    sourceCheckCacheKey,
  });

  const response = await fetch(`${convexSiteUrl}/managed/ask-finding/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: request.question,
      sourceUrl: request.sourceUrl,
      targetLensId: request.targetLensId,
      testing,
      streamOptions:
        typeof sourceCheckMaxCitations === "number"
          ? { maxCitations: sourceCheckMaxCitations }
          : undefined,
      conversation: request.conversation,
      annotations: request.annotations,
      selectionText: request.selectionText,
      pageContext: request.pageContext,
      selectionMode: request.selectionMode,
      provider: aiSettings.provider,
      model: aiSettings.model,
      reasoningEffort: aiSettings.reasoningEffort,
    }),
    signal,
  });

  if (!response.ok) {
    const errorMessage = await readManagedApiError(
      response,
      `Streaming API error (${response.status})`
    );
    logFindingStreamDebug("stream_http_error", {
      status: response.status,
      errorText: errorMessage.slice(0, 300),
    });
    port.postMessage({
      type: "error",
      error: errorMessage,
    } satisfies StreamPortEvent);
    return;
  }

  if (!response.body) {
    port.postMessage({
      type: "error",
      error: "Streaming API returned an empty response body.",
    } satisfies StreamPortEvent);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let chunkEvents = 0;
  let citationEvents = 0;
  let finalDoneEvent: Extract<StreamPortEvent, { type: "done" }> | null = null;

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    sseBuffer += decoder.decode(result.value, { stream: true });
    sseBuffer = sseBuffer.replaceAll("\r", "");
    const events = splitSseEvents(sseBuffer);
    sseBuffer = events.remaining;

    for (const rawEvent of events.complete) {
      for (const parsed of parseSseDataObjects(rawEvent)) {
        if (parsed.type === "chunk") {
          chunkEvents++;
          if (chunkEvents % 10 === 0) {
            logFindingStreamDebug("stream_progress", {
              chunkEvents,
              latestChunkLength: parsed.text.length,
              segmentCount: parsed.textSegments?.length ?? 0,
            });
          }
        }

        if (parsed.type === "citations") {
          citationEvents++;
          logFindingStreamDebug("stream_citations", {
            citationEvents,
            citationCount: parsed.citations.length,
            segmentCount: parsed.textSegments?.length ?? 0,
          });
        }

        if (parsed.type === "done") {
          finalDoneEvent = parsed;
          logFindingStreamDebug("stream_done", {
            fullTextLength: parsed.fullText.length,
            segmentCount: parsed.textSegments?.length ?? 0,
            modelUsed: parsed.modelUsed,
            chunkEvents,
            citationEvents,
          });
        }

        if (parsed.type === "error") {
          logFindingStreamDebug("stream_event_error", {
            error: parsed.error,
            chunkEvents,
            citationEvents,
          });
        }

        try {
          port.postMessage(formatStreamPortEvent(parsed));
        } catch {
          return;
        }
      }
    }
  }

  if (sseBuffer.trim().length > 0) {
    for (const parsed of parseSseDataObjects(sseBuffer.trim())) {
      logFindingStreamDebug("stream_tail_event", { type: parsed.type });
      if (parsed.type === "done") {
        finalDoneEvent = parsed;
      }
      try {
        port.postMessage(formatStreamPortEvent(parsed));
      } catch {
        return;
      }
    }
  }

  if (sourceCheckCacheKey && sourceCheckUseCache && finalDoneEvent) {
    await setCachedSourceCheckResponse(sourceCheckCacheKey, {
      targetLensId: request.targetLensId,
      fullText: finalDoneEvent.fullText,
      citations: finalDoneEvent.citations ?? [],
      textSegments: finalDoneEvent.textSegments ?? [],
      modelUsed: finalDoneEvent.modelUsed,
    });

    logFindingStreamDebug("source_check_cache_stored", {
      key: sourceCheckCacheKey,
      citationCount: finalDoneEvent.citations?.length ?? 0,
      segmentCount: finalDoneEvent.textSegments?.length ?? 0,
    });
  }
}

function formatStreamPortEvent(event: StreamPortEvent): StreamPortEvent {
  if (event.type !== "error") return event;
  return {
    ...event,
    error: formatStreamingApiError({
      status: 503,
      bodyText: event.error,
    }),
  };
}

function splitSseEvents(buffer: string): { complete: string[]; remaining: string } {
  const complete: string[] = [];
  let working = buffer;
  let marker = working.indexOf("\n\n");

  while (marker >= 0) {
    complete.push(working.slice(0, marker));
    working = working.slice(marker + 2);
    marker = working.indexOf("\n\n");
  }

  return { complete, remaining: working };
}

function parseSseDataObjects(rawEvent: string): StreamPortEvent[] {
  const events: StreamPortEvent[] = [];
  const lines = rawEvent.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;

    try {
      const parsed = JSON.parse(payload) as StreamPortEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        events.push(parsed);
      }
    } catch {
      // ignore malformed event
    }
  }

  return events;
}

// --- Auto-Run on Navigation ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

  const settings = await chrome.storage.local.get([
    "autoRun",
    "autoAnalyze",
    "selectedLenses",
    STORE_PAGE_LENSES_KEY,
  ]);
  const autoRun =
    typeof settings.autoRun === "boolean" ? settings.autoRun : !!settings.autoAnalyze;
  const shouldStorePageLenses =
    typeof settings[STORE_PAGE_LENSES_KEY] === "boolean"
      ? settings[STORE_PAGE_LENSES_KEY]
      : true;

  const selectedLensIds = settings.selectedLenses;
  const rawStoredLensIds: string[] = Array.isArray(selectedLensIds)
    ? selectedLensIds.filter((lensId): lensId is string => typeof lensId === "string")
    : [];
  const storedLensIds = withoutRetiredLensIds(rawStoredLensIds);
  if (storedLensIds.length !== rawStoredLensIds.length) {
    await chrome.storage.local.set({ selectedLenses: storedLensIds });
  }
  const lensIds = await applicableLensIdsForUrl(storedLensIds, tab.url);
  if (lensIds.length === 0) return;

  // Clear previous highlights
  chrome.tabs.sendMessage(tabId, { type: "clear" });

  const missingLensIds: string[] = [...lensIds];

  if (shouldStorePageLenses) {
    const restoredByLens: Record<string, DebugFinding[]> = await getStoredFindings(
      { sourceUrl: tab.url },
      lensIds
    ).catch(() => ({}));

    // First try restoring persisted findings for this URL.
    for (const lensId of lensIds) {
      const restored = restoredByLens[lensId];
      if (restored && restored.length > 0) {
        chrome.tabs.sendMessage(tabId, {
          type: "highlight",
          findings: restored,
          lensId,
          colors: colorsForLens(lensId),
        });
        const index = missingLensIds.indexOf(lensId);
        if (index >= 0) missingLensIds.splice(index, 1);
      }
    }
  }

  const autoLensIds = autoRun
    ? await applicableLensIdsForUrl(missingLensIds, tab.url, { requireAuto: true })
    : [];
  if (autoLensIds.length === 0 || !autoRun) return;

  // Small delay to let the content script initialize
  await new Promise((r) => setTimeout(r, 500));

  // Fallback: run missing lenses live if nothing persisted for them.
  const textResponse = await new Promise<{ text?: string }>((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "get-page-text" }, (response) => {
      resolve(response ?? {});
    });
  });

  if (!textResponse.text) return;

  for (const lensId of autoLensIds) {
    const result = await handleRun({
      type: "run",
      lensId,
      text: textResponse.text,
      sourceUrl: shouldStorePageLenses ? tab.url : undefined,
    });

    if (!("findings" in result) || result.findings.length === 0) continue;
    chrome.tabs.sendMessage(tabId, {
      type: "highlight",
      findings: result.findings,
      lensId,
      colors: colorsForLens(lensId),
      sourceText: textResponse.text,
    });
  }

  // Push saved selection chats for this URL to the content script.
  try {
    const savedData = await getSavedSelections(tab.url);
    const savedSelections = savedData.selections ?? [];
    if (savedSelections.length > 0) {
      chrome.tabs.sendMessage(tabId, { type: "saved-selections", selections: savedSelections });
    }
  } catch {
    // Non-fatal: saved selections are also fetched by the content script on load.
  }
});
