import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APP_ACCESS_MODE,
  isAppModeChangedMessage,
  parseAppAccessMode,
} from "../src/lib/app-mode.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), "utf-8");
}

describe("app mode parsing", () => {
  it("defaults missing or malformed storage to managed mode", () => {
    expect(parseAppAccessMode(undefined)).toBe(DEFAULT_APP_ACCESS_MODE);
    expect(parseAppAccessMode("local")).toBe("managed");
  });

  it("preserves an explicit Local BYOK selection", () => {
    expect(parseAppAccessMode("local_byok")).toBe("local_byok");
  });

  it("accepts only well-formed runtime change messages", () => {
    expect(
      isAppModeChangedMessage({ type: "app-mode:changed", mode: "managed" })
    ).toBe(true);
    expect(
      isAppModeChangedMessage({ type: "app-mode:changed", mode: "local" })
    ).toBe(false);
  });
});

describe("app mode refresh", () => {
  it("defines a shared app-mode changed runtime message", () => {
    const appMode = readSource("lib/app-mode.ts");

    expect(appMode).toContain('APP_MODE_CHANGED_MESSAGE_TYPE = "app-mode:changed"');
    expect(appMode).toContain("AppModeChangedMessage");
    expect(appMode).toContain("isAppModeChangedMessage");
  });

  it("clears only AI response caches and broadcasts mode changes from the worker", () => {
    const worker = readSource("background/service-worker.ts");

    expect(worker).toContain("APP_ACCESS_MODE_STORAGE_KEY");
    expect(worker).toContain("handleAppAccessModeChanged");
    expect(worker).toContain("clearAiModeCache");
    expect(worker).toContain("broadcastAppModeChanged");
    expect(worker).toContain("SOURCE_CHECK_CACHE_KEY");
    expect(worker).not.toContain(
      "remove([SOURCE_CHECK_CACHE_KEY, USER_LENSES_CACHE_KEY, ACTIVE_CUSTOM_LENS_KEY])"
    );
    expect(worker).toContain("sendRuntimeMessageQuiet");
    expect(worker).toContain("sendTabMessageQuiet");
  });

  it("uses the product-wide provider default in source-check cache keys", () => {
    const worker = readSource("background/service-worker.ts");

    expect(worker).toContain(
      "provider: aiSettings?.provider ?? DEFAULT_MODEL_PROVIDER"
    );
    expect(worker).not.toContain('provider: aiSettings?.provider ?? "anthropic"');
  });

  it("refreshes page content state from the new backing store", () => {
    const content = readSource("content/content.ts");
    const types = readSource("content/types.ts");

    expect(types).toContain("AppModeChangedMessage");
    expect(content).toContain("APP_MODE_CHANGED_MESSAGE_TYPE");
    expect(content).toContain("resetModeScopedPageData");
    expect(content).toContain("activeAnnotations = []");
    expect(content).toContain("resultDisplayModeByLensId.clear()");
    expect(content).toContain("refreshPageSavedSelectionsFromStorage({ replace: true })");
    expect(content).toContain("restoreStoredPageLensResults()");
    expect(content).toContain("syncPageLensDock()");
  });

  it("refreshes side panel data, not only the lens list", () => {
    const app = readSource("sidepanel/App.tsx");
    const chat = readSource("sidepanel/hooks/useChat.ts");
    const customLenses = readSource("sidepanel/hooks/useCustomLenses.ts");
    const claims = readSource("sidepanel/hooks/useClaims.ts");

    expect(app).toContain("isAppModeChangedMessage");
    expect(app).toContain("apiKey.checkApiKey()");
    expect(app).toContain("customLenses.refreshForAppModeChange()");
    expect(app).toContain("chat.restoreMessages()");
    expect(app).toContain("loadActiveSource(true)");
    expect(app).toContain("refreshFindings()");
    expect(chat).toContain("restoreMessages");
    expect(customLenses).toContain("refreshUserLenses");
    expect(customLenses).toContain("refreshForAppModeChange");
    expect(claims).toContain("setClaimsSync(nextClaims)");
  });

  it("refreshes popup state on app mode changes", () => {
    const popup = readSource("popup/usePopupController.ts");

    expect(popup).toContain("isAppModeChangedMessage");
    expect(popup).toContain("refreshConnection");
    expect(popup).toContain("refreshUnsupportedPage");
    expect(popup).toContain("refreshPageDockSite");
    expect(popup).toContain("refreshPins");
    expect(popup).toContain("setComputingLensIds([])");
    expect(popup).toContain("setSettlingLensIds([])");
  });
});
