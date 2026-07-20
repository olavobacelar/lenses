// Structured-output header support for the selection-chat stream.
//
// Each selection quick-action ("ask", "explain", "truth", "summarize") can
// optionally declare a metadata schema. When a schema is present, the model is
// instructed to begin its response with a single JSON object on its own line,
// followed by a blank line, then prose. The server parses the header out of the
// stream, validates it against the schema, and emits a structured `meta` event
// so the UI can render a typed affordance (e.g. a verdict pill) before the
// prose chunks arrive.

export type SelectionMode = "ask" | "explain" | "truth" | "summarize";

export interface MetaFieldSpec {
  // Enum of allowed string values, or null for "any string".
  readonly allowed: ReadonlyArray<string> | null;
  readonly required: boolean;
}

export interface MetaSchema {
  readonly fields: Readonly<Record<string, MetaFieldSpec>>;
  // Human-readable JSON shape shown in the system prompt.
  readonly promptShape: string;
  // Per-mode guidance appended to the prompt instruction.
  readonly promptGuidance: string;
}

const VERDICT_VALUES = ["true", "false", "mixed", "unverifiable"] as const;

export const VERDICT_SCHEMA: MetaSchema = {
  fields: {
    verdict: { allowed: VERDICT_VALUES, required: true },
  },
  promptShape: '{"verdict": "true" | "false" | "mixed" | "unverifiable"}',
  promptGuidance: [
    '- "true": the claim is well supported by reliable sources.',
    '- "false": the claim contradicts reliable sources.',
    '- "mixed": parts are supported, parts contradict, or the claim oversimplifies.',
    '- "unverifiable": evidence is insufficient either way.',
  ].join("\n"),
};

export const SELECTION_META_SCHEMAS: Readonly<Record<SelectionMode, MetaSchema | null>> = {
  ask: null,
  explain: null,
  truth: VERDICT_SCHEMA,
  summarize: null,
};

export function getMetaSchemaForMode(mode: SelectionMode | undefined): MetaSchema | null {
  if (!mode) return null;
  return SELECTION_META_SCHEMAS[mode] ?? null;
}

export function buildMetaInstruction(schema: MetaSchema): string {
  return (
    "Begin your reply with a single line containing only a JSON object that describes " +
    "structured metadata for this question (no markdown, no prose, no code fences). " +
    `Use this exact schema and no extra keys:\n\n${schema.promptShape}\n\n` +
    `${schema.promptGuidance}\n\n` +
    "Emit one newline after the JSON, then a blank line, then your prose answer. " +
    "The UI renders this metadata as a labeled badge — do not restate it in prose."
  );
}

export type ParsedMeta = Record<string, string>;

export function validateMetaPayload(raw: unknown, schema: MetaSchema): ParsedMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const result: ParsedMeta = {};

  for (const [key, spec] of Object.entries(schema.fields)) {
    const value = obj[key];
    if (value === undefined) {
      if (spec.required) return null;
      continue;
    }
    if (typeof value !== "string") return null;
    if (spec.allowed && !spec.allowed.includes(value)) return null;
    result[key] = value;
  }

  // Reject unknown keys so we never leak unvalidated data into persistence.
  for (const key of Object.keys(obj)) {
    if (!(key in schema.fields)) return null;
  }

  return result;
}

export interface MetaExtractorResult {
  // Structured metadata, present exactly once when the header is successfully parsed.
  readonly meta: ParsedMeta | null;
  // Prose text safe to emit downstream as a chunk. May be empty while buffering.
  readonly proseText: string;
  // True once the extractor has committed to a decision (header found or abandoned).
  // Further pushes pass through unchanged.
  readonly settled: boolean;
}

export interface MetaExtractorOptions {
  // Hard cap on how much we'll buffer before giving up and treating the buffer as prose.
  readonly maxBufferBytes?: number;
}

const DEFAULT_MAX_BUFFER_BYTES = 2048;

// Streaming parser for the leading JSON header. Designed to be fed text deltas
// in any order — it accumulates until it can decide whether a header exists,
// then becomes a pass-through for the remainder of the stream.
export class MetaHeaderExtractor {
  private buffer = "";
  private settled = false;
  private readonly maxBufferBytes: number;

  constructor(
    private readonly schema: MetaSchema,
    options: MetaExtractorOptions = {}
  ) {
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  push(chunk: string): MetaExtractorResult {
    if (this.settled) {
      return { meta: null, proseText: chunk, settled: true };
    }

    this.buffer += chunk;

    // Skip any leading whitespace (newlines, spaces) before the JSON object.
    let cursor = 0;
    while (cursor < this.buffer.length && isAsciiWhitespace(this.buffer[cursor])) {
      cursor++;
    }

    if (cursor >= this.buffer.length) {
      return this.maybeGiveUpForSize();
    }

    if (this.buffer[cursor] !== "{") {
      // First non-whitespace is not the start of an object — there's no header.
      return this.flushAsProse();
    }

    const newlineIndex = this.buffer.indexOf("\n", cursor);
    if (newlineIndex < 0) {
      return this.maybeGiveUpForSize();
    }

    const candidate = this.buffer.slice(cursor, newlineIndex).trim();
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(candidate);
    } catch {
      return this.flushAsProse();
    }

    const meta = validateMetaPayload(rawParsed, this.schema);
    if (!meta) {
      return this.flushAsProse();
    }

    // Consume the newline and any immediately-following blank lines.
    let consumed = newlineIndex + 1;
    while (
      consumed < this.buffer.length &&
      (this.buffer[consumed] === "\n" || this.buffer[consumed] === "\r")
    ) {
      consumed++;
    }
    const proseText = this.buffer.slice(consumed);
    this.buffer = "";
    this.settled = true;
    return { meta, proseText, settled: true };
  }

  // Flush any leftover buffered text when the text block ends without a newline.
  end(): MetaExtractorResult {
    if (this.settled) {
      return { meta: null, proseText: "", settled: true };
    }
    return this.flushAsProse();
  }

  private maybeGiveUpForSize(): MetaExtractorResult {
    if (this.buffer.length > this.maxBufferBytes) {
      return this.flushAsProse();
    }
    return { meta: null, proseText: "", settled: false };
  }

  private flushAsProse(): MetaExtractorResult {
    const flushed = this.buffer;
    this.buffer = "";
    this.settled = true;
    return { meta: null, proseText: flushed, settled: true };
  }
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}
