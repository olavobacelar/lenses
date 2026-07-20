// Regression test for a real visual bug: the chatbox messages container
// (.lenses-chatbox-messages) had only 2px of horizontal padding and no
// reserved scrollbar gutter, so when the scrollbar appeared it sat flush
// against the rounded right border of full-width children like the
// .lenses-chat-thinking <details> element. The fix reserves the scrollbar
// gutter so layout doesn't shift and the right border has breathing room
// from the scrollbar.

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
  // Match `.selector {  ...  }` non-greedy up to the first closing brace.
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

describe("chatbox messages scrollbar layout", () => {
  it("reserves scrollbar gutter on .lenses-chatbox-messages", () => {
    const body = extractRuleBody(".lenses-chatbox-messages");
    expect(body).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("keeps overflow-y: auto so the gutter actually applies", () => {
    const body = extractRuleBody(".lenses-chatbox-messages");
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("gives the right edge breathing room from the scrollbar", () => {
    // Either symmetric horizontal padding >= 4px on both sides, or an
    // asymmetric `padding: top right bottom left` with right >= 4px.
    const body = extractRuleBody(".lenses-chatbox-messages");
    const paddingMatch = body.match(/padding:\s*([^;]+);/);
    expect(paddingMatch, "expected a `padding` declaration").not.toBeNull();
    const parts = paddingMatch![1].trim().split(/\s+/).map((p) => parseInt(p, 10));
    // CSS shorthand: 2 values → vertical horizontal; 4 values → T R B L.
    let right: number;
    if (parts.length === 2) {
      right = parts[1];
    } else if (parts.length === 4) {
      right = parts[1];
    } else {
      throw new Error(`Unexpected padding shorthand: ${paddingMatch![1]}`);
    }
    expect(right).toBeGreaterThanOrEqual(4);
  });
});

describe("selection chatbox sizing", () => {
  it("opens as a taller menu by default", () => {
    const body = extractRuleBody(".lenses-chatbox--selection");
    expect(body).toMatch(/width:\s*min\(680px,\s*calc\(100vw - 16px\)\)/);
    expect(body).toMatch(/min-height:\s*min\(720px,\s*calc\(100vh - 16px\)\)/);
    expect(body).toMatch(/max-height:\s*min\(800px,\s*calc\(100vh - 16px\)\)/);
  });

  it("uses the same taller menu sizing for detached finding chats", () => {
    const body = extractRuleBodyContaining(".lenses-chatbox--detached");
    expect(body).toMatch(/min-height:\s*min\(560px,\s*calc\(100vh - 16px\)\)/);
    expect(body).toMatch(/max-height:\s*min\(640px,\s*calc\(100vh - 16px\)\)/);
  });

  it("keeps the selection shell padding even around the composer", () => {
    const body = extractRuleBody(".lenses-chatbox--selection");
    expect(body).toMatch(/padding:\s*12px/);
    expect(body).not.toMatch(/padding:\s*\d+px\s+\d+px\s+\d+px/);
  });

  it("lets the message area fill the taller selection menu", () => {
    const body = extractRuleBody(".lenses-chatbox--selection .lenses-chatbox-messages");
    expect(body).toMatch(/flex:\s*1 1 300px/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/max-height:\s*none/);
  });

  it("lets long selected text stay readable without hiding the composer", () => {
    const contextBody = extractRuleBody(".lenses-chatbox--selection .lenses-chatbox-context-list");
    expect(contextBody).toMatch(/max-height:\s*min\(280px,\s*40vh\)/);

    const quoteBody = extractRuleBody(".lenses-chatbox-selection-quote");
    expect(quoteBody).toMatch(/max-height:\s*min\(240px,\s*36vh\)/);
    expect(quoteBody).toMatch(/overflow-y:\s*auto/);
    expect(quoteBody).not.toContain("-webkit-line-clamp");
  });
});

describe("chatbox messages scroll-edge fade", () => {
  it("masks the log with a gradient so its edges can fade", () => {
    expect(extractRuleBody(".lenses-chatbox-messages")).toMatch(/mask-image:\s*linear-gradient/);
  });

  it("defaults both fades off so a non-scrolling log shows none", () => {
    const body = extractRuleBody(".lenses-chatbox-messages");
    expect(body).toMatch(/--lenses-chat-fade-top:\s*0px/);
    expect(body).toMatch(/--lenses-chat-fade-bottom:\s*0px/);
  });

  it("arms each fade only when the matching overflow attribute is set", () => {
    expect(extractRuleBody('.lenses-chatbox-messages[data-overflow-top="true"]')).toMatch(
      /--lenses-chat-fade-top:\s*\d/
    );
    expect(extractRuleBody('.lenses-chatbox-messages[data-overflow-bottom="true"]')).toMatch(
      /--lenses-chat-fade-bottom:\s*\d/
    );
  });
});
