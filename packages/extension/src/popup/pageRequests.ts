import {
  parseDefuddleResult,
  parsePageTextResult,
  parseReadabilityResult,
} from "./schemas";
import {
  getErrorMessage,
  logPopupError,
  sendRuntimeMessage,
  sendTabMessage,
} from "./chromeBase";
import type {
  DefuddleData,
  DefuddleResult,
  PageTextResult,
  ReadabilityData,
  ReadabilityResult,
} from "./types";

export async function renewSourceCache(): Promise<number> {
  const result = await sendRuntimeMessage<{ clearedCount?: number; error?: string }>({
    type: "clear-source-check-cache",
  });
  if (result?.error) throw new Error(result.error);
  return typeof result?.clearedCount === "number" ? result.clearedCount : 0;
}

export async function getActiveStorableTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return null;
  }
  return tab;
}

export async function getPageTextResultWithRecovery(tabId: number): Promise<PageTextResult> {
  const firstTry = await requestPageText(tabId);
  if (firstTry.text) return firstTry;
  if (!firstTry.missingReceiver) return firstTry;

  const injected = await injectContentScript(tabId);
  if (!injected) {
    logPopupError("receiver missing and reinjection failed", { tabId });
    return firstTry;
  }

  const retry = await requestPageText(tabId);
  if (!retry.text) {
    logPopupError("receiver reinjected but still no page text", { tabId });
  }
  return retry;
}

export async function getPageTextWithRecovery(tabId: number): Promise<string | null> {
  const result = await getPageTextResultWithRecovery(tabId);
  return result.text;
}

export async function getDefuddleWithRecovery(tabId: number): Promise<DefuddleData | null> {
  const firstTry = await requestDefuddleData(tabId);
  if (firstTry.result) return firstTry.result;
  if (!firstTry.missingReceiver) return null;

  const injected = await injectContentScript(tabId);
  if (!injected) {
    logPopupError("defuddle receiver missing and reinjection failed", { tabId });
    return null;
  }

  const retry = await requestDefuddleData(tabId);
  if (!retry.result) {
    logPopupError("defuddle receiver reinjected but still no result", {
      tabId,
      error: retry.error,
    });
  }
  return retry.result;
}

export async function getReadabilityWithRecovery(tabId: number): Promise<ReadabilityData | null> {
  const firstTry = await requestReadabilityData(tabId);
  if (firstTry.result) return firstTry.result;
  if (!firstTry.missingReceiver) return null;

  const injected = await injectContentScript(tabId);
  if (!injected) {
    logPopupError("readability receiver missing and reinjection failed", { tabId });
    return null;
  }

  const retry = await requestReadabilityData(tabId);
  if (!retry.result) {
    logPopupError("readability receiver reinjected but still no result", {
      tabId,
      error: retry.error,
    });
  }
  return retry.result;
}

export async function clearHighlightsOnActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await sendTabMessage(tab.id, { type: "clear" }).catch((error) => {
    logPopupError("manual clear failed", {
      tabId: tab.id,
      message: getErrorMessage(error),
    });
  });
}

async function requestPageText(tabId: number): Promise<PageTextResult> {
  try {
    const response = await sendTabMessage<unknown>(tabId, { type: "get-page-text" });
    return parsePageTextResult(response, false);
  } catch (error) {
    const message = getErrorMessage(error);
    logPopupError("get-page-text failed", { tabId, message });
    return parsePageTextResult(null, isMissingReceiverMessage(message));
  }
}

async function requestDefuddleData(tabId: number): Promise<DefuddleResult> {
  try {
    const response = await sendTabMessage<unknown>(tabId, { type: "get-defuddle" });
    return parseDefuddleResult(response, false);
  } catch (error) {
    const message = getErrorMessage(error);
    logPopupError("get-defuddle failed", { tabId, message });
    return parseDefuddleResult(null, isMissingReceiverMessage(message), message);
  }
}

async function requestReadabilityData(tabId: number): Promise<ReadabilityResult> {
  try {
    const response = await sendTabMessage<unknown>(tabId, { type: "get-readability" });
    return parseReadabilityResult(response, false);
  } catch (error) {
    const message = getErrorMessage(error);
    logPopupError("get-readability failed", { tabId, message });
    return parseReadabilityResult(null, isMissingReceiverMessage(message), message);
  }
}

function injectContentScript(tabId: number): Promise<boolean> {
  if (!chrome.scripting) return Promise.resolve(false);

  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content/content.js"],
      },
      () => {
        if (chrome.runtime.lastError) {
          logPopupError("content script injection failed", {
            tabId,
            message: chrome.runtime.lastError.message,
          });
          resolve(false);
          return;
        }

        chrome.scripting.insertCSS(
          {
            target: { tabId },
            files: ["content/highlight.css"],
          },
          () => {
            if (chrome.runtime.lastError) {
              logPopupError("content css injection failed", {
                tabId,
                message: chrome.runtime.lastError.message,
              });
              resolve(false);
              return;
            }

            resolve(true);
          }
        );
      }
    );
  });
}

function isMissingReceiverMessage(message: string): boolean {
  return message.includes("Receiving end does not exist");
}
