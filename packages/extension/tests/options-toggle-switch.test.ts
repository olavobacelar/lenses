// Regression test for the General/settings page toggle switches.
//
// The Radix Switch on the settings page used to collapse into a small dark
// circle with a dull beige (`--muted`) thumb. The cause was structural: the
// `.switch-control` wrapper is a `<span>` (inline elements ignore width/height),
// and `.switch-track` was `position: absolute; inset: 0`, so the track shrank to
// the wrapper's intrinsic box (~the 14px thumb) instead of a 36×20 pill.
//
// The fix mirrors the popup (`.toggle-switch`) and sidepanel (`.bay-switch`):
// the Radix <button> (`.switch-track`) is the sized pill itself, with a white
// thumb that is vertically centered by the track and moves horizontally on a
// transform. These assertions lock that shape in so the "round and ugly"
// rendering can't regress.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(join(here, "..", "src", "options", "options.css"));
const css = readFileSync(cssPath, "utf-8");

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Non-greedy match up to the first closing brace (rules here are flat).
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Could not find rule for ${selector} in options.css`);
  return m[1];
}

describe("options toggle: track is a sized pill, not a collapsed circle", () => {
  const control = extractRuleBody(".switch-control");
  const track = extractRuleBody(".switch-track");

  it("lets the wrapper hug the button so its width/height apply", () => {
    // An inline <span> would swallow the track's dimensions; inline-flex sizes
    // to the button instead.
    expect(control).toMatch(/display:\s*inline-flex/);
  });

  it("sizes the track directly instead of absolutely filling the wrapper", () => {
    // The bug was `position: absolute; inset: 0` on the track.
    expect(track).not.toMatch(/position:\s*absolute/);
    expect(track).not.toMatch(/inset:/);
  });

  it("is a pill: wider than it is tall, with a pill radius", () => {
    const width = track.match(/width:\s*(\d+)px/);
    const height = track.match(/height:\s*(\d+)px/);
    expect(width, "expected a width declaration").not.toBeNull();
    expect(height, "expected a height declaration").not.toBeNull();
    expect(parseInt(width![1], 10)).toBeGreaterThan(parseInt(height![1], 10));
    expect(track).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });

  it("centers the thumb vertically with layout instead of a y transform", () => {
    expect(track).toMatch(/display:\s*grid/);
    expect(track).toMatch(/align-items:\s*center/);
    expect(track).toMatch(/justify-items:\s*start/);
  });

  it("overrides the generic button min-height so it can't stretch into an oval", () => {
    // The real bug: `.switch-track` is a <button>, and `button { min-height: 38px }`
    // (a tap-target floor) overrode the 20px height, rendering a 34×38 oval. The
    // track must pin its own min-height down to the pill height.
    const minHeight = track.match(/min-height:\s*(\d+)px/);
    expect(minHeight, "expected an explicit min-height on the track").not.toBeNull();
    const height = parseInt(track.match(/height:\s*(\d+)px/)![1], 10);
    expect(parseInt(minHeight![1], 10)).toBeLessThanOrEqual(height);
  });

  it("uses a filled track with no hard border (matches popup/sidepanel)", () => {
    expect(track).toMatch(/border:\s*0/);
    expect(track).toMatch(/background:\s*var\(--line\)/);
  });
});

describe("options toggle: thumb and checked state match the rest of the app", () => {
  const thumb = extractRuleBody(".switch-thumb");
  const checkedTrack = extractRuleBody('.switch-track[data-state="checked"]');
  const checkedThumb = extractRuleBody(
    '.switch-track[data-state="checked"] .switch-thumb',
  );

  it("uses a white thumb that rides on a transform, not the dull --muted dot", () => {
    expect(thumb).not.toMatch(/background:\s*var\(--muted\)/);
    expect(thumb).toMatch(/background:\s*#fff(fff)?/i);
    expect(thumb).toMatch(/transform:\s*translateX\(3px\)/);
    expect(thumb).not.toMatch(/translate\([^)]*,/);
  });

  it("turns the accent color on and slides the thumb right when checked", () => {
    expect(checkedTrack).toMatch(/background:\s*var\(--accent-strong\)/);
    expect(checkedThumb).toMatch(/transform:\s*translateX\(17px\)/);
    expect(checkedThumb).not.toMatch(/translate\([^)]*,/);
  });
});
