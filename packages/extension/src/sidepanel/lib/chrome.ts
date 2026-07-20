import { Effect } from "effect";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function lastRuntimeError(): Error | null {
  const error = chrome.runtime.lastError;
  return error ? new Error(error.message) : null;
}

// MV3 recycles the background worker aggressively. A message sent while it
// cold-starts can lose its reply port ("The message port closed before a
// response was received") or find no listener registered yet ("Receiving end
// does not exist"). Both are transient: the send itself wakes the worker, so a
// single short-delay retry lands on a warm one.
const WORKER_RETRY_DELAY_MS = 150;
const ACTIVE_TAB_RETRY_DELAY_MS = 100;

export function isTransientWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("message port closed") || isMissingReceiverError(error))
  );
}

function sendRuntimeMessageOnce<T>(message: unknown): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<T>((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            const error = lastRuntimeError();
            if (error) {
              reject(error);
              return;
            }
            resolve(response as T);
          });
        }),
      catch: toError,
    })
  );
}

export async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  try {
    return await sendRuntimeMessageOnce<T>(message);
  } catch (error) {
    if (!isTransientWorkerError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, WORKER_RETRY_DELAY_MS));
    try {
      return await sendRuntimeMessageOnce<T>(message);
    } catch (retryError) {
      // Still down after a retry: surface something a person can act on
      // instead of Chrome's internal port wording.
      throw isTransientWorkerError(retryError)
        ? new Error(
            "Lenses couldn't reach its background service. Try again in a moment."
          )
        : retryError;
    }
  }
}

export function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<T>((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            const error = lastRuntimeError();
            if (error) {
              reject(error);
              return;
            }
            resolve(response as T);
          });
        }),
      catch: toError,
    })
  );
}

export async function sendToActiveTab<T>(
  tabId: number | null,
  message: unknown,
  recover: boolean
): Promise<T> {
  if (!tabId) throw new Error("No active tab.");

  try {
    return await sendToTab<T>(tabId, message);
  } catch (error) {
    if (!recover || !isMissingReceiverError(error)) throw error;
    await injectContentScript(tabId);
    return sendToTab<T>(tabId, message);
  }
}

export async function captureVisibleTabScreenshot(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.windowId !== "number") throw new Error("No active window.");

  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<string>((resolve, reject) => {
          chrome.tabs.captureVisibleTab(
            tab.windowId,
            { format: "jpeg", quality: 85 },
            (dataUrl) => {
              const error = lastRuntimeError();
              if (error) {
                reject(error);
                return;
              }
              if (!dataUrl) {
                reject(new Error("Screenshot failed."));
                return;
              }
              resolve(dataUrl);
            }
          );
        }),
      catch: toError,
    })
  );
}

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  // `currentWindow` can briefly point at the side panel's extension surface
  // while focus is moving between browser windows. Chrome's own "current tab"
  // examples use `lastFocusedWindow`, which keeps this query anchored to the
  // browser window the person was actually using. One bounded retry absorbs
  // the short empty result Chrome can emit during activation/navigation.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (typeof tab?.id === "number" && tab.url) return tab;
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, ACTIVE_TAB_RETRY_DELAY_MS));
    }
  }
  throw new Error("No active tab.");
}

export async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"],
  });
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/highlight.css"],
    });
  } catch {
    // Highlight CSS is not required for source-panel reads.
  }
}

export function isMissingReceiverError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}

export function openApiKeySettings(): void {
  chrome.tabs.create({
    url: chrome.runtime.getURL("settings.html#api-keys"),
  });
}

// Open the lens editor in a tab, optionally deep-linked to a specific lens. The
// settings page reads the hash on load to pick the Lenses view and selection.
export function openLensEditor(lensId?: string): void {
  const hash = lensId ? `#lenses/${encodeURIComponent(lensId)}` : "#lenses";
  chrome.tabs.create({
    url: chrome.runtime.getURL(`settings.html${hash}`),
  });
}

export function openOptionsPage(): void {
  chrome.runtime.openOptionsPage();
}

export function openEvidenceBaseLibrary(evidenceBaseId?: string): void {
  const hash = evidenceBaseId ? `#${encodeURIComponent(evidenceBaseId)}` : "";
  chrome.tabs.create({
    url: chrome.runtime.getURL(`evidence-bases/evidence-bases.html${hash}`),
  });
}
