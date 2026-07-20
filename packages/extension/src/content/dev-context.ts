import {
  DEV_CONTEXT_CHECK_MESSAGE_TYPE,
  isExtensionContextInvalidatedMessage,
} from "../lib/dev-reload.js";

let devContextInvalidationNoted = false;
let devContextChecksInstalled = false;

export function noteDevInvalidatedContext(error: unknown): boolean {
  if (!__DEV_RELOAD__) return false;

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!isExtensionContextInvalidatedMessage(message)) return false;

  if (!devContextInvalidationNoted) {
    devContextInvalidationNoted = true;
    console.info("[Lenses] Extension context invalidated after dev reload; reload this tab manually.");
  }
  return true;
}

export function installDevContextReloadChecks(): void {
  if (!__DEV_RELOAD__ || devContextChecksInstalled) return;
  devContextChecksInstalled = true;

  // Restored tabs can keep an old content-script realm after the extension reloads.
  // In dev mode we leave page reloads manual, but this note makes stale tabs easier
  // to recognize when they start reporting invalidated extension contexts.
  const check = () => {
    if (devContextInvalidationNoted) return;

    try {
      chrome.runtime.sendMessage({ type: DEV_CONTEXT_CHECK_MESSAGE_TYPE }, () => {
        const error = chrome.runtime.lastError;
        if (error) noteDevInvalidatedContext(error.message);
      });
    } catch (error) {
      noteDevInvalidatedContext(error);
    }
  };

  const checkSoon = () => {
    window.setTimeout(check, 0);
  };

  window.addEventListener("pageshow", checkSoon);
  window.addEventListener("focus", checkSoon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkSoon();
  });
  window.setTimeout(check, 500);
}
