import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_CONTEXT_CHECK_MESSAGE_TYPE,
  isExtensionContextInvalidatedMessage,
} from "../src/lib/dev-reload.js";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

describe("dev reload lifecycle", () => {
  it("recognizes invalidated extension context errors", () => {
    expect(isExtensionContextInvalidatedMessage("Extension context invalidated.")).toBe(true);
    expect(isExtensionContextInvalidatedMessage(new Error("Extension context invalidated."))).toBe(
      true
    );
    expect(isExtensionContextInvalidatedMessage("Receiving end does not exist.")).toBe(false);
  });

  it("reloads the extension without reloading browser tabs", () => {
    const worker = readSource("background/service-worker.ts");

    expect(worker).toContain("reloadExtensionForDev");
    expect(worker).toContain("chrome.runtime.reload()");
    expect(worker).not.toContain("reloadPendingDevTabs");
    expect(worker).not.toContain("DEV_RELOAD_PENDING_TABS_KEY");
    expect(worker).not.toContain("chrome.tabs.reload");
  });

  it("lets stale dev content scripts probe the current worker without reloading the page", () => {
    const worker = readSource("background/service-worker.ts");
    const content = readSource("content/content.ts");
    const devContext = readSource("content/dev-context.ts");
    const dock = readSource("content/PageLensDock.tsx");
    const devReload = readSource("lib/dev-reload.ts");

    expect(worker).toContain("DEV_CONTEXT_CHECK_MESSAGE_TYPE");
    expect(devReload).toContain(DEV_CONTEXT_CHECK_MESSAGE_TYPE);
    expect(worker).toContain("sendResponse({ ok: true })");
    expect(content).toContain("installDevContextReloadChecks()");
    expect(devContext).toContain("chrome.runtime.sendMessage({ type: DEV_CONTEXT_CHECK_MESSAGE_TYPE }");
    expect(devContext).toContain('window.addEventListener("pageshow"');
    expect(devContext).toContain('window.addEventListener("focus"');
    expect(devContext).toContain("document.visibilityState === \"visible\"");
    expect(devContext).not.toContain("window.location.reload()");
    expect(devContext).toContain("reload this tab manually");
    expect(dock).toContain("noteDevInvalidatedContext(runtimeError)");
    expect(dock).toContain("Reload this page to reconnect Lenses.");
  });
});
