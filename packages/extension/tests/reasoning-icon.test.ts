// Spec for the reasoning-trace icon treatment.
//
// The design intent:
//   1. The reasoning step no longer carries a glyph up in the timeline marker
//      (no icon next to the "Thought" / "Thinking" summary). The marker only
//      renders the research Globe now.
//   2. When the disclosure is expanded, a lucide `History` glyph appears to the
//      LEFT of the reasoning body — inside `.lenses-chat-thinking-row`, ahead of
//      the `.lenses-chat-thinking-content` <pre>.
//   3. Both chat surfaces (in-page chatbox + sidepanel) style the row and icon,
//      kept in parity.
//
// These tests parse source files as strings — matching the established
// convention in this package — so we avoid pulling in a DOM dependency.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extSrc = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(extSrc, ...parts), "utf-8");

const chatUi = read("lib", "ChatUi.tsx");
const chatboxCss = read("content", "styles", "chatbox.css");
const sidepanelCss = read("sidepanel", "sidepanel.css");

describe("reasoning-trace icon", () => {
  it("uses the lucide History glyph for reasoning, not Brain", () => {
    expect(chatUi).toMatch(/import\s*\{[^}]*\bHistory\b[^}]*\}\s*from\s*["']lucide-react["']/);
    // The old brain glyph is gone entirely.
    expect(chatUi).not.toMatch(/\bBrain\b/);
  });

  it("does not render an icon in the timeline marker for thinking steps", () => {
    // The marker renders the Globe for research and nothing for thinking.
    const marker = chatUi.slice(
      chatUi.indexOf("lenses-chat-activity-marker"),
      chatUi.indexOf("lenses-chat-activity-body")
    );
    expect(marker).toContain("<Globe");
    expect(marker).toContain('item.kind === "research" ?');
    // No second icon branch — the thinking arm is `null`.
    expect(marker).toMatch(/\)\s*:\s*null/);
  });

  it("renders the History glyph to the left of the reasoning body, gated on expansion", () => {
    // The icon lives inside the disclosure body (`body`), which only renders
    // when open — never in the always-visible summary row.
    const body = chatUi.slice(
      chatUi.indexOf("const body = ("),
      chatUi.indexOf("if (open)")
    );
    expect(body).toContain("lenses-chat-thinking-row");
    expect(body).toMatch(/<History[^>]*lenses-chat-thinking-icon/);
    // Icon comes before the thought <pre> content (left of the reasoning).
    expect(body.indexOf("lenses-chat-thinking-icon")).toBeLessThan(
      body.indexOf("lenses-chat-thinking-content")
    );

    // The summary row stays icon-free.
    const summary = chatUi.slice(
      chatUi.indexOf("const summary = ("),
      chatUi.indexOf("const body = (")
    );
    expect(summary).not.toContain("History");
    expect(summary).not.toContain("thinking-icon");
  });

  it("styles the row and icon on both chat surfaces in parity", () => {
    for (const css of [chatboxCss, sidepanelCss]) {
      expect(css).toContain(".lenses-chat-thinking-row");
      expect(css).toContain(".lenses-chat-thinking-icon");
      // Row is a flex line so the glyph sits beside the text.
      expect(css).toMatch(/\.lenses-chat-thinking-row\s*\{[^}]*display:\s*flex/);
    }
  });
});
