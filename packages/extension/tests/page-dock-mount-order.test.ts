import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

function mountFunctionSource(): string {
  const controller = readSource("content/PageLensDockController.ts");
  const start = controller.indexOf("export function mountPageLensDock");
  const end = controller.indexOf("function shouldMountPageLensDock");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return controller.slice(start, end);
}

describe("page dock mount order", () => {
  it("resolves eligibility before creating any DOM", () => {
    const mountFn = mountFunctionSource();

    // Pages where the dock is disabled must never see a shadow host created
    // and torn down again — the settings read has to come first.
    const eligibilityIndex = mountFn.indexOf("shouldShowPageLensDock()");
    const mountIndex = mountFn.indexOf("createLensesShadowMount(");
    expect(eligibilityIndex).toBeGreaterThan(-1);
    expect(mountIndex).toBeGreaterThan(-1);
    expect(eligibilityIndex).toBeLessThan(mountIndex);
  });

  it("falls back to showing the dock when the settings read fails", () => {
    const mountFn = mountFunctionSource();
    expect(mountFn).toContain(".catch(() => true)");
  });

  it("ignores a late eligibility result after the controller is destroyed", () => {
    const mountFn = mountFunctionSource();

    // syncPageLensDock destroys and re-creates controllers on settings
    // changes; a controller destroyed mid-read must not resurrect the dock.
    const guardIndex = mountFn.indexOf("if (destroyed) return;");
    const mountIndex = mountFn.indexOf("createLensesShadowMount(");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(mountIndex);
  });

  it("still cleans up stale dock hosts once eligibility is known", () => {
    const mountFn = mountFunctionSource();
    expect(mountFn).toContain('removeLensesShadowHosts("page-dock")');
    expect(mountFn).toContain("removeExistingPageLensDockRoots()");
  });
});
