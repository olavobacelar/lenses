import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BUILT_IN_LENSES,
  CHAT_ACTIONS_USE_SIDE_PANEL_KEY,
  DEBUG_MODE_KEY,
  DEFAULT_TEST_SOURCE_MAX_CITATIONS,
  PAGE_DOCK_ENABLED_KEY,
  POPUP_STORAGE_KEYS,
  SHOW_DEBUG_OPTIONS_KEY,
  STORAGE_KEY,
  STORE_PAGE_LENSES_KEY,
  TEST_SOURCE_MAX_CITATIONS_KEY,
  TEST_SOURCE_USE_CACHE_KEY,
} from "../constants";
import { getErrorMessage, logPopupError } from "../chrome";
import { parsePopupStorage } from "../schemas";
import type { PopupStorageState } from "../types";

const INITIAL_STORAGE_STATE: PopupStorageState = {
  selectedLensIds: [],
  autoRun: false,
  debugMode: false,
  showDebugOptions: false,
  storePageLenses: true,
  pageDockEnabled: true,
  chatActionsUseSidePanel: false,
  testSourceMaxCitations: DEFAULT_TEST_SOURCE_MAX_CITATIONS,
  testSourceUseCache: true,
};

export function usePopupStorage() {
  const [storageState, setStorageState] =
    useState<PopupStorageState>(INITIAL_STORAGE_STATE);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const stored = await chrome.storage.local.get([...POPUP_STORAGE_KEYS]);
      if (!cancelled) {
        setStorageState(parsePopupStorage(stored));
      }
    }

    void restore().catch((error) =>
      logPopupError("restore popup settings failed", {
        message: getErrorMessage(error),
      })
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") return;
      setStorageState((current) => ({
        ...current,
        ...(STORAGE_KEY in changes
          ? {
              selectedLensIds: Array.isArray(changes[STORAGE_KEY].newValue)
                ? changes[STORAGE_KEY].newValue.filter(
                    (entry): entry is string => typeof entry === "string"
                  )
                : [],
            }
          : null),
        ...(__INTERNAL_TOOLS__ && DEBUG_MODE_KEY in changes
          ? { debugMode: changes[DEBUG_MODE_KEY].newValue === true }
          : null),
        ...(__INTERNAL_TOOLS__ && SHOW_DEBUG_OPTIONS_KEY in changes
          ? { showDebugOptions: changes[SHOW_DEBUG_OPTIONS_KEY].newValue === true }
          : null),
        ...(PAGE_DOCK_ENABLED_KEY in changes
          ? { pageDockEnabled: changes[PAGE_DOCK_ENABLED_KEY].newValue !== false }
          : null),
        ...(CHAT_ACTIONS_USE_SIDE_PANEL_KEY in changes
          ? {
              chatActionsUseSidePanel:
                changes[CHAT_ACTIONS_USE_SIDE_PANEL_KEY].newValue === true,
            }
          : null),
      }));
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const selectedLensIds = useMemo(
    () => orderedLensIds(storageState.selectedLensIds),
    [storageState.selectedLensIds]
  );

  const setLensChecked = useCallback((lensId: string, checked: boolean) => {
    setStorageState((current) => {
      const nextSet = new Set(current.selectedLensIds);
      if (checked) {
        nextSet.add(lensId);
      } else {
        nextSet.delete(lensId);
      }
      const selectedLensIds = orderedLensIds(Array.from(nextSet));
      void chrome.storage.local.set({ [STORAGE_KEY]: selectedLensIds });
      return { ...current, selectedLensIds };
    });
  }, []);

  const setAutoRun = useCallback((autoRun: boolean) => {
    setStorageState((current) => ({ ...current, autoRun }));
    void chrome.storage.local.set({ autoRun, autoAnalyze: autoRun });
  }, []);

  const setDebugMode = useCallback((debugMode: boolean) => {
    if (!__INTERNAL_TOOLS__) return;
    setStorageState((current) => ({ ...current, debugMode }));
    void chrome.storage.local.set({ [DEBUG_MODE_KEY]: debugMode });
  }, []);

  const setStorePageLenses = useCallback((storePageLenses: boolean) => {
    setStorageState((current) => ({ ...current, storePageLenses }));
    void chrome.storage.local.set({ [STORE_PAGE_LENSES_KEY]: storePageLenses });
  }, []);

  const setPageDockEnabled = useCallback((pageDockEnabled: boolean) => {
    setStorageState((current) => ({ ...current, pageDockEnabled }));
    void chrome.storage.local.set({ [PAGE_DOCK_ENABLED_KEY]: pageDockEnabled });
  }, []);

  const setChatActionsUseSidePanel = useCallback(
    (chatActionsUseSidePanel: boolean) => {
      setStorageState((current) => ({ ...current, chatActionsUseSidePanel }));
      void chrome.storage.local.set({
        [CHAT_ACTIONS_USE_SIDE_PANEL_KEY]: chatActionsUseSidePanel,
      });
    },
    []
  );

  const setTestSourceMaxCitations = useCallback((value: string | number) => {
    const raw = Number(value);
    const testSourceMaxCitations = Number.isFinite(raw)
      ? Math.max(1, Math.min(10, Math.trunc(raw)))
      : DEFAULT_TEST_SOURCE_MAX_CITATIONS;
    setStorageState((current) => ({ ...current, testSourceMaxCitations }));
    void chrome.storage.local.set({
      [TEST_SOURCE_MAX_CITATIONS_KEY]: testSourceMaxCitations,
    });
  }, []);

  const setTestSourceUseCache = useCallback((testSourceUseCache: boolean) => {
    setStorageState((current) => ({ ...current, testSourceUseCache }));
    void chrome.storage.local.set({
      [TEST_SOURCE_USE_CACHE_KEY]: testSourceUseCache,
    });
  }, []);

  return {
    storageState,
    selectedLensIds,
    setLensChecked,
    setAutoRun,
    setDebugMode,
    setStorePageLenses,
    setPageDockEnabled,
    setChatActionsUseSidePanel,
    setTestSourceMaxCitations,
    setTestSourceUseCache,
  };
}

function orderedLensIds(ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return BUILT_IN_LENSES.filter((lens) => selected.has(lens.id)).map((lens) => lens.id);
}
