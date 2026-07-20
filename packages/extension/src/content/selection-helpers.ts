// Pure helpers for the selection-triggered chat. Lives outside content.ts
// so the content script can stay a module with DOM side effects while tests
// import these functions without dragging the listeners along.

export const MIN_SELECTION_CHARS = 1;
export const SELECTION_SNIPPET_MAX = 220;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface TriggerPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface TextAnchor {
  selectedText: string;
  prefix?: string;
  suffix?: string;
  textStart?: number;
  textEnd?: number;
}

export interface TextAnchorMatch {
  start: number;
  end: number;
  kind: "exact" | "normalized" | "context" | "source_span" | "selection_fallback";
}

export interface TextIndexItem<TNode> {
  node: TNode;
  text: string;
  startsNewTextBlock?: boolean;
}

export interface TextIndexPiece<TNode> {
  node: TNode;
  start: number;
  end: number;
}

export interface TextIndex<TNode> {
  text: string;
  pieces: Array<TextIndexPiece<TNode>>;
}

export interface SourceSpan {
  start: number;
  end: number;
}

export interface FindFindingTextAnchorOptions {
  fallbackToSelection?: boolean;
  sourceText?: string;
}

export function isSelectionLongEnough(text: string): boolean {
  return text.trim().length > 0;
}

export function formatSelectionSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SELECTION_SNIPPET_MAX) return `“${collapsed}”`;
  return `“${collapsed.slice(0, SELECTION_SNIPPET_MAX - 1).trimEnd()}…”`;
}

export type QuoteSegment =
  | { kind: "text"; value: string }
  | { kind: "ref"; value: string };

// Splits a quoted selection into prose segments interleaved with bracketed
// reference markers like "[1]". Lets the renderer style references as small
// superscript pills so they don't read as raw markup inside the headline.
export function splitQuoteForReferences(text: string): QuoteSegment[] {
  const pattern = /\[(\d{1,3})\]/g;
  const segments: QuoteSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "ref", value: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
}

export function buildTextIndex<TNode>(items: Array<TextIndexItem<TNode>>): TextIndex<TNode> {
  const pieces: Array<TextIndexPiece<TNode>> = [];
  let text = "";

  for (const item of items) {
    if (shouldInsertTextIndexSeparator(text, item.text, item.startsNewTextBlock === true)) {
      text += " ";
    }

    const start = text.length;
    text += item.text;
    pieces.push({ node: item.node, start, end: text.length });
  }

  return { text, pieces };
}

export interface ArticleRectLike {
  left: number;
  right: number;
}

export interface SourceCalloutLayoutInput {
  articleRect: ArticleRectLike | null;
  viewportWidth: number;
  gap?: number;
  rightMargin?: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface SourceCalloutLayout {
  left: number;
  width: number;
}

// Pin the source-tracker panel to the empty margin next to the article column
// so the article text stays fully visible. Falls back to a right-aligned overlay
// when there's no article context to anchor against.
export function computeSourceCalloutLayout({
  articleRect,
  viewportWidth,
  gap = 16,
  rightMargin = 12,
  minWidth = 200,
  maxWidth = 360,
}: SourceCalloutLayoutInput): SourceCalloutLayout {
  if (!articleRect) {
    const width = Math.min(maxWidth, Math.max(minWidth, viewportWidth - 2 * rightMargin));
    return { left: Math.max(rightMargin, viewportWidth - rightMargin - width), width };
  }

  const spaceRight = viewportWidth - articleRect.right - gap - rightMargin;
  if (spaceRight >= minWidth) {
    const width = Math.min(maxWidth, spaceRight);
    return { left: Math.round(articleRect.right + gap), width };
  }

  const spaceLeft = articleRect.left - gap - rightMargin;
  if (spaceLeft >= minWidth) {
    const width = Math.min(maxWidth, spaceLeft);
    return { left: rightMargin, width };
  }

  // Article reaches the viewport edges — narrow the panel and accept overlap.
  const fallbackWidth = Math.max(minWidth, Math.min(maxWidth, viewportWidth - 2 * rightMargin));
  return {
    left: Math.max(rightMargin, viewportWidth - rightMargin - fallbackWidth),
    width: fallbackWidth,
  };
}

export function computeSelectionTriggerPosition(
  rect: RectLike,
  viewport: ViewportSize,
  buttonWidth: number,
  buttonHeight: number
): TriggerPosition {
  const margin = 8;
  const gap = 8;

  let left = rect.left + rect.width / 2 - buttonWidth / 2;
  left = Math.max(margin, Math.min(left, viewport.width - buttonWidth - margin));

  const above = rect.top - buttonHeight - gap;
  if (above >= margin) {
    return { left, top: above, placement: "above" };
  }

  const belowRaw = rect.bottom + gap;
  const maxTop = viewport.height - buttonHeight - margin;
  const top = Math.max(margin, Math.min(belowRaw, maxTop));
  return { left, top, placement: "below" };
}

export function buildTextAnchor(
  pageText: string,
  selectedText: string,
  contextChars = 160
): TextAnchor {
  const selected = selectedText.trim();
  const anchor: TextAnchor = { selectedText: selected };
  if (!selected) return anchor;

  const match = findSelectedText(pageText, selected);
  if (!match) return anchor;

  anchor.textStart = match.start;
  anchor.textEnd = match.end;
  anchor.prefix = pageText.slice(Math.max(0, match.start - contextChars), match.start);
  anchor.suffix = pageText.slice(match.end, Math.min(pageText.length, match.end + contextChars));
  return anchor;
}

export function findTextAnchor(pageText: string, anchor: TextAnchor): TextAnchorMatch | null {
  const selected = anchor.selectedText.trim();
  if (!selected) return null;

  const nearOffsetMatch = findNearStoredOffset(pageText, selected, anchor);
  if (nearOffsetMatch) return nearOffsetMatch;

  const exactIndex = pageText.indexOf(selected);
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + selected.length, kind: "exact" };
  }

  const normalizedMatch = findNormalizedRange(pageText, selected);
  if (normalizedMatch) {
    return { ...normalizedMatch, kind: "normalized" };
  }

  const contextMatch = findByContext(pageText, anchor);
  if (contextMatch) return contextMatch;

  return null;
}

export function findFindingTextAnchor(
  pageText: string,
  selectedText: string,
  findingText: string,
  sourceSpan?: SourceSpan,
  options?: FindFindingTextAnchorOptions
): TextAnchorMatch | null {
  const selected = selectedText.trim();
  const selectedRange = selected
    ? findTextAnchor(pageText, buildTextAnchor(pageText, selected))
    : null;

  if (selectedRange && isValidSourceSpan(sourceSpan, selected.length)) {
    return {
      start: selectedRange.start + sourceSpan.start,
      end: selectedRange.start + sourceSpan.end,
      kind: "source_span",
    };
  }

  const finding = findingText.trim();
  if (!finding) return null;

  if (!selectedRange) {
    const pageSourceSpanMatch = findPageSourceSpan(pageText, finding, sourceSpan);
    if (pageSourceSpanMatch) return pageSourceSpanMatch;
  }

  if (selectedRange) {
    const selectedLocalMatch = findTextAnchor(selected, { selectedText: finding });
    if (selectedLocalMatch) {
      return {
        start: selectedRange.start + selectedLocalMatch.start,
        end: selectedRange.start + selectedLocalMatch.end,
        kind: selectedLocalMatch.kind,
      };
    }
  }

  const pageMatch = findTextAnchor(pageText, { selectedText: finding });
  if (pageMatch) return pageMatch;

  const sourceTextSpanMatch = findSourceTextSpanAnchor(
    pageText,
    options?.sourceText,
    sourceSpan
  );
  if (sourceTextSpanMatch) return sourceTextSpanMatch;

  if (selectedRange && options?.fallbackToSelection) {
    return {
      start: selectedRange.start,
      end: selectedRange.end,
      kind: "selection_fallback",
    };
  }

  return null;
}

function findSourceTextSpanAnchor(
  pageText: string,
  sourceText: string | undefined,
  sourceSpan?: SourceSpan
): TextAnchorMatch | null {
  if (!sourceText || !isValidSourceSpan(sourceSpan, sourceText.length)) return null;

  const sourceSpanText = sourceText.slice(sourceSpan.start, sourceSpan.end).trim();
  if (!sourceSpanText) return null;

  const match = findTextAnchor(pageText, { selectedText: sourceSpanText });
  if (!match) return null;

  return { ...match, kind: "source_span" };
}

function findPageSourceSpan(
  pageText: string,
  findingText: string,
  sourceSpan?: SourceSpan
): TextAnchorMatch | null {
  if (!isValidSourceSpan(sourceSpan, pageText.length)) return null;

  const spanText = pageText.slice(sourceSpan.start, sourceSpan.end);
  if (normalizeAnchorText(spanText) !== normalizeAnchorText(findingText)) return null;

  return {
    start: sourceSpan.start,
    end: sourceSpan.end,
    kind: "source_span",
  };
}

function isValidSourceSpan(
  sourceSpan: SourceSpan | undefined,
  selectedLength: number
): sourceSpan is SourceSpan {
  return (
    !!sourceSpan &&
    Number.isFinite(sourceSpan.start) &&
    Number.isFinite(sourceSpan.end) &&
    sourceSpan.start >= 0 &&
    sourceSpan.end > sourceSpan.start &&
    sourceSpan.end <= selectedLength
  );
}

function shouldInsertTextIndexSeparator(
  existingText: string,
  nextText: string,
  startsNewTextBlock: boolean
) {
  if (!startsNewTextBlock || existingText.length === 0 || nextText.length === 0) return false;
  if (/\s$/.test(existingText) || /^\s/.test(nextText)) return false;
  return true;
}

function findSelectedText(pageText: string, selectedText: string) {
  const exactIndex = pageText.indexOf(selectedText);
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + selectedText.length };
  }

  return findNormalizedRange(pageText, selectedText);
}

function findNearStoredOffset(
  pageText: string,
  selectedText: string,
  anchor: TextAnchor
): TextAnchorMatch | null {
  if (typeof anchor.textStart !== "number") return null;

  const margin = Math.max(500, selectedText.length * 3);
  const windowStart = Math.max(0, anchor.textStart - margin);
  const windowEnd = Math.min(
    pageText.length,
    (typeof anchor.textEnd === "number" ? anchor.textEnd : anchor.textStart + selectedText.length) +
      margin
  );
  const windowText = pageText.slice(windowStart, windowEnd);

  const exactIndex = findClosestIndex(windowText, selectedText, anchor.textStart - windowStart);
  if (exactIndex >= 0) {
    return {
      start: windowStart + exactIndex,
      end: windowStart + exactIndex + selectedText.length,
      kind: "exact",
    };
  }

  const normalizedMatch = findNormalizedRange(windowText, selectedText);
  if (!normalizedMatch) return null;
  return {
    start: windowStart + normalizedMatch.start,
    end: windowStart + normalizedMatch.end,
    kind: "normalized",
  };
}

function findClosestIndex(haystack: string, needle: string, targetIndex: number): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let fromIndex = 0;

  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index < 0) break;

    const distance = Math.abs(index - targetIndex);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }

    fromIndex = index + Math.max(needle.length, 1);
  }

  return bestIndex;
}

function findByContext(pageText: string, anchor: TextAnchor): TextAnchorMatch | null {
  if (!anchor.prefix || !anchor.suffix) return null;

  const prefixNeedle = tail(anchor.prefix, 96);
  const suffixNeedle = head(anchor.suffix, 96);
  if (!prefixNeedle || !suffixNeedle) return null;

  const prefix = findNormalizedRange(pageText, prefixNeedle);
  if (!prefix) return null;

  const suffixSearchStart = prefix.end;
  const suffix = findNormalizedRange(pageText.slice(suffixSearchStart), suffixNeedle);
  if (!suffix) return null;

  let start = prefix.end;
  let end = suffixSearchStart + suffix.start;
  while (start < end && /\s/.test(pageText[start])) start++;
  while (end > start && /\s/.test(pageText[end - 1])) end--;

  if (end <= start) return null;
  const maxReasonableLength = Math.max(anchor.selectedText.length * 3, anchor.selectedText.length + 500);
  if (end - start > maxReasonableLength) return null;

  return { start, end, kind: "context" };
}

function findNormalizedRange(haystack: string, needle: string): { start: number; end: number } | null {
  const normalizedHaystack = normalizeWithMap(haystack);
  const normalizedNeedle = normalizeAnchorText(needle);
  if (!normalizedNeedle) return null;

  const index = normalizedHaystack.text.indexOf(normalizedNeedle);
  if (index < 0) return null;

  const endIndex = index + normalizedNeedle.length - 1;
  const start = normalizedHaystack.map[index];
  const end = (normalizedHaystack.map[endIndex] ?? start) + 1;
  return { start, end };
}

function normalizeAnchorText(value: string): string {
  return normalizeWithMap(value).text;
}

function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let inSpace = true;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (/\s/.test(char)) {
      if (!inSpace && text.length > 0) {
        text += " ";
        map.push(i);
        inSpace = true;
      }
      continue;
    }

    text += normalizeComparableChar(char);
    map.push(i);
    inSpace = false;
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }

  return { text, map };
}

function normalizeComparableChar(char: string): string {
  switch (char) {
    case "\u2018":
    case "\u2019":
    case "\u201B":
    case "\u2032":
      return "'";
    case "\u201C":
    case "\u201D":
    case "\u201E":
    case "\u2033":
      return '"';
    case "\u2010":
    case "\u2011":
    case "\u2012":
    case "\u2013":
    case "\u2014":
    case "\u2212":
      return "-";
    default:
      return char.toLowerCase();
  }
}

function tail(value: string, length: number): string {
  return value.slice(Math.max(0, value.length - length)).trim();
}

function head(value: string, length: number): string {
  return value.slice(0, length).trim();
}
