// Regression tests for two delete affordances tied to saved highlights:
//
// 1. The small `×` button anchored to the top-left corner of a saved
//    highlight. It used to be a solid indigo dot with white glyph that
//    drew the eye away from the highlighted text. We softened it to a
//    light ghost circle (white-ish background, slate text, 1px border)
//    and bumped its size from 14px → 18px so it is bigger and lighter,
//    not more aggressive.
//
// 2. The icon-only delete button rendered in the selection-mode chatbox
//    header when the chat is backed by a saved selection. It mirrors the
//    source-callout close button's compact footprint but turns destructive-red
//    on hover.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "src", "content", "highlight.css");
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

function extractRuleBody(selector: string): string {
  // Match `.selector { ... }` non-greedy up to the first closing brace.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Could not find rule for ${selector} in highlight.css`);
  return m[1];
}

function extractRuleBodyContaining(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Could not find rule containing ${selector} in highlight.css`);
  return m[1];
}

describe("saved-highlight delete (corner `×`)", () => {
  const body = extractRuleBody(".lenses-saved-highlight-delete");

  it("is bigger than the previous 14px footprint", () => {
    const width = body.match(/width:\s*(\d+)px/);
    const height = body.match(/height:\s*(\d+)px/);
    expect(width, "expected a width declaration").not.toBeNull();
    expect(height, "expected a height declaration").not.toBeNull();
    expect(parseInt(width![1], 10)).toBeGreaterThan(14);
    expect(parseInt(height![1], 10)).toBeGreaterThan(14);
  });

  it("no longer uses the heavy solid indigo background", () => {
    // The previous rule hard-coded `background: #4f46e5;` — make sure that
    // exact color is gone. A regression that re-introduces the dark dot
    // should fail here.
    expect(body).not.toMatch(/background:\s*#4f46e5/i);
  });

  it("uses a light surface so the highlight reads first, not the close glyph", () => {
    // Either a light white/translucent background, or a very pale gray.
    expect(body).toMatch(/background:\s*(rgba\(255,\s*255,\s*255|#f|#e)/i);
  });

  it("uses a softer glyph color than white-on-indigo", () => {
    // Anything but pure white. Slate/gray tones are the intent.
    const color = body.match(/color:\s*([^;]+);/);
    expect(color, "expected a color declaration").not.toBeNull();
    expect(color![1].trim().toLowerCase()).not.toBe("white");
    expect(color![1].trim().toLowerCase()).not.toBe("#fff");
    expect(color![1].trim().toLowerCase()).not.toBe("#ffffff");
  });
});

describe("saved-highlight hover surface", () => {
  it("keeps the overlay container transparent to hit testing", () => {
    const body = extractRuleBody(".lenses-saved-highlight-overlay");
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  it("makes each visible highlight rect the interactive cursor target", () => {
    const body = extractRuleBody(".lenses-saved-highlight-overlay-rect");
    expect(body).toMatch(/pointer-events:\s*auto/);
    expect(body).toMatch(/cursor:\s*pointer/);
  });
});

describe("chatbox delete (selection-mode header)", () => {
  it("uses a compact icon button next to Close", () => {
    const body = extractRuleBodyContaining(".lenses-chatbox--selection .lenses-chatbox-delete");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/width:\s*18px/);
    expect(body).toMatch(/height:\s*18px/);
    expect(body).toMatch(/padding:\s*0/);
  });

  it("turns red on hover so the destructive intent is unambiguous", () => {
    const body = extractRuleBody(".lenses-chatbox--selection .lenses-chatbox-delete:hover");
    // Some red-ish color value — either a named red or a hex starting with
    // #b/#c/#d/#e/#f in the red family. We accept any color whose hex starts
    // with a red component clearly above the others by checking for known
    // tailwind-style red tokens.
    expect(body).toMatch(/color:\s*(#b91c1c|#dc2626|#ef4444|#b1[0-9a-f]{4})/i);
  });
});
