import { LensConfig, type HighlightRule } from "./schemas/lens.js";
import { SourceScopeKind } from "./schemas/source.js";

interface LensMarkdownParts {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

const SECTION_RE = /^##\s+(.+?)\s*$/gm;
const TAG_RE = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;

export function parseLensMarkdown(markdown: string): LensConfig {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const sections = parseSections(body);
  const taggedSections = parseTaggedSections(body);
  const name = requireField(frontmatter, "name");
  const categorySection =
    sections.get("categories") ?? taggedSections.get("categories");
  if (!categorySection) {
    throw new Error("Lens markdown missing section: categories");
  }
  const outputInstructions =
    sections.get("output") ??
    sections.get("output format") ??
    taggedSections.get("output") ??
    taggedSections.get("output format");
  if (!outputInstructions) {
    throw new Error("Lens markdown missing section: output");
  }

  const highlightRules = parseHighlightRules(categorySection);
  const promptTemplate =
    sections.get("prompt") ??
    buildPromptTemplateFromSkillBody(body, [
      "categories",
      "output",
      "output_format",
      "output-format",
    ]);

  return LensConfig.parse({
    id: readScalar(frontmatter, "id")?.trim() || slugify(name),
    name,
    // Description is optional — a lens without one is valid. An absent or blank
    // frontmatter field parses to an empty string rather than throwing.
    description: readScalar(frontmatter, "description")?.trim() || "",
    version: readScalar(frontmatter, "version")?.trim() || "0.0.1",
    authorType: readScalar(frontmatter, "authorType")?.trim() || "builtin",
    defaultModel: readScalar(frontmatter, "defaultModel")?.trim() || undefined,
    contentTypeHints: readArray(frontmatter, "contentTypeHints", ["text"]),
    outputCategories: highlightRules.map((rule) => ({
      name: rule.value,
      color: rule.color,
      label: rule.label,
      description: rule.label,
    })),
    fallbackColor: readScalar(frontmatter, "fallbackColor")?.trim() || "#64748b",
    focus: readScalar(frontmatter, "focus")?.trim() || "source",
    scope: parseScope(frontmatter.scope),
    itemNoun: readScalar(frontmatter, "itemNoun")?.trim() || "finding",
    outputKind: readScalar(frontmatter, "outputKind")?.trim() || "items",
    runMode: parseRunMode(frontmatter),
    triggers: readArray(frontmatter, "triggers", []),
    allowedDomains: readArray(frontmatter, "allowedDomains", []),
    tools: readArray(frontmatter, "tools", []),
    suggestedEnrichments: parseSuggestedEnrichments(
      frontmatter.suggestedEnrichments
    ),
    visible: readScalar(frontmatter, "visible")?.trim() !== "false",
    promptTemplate,
    outputInstructions,
    highlightRules,
  });
}

// Serialize a LensConfig back into the canonical lens-markdown format so users
// can export an edited lens in the same shape the built-ins ship in. It is the
// inverse of parseLensMarkdown: feeding the output back through the parser yields
// an equivalent config. The prompt is emitted verbatim (it already excludes the
// categories/output blocks, since the parser reconstructs it that way), followed
// by the `<categories>` and `<output_format>` tags the parser reads back.
//
// Fields at their schema default are omitted to keep exported frontmatter terse;
// the parser re-applies those same defaults on the way back in, so the round-trip
// is still faithful.
export function serializeLensMarkdown(config: LensConfig): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${config.id}`);
  lines.push(`name: ${config.name}`);
  // Omitted when blank, mirroring the other optional fields; the parser applies
  // the same empty-string default on the way back in, so the round-trip holds.
  if (config.description) lines.push(`description: ${config.description}`);
  if (config.version && config.version !== "0.0.1") {
    lines.push(`version: ${config.version}`);
  }
  if (config.authorType && config.authorType !== "builtin") {
    lines.push(`authorType: ${config.authorType}`);
  }
  if (config.defaultModel) lines.push(`defaultModel: ${config.defaultModel}`);
  if (config.focus && config.focus !== "source") {
    lines.push(`focus: ${config.focus}`);
  }
  if (config.visible === false) lines.push(`visible: false`);
  if (config.itemNoun && config.itemNoun !== "finding") {
    lines.push(`itemNoun: ${config.itemNoun}`);
  }
  if (!isDefaultArray(config.contentTypeHints, ["text"])) {
    lines.push(`contentTypeHints: ${formatArray(config.contentTypeHints)}`);
  }
  if (!isDefaultArray(config.scope, ["page"])) {
    lines.push(`scope: ${formatArray(config.scope)}`);
  }
  if (config.outputKind && config.outputKind !== "items") {
    lines.push(`outputKind: ${config.outputKind}`);
  }
  if (config.runMode && config.runMode !== "manual") {
    lines.push(`runMode: ${config.runMode}`);
  }
  if (config.triggers.length > 0) {
    lines.push(`triggers: ${formatArray(config.triggers, true)}`);
  }
  if (config.allowedDomains.length > 0) {
    lines.push(`allowedDomains: ${formatArray(config.allowedDomains)}`);
  }
  if (config.tools.length > 0) {
    lines.push(`tools: ${formatArray(config.tools)}`);
  }
  if (config.suggestedEnrichments.length > 0) {
    const items = config.suggestedEnrichments.map((enrichment) =>
      enrichment.auto ? `${enrichment.lensId}:auto` : enrichment.lensId
    );
    lines.push(`suggestedEnrichments: ${formatArray(items)}`);
  }
  if (config.fallbackColor && config.fallbackColor !== "#64748b") {
    lines.push(`fallbackColor: "${config.fallbackColor}"`);
  }
  lines.push("---");

  const categories = config.highlightRules
    .map((rule) =>
      rule.label
        ? `- ${rule.value} | ${rule.color} | ${rule.label}`
        : `- ${rule.value} | ${rule.color}`
    )
    .join("\n");

  return [
    lines.join("\n"),
    "",
    config.promptTemplate.trim(),
    "",
    "<categories>",
    categories,
    "</categories>",
    "",
    "<output_format>",
    config.outputInstructions.trim(),
    "</output_format>",
    "",
  ].join("\n");
}

// Inline-array frontmatter formatting that the parser reads back via
// parseFrontmatterValue (`[a, b]`). Glob triggers are quoted because they can
// contain characters that read awkwardly bare; the parser unquotes each item.
function formatArray(values: readonly string[], quote = false): string {
  const items = values.map((value) => (quote ? `"${value}"` : value));
  return `[${items.join(", ")}]`;
}

function isDefaultArray(values: readonly string[], fallback: string[]): boolean {
  return (
    values.length === fallback.length &&
    values.every((value, index) => value === fallback[index])
  );
}

function parseRunMode(fields: Record<string, string | string[]>): string {
  const explicit = readScalar(fields, "runMode")?.trim();
  if (explicit) return explicit;

  const autoRun =
    readBoolean(fields, "autoRun") ??
    readBoolean(fields, "autoExtract") ??
    readBoolean(fields, "autoExtractClaims");
  return autoRun ? "auto" : "manual";
}

function readBoolean(
  fields: Record<string, string | string[]>,
  key: string
): boolean | undefined {
  const value = readScalar(fields, key)?.trim().toLowerCase();
  if (!value) return undefined;
  if (["true", "yes", "1", "auto"].includes(value)) return true;
  if (["false", "no", "0", "manual"].includes(value)) return false;
  return undefined;
}

/**
 * Parses `suggestedEnrichments: [verify-claim, locate-source:auto]` into objects.
 * A trailing `:auto` (or `:eager`) marks the enrichment to run eagerly.
 */
function parseSuggestedEnrichments(
  value: string | string[] | undefined
): { lensId: string; auto: boolean }[] {
  const ids = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map((part) => part.trim()).filter(Boolean)
      : [];

  return ids
    .map((raw) => {
      const [lensId, flag] = raw.split(":").map((part) => part.trim());
      if (!lensId) return undefined;
      return { lensId, auto: flag === "auto" || flag === "eager" };
    })
    .filter((entry): entry is { lensId: string; auto: boolean } => Boolean(entry));
}

function splitFrontmatter(markdown: string): LensMarkdownParts {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith("---\n")) {
    throw new Error("Lens markdown must start with YAML-style frontmatter");
  }

  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    throw new Error("Lens markdown frontmatter must close with ---");
  }

  const frontmatterText = normalized.slice(4, end).trim();
  const body = normalized.slice(end + 4).trim();
  return {
    frontmatter: parseScalarFrontmatter(frontmatterText),
    body,
  };
}

function parseScalarFrontmatter(text: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex < 0) {
      throw new Error(`Invalid frontmatter line: ${trimmed}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseFrontmatterValue(trimmed.slice(separatorIndex + 1).trim());
    if (key) fields[key] = value;
  }
  return fields;
}

function parseFrontmatterValue(value: string): string | string[] {
  const unquoted = unquote(value);
  if (!unquoted.startsWith("[") || !unquoted.endsWith("]")) {
    return unquoted;
  }

  const rawItems = unquoted.slice(1, -1).trim();
  if (!rawItems) return [];
  return rawItems
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

function parseSections(body: string): Map<string, string> {
  const matches = Array.from(body.matchAll(SECTION_RE));
  const sections = new Map<string, string>();

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const title = normalizeSectionTitle(match[1] ?? "");
    const contentStart = match.index! + match[0].length;
    const contentEnd =
      i + 1 < matches.length ? matches[i + 1].index! : body.length;
    sections.set(title, body.slice(contentStart, contentEnd).trim());
  }

  return sections;
}

function parseTaggedSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const match of body.matchAll(TAG_RE)) {
    const tag = normalizeSectionTitle(match[1] ?? "");
    const content = (match[2] ?? "").trim();
    if (tag && content) {
      sections.set(tag, content);
    }
  }
  return sections;
}

function buildPromptTemplateFromSkillBody(body: string, excludedTags: string[]): string {
  let prompt = body.trim();

  for (const tag of excludedTags) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
    prompt = prompt.replace(re, "").trim();
  }

  if (!prompt.includes("{{text}}")) {
    throw new Error("Lens markdown prompt must include {{text}}");
  }

  return prompt;
}

function parseHighlightRules(section: string): HighlightRule[] {
  const rules = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .map((line) => {
      const [value, color, label] = line.split("|").map((part) => part.trim());
      if (!value || !color) {
        throw new Error(
          "Each category must use: - category_value | #color | Label"
        );
      }

      return {
        condition: "category",
        value,
        color,
        label: label || humanizeCategory(value),
      };
    });

  if (rules.length === 0) {
    throw new Error("Lens markdown must define at least one category");
  }

  return rules;
}

function parseScope(value: string | string[] | undefined) {
  const raw =
    Array.isArray(value) ? value.join(",") : typeof value === "string" ? value : "";
  if (!raw.trim()) return ["page"];

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => SourceScopeKind.parse(part === "source" ? "page" : part));
}

function requireField(fields: Record<string, string | string[]>, key: string): string {
  const value = readScalar(fields, key)?.trim();
  if (!value) throw new Error(`Lens markdown missing frontmatter field: ${key}`);
  return value;
}

function requireSection(sections: Map<string, string>, title: string): string {
  const value = sections.get(normalizeSectionTitle(title))?.trim();
  if (!value) throw new Error(`Lens markdown missing section: ## ${title}`);
  return value;
}

function normalizeSectionTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readScalar(
  fields: Record<string, string | string[]>,
  key: string
): string | undefined {
  const value = fields[key];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function readArray(
  fields: Record<string, string | string[]>,
  key: string,
  fallback: string[]
): string[] {
  const value = fields[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return fallback;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeCategory(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
