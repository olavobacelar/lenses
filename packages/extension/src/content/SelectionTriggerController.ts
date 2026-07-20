import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  computeSelectionTriggerPosition,
  formatSelectionSnippet,
  isSelectionLongEnough,
} from "./selection-helpers.js";
import { SelectionTriggerContent } from "./SelectionTrigger.js";
import {
  createLensesShadowMount,
  type LensesShadowMount,
} from "./shadow-ui.js";
import {
  parseSelectionTriggerSettings,
  resolveSelectionTriggerStyle,
  selectionTriggerMatchesUrl,
  type SelectionTriggerSettings,
} from "../lib/selection-trigger-settings.js";
import type { ChatContext, SelectionChatMode } from "./types.js";

const SELECTION_TRIGGER_CLASS = "lenses-selection-trigger";

type SelectionActionIconName = SelectionChatMode;

interface SelectionInfo {
  rect: DOMRect;
  text: string;
}

/** Maps physical keys to selection actions for manual-mode (⌥ + key) shortcuts. */
const MANUAL_SHORTCUT_BY_CODE: Record<string, SelectionChatMode> = {
  KeyS: "summarize",
  KeyA: "ask",
  KeyE: "explain",
  KeyT: "truth",
};

/** Reads the Alt/Option modifier from a mouseup (MouseEvent) or keyup (KeyboardEvent). */
function eventHasAltModifier(event: Event): boolean {
  return "altKey" in event && (event as MouseEvent | KeyboardEvent).altKey === true;
}

interface ActiveSelectionTrigger {
  root: HTMLElement;
  mount: LensesShadowMount;
  reactRoot: Root;
  rect: DOMRect;
  text: string;
  disabled: boolean;
}

export interface SelectionTriggerController {
  hide: () => void;
  handleKeydown: (event: KeyboardEvent) => void;
  handleSelectionRelease: (event: Event) => void;
  handleOutsideMouseDown: (event: MouseEvent) => void;
  markSelectionDirty: () => void;
}

export function createSelectionTriggerController({
  getPageText,
  isInsideLensesUi,
  openChatbox,
  getSettings = () => parseSelectionTriggerSettings({}),
  getUrl = () => window.location.href,
}: {
  getPageText: () => string;
  isInsideLensesUi: (target: EventTarget | null) => boolean;
  openChatbox: (anchor: HTMLElement, context: ChatContext) => void;
  getSettings?: () => SelectionTriggerSettings;
  getUrl?: () => string;
}): SelectionTriggerController {
  let activeSelectionTrigger: ActiveSelectionTrigger | null = null;
  let selectionDirty = false;

  function isSelectionTriggerAllowedHere(): boolean {
    return selectionTriggerMatchesUrl(getSettings(), getUrl());
  }

  function getCurrentSelectionInfo(): { rect: DOMRect; text: string } | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString();
    if (!isSelectionLongEnough(text)) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { rect, text: text.trim() };
  }

  function positionSelectionTrigger(root: HTMLElement, rect: DOMRect) {
    const width = root.offsetWidth || 260;
    const height = root.offsetHeight || 120;
    const pos = computeSelectionTriggerPosition(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      width,
      height
    );
    root.style.position = "fixed";
    root.style.left = `${pos.left}px`;
    root.style.top = `${pos.top}px`;
    root.style.zIndex = "2147483647";
    root.dataset.placement = pos.placement;
  }

  function renderActiveSelectionTrigger() {
    const trigger = activeSelectionTrigger;
    if (!trigger) return;

    trigger.reactRoot.render(
      createElement(SelectionTriggerContent, {
        disabled: trigger.disabled,
        onPrimaryAction: runPrimarySelectionAction,
      })
    );
    positionSelectionTrigger(trigger.root, trigger.rect);
    window.requestAnimationFrame(() => {
      if (activeSelectionTrigger === trigger) {
        positionSelectionTrigger(trigger.root, trigger.rect);
      }
    });
  }

  function runPrimarySelectionAction(mode: SelectionActionIconName) {
    if (mode === "summarize") {
      openSelectionSummaryFromTrigger();
    } else if (mode === "truth") {
      openSelectionTruthFromTrigger();
    } else if (mode === "explain") {
      openSelectionExplanationFromTrigger();
    } else {
      openSelectionAskFromTrigger();
    }
  }

  function buildSelectionExplanationQuestion(selectedText: string) {
    const snippet = formatSelectionSnippet(selectedText);
    return (
      `Give a short explanation of ${snippet} in the context of this page. ` +
      "Use 1 to 3 sentences. Explain what it means here, not every possible meaning. " +
      "If the page context is not enough to disambiguate it, use web search to identify the likely reference and cite the source inline."
    );
  }

  function buildSelectionTruthQuestion(selectedText: string) {
    const snippet = formatSelectionSnippet(selectedText);
    return (
      `Is this true: ${snippet}? ` +
      "Check the selected claim against the page context and, when needed, the web. " +
      "The verdict is rendered as a labeled badge above your reply — do not restate " +
      "it in prose. Start directly with the key evidence and reasoning, including " +
      "the most important caveat if any. " +
      "Use inline citations for factual claims from web sources."
    );
  }

  function buildSelectionSummaryQuestion(selectedText: string) {
    const snippet = formatSelectionSnippet(selectedText);
    return (
      `Summarize ${snippet} in the context of this page. ` +
      "Keep it concise and focus on what matters here. " +
      "Use the page context first; use web search only if needed to identify or verify factual references, with inline citations."
    );
  }

  // Actions resolve their target from the visible popup when present, otherwise
  // from the live selection — this is what lets manual mode (no popup) act on
  // the current selection via keyboard.
  function resolveSelectionInfo(): SelectionInfo | null {
    if (activeSelectionTrigger) {
      return { rect: activeSelectionTrigger.rect, text: activeSelectionTrigger.text };
    }
    return getCurrentSelectionInfo();
  }

  function openSelectionAskFromTrigger() {
    const captured = resolveSelectionInfo();
    if (!captured) return;
    const anchor = makeVirtualAnchor(captured.rect);
    openChatbox(anchor, {
      kind: "selection",
      selectedText: captured.text,
      pageContext: getPageText(),
      selectionMode: "ask",
    });
  }

  function openSelectionExplanationFromTrigger() {
    const captured = resolveSelectionInfo();
    if (!captured) return;
    const anchor = makeVirtualAnchor(captured.rect);
    openChatbox(anchor, {
      kind: "selection",
      selectedText: captured.text,
      pageContext: getPageText(),
      selectionMode: "explain",
      initialQuestion: buildSelectionExplanationQuestion(captured.text),
    });
  }

  function openSelectionTruthFromTrigger() {
    const captured = resolveSelectionInfo();
    if (!captured) return;
    const anchor = makeVirtualAnchor(captured.rect);
    openChatbox(anchor, {
      kind: "selection",
      selectedText: captured.text,
      pageContext: getPageText(),
      selectionMode: "truth",
      initialQuestion: buildSelectionTruthQuestion(captured.text),
    });
  }

  function openSelectionSummaryFromTrigger() {
    const captured = resolveSelectionInfo();
    if (!captured) return;
    const anchor = makeVirtualAnchor(captured.rect);
    openChatbox(anchor, {
      kind: "selection",
      selectedText: captured.text,
      pageContext: getPageText(),
      selectionMode: "summarize",
      initialQuestion: buildSelectionSummaryQuestion(captured.text),
    });
  }

  function showSelectionTrigger(rect: DOMRect, text: string) {
    hideSelectionTrigger();

    const mount = createLensesShadowMount({
      surface: "selection-trigger",
      rootClassName: SELECTION_TRIGGER_CLASS,
      ariaLabel: "Lenses selection actions",
    });
    const root = mount.root;
    root.setAttribute("aria-label", "Lenses selection actions");
    root.addEventListener("mousedown", (event) => event.preventDefault());
    root.addEventListener("click", (event) => event.stopPropagation());

    activeSelectionTrigger = {
      root,
      mount,
      reactRoot: createRoot(root),
      rect,
      text,
      disabled: false,
    };
    renderActiveSelectionTrigger();
  }

  function hideSelectionTrigger() {
    if (!activeSelectionTrigger) return;
    activeSelectionTrigger.reactRoot.unmount();
    activeSelectionTrigger.mount.remove();
    activeSelectionTrigger = null;
  }

  function isEditableKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    if (target.closest("input, textarea, select")) return true;
    return !!target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (activeSelectionTrigger) {
      handleVisibleTriggerKeydown(event);
      return;
    }
    handleManualShortcutKeydown(event);
  }

  // Shortcuts while the popup is visible: bare letters, no modifiers (the popup
  // is the affordance, so we don't require one). Mirrors the on-screen hints.
  function handleVisibleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideSelectionTrigger();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (isEditableKeyboardTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      event.stopPropagation();
      openSelectionSummaryFromTrigger();
    } else if (key === "a") {
      event.preventDefault();
      event.stopPropagation();
      openSelectionAskFromTrigger();
    } else if (key === "e") {
      event.preventDefault();
      event.stopPropagation();
      openSelectionExplanationFromTrigger();
    } else if (key === "t") {
      event.preventDefault();
      event.stopPropagation();
      openSelectionTruthFromTrigger();
    }
  }

  // Manual mode never shows the popup, so its shortcuts must be explicit to
  // avoid hijacking single letters site-wide: require ⌥/Alt and key by physical
  // code (event.key is an accented glyph for Alt+letter on macOS).
  function handleManualShortcutKeydown(event: KeyboardEvent) {
    if (resolveSelectionTriggerStyle(getSettings(), getUrl()) !== "manual") return;
    if (!isSelectionTriggerAllowedHere()) return;
    if (!event.altKey || event.metaKey || event.ctrlKey || event.repeat) return;
    if (isEditableKeyboardTarget(event.target)) return;

    const mode = MANUAL_SHORTCUT_BY_CODE[event.code];
    if (!mode) return;
    if (!getCurrentSelectionInfo()) return;

    event.preventDefault();
    event.stopPropagation();
    runPrimarySelectionAction(mode);
  }

  function makeVirtualAnchor(rect: DOMRect): HTMLElement {
    const anchor = document.createElement("div");
    anchor.style.position = "fixed";
    anchor.style.left = `${rect.left}px`;
    anchor.style.top = `${rect.top}px`;
    anchor.style.width = `${rect.width}px`;
    anchor.style.height = `${rect.height}px`;
    anchor.style.pointerEvents = "none";
    anchor.style.visibility = "hidden";
    document.body.appendChild(anchor);
    return anchor;
  }

  function maybeShowSelectionTrigger() {
    const info = getCurrentSelectionInfo();
    if (!info) {
      hideSelectionTrigger();
      return;
    }
    showSelectionTrigger(info.rect, info.text);
  }

  function handleSelectionRelease(event: Event) {
    if (!selectionDirty) return;
    selectionDirty = false;
    if (isInsideLensesUi(event.target)) return;

    const settings = getSettings();
    if (!selectionTriggerMatchesUrl(settings, getUrl())) return;

    // Style is resolved per-domain: a matching override wins, else the global
    // default. `immediate` shows on any release; `modifier` only when ⌥/Alt is
    // held at release; `manual` never auto-shows (keyboard shortcuts handle it).
    const style = resolveSelectionTriggerStyle(settings, getUrl());
    if (style === "manual") return;
    if (style === "modifier" && !eventHasAltModifier(event)) return;

    maybeShowSelectionTrigger();
  }

  function handleOutsideMouseDown(event: MouseEvent) {
    if (!activeSelectionTrigger) return;
    if (isInsideLensesUi(event.target)) return;
    hideSelectionTrigger();
  }

  return {
    hide: hideSelectionTrigger,
    handleKeydown,
    handleSelectionRelease,
    handleOutsideMouseDown,
    markSelectionDirty: () => {
      selectionDirty = true;
    },
  };
}
