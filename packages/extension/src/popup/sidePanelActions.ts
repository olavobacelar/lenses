import {
  isExtensionOptionsPageUrl,
  SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE,
} from "../lib/source-panel-url";
import { getErrorMessage, logPopupError, sendRuntimeMessage } from "./chromeBase";
import type { PopupSidePanelApi } from "./types";

const popupSidePanel = (chrome as typeof chrome & { sidePanel?: PopupSidePanelApi }).sidePanel;
const SETTINGS_PAGE_URL = chrome.runtime.getURL("settings.html");

export type SidePanelHandoffResult =
  | { opened: true }
  | { opened: false; error: string };

export async function openSourcePanelFromPopup(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (isExtensionOptionsPageUrl(tab?.url, SETTINGS_PAGE_URL)) {
    throw new Error(SOURCE_PANEL_UNAVAILABLE_ON_OPTIONS_PAGE);
  }

  if (tab?.id && popupSidePanel) {
    await popupSidePanel.open({ tabId: tab.id });
    return;
  }

  if (!tab?.id && popupSidePanel) {
    const currentWindow = await chrome.windows.getCurrent();
    if (typeof currentWindow.id === "number" && currentWindow.id >= 0) {
      await popupSidePanel.open({ windowId: currentWindow.id });
      return;
    }
  }

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const response = await openViaBackground(tab.id, tab.url);
  if (!response.success) {
    const backgroundError = response.error ?? "Background did not confirm open.";
    throw new Error(backgroundError);
  }
}

export async function handToSidePanel(): Promise<SidePanelHandoffResult> {
  try {
    await openSourcePanelFromPopup();
    window.close();
    return { opened: true };
  } catch (error) {
    const message = getErrorMessage(error);
    logPopupError("open side panel after action failed", {
      message,
    });
    return { opened: false, error: message };
  }
}

function openViaBackground(
  tabId: number,
  url: string | undefined
): Promise<{ success?: boolean; error?: string }> {
  return sendRuntimeMessage({
    action: "open-source-panel",
    tabId,
    url,
  });
}
