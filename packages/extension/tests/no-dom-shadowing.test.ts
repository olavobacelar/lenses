// Regression test for a real bug: a top-level `function getSelection()` in
// content.ts (classic script in a content-script isolated world) overwrote
// `window.getSelection`, causing infinite recursion whenever any code called
// `window.getSelection()`. This test scans the content-script source for
// top-level function declarations that collide with well-known DOM APIs
// exposed on `window`, so the next instance of this bug fails CI instead of
// silently shipping.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contentScriptPath = join(here, "..", "src", "content", "content.ts");

// Names that the Window prototype exposes globally. A top-level `function <name>`
// declaration in a content script attaches to `window`, silently overriding any
// of these. The list is intentionally narrow — only globals we actually call or
// might call from this code. Add more if/when the codebase grows.
const FORBIDDEN_TOP_LEVEL_NAMES = new Set([
  "getSelection",
  "getComputedStyle",
  "scrollTo",
  "scrollBy",
  "scroll",
  "alert",
  "confirm",
  "prompt",
  "open",
  "close",
  "focus",
  "blur",
  "find",
  "stop",
  "print",
  "matchMedia",
  "fetch",
  "atob",
  "btoa",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "queueMicrotask",
  "structuredClone",
  "postMessage",
]);

function extractTopLevelFunctionNames(source: string): string[] {
  // Match `function name(...)` at column 0 only. Nested functions are indented,
  // so this stays at the module level without needing a real parser.
  const matches = source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm);
  return [...matches].map((m) => m[1]);
}

describe("content.ts top-level functions don't shadow window DOM APIs", () => {
  const source = readFileSync(contentScriptPath, "utf-8");
  const names = extractTopLevelFunctionNames(source);

  it("found at least one top-level function (sanity check)", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each([...FORBIDDEN_TOP_LEVEL_NAMES])(
    "does not declare top-level `function %s`",
    (forbidden) => {
      expect(names).not.toContain(forbidden);
    }
  );
});
