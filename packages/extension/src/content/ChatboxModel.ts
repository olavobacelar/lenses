import type { Annotation, SelectionChatMode } from "./types.js";
import { getAnnotationDisplayLabel } from "./annotationModel.js";

export function getSelectionChatEyebrow(mode: SelectionChatMode | undefined) {
  if (mode === "explain") return "Explaining";
  if (mode === "truth") return "Checking";
  if (mode === "summarize") return "Summarizing";
  return "Asking";
}

export function getSelectionInputPlaceholder(mode: SelectionChatMode | undefined) {
  if (mode === "explain" || mode === "truth" || mode === "summarize") {
    return "Ask a follow-up…";
  }
  return "Ask…";
}

export function positionChatbox(anchor: HTMLElement, chatbox: HTMLElement) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const chatboxRect = chatbox.getBoundingClientRect();
  const isSelectionChatbox = chatbox.classList.contains("lenses-chatbox--selection");
  const isDetachedChatbox =
    chatbox.classList.contains("lenses-chatbox--detached") ||
    isSelectionChatbox;
  const fallbackWidth = isSelectionChatbox ? 680 : isDetachedChatbox ? 600 : 500;
  const fallbackHeight = isSelectionChatbox ? 800 : isDetachedChatbox ? 640 : 420;
  const width = finitePositive(chatboxRect.width, fallbackWidth);
  const preferredHeight = finitePositive(chatboxRect.height, fallbackHeight);
  const viewportHeight = window.innerHeight;
  const viewportAvailableHeight = Math.max(0, viewportHeight - margin * 2);
  const height = Math.min(preferredHeight, viewportAvailableHeight);

  let left = Math.min(rect.left, window.innerWidth - width - margin);
  left = Math.max(margin, left);

  const belowTop = rect.bottom + margin;
  const aboveTop = rect.top - height - margin;
  const belowFits = belowTop + height <= viewportHeight - margin;
  const aboveFits = aboveTop >= margin;
  let top = belowTop;
  if (!belowFits && (aboveFits || rect.top > viewportHeight - rect.bottom)) {
    top = aboveTop;
  }
  top = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - height - margin));
  const availableHeightFromTop = Math.max(0, viewportHeight - top - margin);

  chatbox.style.position = "fixed";
  chatbox.style.left = `${left}px`;
  chatbox.style.top = `${top}px`;
  chatbox.style.maxHeight = `${availableHeightFromTop}px`;
  if (isDetachedChatbox) {
    chatbox.style.minHeight = `${Math.min(preferredHeight, availableHeightFromTop)}px`;
  }
  chatbox.style.zIndex = "2147483647";
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function uniqueAnnotations(annotations: Annotation[]) {
  const seen = new Set<string>();
  const unique: Annotation[] = [];

  for (const annotation of annotations) {
    const key = [
      annotation.lensId,
      annotation.label,
      annotation.finding.category,
      annotation.finding.text,
      annotation.finding.detail,
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(annotation);
  }

  return unique;
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildDebugAnnotationMarkdown(annotation: Annotation): string {
  const displayLabel = getAnnotationDisplayLabel(annotation);
  const findingSnapshot = {
    runId: annotation.finding.runId ?? null,
    findingIndex:
      typeof annotation.finding.findingIndex === "number"
        ? annotation.finding.findingIndex
        : null,
    category: annotation.finding.category,
    label: displayLabel,
    confidence: annotation.finding.confidence,
    text: annotation.finding.text,
    detail: annotation.finding.detail,
    sourceSpan: annotation.finding.sourceSpan ?? null,
    rawFinding: annotation.finding.rawFinding ?? null,
  };

  return (
    `### Debug: ${displayLabel}\n\n` +
    "#### Finding payload\n\n" +
    "```json\n" +
    `${toPrettyJson(findingSnapshot)}\n` +
    "```\n\n" +
    "#### Raw model output\n\n" +
    "```text\n" +
    `${annotation.finding.rawResponse ?? "No raw model output available."}\n` +
    "```"
  );
}

export function buildAnnotationQuestion(annotation: Annotation): string {
  const displayLabel = getAnnotationDisplayLabel(annotation);
  if (annotation.lensId === "source-tracer") {
    return (
      `Find the original and best available sources for this excerpt using web search. ` +
      `Do not explain why it was flagged; focus on sourcing and evidence only. ` +
      `Keep it brief and practical (around 4-8 short sentences). ` +
      `Cite sources inline.\n\n` +
      `Label: ${displayLabel}\n` +
      `Excerpt: "${annotation.finding.text}"`
    );
  }

  return (
    `Explain why this excerpt was flagged as ${displayLabel}. ` +
    `What does this signal, what are plausible alternative interpretations, and what should I verify first?\n\n` +
    `Excerpt: "${annotation.finding.text}"`
  );
}
