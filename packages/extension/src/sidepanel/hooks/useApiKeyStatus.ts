import { useCallback, useEffect, useState } from "react";
import { AI_SETTINGS_STORAGE_KEYS } from "../../lib/ai-settings-compat";
import { openApiKeySettings, sendRuntimeMessage } from "../lib/chrome";

export function useApiKeyStatus() {
  const [hasApiKey, setHasApiKey] = useState(true);

  const checkApiKey = useCallback(async () => {
    const result = await sendRuntimeMessage<{ hasKey?: boolean }>({
      action: "checkApiKey",
    });
    setHasApiKey(!!result.hasKey);
  }, []);

  const markMissingApiKey = useCallback(() => {
    setHasApiKey(false);
  }, []);

  useEffect(() => {
    void checkApiKey();

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (
        (areaName === "sync" && changes[AI_SETTINGS_STORAGE_KEYS.provider]) ||
        (areaName === "local" &&
          (changes[AI_SETTINGS_STORAGE_KEYS.anthropicApiKey] ||
            changes[AI_SETTINGS_STORAGE_KEYS.openaiApiKey]))
      ) {
        void checkApiKey();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [checkApiKey]);

  return {
    hasApiKey,
    checkApiKey,
    markMissingApiKey,
    openApiKeySettings,
  };
}
