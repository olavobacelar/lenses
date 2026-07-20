// Content script — injects highlights and an annotation chatbox into the page DOM
// Supports overlapping annotations via stacked underlines
import Defuddle from "defuddle";
import { Readability } from "@mozilla/readability";
import { createElement } from "react";
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  type TextAnchor,
  buildTextIndex,
  buildTextAnchor,
  computeSourceCalloutLayout,
  findFindingTextAnchor,
  findTextAnchor,
  formatSelectionSnippet,
} from "./selection-helpers.js";
import { captureScreenshot } from "./youtube-screenshot.js";
import {
  getContextAroundTime,
  getCurrentTranscript,
  getCurrentVideoId,
  getVideoId,
  getVideoMetadata,
  initializeTranscript,
  isVideoPage,
  resetTranscriptState,
} from "./youtube-transcript.js";
import {
  findVideoElement,
  getCurrentTime,
  seekTo,
  startPlaybackTracking,
} from "./youtube-time-tracker.js";
import { initTheme } from "../lib/theme.js";
import { APP_MODE_CHANGED_MESSAGE_TYPE } from "../lib/app-mode.js";
import {
  CHAT_ACTIONS_USE_SIDE_PANEL_KEY,
  chatActionsUseSidePanelFromStorage,
} from "../lib/chat-surface-settings.js";
import type { PendingAskContext } from "../lib/composer.js";
import { computeScrollOverflow } from "../lib/scroll.js";
import { type ChatActivityItem } from "../lib/chat-activity.js";
import {
  applyChatStreamEvent,
  createChatStreamState,
} from "../lib/chat-stream.js";
import {
  foldSearchEvent,
  isSearchInFlight,
  type WebSearchEntry,
} from "../lib/web-search.js";
import { parseCitationPublisherResolution } from "../lib/citation-publisher-resolution.js";
import {
  SourceCalloutStack,
  type SourceCalloutView,
} from "./SourceCalloutStack.js";
import { OrphanedSavedChatsPanel } from "./OrphanedSavedChatsPanel.js";
import {
  ChatboxView,
  type ChatboxAnnotationView,
  type ChatboxMessageSelectionPrompt,
  type ChatboxMessageView,
  type ChatboxStreamingView,
} from "./ChatboxView.js";
import {
  buildAnnotationQuestion,
  buildDebugAnnotationMarkdown,
  getSelectionChatEyebrow,
  getSelectionInputPlaceholder,
  positionChatbox,
  uniqueAnnotations,
} from "./ChatboxModel.js";
import {
  buildAnnotationId,
  dedupeAnnotationsById,
  getAnnotationDisplayLabel,
  isSourceCheckCandidate,
} from "./annotationModel.js";
import {
  dismissPageDockUndoToast,
  mountPageLensDock,
  showPageDockUndoToast,
  PAGE_LENS_DOCK_ROOT_CLASS,
  type PageLensDockController,
} from "./PageLensDockController.js";
import { setPageLensDockEnabled } from "./PageLensDockSettings.js";
import { installDevContextReloadChecks } from "./dev-context.js";
import {
  pageDockEnabledFromStorage,
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_SETTINGS_KEYS,
} from "../lib/page-dock-settings.js";
import { createSelectionTriggerController } from "./SelectionTriggerController.js";
import {
  defaultSelectionTriggerSettings,
  loadSelectionTriggerSettings,
  SELECTION_TRIGGER_STORAGE_KEYS,
} from "./SelectionTriggerSettings.js";
import {
  LENSES_SHADOW_HOST_CLASS,
  createLensesShadowMount,
  removeLensesShadowHosts,
  setLensesShadowTheme,
  type LensesShadowMount,
} from "./shadow-ui.js";
import type {
  ActionMessage,
  Annotation,
  AskFindingStreamPortEvent,
  AskFindingStreamPortRequest,
  ChatContext,
  ChatMessage,
  Finding,
  LensResultDisplayMode,
  LensUiConfig,
  ResolveCitationPublishersResponse,
  RuntimeMessage,
  SavedSelection,
  SelectionMessageMeta,
  StreamTextSegment,
} from "./types.js";

// In contest builds, selection and highlight chat actions always open in the
// side panel instead of the floating in-page chatbox (which is not part of the
// contest surface set). Guarded with `typeof` so tests that load this module
// without the bundler's define still run.
const CONTEST_BUILD =
  typeof __CONTEST_BUILD__ === "undefined" ? false : __CONTEST_BUILD__;

const HIGHLIGHT_CLASS = "lenses-highlight";
const SAVED_HIGHLIGHT_CLASS = "lenses-saved-highlight";
const SAVED_CSS_HIGHLIGHT_NAME = "lenses-saved-highlight";
const SAVED_CHANGED_CSS_HIGHLIGHT_NAME = "lenses-saved-highlight-changed";
const SAVED_HIGHLIGHT_OVERLAY_ACTIVE_CLASS = "lenses-saved-highlight-overlay-active";
const SAVED_HIGHLIGHT_OVERLAY_CLASS = "lenses-saved-highlight-overlay";
const SAVED_HIGHLIGHT_OVERLAY_RECT_CLASS = "lenses-saved-highlight-overlay-rect";
const CHATBOX_CLASS = "lenses-chatbox";
const ANNOTATION_MARKER_CLASS = "lenses-annotation-marker";
const SOURCE_MARKER_CLASS = "lenses-source-marker";
const SOURCE_CALLOUT_STACK_CLASS = "lenses-source-callout-stack";
const SELECTION_TRIGGER_CLASS = "lenses-selection-trigger";

const LENS_UI_CONFIG_BY_ID: Record<string, LensUiConfig> = {
  "source-tracer": { autoSourceChecks: false },
};
const DEFAULT_RESULT_DISPLAY_MODE: LensResultDisplayMode = "inline";

type SourceCheckStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface SourceCheckState {
  annotation: Annotation;
  status: SourceCheckStatus;
  markerNumber: number;
  citations: Array<{ url: string; title: string; citedText?: string }>;
  answerText: string;
  textSegments: StreamTextSegment[];
  thinkingText: string;
  searching: boolean;
  searches: WebSearchEntry[];
  errorMessage?: string;
  open: boolean;
  port: chrome.runtime.Port | null;
}

interface AnchorFailureDiagnostic {
  annotationId: string;
  lensId: string;
  category: string;
  label: string;
  reason: "empty-text" | "range-not-renderable" | "text-not-found";
  text: string;
  textLength: number;
  hasSourceSpan: boolean;
  sourceSpan?: Finding["sourceSpan"];
}

interface HighlightRenderResult {
  renderedCount: number;
  failedAnchorCount: number;
  failedAnchors: AnchorFailureDiagnostic[];
  totalVisibleAnnotations: number;
}

let activeAnnotations: Annotation[] = [];
const resultDisplayModeByLensId = new Map<string, LensResultDisplayMode>();
const pageLensDockStateListeners = new Set<() => void>();
let activeChatbox: {
  root: HTMLElement;
  mount: LensesShadowMount;
  getSavedId: () => string | null;
  teardown: () => void;
} | null = null;
let activeSavedSelections: SavedSelection[] = [];
let orphanedPanel: HTMLElement | null = null;
let orphanedPanelMount: LensesShadowMount | null = null;
let orphanedPanelRoot: Root | null = null;
let savedHighlightOverlay: HTMLElement | null = null;
let savedHighlightRerenderTimer: number | null = null;
let debugModeEnabled = false;
let chatActionsUseSidePanel = false;
const sourceCheckStateByAnnotationId = new Map<string, SourceCheckState>();
const sourceCheckOpenOrder: string[] = [];
let sourceCalloutMount: LensesShadowMount | null = null;
const sourceTextByLensId = new Map<string, string>();
const lastRenderedCountByLensId = new Map<string, number>();
const lastAnchorFailureCountByLensId = new Map<string, number>();
let lastAnchorFailureLogSignature = "";

function mergeSavedSelectionsFromStorage(selections: SavedSelection[]) {
  const existingById = new Map(activeSavedSelections.map((selection) => [selection.id, selection]));
  const incomingIds = new Set(selections.map((selection) => selection.id));

  activeSavedSelections = [
    ...selections.map((selection) => {
      const existing = existingById.get(selection.id);
      if (!existing || !hasRicherMessages(existing, selection)) return selection;
      return { ...selection, messages: existing.messages };
    }),
    ...activeSavedSelections.filter((selection) => !incomingIds.has(selection.id)),
  ];
}

function hasRicherMessages(candidate: SavedSelection, baseline: SavedSelection) {
  if (candidate.messages.length > baseline.messages.length) return true;
  if (candidate.messages.length < baseline.messages.length) return false;
  return (
    countMessageCitationSegments(candidate.messages) >
    countMessageCitationSegments(baseline.messages)
  );
}

function countMessageCitationSegments(messages: ChatMessage[]) {
  return messages.reduce(
    (total, message) =>
      total +
      (message.textSegments?.length ?? 0) +
      (message.thinkingText?.trim() ? 1 : 0),
    0
  );
}

function normalizeChatboxInsertedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const sourceAnchorByAnnotationId = new Map<string, HTMLElement>();
let sourceCalloutStack: HTMLElement | null = null;
let sourceCalloutRoot: Root | null = null;
let sourceCalloutRenderFrame: number | null = null;
const sourceCalloutHeightByAnnotationId = new Map<string, number>();
const citationPublisherCache = new Map<string, string>();
const citationPublisherMisses = new Set<string>();
const citationPublisherInFlight = new Set<string>();
let sourceCalloutViewportListenersAttached = false;

function logContentStreamDebug(event: string, details: Record<string, unknown> = {}) {
  if (!debugModeEnabled) return;
  console.log("[Lenses][content][finding-stream]", event, details);
}

function recordLensCount(map: Map<string, number>, lensId: string, increment = 1) {
  map.set(lensId, (map.get(lensId) ?? 0) + increment);
}

function lensCountMapToRecord(map: Map<string, number>, lensIds: readonly string[]) {
  const record: Record<string, number> = {};
  for (const lensId of lensIds) {
    record[lensId] = map.get(lensId) ?? 0;
  }
  return record;
}

function anchorFailureDiagnostic(
  annotation: Annotation,
  reason: AnchorFailureDiagnostic["reason"]
): AnchorFailureDiagnostic {
  const text = annotation.finding.text.trim();
  return {
    annotationId: annotation.id,
    lensId: annotation.lensId,
    category: annotation.finding.category,
    label: annotation.label,
    reason,
    text: formatSelectionSnippet(text),
    textLength: text.length,
    hasSourceSpan: !!annotation.finding.sourceSpan,
    sourceSpan: annotation.finding.sourceSpan,
  };
}

function updateAnchorRenderCounts(
  visibleAnnotations: readonly Annotation[],
  matchedAnnotationIds: ReadonlySet<string>,
  failedAnchors: readonly AnchorFailureDiagnostic[]
) {
  lastRenderedCountByLensId.clear();
  lastAnchorFailureCountByLensId.clear();

  for (const annotation of visibleAnnotations) {
    if (matchedAnnotationIds.has(annotation.id)) {
      recordLensCount(lastRenderedCountByLensId, annotation.lensId);
    }
  }

  for (const failure of failedAnchors) {
    recordLensCount(lastAnchorFailureCountByLensId, failure.lensId);
  }
}

function logAnchorFailures(result: HighlightRenderResult) {
  if (result.failedAnchorCount === 0) {
    lastAnchorFailureLogSignature = "";
    return;
  }

  const byLens: Record<string, number> = {};
  for (const failure of result.failedAnchors) {
    byLens[failure.lensId] = (byLens[failure.lensId] ?? 0) + 1;
  }

  const signature = result.failedAnchors
    .map((failure) => `${failure.annotationId}:${failure.reason}`)
    .sort()
    .join("|");
  if (signature === lastAnchorFailureLogSignature) return;
  lastAnchorFailureLogSignature = signature;

  console.warn("[Lenses][content][anchors] failed to anchor findings", {
    failedAnchorCount: result.failedAnchorCount,
    renderedCount: result.renderedCount,
    totalVisibleAnnotations: result.totalVisibleAnnotations,
    byLens,
    failures: result.failedAnchors.slice(0, 25),
    truncated: result.failedAnchors.length > 25,
  });
}

function getLensUiConfig(lensId: string): LensUiConfig {
  return LENS_UI_CONFIG_BY_ID[lensId] ?? {};
}

function getLensResultDisplayMode(lensId: string): LensResultDisplayMode {
  return resultDisplayModeByLensId.get(lensId) ?? DEFAULT_RESULT_DISPLAY_MODE;
}

function setLensResultDisplayMode(lensId: string, mode: LensResultDisplayMode) {
  if (mode === DEFAULT_RESULT_DISPLAY_MODE) {
    resultDisplayModeByLensId.delete(lensId);
  } else {
    resultDisplayModeByLensId.set(lensId, mode);
  }
}

function isLensResultVisible(lensId: string) {
  return getLensResultDisplayMode(lensId) !== "off";
}

function shouldRenderInlineResult(lensId: string) {
  return getLensResultDisplayMode(lensId) === "inline";
}

function shouldRenderNoteResult(lensId: string) {
  return getLensResultDisplayMode(lensId) === "notes";
}

function getPageLensDockLensState() {
  const computedLensIds = Array.from(
    new Set(activeAnnotations.map((annotation) => annotation.lensId))
  );
  const findingCountByLensId: Record<string, number> = {};
  for (const annotation of activeAnnotations) {
    findingCountByLensId[annotation.lensId] =
      (findingCountByLensId[annotation.lensId] ?? 0) + 1;
  }
  return {
    computedLensIds,
    visibleLensIds: computedLensIds.filter(isLensResultVisible),
    findingCountByLensId,
    renderedCountByLensId: lensCountMapToRecord(lastRenderedCountByLensId, computedLensIds),
    anchorFailureCountByLensId: lensCountMapToRecord(
      lastAnchorFailureCountByLensId,
      computedLensIds
    ),
    resultDisplayModeByLensId: Object.fromEntries(
      computedLensIds.map((lensId) => [lensId, getLensResultDisplayMode(lensId)])
    ),
  };
}

function setPageLensDockLensVisibility(lensId: string, visible: boolean) {
  setLensResultDisplayMode(lensId, visible ? DEFAULT_RESULT_DISPLAY_MODE : "off");
  renderAllHighlights();
  notifyPageLensDockStateChanged();
}

function setPageLensDockLensDisplayMode(lensId: string, mode: LensResultDisplayMode) {
  setLensResultDisplayMode(lensId, mode);
  renderAllHighlights();
  notifyPageLensDockStateChanged();
}

function clearPageLensDockLensResults(lensId: string) {
  activeAnnotations = activeAnnotations.filter((annotation) => annotation.lensId !== lensId);
  sourceTextByLensId.delete(lensId);
  lastRenderedCountByLensId.delete(lensId);
  lastAnchorFailureCountByLensId.delete(lensId);
  resultDisplayModeByLensId.delete(lensId);

  removeSourceCheckStatesForLens(lensId);

  const renderResult = renderAllHighlights();
  notifyPageLensDockStateChanged();
  return renderResult;
}

function clearPageLensDockFindingResult(annotationId: string) {
  const removed = activeAnnotations.find((annotation) => annotation.id === annotationId);
  if (!removed) {
    notifyPageLensDockStateChanged();
    return renderAllHighlights();
  }

  activeAnnotations = activeAnnotations.filter((annotation) => annotation.id !== annotationId);
  const state = sourceCheckStateByAnnotationId.get(annotationId);
  if (state?.port) {
    try {
      state.port.disconnect();
    } catch {
      // no-op
    }
  }
  sourceCheckStateByAnnotationId.delete(annotationId);
  const openIndex = sourceCheckOpenOrder.indexOf(annotationId);
  if (openIndex >= 0) sourceCheckOpenOrder.splice(openIndex, 1);
  sourceAnchorByAnnotationId.delete(annotationId);
  sourceCalloutHeightByAnnotationId.delete(annotationId);

  if (!activeAnnotations.some((annotation) => annotation.lensId === removed.lensId)) {
    sourceTextByLensId.delete(removed.lensId);
    lastRenderedCountByLensId.delete(removed.lensId);
    lastAnchorFailureCountByLensId.delete(removed.lensId);
    resultDisplayModeByLensId.delete(removed.lensId);
  }

  const renderResult = renderAllHighlights();
  notifyPageLensDockStateChanged();
  return renderResult;
}

function subscribeToPageLensDockState(listener: () => void) {
  pageLensDockStateListeners.add(listener);
  return () => {
    pageLensDockStateListeners.delete(listener);
  };
}

function notifyPageLensDockStateChanged() {
  for (const listener of pageLensDockStateListeners) {
    listener();
  }
}

function shouldAutoStartSourceCheck(annotation: Annotation) {
  const config = getLensUiConfig(annotation.lensId);
  if (!config.autoSourceChecks) return false;
  return isSourceCheckCandidate(annotation);
}

function collectUniqueCitations(
  segments: StreamTextSegment[] | undefined,
  fallbackCitations?: Array<{ url: string; title: string; citedText?: string }>
) {
  const seen = new Set<string>();
  const citations: Array<{ url: string; title: string; citedText?: string }> = [];

  const pushCitation = (citation: { url: string; title: string; citedText?: string }) => {
    const normalizedUrl = normalizeCitationUrl(citation.url);
    if (!normalizedUrl) return;
    const key = `${normalizedUrl}|${citation.title}`.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    citations.push({
      url: normalizedUrl,
      title: citation.title,
      citedText: citation.citedText,
    });
  };

  for (const segment of segments ?? []) {
    for (const citation of segment.citations ?? []) {
      pushCitation(citation);
    }
  }

  if (citations.length === 0) {
    for (const citation of fallbackCitations ?? []) {
      pushCitation(citation);
    }
  }

  return citations;
}

function ensureSourceCalloutStack() {
  if (sourceCalloutStack && sourceCalloutStack.isConnected) return sourceCalloutStack;
  removeLensesShadowHosts("source-callouts");
  sourceCalloutMount = createLensesShadowMount({
    surface: "source-callouts",
    rootClassName: SOURCE_CALLOUT_STACK_CLASS,
    rootTagName: "div",
  });
  sourceCalloutStack = sourceCalloutMount.root;
  sourceCalloutRoot = createRoot(sourceCalloutStack);
  return sourceCalloutStack;
}

function removeSourceCalloutStack() {
  if (sourceCalloutRenderFrame !== null) {
    window.cancelAnimationFrame(sourceCalloutRenderFrame);
    sourceCalloutRenderFrame = null;
  }
  sourceCalloutRoot?.unmount();
  sourceCalloutRoot = null;
  sourceCalloutMount?.remove();
  sourceCalloutMount = null;
  sourceCalloutStack = null;
}

function renderSourceCalloutsOnViewportChange() {
  renderSourceCallouts();
}

function attachSourceCalloutViewportListeners() {
  if (sourceCalloutViewportListenersAttached) return;
  window.addEventListener("scroll", renderSourceCalloutsOnViewportChange, true);
  window.addEventListener("resize", renderSourceCalloutsOnViewportChange);
  sourceCalloutViewportListenersAttached = true;
}

function detachSourceCalloutViewportListeners() {
  if (!sourceCalloutViewportListenersAttached) return;
  window.removeEventListener("scroll", renderSourceCalloutsOnViewportChange, true);
  window.removeEventListener("resize", renderSourceCalloutsOnViewportChange);
  sourceCalloutViewportListenersAttached = false;
}

function resetSourceCheckState() {
  for (const state of sourceCheckStateByAnnotationId.values()) {
    if (state.port) {
      try {
        state.port.disconnect();
      } catch {
        // no-op
      }
    }
  }

  sourceCheckStateByAnnotationId.clear();
  sourceCheckOpenOrder.length = 0;
  sourceAnchorByAnnotationId.clear();
  sourceCalloutHeightByAnnotationId.clear();
  removeSourceCalloutStack();
  detachSourceCalloutViewportListeners();
}

function removeSourceCheckStatesForLens(lensId: string) {
  const removedIds: string[] = [];

  for (const [annotationId, state] of sourceCheckStateByAnnotationId.entries()) {
    if (state.annotation.lensId !== lensId) continue;
    if (state.port) {
      try {
        state.port.disconnect();
      } catch {
        // no-op
      }
    }
    sourceCheckStateByAnnotationId.delete(annotationId);
    removedIds.push(annotationId);
  }

  for (const annotationId of removedIds) {
    const index = sourceCheckOpenOrder.indexOf(annotationId);
    if (index >= 0) {
      sourceCheckOpenOrder.splice(index, 1);
    }
    sourceAnchorByAnnotationId.delete(annotationId);
    sourceCalloutHeightByAnnotationId.delete(annotationId);
  }
}

function updateSourceMarkerState(marker: HTMLButtonElement, state: SourceCheckState) {
  marker.classList.remove("is-loading", "is-ready", "is-empty", "is-error");
  marker.classList.add(`is-${state.status}`);
  marker.dataset.sourceStatus = state.status;

  if (state.status === "loading") {
    marker.textContent = `[${state.markerNumber}…]`;
    marker.title = "Checking sources...";
    return;
  }

  if (state.status === "ready") {
    marker.textContent = `[${state.markerNumber}]`;
    marker.title = `${state.citations.length} sources found`;
    return;
  }

  if (state.status === "empty") {
    marker.textContent = `[${state.markerNumber}?]`;
    marker.title = "No strong sources found";
    return;
  }

  if (state.status === "error") {
    marker.textContent = `[${state.markerNumber}!]`;
    marker.title = state.errorMessage || "Could not check sources";
    return;
  }

  marker.textContent = `[${state.markerNumber}]`;
}

function createSourceMarker(annotationId: string, state: SourceCheckState) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = SOURCE_MARKER_CLASS;
  marker.dataset.annotationId = annotationId;
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    openSourceCallout(annotationId);
  });
  updateSourceMarkerState(marker, state);
  return marker;
}

function createAnnotationMarker(annotation: Annotation, markerNumber: number) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = ANNOTATION_MARKER_CLASS;
  marker.dataset.annotationId = annotation.id;
  marker.textContent = `[${markerNumber}]`;
  marker.title = getAnnotationDisplayLabel(annotation);
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    openChatSurface(marker, { kind: "annotations", annotations: [annotation] });
  });
  return marker;
}

// Locate the article column so the source-tracker panel can sit beside it
// rather than overlap the prose. Walks up from a known anchor first so we
// pick the article that actually contains the highlighted span; falls back
// to a document-wide query for pages that don't have an obvious anchor yet.
function findArticleContainer(anchor?: HTMLElement | null): HTMLElement | null {
  let current: HTMLElement | null = anchor ?? null;
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    if (tag === "article" || tag === "main") return current;
    const role = current.getAttribute("role");
    if (role === "main" || role === "article") return current;
    current = current.parentElement;
  }

  return (
    document.querySelector<HTMLElement>("article") ||
    document.querySelector<HTMLElement>("main") ||
    document.querySelector<HTMLElement>('[role="main"]') ||
    null
  );
}

function renderSourceCallouts() {
  const openStatesWithAnchor = sourceCheckOpenOrder
    .map((annotationId) => {
      const state = sourceCheckStateByAnnotationId.get(annotationId);
      const anchor = sourceAnchorByAnnotationId.get(annotationId);
      if (!state || !state.open || !anchor?.isConnected) return null;
      return { state, anchor };
    })
    .filter(
      (entry): entry is { state: SourceCheckState; anchor: HTMLElement } => !!entry
    )
    .map(({ state, anchor }) => {
      const rect = anchor.getBoundingClientRect();
      return { state, anchor, rect };
    })
    .filter(({ rect }) => rect.bottom >= 0 && rect.top <= window.innerHeight)
    .sort((a, b) => a.rect.top - b.rect.top);

  if (openStatesWithAnchor.length === 0) {
    removeSourceCalloutStack();
    detachSourceCalloutViewportListeners();
    return;
  }

  attachSourceCalloutViewportListeners();
  const stack = ensureSourceCalloutStack();
  let nextAvailableTop = 8;

  // Anchor the panel column to whatever article surrounds the first open
  // annotation, then reuse that column for the whole stack so callouts line
  // up vertically even when one annotation lives in a sidebar.
  const articleEl = findArticleContainer(openStatesWithAnchor[0]?.anchor);
  const articleRect = articleEl?.getBoundingClientRect() ?? null;
  const layout = computeSourceCalloutLayout({
    articleRect: articleRect
      ? { left: articleRect.left, right: articleRect.right }
      : null,
    viewportWidth: window.innerWidth,
  });

  const callouts: SourceCalloutView[] = openStatesWithAnchor.map(({ state, rect }) => {
    const desiredTop = Math.max(8, Math.min(window.innerHeight - 140, rect.top - 8));
    const top = Math.max(desiredTop, nextAvailableTop);
    const measuredHeight = sourceCalloutHeightByAnnotationId.get(state.annotation.id) ?? 140;
    nextAvailableTop = top + measuredHeight + 8;

    return {
      id: state.annotation.id,
      left: layout.left,
      top,
      width: layout.width,
      status: state.status,
      citations: state.citations,
      answerText: state.answerText,
      textSegments: state.textSegments,
      thinkingText: state.thinkingText,
      searching: state.searching,
      searches: state.searches,
      errorMessage: state.errorMessage,
      debugMode: debugModeEnabled,
    };
  });

  sourceCalloutRoot?.render(
    createElement(SourceCalloutStack, {
      callouts,
      onClose: closeSourceCallout,
      onMeasure: handleSourceCalloutMeasure,
    })
  );

  window.requestAnimationFrame(() => {
    if (stack.isConnected) resolveCitationPublishersForNode(stack);
  });
}

function closeSourceCallout(annotationId: string) {
  const state = sourceCheckStateByAnnotationId.get(annotationId);
  if (!state) return;
  state.open = false;
  const index = sourceCheckOpenOrder.indexOf(annotationId);
  if (index >= 0) sourceCheckOpenOrder.splice(index, 1);
  renderSourceCallouts();
}

function handleSourceCalloutMeasure(annotationId: string, height: number) {
  const previous = sourceCalloutHeightByAnnotationId.get(annotationId);
  if (previous && Math.abs(previous - height) <= 1) return;
  sourceCalloutHeightByAnnotationId.set(annotationId, height);
  if (sourceCalloutRenderFrame !== null) return;
  sourceCalloutRenderFrame = window.requestAnimationFrame(() => {
    sourceCalloutRenderFrame = null;
    renderSourceCallouts();
  });
}

function openSourceCallout(annotationId: string) {
  const state = sourceCheckStateByAnnotationId.get(annotationId);
  if (!state) return;
  state.open = true;

  const existingIndex = sourceCheckOpenOrder.indexOf(annotationId);
  if (existingIndex >= 0) {
    sourceCheckOpenOrder.splice(existingIndex, 1);
  }
  sourceCheckOpenOrder.push(annotationId);

  if (state.status === "idle") {
    startUnsourcedCheck(state);
    return;
  }

  renderSourceCallouts();
}

function syncAnnotationMarkers() {
  const annotationById = new Map(activeAnnotations.map((annotation) => [annotation.id, annotation]));
  const firstAnchorByAnnotationId = new Map<string, HTMLElement>();
  const highlightSpans = document.querySelectorAll<HTMLElement>(
    `.${HIGHLIGHT_CLASS}[data-annotation-ids]`
  );

  for (const span of highlightSpans) {
    const ids = (span.dataset.annotationIds ?? "")
      .split(" ")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    for (const id of ids) {
      const annotation = annotationById.get(id);
      if (!annotation) continue;
      if (!shouldRenderNoteResult(annotation.lensId)) continue;
      if (isSourceCheckCandidate(annotation)) continue;
      if (!firstAnchorByAnnotationId.has(id)) {
        firstAnchorByAnnotationId.set(id, span);
      }
    }
  }

  for (const marker of document.querySelectorAll(`.${ANNOTATION_MARKER_CLASS}`)) {
    marker.remove();
  }

  const markerEntriesByAnchor = new Map<
    HTMLElement,
    Array<{ annotation: Annotation }>
  >();

  for (const [annotationId, anchor] of firstAnchorByAnnotationId.entries()) {
    const annotation = annotationById.get(annotationId);
    if (!annotation) continue;
    const entries = markerEntriesByAnchor.get(anchor) ?? [];
    entries.push({ annotation });
    markerEntriesByAnchor.set(anchor, entries);
  }

  let markerNumber = 1;
  for (const [anchor, entries] of markerEntriesByAnchor.entries()) {
    let insertAfter: Element = anchor;
    for (const { annotation } of entries) {
      const marker = createAnnotationMarker(annotation, markerNumber++);
      insertAfter.insertAdjacentElement("afterend", marker);
      insertAfter = marker;
    }
  }
}

function syncUnsourcedMarkers() {
  const firstAnchorByAnnotationId = new Map<string, HTMLElement>();
  const highlightSpans = document.querySelectorAll<HTMLElement>(
    `.${HIGHLIGHT_CLASS}[data-annotation-ids]`
  );

  for (const span of highlightSpans) {
    const ids = (span.dataset.annotationIds ?? "")
      .split(" ")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    for (const id of ids) {
      const state = sourceCheckStateByAnnotationId.get(id);
      if (!state) continue;
      if (!shouldRenderNoteResult(state.annotation.lensId) && !state.open) continue;
      if (!firstAnchorByAnnotationId.has(id)) {
        firstAnchorByAnnotationId.set(id, span);
      }
    }
  }

  for (const marker of document.querySelectorAll(`.${SOURCE_MARKER_CLASS}`)) {
    marker.remove();
  }

  const markerEntriesByAnchor = new Map<
    HTMLElement,
    Array<{ annotationId: string; state: SourceCheckState }>
  >();
  sourceAnchorByAnnotationId.clear();

  let markerNumber = 1;
  for (const [annotationId, anchor] of firstAnchorByAnnotationId.entries()) {
    const state = sourceCheckStateByAnnotationId.get(annotationId);
    if (!state) continue;
    state.markerNumber = markerNumber++;
    sourceAnchorByAnnotationId.set(annotationId, anchor);

    const entries = markerEntriesByAnchor.get(anchor) ?? [];
    entries.push({ annotationId, state });
    markerEntriesByAnchor.set(anchor, entries);
  }

  for (const [anchor, entries] of markerEntriesByAnchor.entries()) {
    let insertAfter: Element = anchor;
    for (const { annotationId, state } of entries) {
      const marker = createSourceMarker(annotationId, state);
      insertAfter.insertAdjacentElement("afterend", marker);
      insertAfter = marker;
    }
  }

  renderSourceCallouts();
}

function startUnsourcedCheck(state: SourceCheckState) {
  if (state.port || state.status === "loading") return;

  state.status = "loading";
  state.errorMessage = undefined;
  syncUnsourcedMarkers();

  const port = chrome.runtime.connect({ name: "lenses-finding-stream" });
  state.port = port;

  let streamedText = "";
  let latestSegments: StreamTextSegment[] = [];

  const finish = (status: SourceCheckStatus, errorMessage?: string) => {
    state.status = status;
    state.errorMessage = errorMessage;
    if (state.port === port) {
      try {
        port.disconnect();
      } catch {
        // no-op
      }
      state.port = null;
    }
    syncUnsourcedMarkers();
  };

  port.onMessage.addListener((event: AskFindingStreamPortEvent) => {
    if (event.type === "chunk") {
      streamedText += event.text;
      state.answerText = streamedText;
      if (Array.isArray(event.textSegments)) {
        latestSegments = event.textSegments;
        state.textSegments = latestSegments;
      }
      renderSourceCallouts();
      return;
    }

    if (event.type === "thinking") {
      if (event.event === "start") {
        state.thinkingText = "";
      } else if (event.event === "delta") {
        state.thinkingText += event.text ?? "";
      } else if (event.event === "end") {
        state.thinkingText = event.fullText ?? state.thinkingText;
      }
      renderSourceCallouts();
      return;
    }

    if (event.type === "searching") {
      state.searches = foldSearchEvent(state.searches, {
        event: event.event,
        kind: event.kind,
        query: event.query,
        url: event.url,
        title: event.title,
        results: event.results,
      });
      state.searching = isSearchInFlight(state.searches);
      renderSourceCallouts();
      return;
    }

    if (event.type === "citations") {
      if (Array.isArray(event.textSegments)) {
        latestSegments = event.textSegments;
        state.textSegments = latestSegments;
      }
      state.citations = collectUniqueCitations(latestSegments, event.citations);
      renderSourceCallouts();
      return;
    }

    if (event.type === "done") {
      if (Array.isArray(event.textSegments)) {
        latestSegments = event.textSegments;
        state.textSegments = latestSegments;
      }
      state.answerText = event.fullText || streamedText;
      state.citations = collectUniqueCitations(latestSegments, event.citations);
      state.searching = false;
      finish(state.citations.length > 0 ? "ready" : "empty");
      return;
    }

    if (event.type === "error") {
      finish("error", event.error || "Could not check sources");
    }
  });

  port.onDisconnect.addListener(() => {
    if (state.port !== port) return;
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError?.message) {
      finish("error", runtimeError.message);
      return;
    }
    if (state.status === "loading") {
      state.searching = false;
      finish("error", "Source check disconnected.");
    }
  });

  const request: AskFindingStreamPortRequest = {
    action: "ask-finding-stream",
    question: buildAnnotationQuestion(state.annotation),
    sourceUrl: window.location.href,
    targetLensId: state.annotation.lensId,
    sourceCheckOptions: {},
    conversation: [],
    annotations: [
      {
        lensId: state.annotation.lensId,
        label: getAnnotationDisplayLabel(state.annotation),
        category: state.annotation.finding.category,
        text: state.annotation.finding.text,
        detail: state.annotation.finding.detail,
        confidence: state.annotation.finding.confidence,
      },
    ],
  };

  port.postMessage(request);
}

function triggerAutoSourceChecks() {
  let started = 0;
  for (const [annotationId, state] of sourceCheckStateByAnnotationId.entries()) {
    if (!shouldAutoStartSourceCheck(state.annotation)) continue;
    if (state.status !== "idle") continue;
    if (!sourceAnchorByAnnotationId.has(annotationId)) continue;
    startUnsourcedCheck(state);
    started++;
  }

  if (started > 0) {
    logContentStreamDebug("auto_source_checks_started", { started });
  }
}

function openSourceChecksForLens(lensId: string) {
  let opened = 0;
  for (const [annotationId, state] of sourceCheckStateByAnnotationId.entries()) {
    if (state.annotation.lensId !== lensId) continue;
    if (!isSourceCheckCandidate(state.annotation)) continue;
    if (!sourceAnchorByAnnotationId.has(annotationId)) continue;

    state.open = true;
    if (!sourceCheckOpenOrder.includes(annotationId)) {
      sourceCheckOpenOrder.push(annotationId);
    }

    if (state.status === "idle") {
      startUnsourcedCheck(state);
    } else {
      renderSourceCallouts();
    }
    opened++;
  }

  if (opened > 0) {
    logContentStreamDebug("selection_source_checks_opened", { lensId, opened });
  }

  return opened;
}

chrome.storage.local.get(["debugMode"], (result) => {
  debugModeEnabled = __INTERNAL_TOOLS__ && !!result.debugMode;
});

chrome.storage.local.get([CHAT_ACTIONS_USE_SIDE_PANEL_KEY], (result) => {
  chatActionsUseSidePanel = chatActionsUseSidePanelFromStorage(result);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if ("debugMode" in changes) {
    debugModeEnabled = __INTERNAL_TOOLS__ && !!changes.debugMode.newValue;
  }
  if (CHAT_ACTIONS_USE_SIDE_PANEL_KEY in changes) {
    chatActionsUseSidePanel =
      changes[CHAT_ACTIONS_USE_SIDE_PANEL_KEY].newValue === true;
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    if (handleActionMessage(message, sendResponse)) {
      return true;
    }

    if (!("type" in message)) {
      return undefined;
    }

    switch (message.type) {
      case "get-page-text":
        if (isVideoPage()) {
          loadYouTubeTranscript(Boolean((message as ActionMessage).force)).then((result) => {
            sendResponse({
              text: transcriptToText(result.transcript) || getPageText(),
              sourceKind: "youtube_video",
              sourceTitle: result.metadata?.title ?? document.title,
              sourceKey: result.videoId ? `youtube:${result.videoId}` : undefined,
              scope: result.transcript?.length ? "transcript" : "page",
            });
          });
          return true;
        }
        sendResponse({
          text: getPageText(),
          sourceKind: "web_page",
          sourceTitle: document.title,
          sourceKey: `url:${location.href}`,
          scope: "page",
          // Chrome hosts PDFs in an embedder page whose body is a bare
          // <embed>, so text and title come back empty; the reported content
          // type lets the sidepanel reroute such tabs to PDF ingestion even
          // when the URL has no .pdf suffix (e.g. arXiv's canonical links).
          contentType: document.contentType,
        });
        break;

      case "get-selection":
        sendResponse({ text: getSelectedText() });
        break;

      case "get-defuddle":
        try {
          const defuddle = new Defuddle(document, {
            url: window.location.href,
            markdown: true,
            separateMarkdown: true,
            removeImages: true,
          });
          const result = defuddle.parse();
          sendResponse({
            result: {
              title: result.title,
              author: result.author,
              site: result.site,
              description: result.description,
              published: result.published,
              wordCount: result.wordCount,
              parseTime: result.parseTime,
              content: result.content,
              contentMarkdown: result.contentMarkdown,
            },
          });
        } catch (error) {
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;

      case "get-readability":
        try {
          const clonedDocument = document.cloneNode(true) as Document;
          const article = new Readability(clonedDocument).parse();
          sendResponse({
            result: article
              ? {
                  title: article.title,
                  byline: article.byline,
                  siteName: article.siteName,
                  excerpt: article.excerpt,
                  length: article.length,
                  textContent: article.textContent,
                  content: article.content,
                }
              : null,
          });
        } catch (error) {
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;

      case "highlight":
        activeAnnotations = activeAnnotations.filter(
          (annotation) => annotation.lensId !== message.lensId
        );
        removeSourceCheckStatesForLens(message.lensId);
        if (typeof message.sourceText === "string" && message.sourceText.trim().length > 0) {
          sourceTextByLensId.set(message.lensId, message.sourceText);
        } else {
          sourceTextByLensId.delete(message.lensId);
        }

        const seenIds = new Set<string>();
        const nextAnnotations: Annotation[] = [];

          for (const finding of message.findings) {
            const colorInfo =
              message.colors[finding.category] ??
              {
                color: "#64748b",
                label: humanizeUnknownCategory(finding.category),
              };

            const annotationId = buildAnnotationId(message.lensId, finding);
            if (seenIds.has(annotationId)) continue;
            seenIds.add(annotationId);

            const annotation: Annotation = {
              id: annotationId,
              finding,
              color: colorInfo.color,
              label: colorInfo.label,
              lensId: message.lensId,
            };
            nextAnnotations.push(annotation);

            if (isSourceCheckCandidate(annotation)) {
              sourceCheckStateByAnnotationId.set(annotation.id, {
                annotation,
                status: "idle",
                markerNumber: 0,
                citations: [],
                answerText: "",
                textSegments: [],
                thinkingText: "",
                searching: false,
                searches: [],
                open: false,
                port: null,
              });
            }
          }

        activeAnnotations.push(...nextAnnotations);
        activeAnnotations = dedupeAnnotationsById(activeAnnotations);
        const renderResult = renderAllHighlights({ selectedText: message.selectedText });
        const sourceCheckCount = message.autoSourceChecks
          ? openSourceChecksForLens(message.lensId)
          : 0;
        sendResponse({
          ok: true,
          renderedCount: renderResult.renderedCount,
          failedAnchorCount: renderResult.failedAnchorCount,
          failedAnchors: renderResult.failedAnchors,
          sourceCheckCount,
        });
        notifyPageLensDockStateChanged();
        break;

      case "set-lens-highlight-visibility": {
        setLensResultDisplayMode(
          message.lensId,
          message.visible ? DEFAULT_RESULT_DISPLAY_MODE : "off"
        );
        const visibilityRenderResult = renderAllHighlights();
        sendResponse({
          ok: true,
          visible: isLensResultVisible(message.lensId),
          renderedCount: visibilityRenderResult.renderedCount,
          failedAnchorCount: visibilityRenderResult.failedAnchorCount,
          failedAnchors: visibilityRenderResult.failedAnchors,
        });
        notifyPageLensDockStateChanged();
        break;
      }

      case "set-lens-result-display-mode": {
        setLensResultDisplayMode(message.lensId, message.mode);
        const displayRenderResult = renderAllHighlights();
        sendResponse({
          ok: true,
          mode: getLensResultDisplayMode(message.lensId),
          visible: isLensResultVisible(message.lensId),
          renderedCount: displayRenderResult.renderedCount,
          failedAnchorCount: displayRenderResult.failedAnchorCount,
          failedAnchors: displayRenderResult.failedAnchors,
        });
        notifyPageLensDockStateChanged();
        break;
      }

      case "clear-lens-results": {
        const clearRenderResult = clearPageLensDockLensResults(message.lensId);
        sendResponse({
          ok: true,
          lensId: message.lensId,
          renderedCount: clearRenderResult.renderedCount,
          failedAnchorCount: clearRenderResult.failedAnchorCount,
          failedAnchors: clearRenderResult.failedAnchors,
        });
        break;
      }

      case APP_MODE_CHANGED_MESSAGE_TYPE:
        resetModeScopedPageData();
        sendResponse({ ok: true });
        break;

      case "clear":
        clearHighlights();
        activeAnnotations = [];
        sourceTextByLensId.clear();
        lastRenderedCountByLensId.clear();
        lastAnchorFailureCountByLensId.clear();
        lastAnchorFailureLogSignature = "";
        if (message.resetVisibility !== false) {
          resultDisplayModeByLensId.clear();
        }
        resetSourceCheckState();
        sendResponse({ ok: true });
        notifyPageLensDockStateChanged();
        break;

      case "saved-selections":
        mergeSavedSelectionsFromStorage(message.selections);
        renderSavedHighlights();
        sendResponse({ ok: true });
        break;
    }

    return undefined;
  }
);

function handleActionMessage(
  message: RuntimeMessage,
  sendResponse: (response?: unknown) => void
): boolean {
  if (!("action" in message) || !message.action) return false;

  switch (message.action) {
    case "getTranscript":
      loadYouTubeTranscript(Boolean(message.force)).then(sendResponse);
      return true;

    case "refreshTranscript":
      loadYouTubeTranscript(true).then(sendResponse);
      return true;

    case "getCurrentTime":
      sendResponse({ time: getCurrentTime() });
      return true;

    case "getContext": {
      const transcript = getCurrentTranscript() ?? [];
      const seconds = Number(message.currentSeconds ?? getCurrentTime()?.seconds ?? 0);
      sendResponse({
        context: getContextAroundTime(transcript, seconds, Number(message.windowSeconds ?? 60)),
      });
      return true;
    }

    case "seekTo":
      sendResponse({ success: seekTo(Number(message.seconds ?? 0)) });
      return true;

    case "captureScreenshot":
      sendResponse(captureScreenshot(findVideoElement()));
      return true;

    default:
      return false;
  }
}

async function loadYouTubeTranscript(force: boolean) {
  const videoId = getVideoId();
  if (!isVideoPage() || !videoId) {
    return {
      isVideoPage: false,
      transcript: null,
      videoId: null,
      metadata: null,
    };
  }

  if (force || getCurrentVideoId() !== videoId || !getCurrentTranscript()) {
    if (force) {
      resetTranscriptState();
    }
    await initializeTranscript();
    startPlaybackTracking();
  }

  return {
    isVideoPage: true,
    transcript: getCurrentTranscript(),
    videoId: getCurrentVideoId() ?? videoId,
    metadata: getVideoMetadata(),
  };
}

function humanizeUnknownCategory(value: string) {
  const label = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) return "Other";
  return label.replace(/^\w/, (letter) => letter.toUpperCase());
}

function getPageText(): string {
  if (isVideoPage()) {
    const transcriptText = transcriptToText(getCurrentTranscript());
    if (transcriptText) return transcriptText;
  }

  const article = document.querySelector("article");
  if (article) return article.innerText;

  const main = document.querySelector("main");
  if (main) return main.innerText;

  // Never clone a live host page to extract text. Cloning custom-element trees can
  // construct detached component instances whose lifecycle code mutates page-wide
  // state (YouTube menus are one example). innerText is read-only and already omits
  // script/style contents and non-rendered text.
  return document.body.innerText;
}

function getCurrentPageSourceKey(): string {
  const videoId = isVideoPage() ? getCurrentVideoId() ?? getVideoId() : null;
  return videoId ? `youtube:${videoId}` : `url:${location.href}`;
}

function getCurrentPageSourceKind(): "web_page" | "youtube_video" {
  return isVideoPage() ? "youtube_video" : "web_page";
}

function getCurrentPageScope(): "page" | "transcript" {
  return isVideoPage() && getCurrentTranscript()?.length ? "transcript" : "page";
}

function refreshPageSavedSelectionsFromStorage(options?: { replace?: boolean }) {
  chrome.runtime.sendMessage(
    { type: "get-saved-selections", url: window.location.href },
    (response: { selections?: SavedSelection[] }) => {
      if (chrome.runtime.lastError) return;
      if (options?.replace) activeSavedSelections = [];
      if (response?.selections) {
        mergeSavedSelectionsFromStorage(response.selections);
      }
      renderSavedHighlights();
    }
  );
}

function restoreStoredPageLensResults() {
  if (activeAnnotations.length > 0) return;

  chrome.runtime.sendMessage(
    {
      type: "restore-page-lens-results",
      sourceUrl: location.href,
      sourceKey: getCurrentPageSourceKey(),
      sourceText: getPageText(),
    },
    (response?: { error?: string }) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError?.message) {
        console.warn("[Lenses][content] could not restore lens results", runtimeError.message);
        return;
      }
      if (response?.error) {
        console.warn("[Lenses][content] could not restore lens results", response.error);
      }
    }
  );
}

function resetModeScopedPageData() {
  clearHighlights();
  activeAnnotations = [];
  sourceTextByLensId.clear();
  lastRenderedCountByLensId.clear();
  lastAnchorFailureCountByLensId.clear();
  lastAnchorFailureLogSignature = "";
  resultDisplayModeByLensId.clear();
  resetSourceCheckState();

  activeSavedSelections = [];
  clearSavedHighlights();
  refreshPageSavedSelectionsFromStorage({ replace: true });
  restoreStoredPageLensResults();
  syncPageLensDock();
  notifyPageLensDockStateChanged();
}

function transcriptToText(
  transcript: Array<{ formatted?: string; text: string }> | null | undefined
): string {
  if (!transcript || transcript.length === 0) return "";
  return transcript
    .map((segment) => `[${segment.formatted ?? ""}] ${segment.text}`.trim())
    .join("\n");
}

function startYouTubeSourceBridge() {
  if (!location.hostname.endsWith("youtube.com")) return;

  let lastHref = location.href;
  const scheduleInitialization = () => {
    window.setTimeout(() => {
      if (!isVideoPage()) return;
      loadYouTubeTranscript(false).catch((error) => {
        console.warn("[Lenses] YouTube transcript initialization failed", error);
      });
    }, 1500);
  };

  scheduleInitialization();

  const observer = new MutationObserver(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    resetTranscriptState();
    scheduleInitialization();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

startYouTubeSourceBridge();

// Renamed from `getSelection` to avoid shadowing the native `window.getSelection`
// DOM API in the content script's isolated world (classic scripts attach top-level
// function declarations to `window`, which silently overrides DOM APIs of the same name).
function getSelectedText(): string {
  return window.getSelection()?.toString() ?? "";
}

function clearHighlights(options?: { preserveSourceCheckState?: boolean }) {
  const preserveSourceCheckState = options?.preserveSourceCheckState ?? false;

  const markerParents = new Set<ParentNode>();
  for (const marker of document.querySelectorAll(`.${ANNOTATION_MARKER_CLASS}`)) {
    if (marker.parentNode) markerParents.add(marker.parentNode);
    marker.remove();
  }
  for (const marker of document.querySelectorAll(`.${SOURCE_MARKER_CLASS}`)) {
    if (marker.parentNode) markerParents.add(marker.parentNode);
    marker.remove();
  }

  for (const el of document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) {
    const parent = el.parentNode;
    if (!parent) continue;

    parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
    parent.normalize();
  }

  for (const parent of markerParents) {
    parent.normalize();
  }

  if (!preserveSourceCheckState) {
    sourceCalloutHeightByAnnotationId.clear();
    removeSourceCalloutStack();
  }

  closeActiveChatbox();
  for (const el of document.querySelectorAll(`.${CHATBOX_CLASS}`)) {
    el.remove();
  }
}

interface MatchLocation {
  textNode: Text;
  startOffset: number;
  endOffset: number;
  annotation: Annotation;
}

function renderAllHighlights(options?: { selectedText?: string }) {
  activeAnnotations = dedupeAnnotationsById(activeAnnotations);
  clearHighlights({ preserveSourceCheckState: true });

  const pageIndex = buildPageTextIndex();
  const visibleAnnotations = activeAnnotations.filter(
    (annotation) => isLensResultVisible(annotation.lensId)
  );
  const matches: MatchLocation[] = [];
  const matchedAnnotationIds = new Set<string>();
  const failedAnchors: AnchorFailureDiagnostic[] = [];
  const selectedText = options?.selectedText?.trim() ?? "";
  const sourceTracerCandidateCount = visibleAnnotations.filter(
    (annotation) => annotation.lensId === "source-tracer" && isSourceCheckCandidate(annotation)
  ).length;

  const addRangeMatch = (annotation: Annotation, start: number, end: number) => {
    let added = false;
    for (const piece of pageIndex.pieces) {
      if (piece.end <= start || piece.start >= end) continue;

      const startOffset = Math.max(0, start - piece.start);
      const endOffset = Math.min(piece.end - piece.start, end - piece.start);
      if (endOffset <= startOffset) continue;

      matches.push({
        textNode: piece.textNode,
        startOffset,
        endOffset,
        annotation,
      });
      added = true;
    }
    if (added) {
      matchedAnnotationIds.add(annotation.id);
    }
    return added;
  };

  for (const ann of visibleAnnotations) {
    const searchText = ann.finding.text.trim();
    if (!searchText) {
      failedAnchors.push(anchorFailureDiagnostic(ann, "empty-text"));
      continue;
    }

    const match = findFindingTextAnchor(
      pageIndex.text,
      selectedText,
      searchText,
      ann.finding.sourceSpan,
      {
        sourceText: sourceTextByLensId.get(ann.lensId),
        fallbackToSelection:
          ann.lensId === "source-tracer" &&
          isSourceCheckCandidate(ann) &&
          sourceTracerCandidateCount === 1,
      }
    );
    if (match) {
      const rendered = addRangeMatch(ann, match.start, match.end);
      if (!rendered) {
        failedAnchors.push(anchorFailureDiagnostic(ann, "range-not-renderable"));
      }
    } else {
      failedAnchors.push(anchorFailureDiagnostic(ann, "text-not-found"));
    }
  }

  const matchesByNode = new Map<Text, MatchLocation[]>();
  for (const match of matches) {
    const existing = matchesByNode.get(match.textNode) ?? [];
    existing.push(match);
    matchesByNode.set(match.textNode, existing);
  }

  for (const [textNode, nodeMatches] of matchesByNode) {
    renderSegmentedNode(textNode, nodeMatches);
  }

  syncAnnotationMarkers();
  syncUnsourcedMarkers();
  triggerAutoSourceChecks();
  const result = {
    renderedCount: matchedAnnotationIds.size,
    failedAnchorCount: failedAnchors.length,
    failedAnchors,
    totalVisibleAnnotations: visibleAnnotations.length,
  };
  updateAnchorRenderCounts(visibleAnnotations, matchedAnnotationIds, failedAnchors);
  logAnchorFailures(result);
  return result;
}

interface Segment {
  start: number;
  end: number;
  annotations: Annotation[];
}

function renderSegmentedNode(textNode: Text, matches: MatchLocation[]) {
  const content = textNode.textContent ?? "";
  const parent = textNode.parentNode;
  if (!parent) return;

  const sortedByWidth = [...matches].sort((a, b) => {
    const widthDiff = (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset);
    if (widthDiff !== 0) return widthDiff;
    return a.startOffset - b.startOffset;
  });
  const annotationOrder = new Map<Annotation, number>();
  sortedByWidth.forEach((m, i) => annotationOrder.set(m.annotation, i));

  const boundaries = new Set<number>([0, content.length]);
  for (const m of matches) {
    boundaries.add(m.startOffset);
    boundaries.add(m.endOffset);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (start === end) continue;

    const segmentAnnotationsById = new Map<string, Annotation>();
    for (const match of matches) {
      if (match.startOffset <= start && match.endOffset >= end) {
        if (!segmentAnnotationsById.has(match.annotation.id)) {
          segmentAnnotationsById.set(match.annotation.id, match.annotation);
        }
      }
    }
    const segmentAnnotations = Array.from(segmentAnnotationsById.values());

    segments.push({ start, end, annotations: segmentAnnotations });
  }

  const frag = document.createDocumentFragment();

  for (const seg of segments) {
    const text = content.slice(seg.start, seg.end);

    if (seg.annotations.length === 0) {
      frag.appendChild(document.createTextNode(text));
      continue;
    }

    const span = document.createElement("span");
    span.className = HIGHLIGHT_CLASS;
    span.textContent = text;
    span.style.cursor = "pointer";
    span.style.position = "relative";

    const sorted = [...seg.annotations].sort(
      (a, b) => (annotationOrder.get(a) ?? 0) - (annotationOrder.get(b) ?? 0)
    );
    const visualHighlightAnnotations = sorted.filter(
      (annotation) => shouldRenderInlineResult(annotation.lensId)
    );

    if (visualHighlightAnnotations.length > 0) {
      const bgImages: string[] = [];
      const bgSizes: string[] = [];
      const bgPositions: string[] = [];

      for (let i = 0; i < visualHighlightAnnotations.length; i++) {
        const color = visualHighlightAnnotations[i].color;
        const offset = i * 3;
        bgImages.push(
          `repeating-linear-gradient(to right, ${color} 0 1.5px, transparent 1.5px 4px)`
        );
        bgSizes.push("auto 1.5px");
        bgPositions.push(`0 calc(100% - ${offset}px)`);
      }

      span.style.backgroundImage = bgImages.join(", ");
      span.style.backgroundSize = bgSizes.join(", ");
      span.style.backgroundPosition = bgPositions.join(", ");
      span.style.backgroundRepeat = "repeat-x";

      const paddingNeeded = Math.max(2, (visualHighlightAnnotations.length - 1) * 3 + 2);
      span.style.paddingBottom = `${paddingNeeded}px`;
    } else {
      span.classList.add("lenses-highlight-side-note-only");
      span.style.backgroundImage = "";
      span.style.backgroundSize = "";
      span.style.backgroundPosition = "";
      span.style.backgroundRepeat = "";
      span.style.paddingBottom = "0";
    }

    span.dataset.annotationCount = String(sorted.length);
    span.dataset.annotationIds = sorted.map((annotation) => annotation.id).join(" ");

    span.addEventListener("click", (e) => {
      e.stopPropagation();
      openChatSurface(span, { kind: "annotations", annotations: sorted });
    });

    frag.appendChild(span);
  }

  parent.replaceChild(frag, textNode);
}

function collectTextNodes(): Text[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.classList?.contains(HIGHLIGHT_CLASS)) return NodeFilter.FILTER_REJECT;
      if (parent.classList?.contains(SAVED_HIGHLIGHT_CLASS)) return NodeFilter.FILTER_REJECT;
      if (parent.classList?.contains(ANNOTATION_MARKER_CLASS)) return NodeFilter.FILTER_REJECT;
      if (parent.classList?.contains(SOURCE_MARKER_CLASS)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`script, style, .${CHATBOX_CLASS}, .${LENSES_SHADOW_HOST_CLASS}`)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        parent.closest(
          `.${SELECTION_TRIGGER_CLASS}, .${SOURCE_CALLOUT_STACK_CLASS}, .lenses-floating-citation-tooltip`
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

function normalizeCitationUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function applyCitationPublisherLabel(badge: HTMLAnchorElement) {
  const citationUrl = badge.dataset.citationUrl;
  const source = badge.querySelector(".citation-source");
  if (!(source instanceof HTMLElement)) return;

  const fallback = source.dataset.fallbackLabel ?? source.textContent ?? "";
  if (!citationUrl) {
    source.textContent = fallback;
    return;
  }

  const resolved = citationPublisherCache.get(citationUrl);
  source.textContent = resolved && resolved.trim().length > 0 ? resolved : fallback;
}

function resolveCitationPublishersForNode(container: ParentNode) {
  const badges = container.querySelectorAll("a.citation-badge[data-citation-url]");
  const unresolved = new Set<string>();

  badges.forEach((node) => {
    const badge = node as HTMLAnchorElement;
    applyCitationPublisherLabel(badge);

    const citationUrl = badge.dataset.citationUrl;
    if (!citationUrl) return;
    if (citationPublisherCache.has(citationUrl)) return;
    if (citationPublisherMisses.has(citationUrl)) return;
    if (citationPublisherInFlight.has(citationUrl)) return;
    unresolved.add(citationUrl);
  });

  if (unresolved.size === 0) return;

  const urls = Array.from(unresolved);
  for (const url of urls) {
    citationPublisherInFlight.add(url);
  }

  chrome.runtime.sendMessage(
    {
      type: "resolve-citation-publishers",
      urls,
    },
    (response?: ResolveCitationPublishersResponse) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError?.message) {
        for (const url of urls) {
          citationPublisherInFlight.delete(url);
        }
        logContentStreamDebug("citation_publishers_error", {
          message: runtimeError.message,
          urlCount: urls.length,
        });
        return;
      }

      const { publishers, authoritativeUrls } = parseCitationPublisherResolution(response);
      let resolvedCount = 0;
      let missCount = 0;

      for (const url of urls) {
        const resolved = publishers[url];
        if (typeof resolved === "string" && resolved.trim().length > 0) {
          citationPublisherCache.set(url, resolved.trim());
          citationPublisherMisses.delete(url);
          resolvedCount++;
        } else if (authoritativeUrls.has(url)) {
          citationPublisherMisses.add(url);
          missCount++;
        }
        citationPublisherInFlight.delete(url);
      }

      logContentStreamDebug("citation_publishers_applied", {
        requestedUrlCount: urls.length,
        resolvedCount,
        missCount,
      });

      const liveBadges = container.querySelectorAll("a.citation-badge[data-citation-url]");
      liveBadges.forEach((node) => {
        applyCitationPublisherLabel(node as HTMLAnchorElement);
      });
    }
  );
}

function openChatSurface(anchor: HTMLElement, context: ChatContext) {
  // The floating chatbox is not part of the contest surface set; the side
  // panel hosts all chat there regardless of the stored preference.
  if (!CONTEST_BUILD && !chatActionsUseSidePanel) {
    openChatbox(anchor, context);
    return;
  }

  stageChatContextInSidePanel(context);
}

function stageChatContextInSidePanel(context: ChatContext) {
  const pending = pendingAskFromChatContext(context);

  chrome.runtime.sendMessage(
    {
      type: "stage-ask",
      ...pending,
    },
    (response?: { staged?: boolean; error?: string }) => {
      if (chrome.runtime.lastError) {
        console.warn("[Lenses] Could not stage side panel chat", chrome.runtime.lastError.message);
        return;
      }
      if (response?.error) {
        console.warn("[Lenses] Could not stage side panel chat", response.error);
      }
    }
  );

  chrome.runtime.sendMessage(
    { action: "open-source-panel" },
    (response?: { success?: boolean; error?: string }) => {
      if (chrome.runtime.lastError) {
        console.warn("[Lenses] Could not open side panel", chrome.runtime.lastError.message);
        return;
      }
      if (response?.error) {
        console.warn("[Lenses] Could not open side panel", response.error);
      }
    }
  );
}

function pendingAskFromChatContext(context: ChatContext) {
  if (context.kind === "selection") {
    const initialQuestion = context.initialQuestion?.trim() ?? "";
    return {
      ...(initialQuestion
        ? {
            question: initialQuestion,
            displayContent: selectionActionDisplayContent(context),
          }
        : { draft: selectionDraft(context.selectedText) }),
      context: pendingAskContextFromChatContext(context),
    };
  }

  const annotations = uniqueAnnotations(context.annotations);
  return {
    draft: annotationDraft(annotations),
    context: pendingAskContextFromChatContext({ kind: "annotations", annotations }),
    targetLensId: annotations[0]?.lensId,
  };
}

function selectionDraft(selectedText: string) {
  const text = selectedText.trim();
  return text ? `About this:\n\n${text}\n\n` : "About this:\n\n";
}

function pendingAskContextFromChatContext(context: ChatContext): PendingAskContext {
  if (context.kind === "selection") {
    return {
      kind: "selection",
      selectedText: context.selectedText,
      pageContext: context.pageContext,
      ...(context.selectionMode ? { selectionMode: context.selectionMode } : null),
    };
  }

  return {
    kind: "annotations",
    annotations: uniqueAnnotations(context.annotations).map((annotation) => ({
      lensId: annotation.lensId,
      label: getAnnotationDisplayLabel(annotation),
      category: annotation.finding.category,
      text: annotation.finding.text,
      detail: annotation.finding.detail,
      confidence: annotation.finding.confidence,
    })),
  };
}

function selectionActionDisplayContent(
  context: Extract<ChatContext, { kind: "selection" }>
) {
  const snippet = formatSelectionSnippet(context.selectedText);
  if (context.selectionMode === "explain") return `Explain ${snippet}`;
  if (context.selectionMode === "truth") return `Check ${snippet}`;
  if (context.selectionMode === "summarize") return `Summarize ${snippet}`;
  return `Ask about ${snippet}`;
}

function annotationDraft(annotations: Annotation[]) {
  const [first] = annotations;
  if (!first) return "About this highlight:\n\n";
  if (annotations.length === 1) {
    return (
      `About this ${getAnnotationDisplayLabel(first)} flag: ` +
      `${formatSelectionSnippet(first.finding.text)}\n\n`
    );
  }

  const lines = annotations.slice(0, 4).map((annotation) => {
    return `- ${getAnnotationDisplayLabel(annotation)}: ${formatSelectionSnippet(annotation.finding.text)}`;
  });
  return `About these highlighted findings:\n\n${lines.join("\n")}\n\n`;
}

function openChatbox(anchor: HTMLElement, context: ChatContext) {
  closeActiveChatbox();
  for (const orphan of document.querySelectorAll("." + CHATBOX_CLASS)) {
    orphan.remove();
  }
  removeLensesShadowHosts("chatbox");
  hideSelectionTrigger();

  const isSelectionMode = context.kind === "selection";
  let currentAnnotations =
    context.kind === "annotations" ? uniqueAnnotations(context.annotations) : [];

  const chatboxMount = createLensesShadowMount({
    surface: "chatbox",
    rootClassName: CHATBOX_CLASS,
    ariaLabel: "Lenses chat",
  });
  const root = chatboxMount.root;
  root.classList.add("lenses-chatbox--detached");
  if (isSelectionMode) {
    root.classList.add("lenses-chatbox--selection");
  }

  const chatboxRoot = createRoot(root);
  let disposed = false;

  function getAnnotationContext() {
    return currentAnnotations.map((annotation) => ({
      lensId: annotation.lensId,
      label: getAnnotationDisplayLabel(annotation),
      category: annotation.finding.category,
      text: annotation.finding.text,
      detail: annotation.finding.detail,
      confidence: annotation.finding.confidence,
    }));
  }

  const selectionPayload =
    context.kind === "selection"
      ? {
          selectionText: context.selectedText,
          pageContext: context.pageContext,
          selectionMode: context.selectionMode,
        }
      : null;
  const savedSelectionAnchor =
    context.kind === "selection"
      ? buildSavedSelectionAnchor(context.selectedText)
      : null;

  function getAnnotationRows(): ChatboxAnnotationView[] {
    return currentAnnotations.map((annotation) => ({
      id: annotation.id,
      label: getAnnotationDisplayLabel(annotation),
      detail: annotation.finding.detail,
      confidence: annotation.finding.confidence,
      color: annotation.color,
    }));
  }

  const conversation: ChatMessage[] = [];
  const messageViews: ChatboxMessageView[] = [];
  let nextMessageId = 1;
  let waiting = false;
  let selectedAnnotation: Annotation | null = null;
  let selectedAnnotationId: string | null = null;
  let floatingCitationTooltip: HTMLDivElement | null = null;
  let floatingCitationTooltipMount: LensesShadowMount | null = null;
  let activeCitationBadge: HTMLAnchorElement | null = null;
  let autoSavedId: string | null = context.kind === "selection" ? (context.savedId ?? null) : null;
  let saveCreateInFlight = false;
  let saveAgainAfterCreate = false;
  let activeStreamPort: chrome.runtime.Port | null = null;
  // All stream-event accumulation goes through the shared fold engine; this
  // closure only decides how the folded state becomes the streaming preview.
  let streamState = createChatStreamState();
  let streamingView: ChatboxStreamingView | null = null;
  let hasAutoSavedStreamingAssistant = false;
  let shouldAutoScroll = true;
  let messageSelectionPrompt: ChatboxMessageSelectionPrompt | null = null;
  let messagesElement: HTMLDivElement | null = null;
  let inputElement: HTMLTextAreaElement | null = null;
  // The fades also depend on the log's own height, so a resize (the detached dock
  // can be dragged) must re-evaluate them even when the message list is unchanged.
  const messagesResizeObserver = new ResizeObserver(() => syncChatboxFades());
  const AUTO_SCROLL_THRESHOLD_PX = 56;

  function renderChatbox(forceScroll = false) {
    if (disposed || !root.isConnected) return;

    flushSync(() => {
      chatboxRoot.render(
        createElement(ChatboxView, {
          selectionHeader:
            context.kind === "selection"
              ? {
                  eyebrow: getSelectionChatEyebrow(context.selectionMode),
                  quote: formatSelectionSnippet(context.selectedText),
                }
              : undefined,
          annotationSubtitle:
            !isSelectionMode && currentAnnotations.length > 1
              ? String(currentAnnotations.length) + " overlapping annotations"
              : undefined,
          annotationRows: getAnnotationRows(),
          selectedAnnotationId,
          debugMode: debugModeEnabled,
          messages: messageViews,
          messageSelectionPrompt,
          streaming: streamingView,
          waiting,
          placeholder: isSelectionMode
            ? getSelectionInputPlaceholder(context.selectionMode)
            : "Ask a follow-up question",
          canDelete: isSelectionMode && !!autoSavedId,
          canRemoveAnnotation: !isSelectionMode && currentAnnotations.length > 0,
          onClose: closeActiveChatbox,
          onDelete: handleDeleteSavedChat,
          onRemoveAnnotation: handleRemoveAnnotation,
          onRawResults: handleRawResults,
          onAnnotationSelect: handleAnnotationSelect,
          onSubmit: handleSubmit,
          onCopyMessage: handleCopyMessage,
          onRetryMessage: handleRetryMessage,
          onRewindMessage: handleRewindMessage,
          onOpenApiKeySettings: openApiKeySettings,
          onInputElement: (element) => {
            inputElement = element;
          },
          onMessagesElement: (element) => {
            messagesElement = element;
            messagesResizeObserver.disconnect();
            if (element) messagesResizeObserver.observe(element);
          },
          onMessagesScroll,
          onMessagesMouseUp,
          onMessagesMouseOver,
          onMessagesMouseOut,
          onMessagesFocusIn,
          onMessagesFocusOut,
          onInsertMessageSelection: insertSelectedChatMessageText,
        })
      );
    });

    if (messagesElement) {
      const hasCitationContent =
        messageViews.some((message) => (message.textSegments?.length ?? 0) > 0) ||
        (streamingView?.textSegments.length ?? 0) > 0;
      if (hasCitationContent) {
        resolveCitationPublishersForNode(messagesElement);
      }
      scrollMessagesToBottom(forceScroll);
      syncChatboxFades();
    }
  }

  function buildSavedSelectionRecord(
    id: string,
    title: string,
    messagesSnapshot: ChatMessage[]
  ): SavedSelection | null {
    if (context.kind !== "selection") return null;
    return {
      id,
      sourceKey: getCurrentPageSourceKey(),
      sourceKind: getCurrentPageSourceKind(),
      scope: "selection",
      url: window.location.href,
      selectedText: context.selectedText,
      messages: messagesSnapshot,
      title,
      createdAt: Date.now(),
      anchorPrefix: savedSelectionAnchor?.prefix,
      anchorSuffix: savedSelectionAnchor?.suffix,
      textStart: savedSelectionAnchor?.textStart,
      textEnd: savedSelectionAnchor?.textEnd,
      pageTitle: document.title,
    };
  }

  function applySavedSelectionLocally(selection: SavedSelection) {
    activeSavedSelections = [
      selection,
      ...activeSavedSelections.filter((saved) => saved.id !== selection.id),
    ];
    renderSavedHighlights();
  }

  function updateSavedSelectionLocally(id: string, messagesSnapshot: ChatMessage[]) {
    activeSavedSelections = activeSavedSelections.map((selection) =>
      selection.id === id ? { ...selection, messages: messagesSnapshot } : selection
    );
  }

  function getStreamingAssistantContent() {
    const assistantText = streamState.text.trim();
    if (assistantText) return assistantText;
    return streamState.textSegments
      .map((segment) => segment.text)
      .join("")
      .trim();
  }

  function buildAutoSaveMessagesSnapshot() {
    const messagesSnapshot = [...conversation];
    const streamingAssistantContent = streamingView ? getStreamingAssistantContent() : "";
    if (streamingAssistantContent) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: streamingAssistantContent,
      };
      const thinkingText = streamState.thinkingText.trim();
      if (thinkingText) {
        assistantMessage.thinkingText = thinkingText;
      }
      if (streamState.textSegments.length > 0) {
        assistantMessage.textSegments = streamState.textSegments;
      }
      if (streamState.meta) {
        assistantMessage.meta = streamState.meta;
      }
      messagesSnapshot.push(assistantMessage);
    }
    return messagesSnapshot;
  }

  function hasPersistableMessages(messagesSnapshot: ChatMessage[]) {
    return messagesSnapshot.some((message) => {
      if (!message.content.trim()) return false;
      if (message.role === "assistant") return true;
      return !message.hidden;
    });
  }

  function getSavedSelectionTitle(messagesSnapshot: ChatMessage[]) {
    if (context.kind !== "selection") return "";
    return (
      messagesSnapshot.find(
        (message) => message.role === "user" && !message.hidden && message.content.trim()
      )?.content.slice(0, 100) ?? context.selectedText.slice(0, 60)
    );
  }

  function getFindingConversationRef() {
    if (context.kind !== "annotations") return null;
    return selectedAnnotationId ?? currentAnnotations[0]?.id ?? null;
  }

  function getConversationIdentity(focusRefOverride?: string | null) {
    if (context.kind === "selection") {
      if (!autoSavedId) return null;
      return {
        sourceKey: getCurrentPageSourceKey(),
        sourceUrl: window.location.href,
        sourceKind: getCurrentPageSourceKind(),
        scope: "selection" as const,
        focus: "selection" as const,
        focusRef: autoSavedId,
      };
    }

    const focusRef = focusRefOverride ?? getFindingConversationRef();
    if (!focusRef) return null;
    return {
      sourceKey: getCurrentPageSourceKey(),
      sourceUrl: window.location.href,
      sourceKind: getCurrentPageSourceKind(),
      scope: getCurrentPageScope(),
      focus: "finding" as const,
      focusRef,
    };
  }

  function saveConversationMessages(messagesSnapshot: ChatMessage[]) {
    const identity = getConversationIdentity();
    if (!identity) return;

    chrome.runtime.sendMessage(
      {
        type: "save-conversation",
        ...identity,
        messages: messagesSnapshot,
      },
      (response: { ok?: boolean; error?: string }) => {
        if (chrome.runtime.lastError) {
          console.warn("[Lenses] Conversation save failed", chrome.runtime.lastError.message);
          return;
        }
        if (response?.error) {
          console.warn("[Lenses] Conversation save failed", response.error);
        }
      }
    );
  }

  function hydrateConversationMessages(messages: ChatMessage[], forceScroll = false) {
    conversation.splice(0);
    messageViews.splice(0);
    nextMessageId = 1;

    for (const message of messages) {
      const conversationIndex = conversation.length;
      const canRetry =
        message.role === "assistant" &&
        conversation.some((candidate) => candidate.role === "user" && candidate.content.trim());
      conversation.push(message);
      if (message.hidden) continue;
      messageViews.push({
        id: nextMessageId++,
        role: message.role,
        content: message.content,
        conversationIndex,
        thinkingText: message.thinkingText,
        activity: message.activity,
        textSegments: message.textSegments,
        meta: message.meta,
        canRetry,
        searches: message.searches,
      });
    }

    renderChatbox(forceScroll);
  }

  function loadConversationMessages(
    focusRef?: string | null,
    options?: { askIfEmpty?: Annotation }
  ) {
    const identity = getConversationIdentity(focusRef);
    if (!identity) return;
    const expectedFocusRef = identity.focusRef;

    chrome.runtime.sendMessage(
      {
        type: "get-conversation",
        ...identity,
      },
      (response?: { messages?: ChatMessage[] }) => {
        if (chrome.runtime.lastError || disposed || !root.isConnected) return;
        if (context.kind === "annotations" && expectedFocusRef !== getFindingConversationRef()) {
          return;
        }

        const messages = response?.messages ?? [];
        if (messages.length > 0) {
          hydrateConversationMessages(messages, true);
          return;
        }

        if (options?.askIfEmpty) {
          askQuestion(buildAnnotationQuestion(options.askIfEmpty), {
            implicit: true,
            targetLensId: options.askIfEmpty.lensId,
          });
        }
      }
    );
  }

  function refreshSavedSelectionsFromStorage() {
    refreshPageSavedSelectionsFromStorage();
  }

  function syncDeleteButtonVisibility() {
    if (!isSelectionMode) return;
    renderChatbox();
  }

  function autoSave() {
    const messagesSnapshot = buildAutoSaveMessagesSnapshot();
    if (!hasPersistableMessages(messagesSnapshot)) return;

    if (context.kind !== "selection") {
      saveConversationMessages(messagesSnapshot);
      return;
    }

    if (autoSavedId) {
      const id = autoSavedId;
      saveConversationMessages(messagesSnapshot);
      updateSavedSelectionLocally(id, messagesSnapshot);
      return;
    }

    if (saveCreateInFlight) {
      saveAgainAfterCreate = true;
      return;
    }

    saveCreateInFlight = true;
    const title = getSavedSelectionTitle(messagesSnapshot);
    chrome.runtime.sendMessage(
      {
        type: "create-saved-selection",
        sourceKey: getCurrentPageSourceKey(),
        sourceKind: getCurrentPageSourceKind(),
        scope: "selection",
        url: window.location.href,
        selectedText: context.selectedText,
        messages: messagesSnapshot,
        title,
        anchorPrefix: savedSelectionAnchor?.prefix,
        anchorSuffix: savedSelectionAnchor?.suffix,
        textStart: savedSelectionAnchor?.textStart,
        textEnd: savedSelectionAnchor?.textEnd,
        pageTitle: document.title,
      },
      (response: { id?: string; error?: string }) => {
        saveCreateInFlight = false;
        if (chrome.runtime.lastError) {
          console.warn("[Lenses] Saved selection create failed", chrome.runtime.lastError.message);
          return;
        }
        if (response?.error) {
          console.warn("[Lenses] Saved selection create failed", response.error);
          return;
        }
        if (response?.id) {
          autoSavedId = response.id;
          syncDeleteButtonVisibility();
          const selection = buildSavedSelectionRecord(response.id, title, messagesSnapshot);
          if (selection) {
            applySavedSelectionLocally(selection);
          }
          refreshSavedSelectionsFromStorage();
          if (saveAgainAfterCreate) {
            saveAgainAfterCreate = false;
            autoSave();
          }
        }
      }
    );
  }

  function setWaiting(value: boolean) {
    waiting = value;
    renderChatbox();
  }

  function ensureFloatingCitationTooltip() {
    if (floatingCitationTooltip) return floatingCitationTooltip;
    const tooltipMount = createLensesShadowMount({
      surface: "citation-tooltip",
      rootClassName: "lenses-floating-citation-tooltip",
      rootTagName: "div",
    });
    const tooltip = tooltipMount.root as HTMLDivElement;
    tooltip.style.display = "none";
    tooltip.dataset.shadowMount = "citation-tooltip";
    floatingCitationTooltip = tooltip;
    floatingCitationTooltipMount = tooltipMount;
    return tooltip;
  }

  function hideFloatingCitationTooltip() {
    activeCitationBadge = null;
    if (!floatingCitationTooltip) return;
    floatingCitationTooltip.style.display = "none";
    floatingCitationTooltip.removeAttribute("data-placement");
  }

  function positionFloatingCitationTooltip(
    tooltip: HTMLDivElement,
    badge: HTMLAnchorElement
  ) {
    const badgeRect = badge.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportMargin = 8;
    const arrowOffset = 10;

    let left = badgeRect.left + badgeRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(
      viewportMargin,
      Math.min(left, window.innerWidth - tooltipRect.width - viewportMargin)
    );

    const spaceAbove = badgeRect.top - viewportMargin - arrowOffset;
    const spaceBelow = window.innerHeight - badgeRect.bottom - viewportMargin - arrowOffset;
    const placement: "top" | "bottom" = spaceAbove >= spaceBelow ? "top" : "bottom";
    let top =
      placement === "top"
        ? badgeRect.top - tooltipRect.height - arrowOffset
        : badgeRect.bottom + arrowOffset;

    top = Math.max(
      viewportMargin,
      Math.min(top, window.innerHeight - tooltipRect.height - viewportMargin)
    );

    tooltip.style.left = String(left) + "px";
    tooltip.style.top = String(top) + "px";
    tooltip.dataset.placement = placement;
  }

  function showFloatingCitationTooltip(badge: HTMLAnchorElement) {
    const inlineTooltip = badge.querySelector(".citation-tooltip");
    if (!(inlineTooltip instanceof HTMLElement)) {
      hideFloatingCitationTooltip();
      return;
    }

    const tooltip = ensureFloatingCitationTooltip();
    tooltip.innerHTML = inlineTooltip.innerHTML;
    tooltip.style.display = "block";
    tooltip.style.visibility = "hidden";
    positionFloatingCitationTooltip(tooltip, badge);
    tooltip.style.visibility = "visible";
    activeCitationBadge = badge;
  }

  function appendMessage(
    role: "user" | "assistant",
    content: string,
    options?: {
      isError?: boolean;
      isImplicit?: boolean;
      thinkingText?: string;
      activity?: ChatActivityItem[];
      textSegments?: StreamTextSegment[];
      meta?: SelectionMessageMeta;
      action?: "api-keys";
      conversationIndex?: number;
      retryTargetLensId?: string;
      retryQuestion?: string;
      canRetry?: boolean;
      searches?: WebSearchEntry[];
    }
  ) {
    messageViews.push({
      id: nextMessageId++,
      role,
      content,
      conversationIndex: options?.conversationIndex,
      isError: options?.isError,
      isImplicit: options?.isImplicit,
      thinkingText: options?.thinkingText,
      activity: options?.activity,
      textSegments: options?.textSegments,
      meta: options?.meta,
      action: options?.action,
      retryTargetLensId: options?.retryTargetLensId,
      retryQuestion: options?.retryQuestion,
      canRetry: options?.canRetry,
      searches: options?.searches,
    });
    renderChatbox();
  }

  function isNearBottom() {
    if (!messagesElement) return true;
    const distance =
      messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight;
    return distance <= AUTO_SCROLL_THRESHOLD_PX;
  }

  function scrollMessagesToBottom(force = false) {
    if (!messagesElement) return;
    if (!force && !shouldAutoScroll) return;
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  // Arm the log's top/bottom fade masks only where content is actually clipped,
  // mirrored onto data attributes the CSS reads (see .lenses-chatbox-messages).
  function syncChatboxFades() {
    if (!messagesElement) return;
    const { top, bottom } = computeScrollOverflow(messagesElement);
    messagesElement.dataset.overflowTop = String(top);
    messagesElement.dataset.overflowBottom = String(bottom);
  }

  function getChatboxSelection() {
    const rootNode = root.getRootNode() as { getSelection?: () => Selection | null };
    return rootNode.getSelection?.() ?? window.getSelection();
  }

  function isNodeInsideMessages(node: Node | null) {
    return !!messagesElement && !!node && (node === messagesElement || messagesElement.contains(node));
  }

  function getVisibleRangeRect(range: Range) {
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    );
    return rects[0] ?? range.getBoundingClientRect();
  }

  function getChatMessageSelectionInfo() {
    if (!messagesElement) return null;

    const selection = getChatboxSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    if (!isNodeInsideMessages(selection.anchorNode) || !isNodeInsideMessages(selection.focusNode)) {
      return null;
    }

    const text = normalizeChatboxInsertedText(selection.toString());
    if (!text) return null;

    const range = selection.getRangeAt(0);
    if (!isNodeInsideMessages(range.commonAncestorContainer)) return null;

    const rect = getVisibleRangeRect(range);
    if (rect.width === 0 && rect.height === 0) return null;
    return { text, rect };
  }

  function hideChatMessageSelectionPrompt() {
    if (!messageSelectionPrompt) return;
    messageSelectionPrompt = null;
    renderChatbox();
  }

  function showChatMessageSelectionPrompt(text: string, rect: DOMRect) {
    const rootRect = root.getBoundingClientRect();
    const rawLeft = rect.left + rect.width / 2 - rootRect.left;
    const maxLeft = Math.max(44, rootRect.width - 44);
    const left = Math.min(Math.max(rawLeft, 44), maxLeft);
    const top = Math.max(36, rect.top - rootRect.top - 6);
    messageSelectionPrompt = { text, left, top };
    renderChatbox();
  }

  function onMessagesScroll() {
    shouldAutoScroll = isNearBottom();
    syncChatboxFades();
    hideChatMessageSelectionPrompt();
    hideFloatingCitationTooltip();
  }

  function onMessagesMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    window.requestAnimationFrame(() => {
      if (disposed || !root.isConnected) return;
      const selectionInfo = getChatMessageSelectionInfo();
      if (!selectionInfo) {
        hideChatMessageSelectionPrompt();
        return;
      }
      showChatMessageSelectionPrompt(selectionInfo.text, selectionInfo.rect);
    });
  }

  function findCitationBadge(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const badge = target.closest("a.citation-badge");
    return badge instanceof HTMLAnchorElement ? badge : null;
  }

  function onMessagesMouseOver(event: ReactMouseEvent<HTMLDivElement>) {
    const badge = findCitationBadge(event.target);
    if (!badge) return;
    if (activeCitationBadge === badge) return;
    showFloatingCitationTooltip(badge);
  }

  function onMessagesMouseOut(event: ReactMouseEvent<HTMLDivElement>) {
    const fromBadge = findCitationBadge(event.target);
    if (!fromBadge) return;
    const toBadge = findCitationBadge(event.relatedTarget);
    if (toBadge && toBadge === fromBadge) return;
    hideFloatingCitationTooltip();
  }

  function onMessagesFocusIn(event: ReactFocusEvent<HTMLDivElement>) {
    const badge = findCitationBadge(event.target);
    if (!badge) return;
    showFloatingCitationTooltip(badge);
  }

  function onMessagesFocusOut(event: ReactFocusEvent<HTMLDivElement>) {
    const fromBadge = findCitationBadge(event.target);
    if (!fromBadge) return;
    const toBadge = findCitationBadge(event.relatedTarget);
    if (toBadge && toBadge === fromBadge) return;
    hideFloatingCitationTooltip();
  }

  function onViewportTooltipRefresh() {
    if (!activeCitationBadge) return;
    if (!activeCitationBadge.isConnected) {
      hideFloatingCitationTooltip();
      return;
    }
    const tooltip = floatingCitationTooltip;
    if (!tooltip || tooltip.style.display === "none") return;
    positionFloatingCitationTooltip(tooltip, activeCitationBadge);
  }

  function disconnectActiveStream() {
    if (!activeStreamPort) return;
    try {
      activeStreamPort.disconnect();
    } catch {
      // no-op
    }
    activeStreamPort = null;
  }

  function syncStreamingView() {
    const hasStreamingContent =
      streamState.thinkingText.trim().length > 0 ||
      streamState.thinkingOpen ||
      streamState.searching ||
      streamState.searches.length > 0 ||
      streamState.activity.length > 0 ||
      streamState.text.trim().length > 0 ||
      streamState.textSegments.length > 0 ||
      !!streamState.meta;
    streamingView = hasStreamingContent
      ? {
          thinkingText: streamState.thinkingText,
          thinkingOpen: streamState.thinkingOpen,
          activity: streamState.activity,
          searching: streamState.searching,
          searches: streamState.searches,
          assistantText: streamState.text,
          textSegments: streamState.textSegments,
          meta: streamState.meta,
        }
      : null;
    renderChatbox();
  }

  function clearStreamingPreview() {
    streamState = { ...streamState, thinkingOpen: false, searching: false };
    streamingView = null;
  }

  function maybeAutoSaveStartedAssistantResponse() {
    if (!isSelectionMode || hasAutoSavedStreamingAssistant) return;
    if (!getStreamingAssistantContent()) return;
    hasAutoSavedStreamingAssistant = true;
    autoSave();
  }

  function finalizeAssistantStream(
    fullText: string,
    textSegments?: StreamTextSegment[],
    meta?: SelectionMessageMeta,
    retry?: { question: string; targetLensId?: string }
  ) {
    clearStreamingPreview();

    const trimmed = fullText.trim();
    if (!trimmed) {
      appendMessage("assistant", "Empty response from assistant.", { isError: true });
      return;
    }

    if (Array.isArray(textSegments) && textSegments.length > 0) {
      streamState = { ...streamState, textSegments };
    }

    const thinkingText = streamState.thinkingText.trim();
    const finalActivity = streamState.activity.length > 0 ? streamState.activity : undefined;
    const finalSearches = streamState.searches.length > 0 ? streamState.searches : undefined;
    const assistantMessage: ChatMessage = { role: "assistant", content: trimmed };
    if (thinkingText) {
      assistantMessage.thinkingText = thinkingText;
    }
    if (finalActivity) {
      assistantMessage.activity = finalActivity;
    }
    if (streamState.textSegments.length > 0) {
      assistantMessage.textSegments = streamState.textSegments;
    }
    if (finalSearches) {
      assistantMessage.searches = finalSearches;
    }
    const finalMeta = meta ?? streamState.meta;
    if (finalMeta) {
      assistantMessage.meta = finalMeta;
    }
    const conversationIndex = conversation.length;
    conversation.push(assistantMessage);
    hideFloatingCitationTooltip();
    appendMessage("assistant", trimmed, {
      thinkingText,
      activity: finalActivity,
      textSegments: streamState.textSegments,
      meta: finalMeta,
      conversationIndex,
      retryTargetLensId: retry?.targetLensId,
      retryQuestion: retry?.question,
      canRetry: true,
      searches: finalSearches,
    });
    autoSave();
  }

  function askQuestion(
    question: string,
    options?: {
      implicit?: boolean;
      targetLensId?: string;
      displayContent?: string;
      hideUserMessage?: boolean;
      recordUserMessage?: boolean;
    }
  ) {
    const trimmed = question.trim();
    if (!trimmed || waiting) return;

    const isImplicit = options?.implicit ?? false;
    const targetLensId = options?.targetLensId;
    const hideUserMessage = options?.hideUserMessage ?? false;
    const recordUserMessage = options?.recordUserMessage ?? true;
    const visibleContent = options?.displayContent?.trim() || trimmed;
    const shouldRenderUserMessage = !hideUserMessage && (!isImplicit || debugModeEnabled);
    const priorConversation = [...conversation];
    const userConversationIndex = recordUserMessage ? conversation.length : undefined;
    shouldAutoScroll = isNearBottom();

    logContentStreamDebug("ask_question_start", {
      targetLensId,
      isImplicit,
      questionLength: trimmed.length,
      priorConversationCount: priorConversation.length,
    });

    if (shouldRenderUserMessage) {
      appendMessage(
        "user",
        visibleContent,
        isImplicit
          ? {
              isImplicit: true,
              conversationIndex: userConversationIndex,
              retryTargetLensId: targetLensId,
            }
          : { conversationIndex: userConversationIndex, retryTargetLensId: targetLensId }
      );
    }
    if (recordUserMessage) {
      conversation.push({
        role: "user",
        content: visibleContent,
        hidden: shouldRenderUserMessage ? undefined : true,
      });
      autoSave();
    }

    disconnectActiveStream();
    streamState = createChatStreamState();
    streamingView = null;
    hasAutoSavedStreamingAssistant = false;

    setWaiting(true);

    const port = chrome.runtime.connect({ name: "lenses-finding-stream" });
    activeStreamPort = port;

    logContentStreamDebug("port_connected", { name: port.name });

    const finishWithError = (message: string) => {
      clearStreamingPreview();
      appendMessage(
        "assistant",
        isApiKeyError(message) ? "Add an API key to use chat on this page." : message,
        {
          isError: true,
          action: isApiKeyError(message) ? "api-keys" : undefined,
          retryTargetLensId: targetLensId,
          retryQuestion: trimmed,
          canRetry: true,
        }
      );
      if (activeStreamPort === port) {
        disconnectActiveStream();
      }
      setWaiting(false);
    };

    port.onMessage.addListener((event: AskFindingStreamPortEvent) => {
      if (!root.isConnected || activeStreamPort !== port) return;

      logContentStreamDebug("port_event", {
        type: event.type,
        chunkLength: event.type === "chunk" ? event.text.length : undefined,
        segmentCount:
          event.type === "chunk" || event.type === "citations" || event.type === "done"
            ? event.textSegments?.length ?? 0
            : undefined,
        meta: event.type === "meta" || event.type === "done" ? event.meta : undefined,
      });

      if (
        event.type === "chunk" ||
        event.type === "thinking" ||
        event.type === "searching" ||
        event.type === "citations" ||
        event.type === "meta"
      ) {
        streamState = applyChatStreamEvent(streamState, event);
        syncStreamingView();
        if (event.type === "chunk" || event.type === "citations") {
          maybeAutoSaveStartedAssistantResponse();
        }
        return;
      }

      if (event.type === "done") {
        logContentStreamDebug("stream_done", {
          fullTextLength: event.fullText.length,
          finalSegmentCount: event.textSegments?.length ?? 0,
        });
        finalizeAssistantStream(event.fullText, event.textSegments, event.meta, {
          question: trimmed,
          targetLensId,
        });
        if (activeStreamPort === port) {
          disconnectActiveStream();
        }
        setWaiting(false);
        inputElement?.focus();
        scrollMessagesToBottom();
        return;
      }

      if (event.type === "error") {
        logContentStreamDebug("stream_error", {
          error: event.error,
        });
        finishWithError(event.error || "Could not answer right now.");
      }
    });

    port.onDisconnect.addListener(() => {
      logContentStreamDebug("port_disconnected", {
        waiting,
      });
      if (!root.isConnected || activeStreamPort !== port || !waiting) return;
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError?.message) {
        finishWithError(runtimeError.message);
        return;
      }
      setWaiting(false);
    });

    const request: AskFindingStreamPortRequest = {
      action: "ask-finding-stream",
      question: trimmed,
      sourceUrl: window.location.href,
      targetLensId,
      conversation: priorConversation,
      annotations: getAnnotationContext(),
      ...(selectionPayload ?? {}),
    };

    port.postMessage(request);
  }

  function openApiKeySettings() {
    chrome.runtime.sendMessage({ action: "openApiKeySettings" });
  }

  function handleCopyMessage(message: ChatboxMessageView) {
    const text = message.content.trim();
    if (!text) return;
    copyTextToClipboard(message.content).catch((error) => {
      console.warn("[Lenses] Could not copy chat message", error);
    });
  }

  function handleRetryMessage(message: ChatboxMessageView) {
    if (message.role !== "assistant") return;
    const retryTarget = findRetryTarget(message);
    if (!retryTarget) {
      const conversationRetryTarget = findConversationRetryTarget(message);
      const hiddenQuestion =
        conversationRetryTarget?.message.content.trim() ?? message.retryQuestion?.trim();
      if (!hiddenQuestion) return;

      const messageIndex = findAssistantMessageIndex(message);
      if (messageIndex < 0) return;

      truncateChatAtMessage(message, messageIndex, conversationRetryTarget?.conversationIndex);
      askQuestion(hiddenQuestion, {
        targetLensId: message.retryTargetLensId ?? selectedAnnotation?.lensId,
        hideUserMessage: true,
      });
      return;
    }

    truncateChatAtMessage(retryTarget.message, retryTarget.index);
    askQuestion(retryTarget.message.content, {
      targetLensId: retryTarget.message.retryTargetLensId ?? selectedAnnotation?.lensId,
    });
  }

  function handleRewindMessage(message: ChatboxMessageView) {
    if (message.role !== "user") return;

    const messageIndex = messageViews.findIndex(
      (candidate) => candidate.id === message.id && candidate.role === "user"
    );
    if (messageIndex < 0) return;

    truncateChatAtMessage(message, messageIndex);

    requestAnimationFrame(() => {
      if (!root.isConnected || !inputElement) return;
      inputElement.value = message.content;
      inputElement.focus();
      inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
    });
  }

  function insertTextAtCursor(text: string) {
    const insertText = normalizeChatboxInsertedText(text);
    if (!insertText || disposed || !root.isConnected || !inputElement) return false;

    const input = inputElement;
    const value = input.value;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    input.value = value.slice(0, start) + insertText + value.slice(end);

    const nextCursor = start + insertText.length;
    input.focus();
    try {
      input.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // Some pages/extensions can temporarily make the input non-selectable.
    }
    return true;
  }

  function insertSelectedChatMessageText() {
    const text = messageSelectionPrompt?.text;
    if (!text) return;
    if (insertTextAtCursor(text)) {
      messageSelectionPrompt = null;
      const selection = getChatboxSelection();
      selection?.removeAllRanges();
      renderChatbox();
    }
  }

  function findRetryTarget(message: ChatboxMessageView) {
    const messageIndex = findAssistantMessageIndex(message);
    if (messageIndex < 0) return null;

    for (let index = messageIndex - 1; index >= 0; index--) {
      const candidate = messageViews[index];
      if (candidate?.role === "user" && candidate.content.trim()) {
        return { message: candidate, index };
      }
    }

    return null;
  }

  function findConversationRetryTarget(message: ChatboxMessageView) {
    if (typeof message.conversationIndex !== "number") return null;

    for (let index = message.conversationIndex - 1; index >= 0; index--) {
      const candidate = conversation[index];
      if (candidate?.role === "user" && candidate.content.trim()) {
        return { message: candidate, conversationIndex: index };
      }
    }

    return null;
  }

  function findAssistantMessageIndex(message: ChatboxMessageView) {
    return messageViews.findIndex(
      (candidate) => candidate.id === message.id && candidate.role === "assistant"
    );
  }

  function truncateChatAtMessage(
    message: ChatboxMessageView,
    messageIndex: number,
    conversationIndexOverride?: number
  ) {
    disconnectActiveStream();
    waiting = false;
    streamState = createChatStreamState();
    streamingView = null;
    hideFloatingCitationTooltip();

    messageViews.splice(messageIndex);
    if (typeof conversationIndexOverride === "number") {
      conversation.splice(conversationIndexOverride);
    } else if (typeof message.conversationIndex === "number") {
      conversation.splice(message.conversationIndex);
    } else {
      conversation.splice(countConversationMessagesBefore(messageIndex));
    }

    autoSave();
    renderChatbox(true);
  }

  function countConversationMessagesBefore(messageViewIndex: number) {
    const indexedBefore = messageViews
      .slice(0, messageViewIndex)
      .map((message) => message.conversationIndex)
      .filter((index): index is number => typeof index === "number");
    if (indexedBefore.length > 0) return Math.max(...indexedBefore) + 1;

    return messageViews
      .slice(0, messageViewIndex)
      .filter((message) => message.role === "user" || !message.isError).length;
  }

  async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the selection-based copy path for older/fussy pages.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Could not copy message.");
  }

  function isApiKeyError(message: unknown): boolean {
    if (typeof message !== "string") return false;
    const normalized = message.toLowerCase();
    return normalized.includes("api key") || normalized.includes("key not configured");
  }

  function handleAnnotationSelect(id: string) {
    const annotation = currentAnnotations.find((candidate) => candidate.id === id);
    if (!annotation) return;
    selectedAnnotation = annotation;
    selectedAnnotationId = annotation.id;
    renderChatbox();
    loadConversationMessages(annotation.id, { askIfEmpty: annotation });
  }

  function handleRawResults() {
    const target = selectedAnnotation ?? currentAnnotations[0];
    if (!target) return;
    appendMessage("assistant", buildDebugAnnotationMarkdown(target));
  }

  function handleSubmit(value: string) {
    askQuestion(value, { targetLensId: selectedAnnotation?.lensId });
  }

  function handleDeleteSavedChat() {
    const id = autoSavedId;
    if (!id) return;
    deleteSavedSelection(id);
    closeActiveChatbox();
  }

  function handleRemoveAnnotation() {
    if (isSelectionMode) return;
    const target = selectedAnnotation ?? currentAnnotations[0];
    if (!target) return;

    clearPageLensDockFindingResult(target.id);
    currentAnnotations = currentAnnotations.filter((annotation) => annotation.id !== target.id);

    if (currentAnnotations.length === 0) {
      closeActiveChatbox();
      return;
    }

    const nextAnnotation =
      currentAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ??
      currentAnnotations[0];
    selectedAnnotation = nextAnnotation;
    selectedAnnotationId = nextAnnotation.id;
    renderChatbox();
  }

  function onOutsideClick(event: MouseEvent) {
    const target = event.target;
    const path = event.composedPath();
    if (!path.includes(root) && !isInsideLensesUi(target)) {
      closeActiveChatbox();
    }
  }

  function onEscape(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeActiveChatbox();
    }
  }

  function onViewportChange() {
    if (root.isConnected) {
      if (messageSelectionPrompt) {
        messageSelectionPrompt = null;
        renderChatbox();
      }
      positionChatbox(anchor, root);
    }
  }

  renderChatbox(true);
  positionChatbox(anchor, root);

  if (context.kind === "selection" && context.initialMessages?.length) {
    hydrateConversationMessages(context.initialMessages, true);
  }

  if (context.kind === "annotations") {
    loadConversationMessages(getFindingConversationRef());
  }

  if (isSelectionMode) {
    requestAnimationFrame(() => {
      if (root.isConnected) inputElement?.focus();
    });
  }

  window.addEventListener("scroll", onViewportTooltipRefresh, true);
  window.addEventListener("resize", onViewportTooltipRefresh);
  const outsideClickTimer = window.setTimeout(
    () => document.addEventListener("click", onOutsideClick),
    0
  );
  document.addEventListener("keydown", onEscape);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);

  activeChatbox = {
    root,
    mount: chatboxMount,
    getSavedId: () => autoSavedId,
    teardown: () => {
      disposed = true;
      disconnectActiveStream();
      hideFloatingCitationTooltip();
      floatingCitationTooltipMount?.remove();
      floatingCitationTooltipMount = null;
      floatingCitationTooltip = null;
      window.clearTimeout(outsideClickTimer);
      document.removeEventListener("click", onOutsideClick);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", onViewportTooltipRefresh, true);
      window.removeEventListener("resize", onViewportTooltipRefresh);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      chatboxRoot.unmount();
    },
  };

  if (context.kind === "selection" && context.initialQuestion) {
    window.setTimeout(() => {
      if (!root.isConnected) return;
      askQuestion(context.initialQuestion ?? "", {
        hideUserMessage: true,
      });
    }, 0);
  }
}

function closeActiveChatbox() {
  if (!activeChatbox) return;
  activeChatbox.teardown();
  activeChatbox.mount.remove();
  activeChatbox = null;
}

function clearSavedHighlights() {
  clearSavedHighlightVisualRanges();
  if (savedHighlightRerenderTimer !== null) {
    window.clearTimeout(savedHighlightRerenderTimer);
    savedHighlightRerenderTimer = null;
  }
  for (const el of document.querySelectorAll(`.${SAVED_HIGHLIGHT_CLASS}`)) {
    const parent = el.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(el.getAttribute("data-saved-text-segment") ?? ""), el);
    parent.normalize();
  }
  removeOrphanedPanel();
}

function renderSavedHighlights() {
  clearSavedHighlights();
  if (activeSavedSelections.length === 0) return;

  const pageIndex = buildPageTextIndex();
  const orphaned: SavedSelection[] = [];
  const matches: SavedSelectionMatch[] = [];

  for (const selection of activeSavedSelections) {
    const anchor = savedSelectionToTextAnchor(selection);
    const match = findTextAnchor(pageIndex.text, anchor);
    if (!match) {
      orphaned.push(selection);
      continue;
    }

    matches.push({
      selection,
      start: match.start,
      end: match.end,
      changed: match.kind === "context",
    });
  }

  renderSavedSelectionMatches(pageIndex, removeOverlappingSavedMatches(matches));

  if (orphaned.length > 0) {
    renderOrphanedPanel(orphaned);
  }
}

function buildSavedSelectionAnchor(selectedText: string): TextAnchor {
  return buildTextAnchor(buildPageTextIndex().text, selectedText);
}

function savedSelectionToTextAnchor(selection: SavedSelection): TextAnchor {
  return {
    selectedText: selection.selectedText,
    prefix: selection.anchorPrefix,
    suffix: selection.anchorSuffix,
    textStart: selection.textStart,
    textEnd: selection.textEnd,
  };
}

const TEXT_INDEX_BLOCK_BOUNDARY_SELECTOR = [
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
].join(",");

function buildPageTextIndex(): PageTextIndex {
  const items: Array<{ node: Text; text: string; startsNewTextBlock: boolean }> = [];
  let previousTextNode: Text | null = null;
  for (const textNode of collectTextNodes()) {
    items.push({
      node: textNode,
      text: textNode.textContent ?? "",
      startsNewTextBlock: previousTextNode
        ? startsNewTextBlock(previousTextNode, textNode)
        : false,
    });
    previousTextNode = textNode;
  }

  const index = buildTextIndex(items);
  return {
    text: index.text,
    pieces: index.pieces.map((piece) => ({
      textNode: piece.node,
      start: piece.start,
      end: piece.end,
    })),
  };
}

function startsNewTextBlock(previousTextNode: Text, currentTextNode: Text) {
  const previousBlock = closestTextIndexBlock(previousTextNode);
  const currentBlock = closestTextIndexBlock(currentTextNode);

  if (previousBlock && currentBlock && previousBlock !== currentBlock) {
    return true;
  }

  return hasTextIndexLineBreakBetween(previousTextNode, currentTextNode);
}

function closestTextIndexBlock(textNode: Text) {
  return textNode.parentElement?.closest(TEXT_INDEX_BLOCK_BOUNDARY_SELECTOR) ?? null;
}

function hasTextIndexLineBreakBetween(previousTextNode: Text, currentTextNode: Text) {
  const range = document.createRange();
  try {
    range.setStartAfter(previousTextNode);
    range.setEndBefore(currentTextNode);
    const fragment = range.cloneContents();
    return !!fragment.querySelector(`br,${TEXT_INDEX_BLOCK_BOUNDARY_SELECTOR}`);
  } catch {
    return false;
  } finally {
    range.detach();
  }
}

function removeOverlappingSavedMatches(matches: SavedSelectionMatch[]): SavedSelectionMatch[] {
  const accepted: SavedSelectionMatch[] = [];
  for (const match of [...matches].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (match.end <= match.start) continue;
    const overlaps = accepted.some(
      (existing) => match.start < existing.end && match.end > existing.start
    );
    if (!overlaps) accepted.push(match);
  }
  return accepted;
}

function renderSavedSelectionMatches(pageIndex: PageTextIndex, matches: SavedSelectionMatch[]) {
  const matchesByNode = new Map<Text, SavedSelectionNodeMatch[]>();
  const visualRanges: SavedSelectionVisualRange[] = [];

  for (const match of matches) {
    let firstSegment = true;
    for (const piece of pageIndex.pieces) {
      if (piece.end <= match.start || piece.start >= match.end) continue;

      const startOffset = Math.max(0, match.start - piece.start);
      const endOffset = Math.min(piece.end - piece.start, match.end - piece.start);
      if (endOffset <= startOffset) continue;

      const existing = matchesByNode.get(piece.textNode) ?? [];
      existing.push({
        selection: match.selection,
        startOffset,
        endOffset,
        changed: match.changed,
        isFirstSegment: firstSegment,
      });
      matchesByNode.set(piece.textNode, existing);
      firstSegment = false;
    }
  }

  for (const [textNode, nodeMatches] of matchesByNode) {
    renderSavedSelectionNode(textNode, nodeMatches, visualRanges);
  }

  applySavedHighlightVisualRanges(visualRanges);
}

function renderSavedSelectionNode(
  textNode: Text,
  matches: SavedSelectionNodeMatch[],
  visualRanges: SavedSelectionVisualRange[]
) {
  const content = textNode.textContent ?? "";
  const parent = textNode.parentNode;
  if (!parent) return;

  const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of sorted) {
    if (match.startOffset > cursor) {
      fragment.appendChild(document.createTextNode(content.slice(cursor, match.startOffset)));
    }

    const segmentText = content.slice(match.startOffset, match.endOffset);
    const highlight = document.createElement("mark");
    highlight.className = SAVED_HIGHLIGHT_CLASS;
    if (match.changed) {
      highlight.classList.add("lenses-saved-highlight--changed");
    }
    const highlightText = document.createTextNode(segmentText);
    highlight.appendChild(highlightText);
    highlight.title = match.changed
      ? `Saved chat reattached near changed text: ${match.selection.title}`
      : `Saved chat: ${match.selection.title}`;
    highlight.dataset.savedId = match.selection.id;
    highlight.setAttribute("data-saved-text-segment", segmentText);
    highlight.addEventListener("mouseenter", () => {
      setSavedSelectionHighlightActive(match.selection.id, true);
    });
    highlight.addEventListener("mouseleave", (event) => {
      if (isSavedSelectionHoverTarget(event.relatedTarget, match.selection.id)) return;
      setSavedSelectionHighlightActive(match.selection.id, false);
    });
    highlight.addEventListener("click", (event) => {
      event.stopPropagation();
      openSavedChatbox(resolveLatestSavedSelection(match.selection), highlight);
    });

    if (match.isFirstSegment) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "lenses-saved-highlight-delete";
      deleteBtn.setAttribute("aria-label", "Delete saved chat");
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSavedSelection(match.selection.id);
      });
      highlight.appendChild(deleteBtn);
    }

    fragment.appendChild(highlight);
    visualRanges.push({
      textNode: highlightText,
      selection: match.selection,
      changed: match.changed,
    });
    cursor = match.endOffset;
  }

  if (cursor < content.length) {
    fragment.appendChild(document.createTextNode(content.slice(cursor)));
  }

  parent.replaceChild(fragment, textNode);
}

function clearSavedHighlightVisualRanges() {
  document.documentElement.classList.remove(SAVED_HIGHLIGHT_OVERLAY_ACTIVE_CLASS);
  savedHighlightOverlay?.remove();
  savedHighlightOverlay = null;

  const registry = getCssHighlightRegistry();
  registry?.delete(SAVED_CSS_HIGHLIGHT_NAME);
  registry?.delete(SAVED_CHANGED_CSS_HIGHLIGHT_NAME);
}

function applySavedHighlightVisualRanges(visualRanges: SavedSelectionVisualRange[]) {
  const rects = collectSavedHighlightRects(visualRanges);
  if (rects.length === 0) {
    document.documentElement.classList.remove(SAVED_HIGHLIGHT_OVERLAY_ACTIVE_CLASS);
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = SAVED_HIGHLIGHT_OVERLAY_CLASS;

  for (const rect of mergeSavedHighlightRects(rects)) {
    const rectEl = document.createElement("div");
    rectEl.className = SAVED_HIGHLIGHT_OVERLAY_RECT_CLASS;
    if (rect.changed) {
      rectEl.classList.add("lenses-saved-highlight-overlay-rect--changed");
    }
    rectEl.dataset.savedId = rect.selection.id;
    rectEl.title = rect.changed
      ? `Saved chat reattached near changed text: ${rect.selection.title}`
      : `Saved chat: ${rect.selection.title}`;
    rectEl.style.left = `${rect.left + window.scrollX}px`;
    rectEl.style.top = `${rect.top + window.scrollY}px`;
    rectEl.style.width = `${rect.right - rect.left}px`;
    rectEl.style.height = `${rect.bottom - rect.top}px`;
    rectEl.addEventListener("mouseenter", () => {
      setSavedSelectionHighlightActive(rect.selection.id, true);
    });
    rectEl.addEventListener("mouseleave", (event) => {
      if (isSavedSelectionHoverTarget(event.relatedTarget, rect.selection.id)) return;
      setSavedSelectionHighlightActive(rect.selection.id, false);
    });
    rectEl.addEventListener("click", (event) => {
      event.stopPropagation();
      openSavedChatbox(resolveLatestSavedSelection(rect.selection), rectEl);
    });
    overlay.appendChild(rectEl);
  }

  document.body.appendChild(overlay);
  savedHighlightOverlay = overlay;
  document.documentElement.classList.add(SAVED_HIGHLIGHT_OVERLAY_ACTIVE_CLASS);
}

function collectSavedHighlightRects(visualRanges: SavedSelectionVisualRange[]) {
  const rects: SavedSelectionVisualRect[] = [];

  for (const visualRange of visualRanges) {
    if (!visualRange.textNode.isConnected || visualRange.textNode.data.length === 0) continue;

    const range = document.createRange();
    range.setStart(visualRange.textNode, 0);
    range.setEnd(visualRange.textNode, visualRange.textNode.data.length);

    const lineHeight = getTextNodeLineHeight(visualRange.textNode);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const height = Math.max(rect.height, lineHeight);
      const verticalInset = Math.max(0, (height - rect.height) / 2);
      rects.push({
        left: rect.left,
        top: rect.top - verticalInset,
        right: rect.right,
        bottom: rect.bottom + verticalInset,
        selection: visualRange.selection,
        changed: visualRange.changed,
      });
    }

    range.detach();
  }

  return rects;
}

function mergeSavedHighlightRects(rects: SavedSelectionVisualRect[]) {
  const merged: SavedSelectionVisualRect[] = [];
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);

  for (const rect of sorted) {
    const existing = merged.find(
      (candidate) => {
        const candidateCenterY = (candidate.top + candidate.bottom) / 2;
        const rectCenterY = (rect.top + rect.bottom) / 2;
        const lineTolerance = Math.max(
          2,
          Math.min(candidate.bottom - candidate.top, rect.bottom - rect.top) * 0.25
        );
        return (
          candidate.changed === rect.changed &&
          candidate.selection.id === rect.selection.id &&
          Math.abs(candidateCenterY - rectCenterY) <= lineTolerance &&
          rect.left <= candidate.right + 4
        );
      }
    );

    if (!existing) {
      merged.push({ ...rect });
      continue;
    }

    existing.left = Math.min(existing.left, rect.left);
    existing.top = Math.min(existing.top, rect.top);
    existing.right = Math.max(existing.right, rect.right);
    existing.bottom = Math.max(existing.bottom, rect.bottom);
  }

  return merged;
}

function getTextNodeLineHeight(textNode: Text) {
  const parent = textNode.parentElement;
  if (!parent) return 0;

  const style = window.getComputedStyle(parent);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 0;
}

function getCssHighlightRegistry(): CssHighlightRegistry | null {
  if (typeof CSS === "undefined") return null;
  return (CSS as typeof CSS & { highlights?: CssHighlightRegistry }).highlights ?? null;
}

function scheduleSavedHighlightsRerender() {
  if (activeSavedSelections.length === 0) return;
  if (savedHighlightRerenderTimer !== null) {
    window.clearTimeout(savedHighlightRerenderTimer);
  }

  savedHighlightRerenderTimer = window.setTimeout(() => {
    savedHighlightRerenderTimer = null;
    renderSavedHighlights();
  }, 120);
}

function isSavedSelectionHoverTarget(target: EventTarget | null, savedId: string) {
  if (!(target instanceof Element)) return false;
  const savedTarget = target.closest<HTMLElement>(
    `mark.${SAVED_HIGHLIGHT_CLASS}[data-saved-id], .${SAVED_HIGHLIGHT_OVERLAY_RECT_CLASS}[data-saved-id]`
  );
  return savedTarget?.dataset.savedId === savedId;
}

function setSavedSelectionHighlightActive(savedId: string, active: boolean) {
  for (const highlight of document.querySelectorAll<HTMLElement>(
    `mark.${SAVED_HIGHLIGHT_CLASS}[data-saved-id]`
  )) {
    if (highlight.dataset.savedId === savedId) {
      highlight.classList.toggle("lenses-saved-highlight--active", active);
    }
  }
}

function resolveLatestSavedSelection(selection: SavedSelection) {
  return activeSavedSelections.find((saved) => saved.id === selection.id) ?? selection;
}

function removeOrphanedPanel() {
  orphanedPanelRoot?.unmount();
  orphanedPanelRoot = null;
  orphanedPanelMount?.remove();
  orphanedPanelMount = null;
  orphanedPanel = null;
}

function renderOrphanedPanel(orphaned: SavedSelection[]) {
  removeOrphanedPanel();

  orphanedPanelMount = createLensesShadowMount({
    surface: "orphaned-panel",
    rootClassName: "lenses-orphaned-panel",
    rootTagName: "div",
  });
  const panel = orphanedPanelMount.root;
  orphanedPanel = panel;
  orphanedPanelRoot = createRoot(panel);
  orphanedPanelRoot.render(
    createElement(OrphanedSavedChatsPanel, {
      items: orphaned.map((selection) => ({
        id: selection.id,
        title: selection.title,
        snippet: formatSelectionSnippet(selection.selectedText),
      })),
      onOpen: (id: string) => {
        const selection = activeSavedSelections.find((saved) => saved.id === id);
        if (!selection) return;
        const anchor = panel;
        removeOrphanedPanel();
        openSavedChatbox(resolveLatestSavedSelection(selection), anchor);
      },
      onDelete: deleteSavedSelection,
    })
  );
}

function openSavedChatbox(selection: SavedSelection, anchor: HTMLElement) {
  openChatSurface(anchor, {
    kind: "selection",
    selectedText: selection.selectedText,
    pageContext: getPageText(),
    initialMessages: selection.messages,
    savedId: selection.id,
  });
}

function deleteSavedSelection(id: string) {
  chrome.runtime.sendMessage({ type: "delete-saved-selection", id }, () => {
    if (chrome.runtime.lastError) return;
    activeSavedSelections = activeSavedSelections.filter((s) => s.id !== id);
    renderSavedHighlights();
    if (activeChatbox?.getSavedId() === id) {
      closeActiveChatbox();
    }
  });
}

// === Selection-triggered chat ============================================

interface PageTextIndexPiece {
  textNode: Text;
  start: number;
  end: number;
}

interface PageTextIndex {
  text: string;
  pieces: PageTextIndexPiece[];
}

interface SavedSelectionMatch {
  selection: SavedSelection;
  start: number;
  end: number;
  changed: boolean;
}

interface SavedSelectionNodeMatch {
  selection: SavedSelection;
  startOffset: number;
  endOffset: number;
  changed: boolean;
  isFirstSegment: boolean;
}

interface SavedSelectionVisualRange {
  textNode: Text;
  selection: SavedSelection;
  changed: boolean;
}

interface SavedSelectionVisualRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  selection: SavedSelection;
  changed: boolean;
}

interface CssHighlightRegistry {
  delete(name: string): boolean;
}

function isInsideLensesUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    `.${LENSES_SHADOW_HOST_CLASS}, .${CHATBOX_CLASS}, .${SELECTION_TRIGGER_CLASS}, .${SOURCE_CALLOUT_STACK_CLASS}, .${PAGE_LENS_DOCK_ROOT_CLASS}, .lenses-floating-citation-tooltip`
  );
}

// Theme the injected Lenses UI (chatbox, selection menu, source callouts) to
// match the user's chosen appearance. A namespaced attribute keeps us from
// clobbering a host page that uses `data-theme` for its own styling.
installDevContextReloadChecks();

initTheme({
  attribute: "data-lenses-theme",
  onChange: (_preference, effectiveTheme) => setLensesShadowTheme(effectiveTheme),
});

// Cache the selection-popup settings so the synchronous mouseup/keydown
// handlers can gate without awaiting storage on every release. Defaults match
// the legacy behavior (show everywhere, immediately) until the first read.
let selectionTriggerSettings = defaultSelectionTriggerSettings();

void loadSelectionTriggerSettings()
  .then((settings) => {
    selectionTriggerSettings = settings;
  })
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!SELECTION_TRIGGER_STORAGE_KEYS.some((key) => key in changes)) return;
  void loadSelectionTriggerSettings()
    .then((settings) => {
      selectionTriggerSettings = settings;
    })
    .catch(() => {});
});

const selectionTriggerController = createSelectionTriggerController({
  getPageText,
  isInsideLensesUi,
  openChatbox: openChatSurface,
  getSettings: () => selectionTriggerSettings,
});

let pageLensDockController: PageLensDockController | null = null;

function mountManagedPageLensDock() {
  pageLensDockController = mountPageLensDock({
    getLensState: getPageLensDockLensState,
    onLensDisplayModeChange: setPageLensDockLensDisplayMode,
    onLensResultsClear: clearPageLensDockLensResults,
    onLensVisibilityChange: setPageLensDockLensVisibility,
    subscribeToLensState: subscribeToPageLensDockState,
    onTurnedOff: () => {
      showPageDockUndoToast({
        message: "Lenses page dock turned off.",
        actionLabel: "Undo",
        onAction: () => {
          void setPageLensDockEnabled(true);
        },
      });
    },
  });
}

// Re-create the dock from scratch whenever a setting that governs its visibility
// changes, so toggling it from the popup, the keyboard command, the context
// menu, or the undo toast takes effect without a page reload. mountPageLensDock
// re-checks visibility and self-destroys when the dock should stay hidden.
function syncPageLensDock() {
  pageLensDockController?.destroy();
  pageLensDockController = null;
  mountManagedPageLensDock();
}

mountManagedPageLensDock();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!PAGE_DOCK_SETTINGS_KEYS.some((key) => key in changes)) return;
  const enabledChange = changes[PAGE_DOCK_ENABLED_KEY];
  // The toast invites the user to re-enable; if the dock comes back on by any
  // route, the invitation is stale, so clear it.
  if (enabledChange && pageDockEnabledFromStorage({ [PAGE_DOCK_ENABLED_KEY]: enabledChange.newValue })) {
    dismissPageDockUndoToast();
  }
  syncPageLensDock();
});

window.setTimeout(restoreStoredPageLensResults, document.readyState === "complete" ? 150 : 600);

function hideSelectionTrigger() {
  selectionTriggerController.hide();
}

document.addEventListener("selectionchange", () => {
  selectionTriggerController.markSelectionDirty();
});

document.addEventListener("keydown", selectionTriggerController.handleKeydown);
document.addEventListener("mouseup", selectionTriggerController.handleSelectionRelease);
document.addEventListener("keyup", selectionTriggerController.handleSelectionRelease);
document.addEventListener("mousedown", selectionTriggerController.handleOutsideMouseDown);

window.addEventListener("scroll", hideSelectionTrigger, true);
window.addEventListener("resize", hideSelectionTrigger);
window.addEventListener("resize", scheduleSavedHighlightsRerender);
window.addEventListener("load", scheduleSavedHighlightsRerender);

// On load, fetch any saved selection chats for this page.
refreshPageSavedSelectionsFromStorage({ replace: true });
