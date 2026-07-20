// The popup composer lets the user type one free-text query and run it in one
// of two modes:
//   - "lens": a custom single-category highlighting lens (extraction → on-page
//     highlights), run by the service worker.
//   - "ask": a question answered over the whole page in the side panel chat.
// Both modes hand off to other surfaces (the service worker, or the side panel
// via storage), so the surface-independent rules live here where they can be
// unit-tested without the DOM or chrome APIs.

export type ComposerMode = "lens" | "ask";

export interface ComposerAction {
  kind: ComposerMode | "noop";
  instruction: string;
}

// A blank query is a no-op for both modes. Centralizing the trim + emptiness
// check keeps the Enter-key handler and the submit-button handler in agreement.
export function resolveComposerAction(
  mode: ComposerMode,
  rawInput: string
): ComposerAction {
  const instruction = rawInput.trim();
  if (!instruction) return { kind: "noop", instruction: "" };
  return { kind: mode, instruction };
}

// --- Pending popup → side panel handoffs ---
// Opening the side panel closes the popup, so an "Ask" query cannot be streamed
// from the popup itself. The popup writes the question to chrome.storage keyed
// by the active tab id. Lens runs use the same handoff so the side panel can
// own the async run lifecycle and refresh itself after completion.

export const PENDING_ASK_PREFIX = "pendingAsk:";
export const PENDING_LENS_RUN_PREFIX = "pendingLensRun:";

// If the side panel never opens (e.g. the user dismisses it), a stored action
// must not fire much later when the panel is next opened for that tab. Anything
// older than this window is treated as expired and ignored.
export const PENDING_ASK_TTL_MS = 60_000;
export const PENDING_LENS_RUN_TTL_MS = 60_000;

export interface PendingAsk {
  question?: string;
  draft?: string;
  displayContent?: string;
  context?: PendingAskContext;
  targetLensId?: string;
  createdAt: number;
}

export type PendingAskSelectionMode = "ask" | "explain" | "truth" | "summarize";

export interface PendingAskAnnotationContext {
  lensId: string;
  label: string;
  category: string;
  text: string;
  detail: string;
  confidence: number;
}

export type PendingAskContext =
  | {
      kind: "selection";
      selectedText: string;
      pageContext: string;
      selectionMode?: PendingAskSelectionMode;
    }
  | {
      kind: "annotations";
      annotations: PendingAskAnnotationContext[];
    };

export interface PendingLensRun {
  lensIds?: string[];
  customLens?: { instruction: string };
  storePageLenses?: boolean;
  createdAt: number;
}

// A human-readable summary of what a staged context grounds the chat in,
// rendered by the side panel as a dismissible chip above the composer so the
// contextual reroute is visible state instead of a hidden latch.
export interface PendingAskContextSummary {
  kind: PendingAskContext["kind"];
  label: string;
}

const CONTEXT_LABEL_SNIPPET_CHARS = 60;

export function describePendingAskContext(
  context: PendingAskContext
): PendingAskContextSummary {
  if (context.kind === "selection") {
    return {
      kind: "selection",
      label: `Selection: ${contextSnippet(context.selectedText)}`,
    };
  }

  const [first] = context.annotations;
  if (!first) return { kind: "annotations", label: "Highlighted findings" };
  if (context.annotations.length === 1) {
    return { kind: "annotations", label: `Finding: ${first.label}` };
  }
  return {
    kind: "annotations",
    label: `Findings: ${context.annotations.length} highlights`,
  };
}

function contextSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= CONTEXT_LABEL_SNIPPET_CHARS) return `“${collapsed}”`;
  return `“${collapsed.slice(0, CONTEXT_LABEL_SNIPPET_CHARS - 1).trimEnd()}…”`;
}

export function pendingAskKey(tabId: number): string {
  return `${PENDING_ASK_PREFIX}${tabId}`;
}

export function pendingLensRunKey(tabId: number): string {
  return `${PENDING_LENS_RUN_PREFIX}${tabId}`;
}

export function isPendingAskFresh(ask: PendingAsk, now: number): boolean {
  // Reject clock-skewed future timestamps as well as expired ones.
  return ask.createdAt <= now && now - ask.createdAt <= PENDING_ASK_TTL_MS;
}

export function isPendingLensRunFresh(run: PendingLensRun, now: number): boolean {
  // Reject clock-skewed future timestamps as well as expired ones.
  return run.createdAt <= now && now - run.createdAt <= PENDING_LENS_RUN_TTL_MS;
}

export function parsePendingAsk(value: unknown): PendingAsk | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const question =
    typeof record.question === "string" ? record.question.trim() : "";
  const draft = typeof record.draft === "string" ? record.draft : "";
  const displayContent =
    typeof record.displayContent === "string" ? record.displayContent.trim() : "";
  const targetLensId =
    typeof record.targetLensId === "string" ? record.targetLensId.trim() : "";
  const createdAt =
    typeof record.createdAt === "number" ? record.createdAt : 0;
  const context = parsePendingAskContext(record.context);
  if ((!question && !draft.trim()) || !createdAt) return null;
  return {
    ...(question ? { question } : null),
    ...(draft.trim() ? { draft } : null),
    ...(displayContent ? { displayContent } : null),
    ...(context ? { context } : null),
    ...(targetLensId ? { targetLensId } : null),
    createdAt,
  };
}

export function parsePendingLensRun(value: unknown): PendingLensRun | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const createdAt =
    typeof record.createdAt === "number" ? record.createdAt : 0;
  if (!createdAt) return null;

  const lensIds = Array.isArray(record.lensIds)
    ? record.lensIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  const customLensValue = record.customLens;
  const customLens =
    customLensValue && typeof customLensValue === "object"
      ? parsePendingCustomLens(customLensValue)
      : null;

  if (lensIds.length === 0 && !customLens) return null;

  const run: PendingLensRun = { createdAt };
  if (lensIds.length > 0) run.lensIds = lensIds;
  if (customLens) run.customLens = customLens;
  if (typeof record.storePageLenses === "boolean") {
    run.storePageLenses = record.storePageLenses;
  }
  return run;
}

function parsePendingCustomLens(value: object): { instruction: string } | null {
  const record = value as Record<string, unknown>;
  const instruction =
    typeof record.instruction === "string" ? record.instruction.trim() : "";
  return instruction ? { instruction } : null;
}

function parsePendingAskContext(value: unknown): PendingAskContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (record.kind === "selection") {
    const selectedText =
      typeof record.selectedText === "string" ? record.selectedText.trim() : "";
    const pageContext =
      typeof record.pageContext === "string" ? record.pageContext.trim() : "";
    const selectionMode = parseSelectionMode(record.selectionMode);
    if (!selectedText || !pageContext) return null;
    return {
      kind: "selection",
      selectedText,
      pageContext,
      ...(selectionMode ? { selectionMode } : null),
    };
  }

  if (record.kind === "annotations") {
    const annotations = Array.isArray(record.annotations)
      ? record.annotations
          .map(parsePendingAskAnnotation)
          .filter((entry): entry is PendingAskAnnotationContext => !!entry)
      : [];
    return annotations.length > 0 ? { kind: "annotations", annotations } : null;
  }

  return null;
}

function parseSelectionMode(value: unknown): PendingAskSelectionMode | null {
  return value === "ask" ||
    value === "explain" ||
    value === "truth" ||
    value === "summarize"
    ? value
    : null;
}

function parsePendingAskAnnotation(
  value: unknown
): PendingAskAnnotationContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const lensId = typeof record.lensId === "string" ? record.lensId.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const category =
    typeof record.category === "string" ? record.category.trim() : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  const confidence =
    typeof record.confidence === "number" ? record.confidence : Number.NaN;

  if (!lensId || !label || !category || !text || !detail || !Number.isFinite(confidence)) {
    return null;
  }

  return { lensId, label, category, text, detail, confidence };
}
