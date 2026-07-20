import { createTab, getErrorMessage, logPopupError, sendRuntimeMessage } from "./chromeBase";
import { mergeDebugRuns } from "./debugModel";
import { parseDebugDataResponse } from "./schemas";
import type { DebugRun, DebugViewPayload } from "./types";

const liveDebugRunsByPage = new Map<string, Map<string, DebugRun>>();

export async function collectDebugRunsForUrl(sourceUrl: string): Promise<DebugRun[]> {
  if (!__INTERNAL_TOOLS__) return [];
  const storedRuns = await getPageDebugData(sourceUrl, []).catch((error) => {
    logPopupError("fetch page debug data failed", {
      sourceUrl,
      message: getErrorMessage(error),
    });
    return [];
  });
  return mergeDebugRuns(storedRuns, getLiveDebugRuns(sourceUrl));
}

export function clearLiveDebugRuns(sourceUrl: string): void {
  if (!__INTERNAL_TOOLS__) return;
  liveDebugRunsByPage.delete(sourceUrl);
}

export async function openDebugPayloadInNewTab(payload: DebugViewPayload): Promise<void> {
  if (!__INTERNAL_TOOLS__) return;
  const key = `debug-page-payload:${Date.now()}:${crypto.randomUUID()}`;
  await chrome.storage.local.set({ [key]: payload });
  await createTab(
    chrome.runtime.getURL(`popup/debug-view.html?key=${encodeURIComponent(key)}`)
  );
  setTimeout(() => {
    chrome.storage.local.remove(key);
  }, 5 * 60 * 1000);
}

function getPageDebugData(sourceUrl: string, lensIds: string[]): Promise<DebugRun[]> {
  if (!__INTERNAL_TOOLS__) return Promise.resolve([]);
  return sendRuntimeMessage<unknown>({
    type: "get-page-debug-data",
    sourceUrl,
    lensIds,
  }).then((response) => {
    const parsed = parseDebugDataResponse(response);
    if (parsed.error) throw new Error(parsed.error);
    return parsed.runs ?? [];
  });
}

function getLiveDebugRuns(sourceUrl: string): DebugRun[] {
  if (!__INTERNAL_TOOLS__) return [];
  const byLens = liveDebugRunsByPage.get(sourceUrl);
  if (!byLens) return [];
  return Array.from(byLens.values());
}
