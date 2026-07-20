// Regression test for the sidepanel chat dock redesign. The "lower part"
// (message history + composer) previously rendered as heavy full-width
// blocks with uppercase role labels, a 190px-min message area, and a bulky
// 3-row textarea next to a 72px-wide send button — it looked nothing like a
// chat and ate vertical space. The fix turns messages into left/right aligned
// bubbles and keeps the composer compact while the chat dock fills the lower
// panel instead of leaving a dead zone below it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "src", "sidepanel", "sidepanel.css");
const css = readFileSync(cssPath, "utf-8");
const chatDockPath = join(here, "..", "src", "sidepanel", "components", "ChatDock.tsx");
const chatDock = readFileSync(chatDockPath, "utf-8");

// A selector can appear in several rules (e.g. `.messages` is declared once in
// a grouped border rule and once on its own); those declarations cascade, so
// gather every matching rule body and join them.
function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector} in sidepanel.css`);
  return bodies.join("\n");
}

function pixelValue(body: string, property: string): number {
  const m = body.match(new RegExp(`${property}:\\s*([0-9.]+)px`));
  if (!m) throw new Error(`Could not find ${property} in rule body`);
  return parseFloat(m[1]);
}

describe("sidepanel chat dock — message bubbles", () => {
  it("aligns user messages to the right as accent bubbles", () => {
    const body = extractRuleBody(".message.user");
    expect(body).toMatch(/align-self:\s*flex-end/);
    expect(body).toMatch(/background:\s*var\(--accent\)/);
  });

  it("aligns assistant messages to the left", () => {
    const body = extractRuleBody(".message.assistant");
    expect(body).toMatch(/align-self:\s*flex-start/);
  });

  it("constrains bubbles so they never span the full width", () => {
    const body = extractRuleBody(".message");
    expect(body).toMatch(/max-width:\s*\d/);
  });
});

describe("sidepanel chat dock — compact, bounded layout", () => {
  it("lets the accordion shrink when the bottom chat dock needs room", () => {
    const body = extractRuleBody(".accordion");
    expect(body).toMatch(/flex:\s*0 1 auto/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("lets the chat dock fill the remaining panel height", () => {
    const body = extractRuleBody(".chat-dock");
    expect(body).toMatch(/flex:\s*1 1 0/);
    // A floor so a tall accordion can't squeeze the composer away entirely.
    expect(body).toMatch(/min-height:\s*120px/);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  it("lets the message history take the spare room and scroll internally", () => {
    const body = extractRuleBody(".messages");
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/max-height:\s*none/);
    expect(body).toMatch(/overflow:\s*auto/);
  });

  // Regression: the message log carried a rigid `min-height: 96px`, so when the
  // composer grew to multiple lines it could not yield vertical space — the
  // composer (and its send button) was shoved past the bottom of the 100vh panel
  // and out of view. The log must be able to shrink to nothing; it scrolls, so a
  // collapsed log stays usable while the composer stays on screen.
  it("lets the message history shrink to nothing so a growing composer is never pushed off-screen", () => {
    const body = extractRuleBody(".messages");
    expect(body).toMatch(/min-height:\s*0;/);
    expect(body).not.toMatch(/min-height:\s*\d*[1-9]\d*px/);
  });

  it("lays the composer out as a vertical flex stack, not a fixed two-column grid", () => {
    const body = extractRuleBody(".chat-form");
    expect(body).toMatch(/flex:\s*0 0 auto/);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  it("keeps the input compact (single row, not the old 58px block)", () => {
    const body = extractRuleBody("#chat-input");
    expect(pixelValue(body, "min-height")).toBeLessThanOrEqual(48);
  });

  it("lets a full selected-text draft show a paragraph before scrolling", () => {
    const body = extractRuleBody("#chat-input");
    expect(pixelValue(body, "max-height")).toBeGreaterThanOrEqual(220);
    expect(chatDock).toContain("Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT)");
  });
});

// Regression test: a long chat history used to crush the accordion above it down
// to a sliver, leaving the section headers (Claims, lenses, Source) hidden behind
// the chat. Flexbox distributes shrinkage by flex-shrink * flex-basis, so a tall
// message history with an `auto` basis grabbed an outsized share of the panel and
// starved the accordion. The chat's zero flex-basis stops its content height from
// inflating that share; the accordion's max-height stops the converse (a long
// section stack swallowing the chat).
describe("sidepanel chat dock — section headers stay visible", () => {
  it("gives the chat a zero flex-basis so its history cannot crush the accordion", () => {
    const body = extractRuleBody(".chat-dock");
    expect(body).toMatch(/flex:\s*1 1 0\b/);
    expect(body).not.toMatch(/flex:\s*1 1 auto/);
  });

  it("caps the accordion height so a long section stack cannot swallow the chat", () => {
    const body = extractRuleBody(".accordion");
    expect(body).toMatch(/max-height:\s*\d/);
  });
});
