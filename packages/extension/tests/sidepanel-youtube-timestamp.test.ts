// Tests for two Lenses sidepanel presentation rules:
//   1. A readable 14px base type scale instead of the
//      browser-default 16px paired with cramped 12.5px message text).
//   2. A clickable "jump to timestamp" pill rendered on user chat messages that
//      were sent while watching a YouTube video. The behaviour is gated at the
//      source-URL level (only youtube_video sources populate the timestamp), not
//      by the active lens — so the gating lives in updateCurrentTime/seekTo.
//
// The sidepanel is React now, so source assertions target the focused component
// or hook that owns the behavior instead of a single side-effecting entry file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "src", "sidepanel", "sidepanel.css");
const messageListPath = join(here, "..", "src", "sidepanel", "components", "MessageList.tsx");
const sourceSectionPath = join(here, "..", "src", "sidepanel", "components", "SourceSection.tsx");
const headerPath = join(here, "..", "src", "sidepanel", "components", "Header.tsx");
const sourceHookPath = join(here, "..", "src", "sidepanel", "hooks", "useActiveSource.ts");
const css = readFileSync(cssPath, "utf-8");
const messageList = readFileSync(messageListPath, "utf-8");
const sourceSection = readFileSync(sourceSectionPath, "utf-8");
const header = readFileSync(headerPath, "utf-8");
const sourceHook = readFileSync(sourceHookPath, "utf-8");

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

// `body` as a bare selector substring also appears inside `.acc-body`, so match
// the element rule specifically: preceded by start/whitespace/comma, not `-`.
function extractBodyRule(): string {
  const m = css.match(/(?:^|[\s,])body\s*\{([^}]*)\}/);
  if (!m) throw new Error("Could not find the body element rule in sidepanel.css");
  return m[1];
}

describe("sidepanel type scale", () => {
  it("sets a 14px base font on the body instead of the browser default", () => {
    const body = extractBodyRule();
    expect(pixelValue(body, "font-size")).toBe(14);
    expect(body).toMatch(/line-height:\s*1\.5/);
  });

  it("renders chat messages at the larger 14px scale", () => {
    const body = extractRuleBody(".message");
    expect(pixelValue(body, "font-size")).toBe(14);
  });
});

describe("sidepanel YouTube timestamp pill — styling", () => {
  it("styles the timestamp as a clickable monospace pill", () => {
    const body = extractRuleBody(".message-timestamp");
    expect(body).toMatch(/cursor:\s*pointer/);
    expect(body).toMatch(/font-family:[^;]*monospace/);
    expect(body).toMatch(/border-radius:/);
  });

  it("provides a hover affordance so it reads as interactive", () => {
    const body = extractRuleBody(".message-timestamp:hover");
    expect(body).toMatch(/background:/);
  });
});

describe("sidepanel accordion headers", () => {
  it("uses tight line boxes for vertically centered header labels", () => {
    expect(extractRuleBody(".acc-title")).toMatch(/line-height:\s*1\.1/);
    expect(extractRuleBody(".acc-count")).toMatch(/line-height:\s*1\.1/);
  });

  it("renders header counts with tabular figures so digits don't shift the layout", () => {
    // Word totals and the live video time both live in .acc-count; tabular-nums
    // keeps their width fixed as digits tick, matching the .timestamp pill.
    expect(extractRuleBody(".acc-count")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("centers the action button with an explicit inline layout", () => {
    expect(extractRuleBody(".acc-action")).toMatch(/display:\s*inline-flex/);
    expect(extractRuleBody(".acc-action")).toMatch(/align-items:\s*center/);
  });
});

describe("sidepanel YouTube timestamp pill — render logic", () => {
  it("only renders the timestamp for user messages that carry one", () => {
    expect(messageList).toMatch(/message\.role === "user" && Boolean\(stamp\?\.formatted\)/);
  });

  it("seeks the video to the captured moment when the chip is clicked", () => {
    expect(messageList).toMatch(/onSeek=\{onSeek\}/);
    // Standalone pill on text-only messages; overlay chip on the first screenshot.
    expect(messageList).toMatch(/className="message-timestamp"/);
    expect(messageList).toMatch(/className="message-timestamp-overlay"/);
  });

  it("is gated at the source-URL level (only youtube_video sources)", () => {
    // currentTime is the value captured onto a message as videoTimestamp; it must
    // be cleared for non-video sources so a stale YouTube time can't leak across.
    expect(sourceHook).toMatch(/source\?\.kind !== "youtube_video"[\s\S]*?setCurrentTime\(null\)/);
    // Seeking is likewise a no-op unless the active source is a YouTube video.
    expect(sourceHook).toMatch(/const seekTo[\s\S]*?source\?\.kind !== "youtube_video"\) return/);
  });

  it("only shows the source header time chip for YouTube videos", () => {
    expect(sourceSection).toMatch(/source\?\.kind === "youtube_video" \?/);
    expect(sourceSection).toMatch(/id="video-time"[\s\S]*?currentTime\?\.formatted \?\? "--:--"/);
  });
});

describe("sidepanel source section — source text labelling", () => {
  it("distinguishes transcripts, PDFs, and ordinary page text", () => {
    expect(header).not.toContain("source-kind");
    expect(header).not.toContain("labelForSource");
    expect(header).not.toContain('"Article"');
    expect(sourceSection).toContain(
      'const sourceLabel = isYouTube ? "Transcript" : isPdf ? "PDF text" : "Page text";'
    );
    expect(sourceSection).toContain('<span className="acc-title">{source ? sourceLabel : "Source"}</span>');
    expect(sourceSection).toContain('id="source-text"');
  });

  it("keeps the source content at one folding level", () => {
    expect(sourceSection).not.toContain("source-stats");
    expect(sourceSection).not.toContain("source-inline-meta");
    expect(sourceSection).not.toContain("source-preview-head");
    expect(sourceSection).not.toContain("toggle-source-text");
    expect(sourceSection).not.toContain("toggle-transcript");
    expect(sourceSection).not.toContain("segment-count");
    expect(sourceSection).not.toContain(">Segments<");
  });
});
