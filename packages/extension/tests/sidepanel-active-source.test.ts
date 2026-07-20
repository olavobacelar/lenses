import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceHookPath = join(here, "..", "src", "sidepanel", "hooks", "useActiveSource.ts");
const sourceHook = readFileSync(sourceHookPath, "utf-8");
const appPath = join(here, "..", "src", "sidepanel", "App.tsx");
const app = readFileSync(appPath, "utf-8");

describe("sidepanel active source refresh", () => {
  it("refreshes the source when the active tab changes or navigates", () => {
    expect(sourceHook).toContain("chrome.tabs.onActivated.addListener");
    expect(sourceHook).toContain("chrome.tabs.onUpdated.addListener");
    expect(sourceHook).toContain("tabId !== activeTabId");
    expect(sourceHook).toContain("changeInfo.url");
    expect(sourceHook).toContain('changeInfo.status === "complete"');
    expect(sourceHook).toContain("reloadActiveSourceSoon");
  });

  it("guards async source loads so stale page reads cannot overwrite newer state", () => {
    expect(sourceHook).toContain("loadRequestIdRef");
    expect(sourceHook).toContain("const isLatest = () => loadRequestIdRef.current === requestId");
    expect(sourceHook).toContain("if (!isLatest()) return;");
    expect(sourceHook).toContain("loadRequestIdRef.current += 1");
  });

  it("keeps the current source visible until Chrome resolves the replacement", () => {
    expect(sourceHook).toContain("setIsLoadingSource(true)");
    const activeTabRead = sourceHook.indexOf("const tab = await getActiveTab()");
    const firstSourceClear = sourceHook.indexOf("setSource(null)");
    expect(activeTabRead).toBeGreaterThan(-1);
    expect(firstSourceClear).toBeGreaterThan(activeTabRead);
    expect(app).toContain(
      "canExtract={!isLoadingSource && canRunClaimExtractor(source, transcript)}"
    );
  });

  it("surfaces unsupported tabs before sending content-script messages", () => {
    expect(sourceHook).toContain("getUnsupportedSourcePage(tab)");
    expect(sourceHook).toContain("setUnsupportedPage(nextUnsupportedPage)");
    expect(sourceHook).toContain("unsupportedPage");

    const unsupportedIndex = sourceHook.indexOf("getUnsupportedSourcePage(tab)");
    const pageReadIndex = sourceHook.indexOf('type: "get-page-text"');
    expect(unsupportedIndex).toBeGreaterThan(-1);
    expect(pageReadIndex).toBeGreaterThan(unsupportedIndex);
  });
});
