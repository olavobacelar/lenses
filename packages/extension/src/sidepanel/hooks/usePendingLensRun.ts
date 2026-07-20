import { useCallback, useEffect, useRef } from "react";
import {
  isPendingLensRunFresh,
  parsePendingLensRun,
  pendingLensRunKey,
  type PendingLensRun,
} from "../../lib/composer";
import { formatError } from "../lib/format";

interface UsePendingLensRunOptions {
  activeTabId: number | null;
  sourceReady: boolean;
  isRunning: boolean;
  runPendingLensRun: (run: PendingLensRun) => Promise<void>;
  showWarning: (message: string) => void;
}

export function usePendingLensRun({
  activeTabId,
  sourceReady,
  isRunning,
  runPendingLensRun,
  showWarning,
}: UsePendingLensRunOptions) {
  const consumingRef = useRef(false);

  const consumePendingLensRun = useCallback(async () => {
    if (
      consumingRef.current ||
      activeTabId == null ||
      !sourceReady ||
      isRunning
    ) {
      return;
    }

    consumingRef.current = true;
    try {
      const key = pendingLensRunKey(activeTabId);
      const stored = await chrome.storage.local.get(key);
      const run = parsePendingLensRun(stored[key]);
      if (!run) {
        if (stored[key] !== undefined) await chrome.storage.local.remove(key);
        return;
      }

      await chrome.storage.local.remove(key);
      if (!isPendingLensRunFresh(run, Date.now())) return;

      await runPendingLensRun(run);
    } catch (error) {
      console.error("[Lenses][sidepanel] consume pending lens run failed", error);
      showWarning(formatError(error));
    } finally {
      consumingRef.current = false;
    }
  }, [activeTabId, isRunning, runPendingLensRun, showWarning, sourceReady]);

  useEffect(() => {
    void consumePendingLensRun();
  }, [consumePendingLensRun]);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || activeTabId == null) return;
      if (changes[pendingLensRunKey(activeTabId)]?.newValue) {
        void consumePendingLensRun();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [activeTabId, consumePendingLensRun]);
}
