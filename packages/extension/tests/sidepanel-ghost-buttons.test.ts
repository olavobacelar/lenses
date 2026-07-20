// The sidepanel's icon/action/text buttons (header reload + settings, the
// re-extract icon, chat "Clear", and the composer source tools) used to carry a
// visible frame and, for the header set, a raised fill. They now read as "ghost"
// buttons: no border or fill at rest, with only a soft hover wash (a translucent
// ink tint) and a brighter glyph appearing on hover. These assertions lock that
// treatment in and guard against the old framed look creeping back.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "sidepanel", "sidepanel.css"), "utf-8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector} in sidepanel.css`);
  return bodies.join("\n");
}

describe("ghost buttons — frameless with a hover wash", () => {
  it("defines a theme-adaptive hover wash derived from --ink", () => {
    // One definition, no dark override: riding on --ink (which flips per theme)
    // yields a light patch on dark surfaces and a soft dim on light ones.
    const root = ruleBody(":root");
    expect(root).toMatch(/--icon-hover-bg:\s*color-mix\(in srgb,\s*var\(--ink\)/);
  });

  it("strips the frame and raised fill from the header icon buttons", () => {
    const base = ruleBody(".icon-btn");
    expect(base).toMatch(/border:\s*1px solid transparent/);
    expect(base).toMatch(/background:\s*transparent/);
    // The old raised chip fill is gone.
    expect(base).not.toMatch(/background:\s*var\(--paper\)/);
  });

  it("reveals only the wash (not a border) on icon-button hover", () => {
    const hover = ruleBody(".icon-btn:hover");
    expect(hover).toMatch(/background:\s*var\(--icon-hover-bg\)/);
    expect(hover).toMatch(/color:\s*var\(--ink\)/);
    expect(hover).not.toMatch(/border-color/);
  });

  it("makes the chat Clear button a ghost text button", () => {
    const base = ruleBody(".text-btn");
    expect(base).toMatch(/border:\s*1px solid transparent/);
    expect(base).toMatch(/background:\s*transparent/);
    expect(ruleBody(".text-btn:hover")).toMatch(/background:\s*var\(--icon-hover-bg\)/);
  });

  it("keeps the composer tools frameless even on hover", () => {
    const hover = ruleBody(".action-btn:hover:not(:disabled)");
    expect(hover).toMatch(/background:\s*var\(--icon-hover-bg\)/);
    // No frame should appear on hover anymore.
    expect(hover).not.toMatch(/border-color:\s*var\(--line\)/);
  });

  it("ghosts the re-extract icon while preserving its square footprint", () => {
    const base = ruleBody(".acc-action--icon");
    expect(base).toMatch(/width:\s*26px/);
    expect(base).toMatch(/background:\s*transparent/);
    expect(base).toMatch(/border-color:\s*transparent/);
    expect(ruleBody(".acc-action--icon:hover")).toMatch(/background:\s*var\(--icon-hover-bg\)/);
  });
});

describe("ghost buttons — extended sweep", () => {
  // The same treatment reaches the other framed secondary buttons in the panel.
  it.each([".lens-run-action", ".claim-action", ".claims-stop-btn", ".claim-verify"])(
    "strips the frame and fill from %s",
    (selector) => {
      const base = ruleBody(selector);
      expect(base).toMatch(/border:\s*1px solid transparent/);
      expect(base).toMatch(/background:\s*transparent/);
    },
  );

  // Semantic icon buttons lose the frame but keep their meaning in the hover
  // color: Stop stays danger-red, Verify stays accent — neither draws a border.
  it("keeps Stop red and Verify accent while frameless on hover", () => {
    const stop = css.match(/\.claims-stop-btn:hover[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";
    expect(stop).toMatch(/color:\s*var\(--danger\)/);
    expect(stop).not.toMatch(/border-color/);

    const verify = css.match(/\.claim-verify:hover\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(verify).toMatch(/color:\s*var\(--accent\)/);
    expect(verify).toMatch(/background:\s*var\(--icon-hover-bg\)/);
    expect(verify).not.toMatch(/border-color/);
  });
});
