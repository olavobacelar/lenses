// The user message bubble used to be accent-filled (a saturated blue) with white
// text on both chat surfaces. It now reads as a neutral gray that simply lifts
// off the chat log — present enough to mark "your turn" without a loud color
// block, compact but still clearly visible. These assertions lock that in for
// both surfaces (sidepanel ChatDock + in-page ChatboxView), which must stay in
// parity, and guard against the accent fill creeping back. They also pin the
// composer send button to its white-in-dark treatment.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => readFileSync(join(here, "..", "src", ...p), "utf-8");

const sidepanelCss = src("sidepanel", "sidepanel.css");
const chatboxCss = src("content", "styles", "chatbox.css");
const darkThemeCss = src("content", "styles", "dark-theme.css");

// CSS rules never nest, so a non-greedy run up to the next `}` is a safe body.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

// Pull a custom-property value out of a rule body, e.g. "--user-bubble-bg".
function tokenValue(body: string, name: string): string {
  const m = body.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1].trim();
}

// The accent hexes the bubble must no longer reference, per theme.
const ACCENT_HEXES = ["#2f6df6", "#7aa2f7"];

describe("user bubble — neutral gray, not an accent fill (sidepanel)", () => {
  it("fills the bubble from the --user-bubble-* tokens, not --accent", () => {
    const bubble = ruleBody(sidepanelCss, ".message.user .message-bubble");
    expect(bubble).toMatch(/background:\s*var\(--user-bubble-bg\)/);
    expect(bubble).toMatch(/color:\s*var\(--user-bubble-ink\)/);
    expect(bubble).not.toMatch(/var\(--accent\)/);
  });

  it("defines a neutral gray bubble token in both themes", () => {
    const light = ruleBody(sidepanelCss, ":root");
    const dark = ruleBody(sidepanelCss, ':root[data-theme="dark"]');
    expect(light).toMatch(/--user-bubble-bg:\s*#/);
    expect(dark).toMatch(/--user-bubble-bg:\s*#/);
    // A gray, not the brand blue.
    for (const accent of ACCENT_HEXES) {
      expect(light).not.toContain(`--user-bubble-bg: ${accent}`);
      expect(dark).not.toContain(`--user-bubble-bg: ${accent}`);
    }
  });

  it("keeps in-bubble chips legible via --ink tints rather than white-on-blue", () => {
    // The old chips were rgba(255,255,255,…) because the bubble was blue. On a
    // gray bubble that vanishes in light theme, so they mix into --ink instead.
    const ts = ruleBody(sidepanelCss, ".message-timestamp");
    const attach = ruleBody(sidepanelCss, ".message-attachment");
    expect(ts).toMatch(/color-mix\(in srgb,\s*var\(--ink\)/);
    expect(ts).not.toMatch(/rgba\(255,\s*255,\s*255/);
    expect(attach).toMatch(/color-mix\(in srgb,\s*var\(--ink\)/);
    expect(attach).not.toMatch(/rgba\(255,\s*255,\s*255/);
  });
});

describe("user bubble — neutral gray, not an accent fill (in-page chatbox)", () => {
  it("fills the bubble from the chat user-bubble tokens, not the chat accent", () => {
    const bubble = ruleBody(chatboxCss, ".lenses-chat-message.user");
    expect(bubble).toMatch(/background:\s*var\(--lenses-chat-user-bubble-bg\)/);
    expect(bubble).toMatch(/color:\s*var\(--lenses-chat-user-bubble-ink\)/);
    expect(bubble).not.toMatch(/var\(--lenses-chat-accent\)/);
    expect(bubble).not.toMatch(/color:\s*white/);
  });

  it("defines the gray bubble token for light (chatbox) and dark (dark-theme)", () => {
    expect(chatboxCss).toMatch(/--lenses-chat-user-bubble-bg:\s*#/);
    expect(darkThemeCss).toMatch(/--lenses-chat-user-bubble-bg:\s*#/);
  });
});

describe("composer send button — white in dark, brightening on hover", () => {
  it("uses an off-white fill that goes pure white on hover (both surfaces, dark)", () => {
    const sidepanelDark = ruleBody(sidepanelCss, ':root[data-theme="dark"]');
    expect(sidepanelDark).toMatch(/--composer-send-bg:\s*#ededed/);
    expect(sidepanelDark).toMatch(/--composer-send-bg-hover:\s*#ffffff/);

    const chatDark = ruleBody(darkThemeCss, 'html[data-lenses-theme="dark"] .lenses-chatbox');
    expect(chatDark).toMatch(/--lenses-chat-send-bg:\s*#ededed/);
    expect(chatDark).toMatch(/--lenses-chat-send-bg-hover:\s*#ffffff/);
  });
});

describe("in-page chatbox mirrors the side panel (dark)", () => {
  const chatDark = ruleBody(darkThemeCss, 'html[data-lenses-theme="dark"] .lenses-chatbox');
  const sidepanelDark = ruleBody(sidepanelCss, ':root[data-theme="dark"]');

  it("uses the same dark user-bubble color as the side panel", () => {
    // The two surfaces are unified, so the bubble grays must match exactly —
    // asserted by equality rather than a hardcoded hex so a future re-tint of
    // one surface can't silently break parity.
    expect(tokenValue(chatDark, "--lenses-chat-user-bubble-bg")).toBe(
      tokenValue(sidepanelDark, "--user-bubble-bg"),
    );
  });

  it("sits the panel on the dark base with a light frame for page separation", () => {
    // Panel base is the dark paper-soft (like the sidepanel log), and a light
    // (translucent-white) border keeps the floating panel's edge legible over
    // any page — the shadow alone vanishes against dark pages.
    expect(chatDark).toMatch(/background:\s*var\(--lenses-chat-paper-soft\)/);
    expect(chatDark).toMatch(/border-color:\s*rgba\(255,\s*255,\s*255/);
  });

  it("renders dark user-bubble text as light ink, not the dark paper-soft base", () => {
    const userDark = ruleBody(
      darkThemeCss,
      'html[data-lenses-theme="dark"] .lenses-chat-message.user',
    );
    expect(userDark).toMatch(/color:\s*var\(--lenses-chat-user-bubble-ink\)/);
    expect(userDark).not.toMatch(/var\(--lenses-chat-paper-soft\)/);
  });
});
