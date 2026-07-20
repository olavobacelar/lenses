// Regression tests for the structured-output rendering pipeline introduced
// to fix the "verdict prose looks bad" issue. Three things must hold:
//
// 1. The inline-markdown helper used by citation-bearing assistant bubbles
//    actually parses `**bold**` (the original bug was that it only created
//    text nodes, so `**Verdict: True**` rendered as literal asterisks).
//
// 2. The verdict pill builder emits the four expected variant class names
//    so the CSS can color each verdict distinctly.
//
// 3. The CSS defines a distinct color treatment for each verdict variant
//    and the truth-question prompt no longer asks the model to repeat the
//    verdict in prose (since the badge already shows it).
//
// These tests parse source files as strings — matching the established
// convention in this package — so we avoid pulling in a DOM dependency.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contentPath = join(here, "..", "src", "content", "content.ts");
const chatUiPath = join(here, "..", "src", "lib", "ChatUi.tsx");
const richTextPath = join(here, "..", "src", "lib", "RichText.tsx");
const selectionTriggerPath = join(here, "..", "src", "content", "SelectionTriggerController.ts");
const cssPath = join(here, "..", "src", "content", "highlight.css");
const content = readFileSync(contentPath, "utf-8");
const chatUi = readFileSync(chatUiPath, "utf-8");
const richText = readFileSync(richTextPath, "utf-8");
const selectionTriggerController = readFileSync(selectionTriggerPath, "utf-8");
const css = readCssFile(cssPath);

function readCssFile(path: string, seen = new Set<string>()): string {
  const fullPath = resolve(path);
  if (seen.has(fullPath)) throw new Error(`Circular CSS import in ${fullPath}`);
  seen.add(fullPath);

  const source = readFileSync(fullPath, "utf-8");
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*@import\s+["'](.+)["'];\s*$/);
      if (!match) return line;
      return readCssFile(resolve(dirname(fullPath), match[1]), seen);
    })
    .join("\n");
}

function extractFunctionBody(source: string, name: string): string {
  // Captures everything between the opening `function name(` and the
  // matching closing brace at column 0 (this codebase uses 2-space indent
  // and never nests top-level functions, so the next `^}` is reliable).
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`function ${escaped}\\b[\\s\\S]*?^\\}`, "m");
  const m = source.match(re);
  if (!m) throw new Error(`Could not find function ${name}`);
  return m[0];
}

function extractCssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Could not find rule for ${selector}`);
  return m[1];
}

describe("renderInlineMarkdownWithBreaks bug fix", () => {
  // The original bug: this helper claimed to render inline markdown but
  // only emitted text nodes, so `**Verdict: True**` showed literal
  // asterisks in any answer with citations (the citation-bearing path
  // uses this helper instead of `renderMarkdown`).
  const body = extractFunctionBody(richText, "renderInlineMarkdownWithBreaks");

  it("calls renderInlineMarkdown so **bold**, *em*, `code` and links render", () => {
    expect(body).toMatch(/renderInlineMarkdown\(/);
  });

  it("no longer uses createTextNode as the per-line renderer", () => {
    // The fix swaps createTextNode for renderInlineMarkdown — if anyone
    // reverts this, the original visible bug returns.
    expect(body).not.toMatch(/document\.createTextNode/);
  });

  it("still inserts a <br> between lines", () => {
    expect(body).toMatch(/<br key=/);
  });
});

describe("MessageMeta (verdict pill renderer)", () => {
  const body = extractFunctionBody(chatUi, "MessageMeta");

  it("returns null when meta is undefined", () => {
    expect(body).toMatch(/if \(!meta\) return null/);
  });

  it("renders the four verdict variants we color in CSS", () => {
    // Each variant comes from labelByVerdict[verdict.toLowerCase()] —
    // missing one would silently drop the pill for that verdict.
    expect(body).toMatch(/true:\s*"True"/);
    expect(body).toMatch(/false:\s*"False"/);
    expect(body).toMatch(/mixed:\s*"Mixed"/);
    expect(body).toMatch(/unverifiable:\s*"Unverifiable"/);
  });

  it("encodes the verdict variant in the class so CSS can color it", () => {
    expect(body).toMatch(/lenses-chat-verdict--\$\{normalized\}/);
  });

  it("falls back to generic key:value pills for unknown meta shapes", () => {
    // Other quick-actions ("explain", "summarize", "ask") may emit meta
    // in the future. The renderer must show something sensible for
    // schemas we haven't styled yet.
    expect(body).toMatch(/lenses-chat-meta-pill/);
  });
});

describe("verdict pill CSS", () => {
  it("defines distinct colors for each verdict variant", () => {
    const trueRule = extractCssRule(".lenses-chat-verdict--true");
    const falseRule = extractCssRule(".lenses-chat-verdict--false");
    const mixedRule = extractCssRule(".lenses-chat-verdict--mixed");
    const unverifiableRule = extractCssRule(".lenses-chat-verdict--unverifiable");

    // We don't pin exact hex values (those will evolve with the design
    // system), but each variant must define its own background and color
    // — otherwise the badge wouldn't visually communicate the verdict.
    for (const [name, rule] of [
      ["true", trueRule],
      ["false", falseRule],
      ["mixed", mixedRule],
      ["unverifiable", unverifiableRule],
    ] as const) {
      expect(rule, `${name} variant should set background`).toMatch(/background:/);
      expect(rule, `${name} variant should set color`).toMatch(/color:/);
    }

    // Sanity check: the four backgrounds must not all collapse to the
    // same value (which would defeat the purpose of distinct verdicts).
    const backgrounds = [trueRule, falseRule, mixedRule, unverifiableRule]
      .map((r) => /background:\s*([^;]+);/.exec(r)?.[1]?.trim() ?? "")
      .filter(Boolean);
    const uniqueBackgrounds = new Set(backgrounds);
    expect(uniqueBackgrounds.size).toBeGreaterThanOrEqual(3);
  });

  it("renders verdict pills as compact uppercase chips", () => {
    const baseRule = extractCssRule(".lenses-chat-verdict,\n.lenses-chat-meta-pill");
    expect(baseRule).toMatch(/text-transform:\s*uppercase/);
    expect(baseRule).toMatch(/border-radius:\s*var\(--lenses-radius-pill\)/);
  });
});

describe("buildSelectionTruthQuestion prompt", () => {
  const body = extractFunctionBody(selectionTriggerController, "buildSelectionTruthQuestion");

  it("tells the model the verdict is shown as a badge so it doesn't repeat it", () => {
    // Without this guidance the model emits `**Verdict: True**` in the
    // prose, which now duplicates the rendered pill.
    expect(body).toMatch(/badge/i);
    expect(body).toMatch(/do not restate/i);
  });

  it("still asks the model to ground the answer in the page + web", () => {
    expect(body).toMatch(/page context/);
    expect(body).toMatch(/web/);
    expect(body).toMatch(/inline citations/);
  });
});

describe("selectionMode wiring", () => {
  it("includes selectionMode in the ask-finding-stream port request", () => {
    // Without this the server cannot pick the right meta schema, so the
    // truth action would silently fall back to free-form text again.
    expect(content).toMatch(/selectionMode:\s*context\.selectionMode/);
  });

  it("handles the meta SSE event during streaming", () => {
    // The shared fold engine stores the meta payload; the chatbox routes the
    // event through it and mirrors the folded meta into its streaming preview.
    expect(content).toMatch(/event\.type === "meta"/);
    expect(content).toMatch(/applyChatStreamEvent/);
    expect(content).toMatch(/meta:\s*streamState\.meta/);
    const chatStream = readFileSync(
      join(here, "..", "src", "lib", "chat-stream.ts"),
      "utf-8"
    );
    expect(chatStream).toMatch(/event\.type === "meta"/);
  });
});
