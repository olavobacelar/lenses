import { describe, it, expect } from "vitest";
import {
  MetaHeaderExtractor,
  VERDICT_SCHEMA,
  buildMetaInstruction,
  getMetaSchemaForMode,
  validateMetaPayload,
} from "@lenses/shared";

function feedAll(extractor: MetaHeaderExtractor, chunks: string[]) {
  const events = chunks.map((chunk) => extractor.push(chunk));
  events.push(extractor.end());
  return events;
}

describe("validateMetaPayload", () => {
  it("accepts a valid verdict object", () => {
    expect(validateMetaPayload({ verdict: "true" }, VERDICT_SCHEMA)).toEqual({
      verdict: "true",
    });
  });

  it("rejects unknown verdict values", () => {
    expect(validateMetaPayload({ verdict: "maybe" }, VERDICT_SCHEMA)).toBeNull();
  });

  it("rejects extra keys to keep persisted payloads tight", () => {
    expect(
      validateMetaPayload({ verdict: "true", extra: "x" }, VERDICT_SCHEMA)
    ).toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(validateMetaPayload({}, VERDICT_SCHEMA)).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(validateMetaPayload("true", VERDICT_SCHEMA)).toBeNull();
    expect(validateMetaPayload(["true"], VERDICT_SCHEMA)).toBeNull();
    expect(validateMetaPayload(null, VERDICT_SCHEMA)).toBeNull();
  });
});

describe("getMetaSchemaForMode", () => {
  it("returns the verdict schema for truth", () => {
    expect(getMetaSchemaForMode("truth")).toBe(VERDICT_SCHEMA);
  });

  it("returns null for modes without a schema today", () => {
    expect(getMetaSchemaForMode("ask")).toBeNull();
    expect(getMetaSchemaForMode("explain")).toBeNull();
    expect(getMetaSchemaForMode("summarize")).toBeNull();
  });

  it("returns null when mode is undefined", () => {
    expect(getMetaSchemaForMode(undefined)).toBeNull();
  });
});

describe("buildMetaInstruction", () => {
  it("mentions the schema shape and the badge UX cue", () => {
    const out = buildMetaInstruction(VERDICT_SCHEMA);
    expect(out).toContain(VERDICT_SCHEMA.promptShape);
    expect(out).toContain("badge");
    expect(out).toContain("blank line");
  });
});

describe("MetaHeaderExtractor", () => {
  it("extracts a single-chunk header with following prose", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push(
      '{"verdict":"true"}\n\nThe selected text is supported.'
    );
    expect(result.meta).toEqual({ verdict: "true" });
    expect(result.proseText).toBe("The selected text is supported.");
    expect(result.settled).toBe(true);
  });

  it("extracts the header when split across many deltas", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const deltas = ["{", '"verdict"', ':', '"false"', "}", "\n\n", "Counter-evidence ", "follows."];
    let metaSeen: Record<string, string> | null = null;
    let prose = "";
    for (const delta of deltas) {
      const r = extractor.push(delta);
      if (r.meta) metaSeen = r.meta;
      prose += r.proseText;
    }
    expect(metaSeen).toEqual({ verdict: "false" });
    expect(prose).toBe("Counter-evidence follows.");
  });

  it("tolerates leading whitespace before the JSON header", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push('\n  {"verdict":"mixed"}\n\nBody.');
    expect(result.meta).toEqual({ verdict: "mixed" });
    expect(result.proseText).toBe("Body.");
  });

  it("strips a single newline between header and prose when no blank line is present", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push('{"verdict":"unverifiable"}\nBody right after.');
    expect(result.meta).toEqual({ verdict: "unverifiable" });
    expect(result.proseText).toBe("Body right after.");
  });

  it("falls back to passing text through when the first non-whitespace is not a brace", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push("The model forgot to emit JSON.\nMore text.");
    expect(result.meta).toBeNull();
    expect(result.proseText).toBe("The model forgot to emit JSON.\nMore text.");
    expect(result.settled).toBe(true);
  });

  it("falls back when the JSON line fails to parse", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push("{verdict: true}\n\nProse.");
    expect(result.meta).toBeNull();
    expect(result.proseText).toBe("{verdict: true}\n\nProse.");
  });

  it("falls back when the JSON parses but fails schema validation", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const result = extractor.push('{"verdict":"sortof"}\n\nProse.');
    expect(result.meta).toBeNull();
    expect(result.proseText).toBe('{"verdict":"sortof"}\n\nProse.');
  });

  it("becomes a pass-through after the header is consumed", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    extractor.push('{"verdict":"true"}\n\nFirst chunk.');
    const second = extractor.push(" Second chunk.");
    expect(second.meta).toBeNull();
    expect(second.proseText).toBe(" Second chunk.");
    expect(second.settled).toBe(true);
  });

  it("gives up if the buffer grows past the configured cap before a newline arrives", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA, { maxBufferBytes: 32 });
    const huge = "{" + "x".repeat(50); // no newline, exceeds cap
    const result = extractor.push(huge);
    expect(result.meta).toBeNull();
    expect(result.proseText).toBe(huge);
    expect(result.settled).toBe(true);
  });

  it("flushes any leftover buffered text on end()", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const first = extractor.push('{"verdict":"true"'); // no newline yet
    expect(first.meta).toBeNull();
    expect(first.proseText).toBe("");
    const final = extractor.end();
    expect(final.meta).toBeNull();
    expect(final.proseText).toBe('{"verdict":"true"');
  });

  it("end() is a no-op once settled", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    extractor.push('{"verdict":"true"}\n\nA.');
    const final = extractor.end();
    expect(final.meta).toBeNull();
    expect(final.proseText).toBe("");
  });

  it("accumulates prose across post-header chunks via the caller", () => {
    const extractor = new MetaHeaderExtractor(VERDICT_SCHEMA);
    const events = feedAll(extractor, [
      '{"verdict":"true"}\n\n',
      "The selected ",
      "text is supported by the cited sources.",
    ]);
    const meta = events.find((e) => e.meta)?.meta;
    const prose = events.map((e) => e.proseText).join("");
    expect(meta).toEqual({ verdict: "true" });
    expect(prose).toBe("The selected text is supported by the cited sources.");
  });
});
