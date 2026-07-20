import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pageDockEnabledFromStorage,
  pageDockToggleTitle,
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_SETTINGS_KEYS,
  PAGE_DOCK_TOGGLE_COMMAND,
} from "../src/lib/page-dock-settings.js";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, "src", relativePath), "utf-8");
}

describe("page dock enabled helpers", () => {
  it("treats a missing value as enabled (fresh install default)", () => {
    expect(pageDockEnabledFromStorage({})).toBe(true);
  });

  it("treats only an explicit false as disabled", () => {
    expect(pageDockEnabledFromStorage({ [PAGE_DOCK_ENABLED_KEY]: false })).toBe(false);
    expect(pageDockEnabledFromStorage({ [PAGE_DOCK_ENABLED_KEY]: true })).toBe(true);
    // Defensive: any non-false value (incl. undefined) reads as enabled.
    expect(pageDockEnabledFromStorage({ [PAGE_DOCK_ENABLED_KEY]: undefined })).toBe(true);
  });

  it("labels the toggle by the resulting action, not the current state", () => {
    expect(pageDockToggleTitle(true)).toBe("Hide Lenses page dock");
    expect(pageDockToggleTitle(false)).toBe("Show Lenses page dock");
  });

  it("includes the enabled key in the visibility-governing key set", () => {
    expect(PAGE_DOCK_SETTINGS_KEYS).toContain(PAGE_DOCK_ENABLED_KEY);
  });
});

describe("page dock re-enable affordances", () => {
  it("registers a keyboard command in the manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(extensionRoot, "manifest.json"), "utf-8")
    ) as { commands?: Record<string, { suggested_key?: Record<string, string> }> };

    expect(manifest.commands).toBeDefined();
    const command = manifest.commands?.[PAGE_DOCK_TOGGLE_COMMAND];
    expect(command).toBeDefined();
    expect(command?.suggested_key?.default).toBe("Ctrl+Shift+L");
    expect(command?.suggested_key?.mac).toBe("Command+Shift+L");
  });

  it("wires the command and context menu in the service worker", () => {
    const worker = readSource("background/service-worker.ts");

    expect(worker).toContain("chrome.commands.onCommand.addListener");
    // The worker references the shared constants by name rather than inlining
    // their string values, so assert on the identifiers it imports.
    expect(worker).toContain("PAGE_DOCK_TOGGLE_COMMAND");
    expect(worker).toContain("togglePageDockEnabled");
    expect(worker).toContain("PAGE_DOCK_TOGGLE_MENU_ID");
    // The toggle is the only Lenses page/selection item, so it must cover all
    // three contexts itself — including "selection", which Chrome would otherwise
    // hide a plain "page" item under.
    expect(worker).toContain('contexts: ["page", "selection", "action"]');
    expect(worker).toContain("updatePageDockToggleMenuTitle");
    expect(worker).toContain("pageDockToggleTitle");
    // The right-click "run a lens on selection" submenu was removed, so the
    // selection menu shows only the dock toggle.
    expect(worker).not.toContain('id: "lenses-parent"');
    expect(worker).not.toContain("for (const lens of LENSES)");
  });

  it("re-syncs the dock and shows an undo toast from the content script", () => {
    const content = readSource("content/content.ts");

    expect(content).toContain("PAGE_DOCK_SETTINGS_KEYS");
    expect(content).toContain("chrome.storage.onChanged.addListener");
    expect(content).toContain("syncPageLensDock");
    expect(content).toContain("showPageDockUndoToast");
    expect(content).toContain("dismissPageDockUndoToast");
    expect(content).toContain("setPageLensDockEnabled(true)");
    expect(content).toContain('actionLabel: "Undo"');
  });

  it("mounts the undo toast in its own shadow surface so it outlives the dock", () => {
    const controller = readSource("content/PageLensDockController.ts");
    const shadowUi = readSource("content/shadow-ui.ts");

    expect(controller).toContain("export function showPageDockUndoToast");
    expect(controller).toContain("export function dismissPageDockUndoToast");
    expect(controller).toContain('surface: "page-dock-toast"');
    expect(controller).toContain("window.top !== window");
    expect(shadowUi).toContain('"page-dock-toast"');
  });

  it("invokes onTurnedOff before tearing the dock down", () => {
    const component = readSource("content/PageLensDock.tsx");

    expect(component).toContain("onTurnedOff");
    // onTurnedOff must fire before onDismiss(), since onDismiss destroys the host.
    const turnedOffIndex = component.indexOf("onTurnedOff?.()");
    const dismissAfterTurnOff = component.indexOf("onDismiss();", turnedOffIndex);
    expect(turnedOffIndex).toBeGreaterThan(-1);
    expect(dismissAfterTurnOff).toBeGreaterThan(turnedOffIndex);
  });
});
