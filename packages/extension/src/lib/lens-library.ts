// Pure, DOM-free core of the master-detail lens editor. It maps between a flat,
// UI-friendly "draft" (what the form binds to) and a validated LensConfig /
// canonical markdown (what the backend stores and what export downloads). Keeping
// it free of React and chrome APIs lets the draft↔markdown round-trip and the
// validation rules be unit-tested in isolation; the editor component is a thin
// shell over these functions.

import {
  LensConfig,
  serializeLensMarkdown,
  type LensFocusKind,
  type LensOutputKind,
  type LensRunMode,
  type SourceScopeKind,
} from "@lenses/shared";

export interface CategoryDraft {
  value: string;
  color: string;
  label: string;
}

// The editable shape the form binds to. Arrays stay arrays here; the component
// converts to/from the multi-line text inputs at the edges (see listToInput /
// parseListInput). Everything a lens carries is represented so the user can edit
// "whatever is in the prompt" — including the prompt and domain rules.
export interface LensDraft {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  outputInstructions: string;
  categories: CategoryDraft[];
  allowedDomains: string[];
  triggers: string[];
  runMode: LensRunMode;
  scope: SourceScopeKind[];
  contentTypeHints: string[];
  itemNoun: string;
  defaultModel: string;
  fallbackColor: string;
  outputKind: LensOutputKind;
  focus: LensFocusKind;
  tools: string[];
  visible: boolean;
  version: string;
  authorType: LensConfig["authorType"];
}

export const DEFAULT_CATEGORY_COLOR = "#4f8df9";
export const DEFAULT_FALLBACK_COLOR = "#64748b";

// A stored lens paired with its provenance. The editor needs `isBuiltIn` to
// decide whether saving forks a copy and whether deleting is allowed, so we
// carry it alongside the validated config rather than re-deriving it.
export interface LibraryLens {
  config: LensConfig;
  isBuiltIn: boolean;
}

// Convert a stored `lenses` row into a typed LensConfig + provenance flag. The
// table's primary column is `lensId`, but LensConfig (and the rest of the app)
// uses `id`, so we re-key before parsing. Returns null for a row that fails
// validation so one malformed lens degrades to "hidden" instead of breaking the
// whole library list. Convex's `_id`/`_creationTime` and the extra `markdown`/
// `isBuiltIn` columns are simply stripped by the object schema.
export function lensFromRow(row: unknown): LibraryLens | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.lensId !== "string") return null;
  const parsed = LensConfig.safeParse({ ...record, id: record.lensId });
  if (!parsed.success) return null;
  return { config: parsed.data, isBuiltIn: record.isBuiltIn === true };
}

// A blank starting point for "New lens". It pre-seeds the prompt with the
// {{text}} placeholder and one category so a fresh draft is one edit away from
// valid, mirroring how the popup composer produces a single-category lens.
export function emptyDraft(): LensDraft {
  return {
    id: "",
    name: "",
    description: "",
    promptTemplate:
      "Find every span of the source text that matches this instruction:\n\n<text_to_analyze>\n{{text}}\n</text_to_analyze>",
    outputInstructions:
      'Return a JSON array where each element has:\n{\n  "text": "the exact span copied verbatim from the source",\n  "category": "match",\n  "detail": "why this span matches",\n  "confidence": number between 0 and 1\n}\n\nOnly return the JSON array, no other text.',
    categories: [{ value: "match", color: DEFAULT_CATEGORY_COLOR, label: "Match" }],
    allowedDomains: [],
    triggers: [],
    runMode: "manual",
    scope: ["page"],
    contentTypeHints: ["text"],
    itemNoun: "finding",
    defaultModel: "",
    fallbackColor: DEFAULT_FALLBACK_COLOR,
    outputKind: "items",
    focus: "source",
    tools: [],
    visible: true,
    version: "0.0.1",
    authorType: "user",
  };
}

// Hydrate the form from a stored lens. The categories come from highlightRules
// (the source of truth the serializer reads back), so editing them round-trips.
export function draftFromConfig(config: LensConfig): LensDraft {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    promptTemplate: config.promptTemplate,
    outputInstructions: config.outputInstructions,
    categories: config.highlightRules.map((rule) => ({
      value: rule.value,
      color: rule.color,
      label: rule.label ?? "",
    })),
    allowedDomains: [...config.allowedDomains],
    triggers: [...config.triggers],
    runMode: config.runMode,
    scope: [...config.scope],
    contentTypeHints: [...config.contentTypeHints],
    itemNoun: config.itemNoun,
    defaultModel: config.defaultModel ?? "",
    fallbackColor: config.fallbackColor,
    outputKind: config.outputKind,
    focus: config.focus,
    tools: [...config.tools],
    visible: config.visible,
    version: config.version,
    authorType: config.authorType,
  };
}

// Validate a draft against the same rules parseLensMarkdown enforces server-side,
// but surfaced as friendly, field-level messages so the editor can block save
// before a round-trip. Returning a list (not throwing) lets the UI show every
// problem at once.
export function validateDraft(draft: LensDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Name is required.");
  if (!draft.promptTemplate.includes("{{text}}")) {
    errors.push("Prompt must include the {{text}} placeholder.");
  }
  const validCategories = draft.categories.filter(
    (category) => category.value.trim() && category.color.trim()
  );
  if (validCategories.length === 0) {
    errors.push("Add at least one category with a value and color.");
  }
  if (!draft.outputInstructions.trim()) {
    errors.push("Output instructions are required.");
  }
  return errors;
}

// Assemble a validated LensConfig from a draft. Throws (via LensConfig.parse or
// the explicit guard) if the draft is invalid, so callers should validateDraft
// first. The id falls back to a slug of the name so a new lens always has a
// stable, URL-safe id.
export function draftToConfig(draft: LensDraft): LensConfig {
  // Mirror parseLensMarkdown's category handling so a draft produces the exact
  // same config the backend gets after re-parsing the markdown: a missing label
  // is humanized from the value, and outputCategories is derived from the rules.
  const rules = draft.categories
    .map((category) => ({
      value: category.value.trim(),
      color: category.color.trim(),
      label: category.label.trim(),
    }))
    .filter((category) => category.value && category.color)
    .map((category) => ({
      condition: "category",
      value: category.value,
      color: category.color,
      label: category.label || humanizeCategory(category.value),
    }));

  return LensConfig.parse({
    id: draft.id.trim() || slugify(draft.name),
    name: draft.name.trim(),
    description: draft.description.trim(),
    promptTemplate: draft.promptTemplate.trim(),
    outputInstructions: draft.outputInstructions.trim(),
    highlightRules: rules,
    outputCategories: rules.map((rule) => ({
      name: rule.value,
      color: rule.color,
      label: rule.label,
      description: rule.label,
    })),
    version: draft.version.trim() || "0.0.1",
    authorType: draft.authorType,
    defaultModel: draft.defaultModel.trim() || undefined,
    contentTypeHints: draft.contentTypeHints,
    fallbackColor: draft.fallbackColor.trim() || DEFAULT_FALLBACK_COLOR,
    focus: draft.focus,
    scope: draft.scope.length > 0 ? draft.scope : ["page"],
    itemNoun: draft.itemNoun.trim() || "finding",
    outputKind: draft.outputKind,
    runMode: draft.runMode,
    allowedDomains: draft.allowedDomains,
    triggers: draft.triggers,
    tools: draft.tools,
    visible: draft.visible,
  });
}

// The canonical markdown for a draft — used both to persist (the backend parses
// it) and to export (download/copy). Single source of truth: storage and export
// are byte-identical.
export function draftToMarkdown(draft: LensDraft): string {
  return serializeLensMarkdown(draftToConfig(draft));
}

// --- multi-line text <-> list helpers (URL triggers, tools, content types) ---

// Split a textarea value into a clean list: one entry per line or comma, trimmed,
// blanks dropped, duplicates removed while preserving first-seen order.
export function parseListInput(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// Render a list back into a one-per-line textarea value.
export function listToInput(values: readonly string[]): string {
  return values.join("\n");
}

// A filename-safe slug derived from a lens name, used for new-lens ids and the
// export download filename. Mirrors the slugify in lensMarkdown so an id chosen
// here matches one the parser would derive.
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A suggested download filename for exporting a lens as markdown.
export function exportFilename(draft: LensDraft): string {
  const base = draft.id.trim() || slugify(draft.name) || "lens";
  return `${base}.md`;
}

// Title-cases a category value for a missing label, mirroring lensMarkdown's
// humanizeCategory so client-built and server-parsed configs match exactly.
function humanizeCategory(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
