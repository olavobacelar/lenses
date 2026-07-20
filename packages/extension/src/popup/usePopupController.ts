import { useCallback, useEffect, useRef, useState } from "react";
import { resolveComposerAction, type ComposerMode } from "../lib/composer";
import {
  PINNED_IDS_BY_DOMAIN_KEY,
  parsePinnedIdsByDomain,
  pinKeyFromUrl,
  pinsForDomain,
  toggleLensPinForUrl,
} from "../lib/pinned-lenses";
import {
  getUnsupportedSourcePage,
  type UnsupportedSourcePage,
} from "../lib/source-panel-url";
import { isAppModeChangedMessage } from "../lib/app-mode";
import { initTheme } from "../lib/theme";
import {
  LENS_NAMES,
  PAGE_DOCK_DISABLED_HOSTS_KEY,
  PAGE_DOCK_ENABLED_KEY,
} from "./constants";
import {
  clearHighlightsOnActiveTab,
  clearLiveDebugRuns,
  collectDebugRunsForUrl,
  copyFixturePath,
  copyFixtureText,
  getActiveStorableTab,
  getDefuddleWithRecovery,
  getErrorMessage,
  getPageTextWithRecovery,
  getReadabilityWithRecovery,
  handToSidePanel,
  logPopupError,
  openDebugPayloadInNewTab,
  openFixtureInNewTab,
  openSourcePanelFromPopup,
  renewSourceCache,
  sendRuntimeMessage,
} from "./chrome";
import { usePopupStatus } from "./hooks/usePopupStatus";
import { usePopupStorage } from "./hooks/usePopupStorage";
import type { PopupFixture } from "./types";

type BusyMap = Record<string, boolean>;

// Mirror the page dock's computing→settling rhythm so a selected lens pill
// always breathes for a perceptible beat, even when the run resolves quickly.
const MIN_COMPUTING_VISIBLE_MS = 850;
const COMPUTING_SETTLE_MS = 420;

interface RunPageLensResult {
  lensId: string;
  findingCount: number;
  cancelled?: boolean;
}

interface RunPageLensesResponse {
  error?: string;
  results?: RunPageLensResult[];
}

async function waitForMinimumDuration(startedAt: number, durationMs: number): Promise<void> {
  const remainingMs = durationMs - (performance.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
}

export function usePopupController() {
  const storage = usePopupStorage();
  const { status, showStatus, hideStatus } = usePopupStatus();
  const [composerMode, setComposerMode] = useState<ComposerMode>("lens");
  const [composerInput, setComposerInput] = useState("");
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [connectionFooterHidden, setConnectionFooterHidden] = useState(false);
  const [busy, setBusy] = useState<BusyMap>({});
  // Lens pills mid-run (breathing) and just-finished (settling) so the popup
  // shows the same computing animation the page dock and side rail use.
  const [computingLensIds, setComputingLensIds] = useState<string[]>([]);
  const [settlingLensIds, setSettlingLensIds] = useState<string[]>([]);
  const settlingTimers = useRef(new Map<string, number>());
  const [pageDockSite, setPageDockSite] = useState<{
    host: string | null;
    disabled: boolean;
  }>({ host: null, disabled: false });
  const [pageIdentity, setPageIdentity] = useState<{ title: string | null }>({
    title: null,
  });
  const [unsupportedPage, setUnsupportedPage] = useState<UnsupportedSourcePage | null>(null);
  // Lens pins for the current domain, read from the shared pinned-lenses store
  // (chrome.storage.sync). A pin means "auto-run this lens on this domain" — the
  // same per-domain pin the page rail writes, so the two surfaces stay in lockstep.
  const [pinState, setPinState] = useState<{
    url: string | null;
    domain: string | null;
    pinnedLensIds: string[];
  }>({ url: null, domain: null, pinnedLensIds: [] });

  useEffect(() => {
    const themeController = initTheme({ fastCache: true });
    return () => themeController.destroy();
  }, []);

  useEffect(() => {
    const timers = settlingTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const refreshConnection = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const response = await sendRuntimeMessage<{ ok?: boolean }>({ type: "ping" });
      if (!isCancelled()) setConnectionFooterHidden(!!response?.ok);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void refreshConnection(() => cancelled).catch((error) => {
      logPopupError("ping failed", { message: getErrorMessage(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [refreshConnection]);

  const refreshPageDockSite = useCallback(async () => {
    const tab = await getActiveStorableTab();
    const host = tab?.url ? hostFromUrl(tab.url) : null;
    if (!host) {
      setPageDockSite({ host: null, disabled: false });
      return;
    }

    const stored = await chrome.storage.local.get(PAGE_DOCK_DISABLED_HOSTS_KEY);
    const disabledHosts = readDisabledHosts(stored[PAGE_DOCK_DISABLED_HOSTS_KEY]);
    setPageDockSite({ host, disabled: disabledHosts.includes(host) });
  }, []);

  const refreshUnsupportedPage = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setPageIdentity({ title: titleFromTab(tab) });
    setUnsupportedPage(getUnsupportedSourcePage(tab));
  }, []);

  useEffect(() => {
    void refreshUnsupportedPage().catch((error) => {
      logPopupError("refresh unsupported page failed", {
        message: getErrorMessage(error),
      });
    });
    void refreshPageDockSite().catch((error) => {
      logPopupError("refresh page dock site failed", {
        message: getErrorMessage(error),
      });
    });
  }, [refreshPageDockSite, refreshUnsupportedPage]);

  const refreshPins = useCallback(async () => {
    const tab = await getActiveStorableTab();
    const url = tab?.url ?? null;
    const domain = url ? pinKeyFromUrl(url) : null;
    if (!url || !domain) {
      setPinState({ url: null, domain: null, pinnedLensIds: [] });
      return;
    }

    const stored = await chrome.storage.sync.get(PINNED_IDS_BY_DOMAIN_KEY);
    const pins = pinsForDomain(parsePinnedIdsByDomain(stored[PINNED_IDS_BY_DOMAIN_KEY]), domain);
    setPinState({ url, domain, pinnedLensIds: pins.lensIds });
  }, []);

  useEffect(() => {
    void refreshPins().catch((error) => {
      logPopupError("refresh pinned lenses failed", {
        message: getErrorMessage(error),
      });
    });
  }, [refreshPins]);

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isAppModeChangedMessage(message)) return;

      for (const timer of settlingTimers.current.values()) window.clearTimeout(timer);
      settlingTimers.current.clear();
      setBusy({});
      setComputingLensIds([]);
      setSettlingLensIds([]);
      setComposerMenuOpen(false);
      hideStatus();
      void refreshConnection().catch((error) => {
        logPopupError("ping failed", { message: getErrorMessage(error) });
      });
      void refreshUnsupportedPage().catch((error) => {
        logPopupError("refresh unsupported page failed", {
          message: getErrorMessage(error),
        });
      });
      void refreshPageDockSite().catch((error) => {
        logPopupError("refresh page dock site failed", {
          message: getErrorMessage(error),
        });
      });
      void refreshPins().catch((error) => {
        logPopupError("refresh pinned lenses failed", {
          message: getErrorMessage(error),
        });
      });
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [hideStatus, refreshConnection, refreshPageDockSite, refreshPins, refreshUnsupportedPage]);

  // Keep pins live if another surface (the page rail, another tab) repins while
  // the popup is open. Pins live in chrome.storage.sync, so re-read this domain's
  // set whenever that key changes.
  useEffect(() => {
    const domain = pinState.domain;
    if (!domain) return;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "sync" || !(PINNED_IDS_BY_DOMAIN_KEY in changes)) return;
      const pins = pinsForDomain(
        parsePinnedIdsByDomain(changes[PINNED_IDS_BY_DOMAIN_KEY].newValue),
        domain
      );
      setPinState((current) => ({ ...current, pinnedLensIds: pins.lensIds }));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [pinState.domain]);

  const withBusy = useCallback(async (key: string, work: () => Promise<void>) => {
    setBusy((current) => ({ ...current, [key]: true }));
    try {
      await work();
    } finally {
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }, []);

  const openPanelAfterAction = useCallback(() => {
    void handToSidePanel().then((result) => {
      if (result.opened) return;
      showStatus(`Could not open side panel: ${result.error}`, true, 5000);
    });
  }, [showStatus]);

  const beginSettling = useCallback((lensId: string) => {
    const existing = settlingTimers.current.get(lensId);
    if (existing !== undefined) window.clearTimeout(existing);
    setSettlingLensIds((current) =>
      current.includes(lensId) ? current : [...current, lensId]
    );
    const timer = window.setTimeout(() => {
      settlingTimers.current.delete(lensId);
      setSettlingLensIds((current) => current.filter((id) => id !== lensId));
    }, COMPUTING_SETTLE_MS);
    settlingTimers.current.set(lensId, timer);
  }, []);

  // Run one selected lens on the active page and breathe its pill while the
  // worker computes. The run lives in the service worker, so it finishes even
  // if the popup closes; we keep the popup open so the animation stays visible.
  const computeLensInPopup = useCallback(
    async (lensId: string) => {
      setSettlingLensIds((current) => current.filter((id) => id !== lensId));
      setComputingLensIds((current) =>
        current.includes(lensId) ? current : [...current, lensId]
      );
      const startedAt = performance.now();
      try {
        const response = await sendRuntimeMessage<RunPageLensesResponse>({
          type: "run-page-lenses",
          lensIds: [lensId],
          clearFirst: false,
          storePageLenses: storage.storageState.storePageLenses,
        });
        if (response?.error) throw new Error(response.error);
        const result = response.results?.find((entry) => entry.lensId === lensId);
        if (result?.cancelled) return;
        if ((result?.findingCount ?? 0) === 0) {
          showStatus(`${LENS_NAMES[lensId] ?? "Lens"} found no matches.`, false, 2600);
        }
      } catch (error) {
        showStatus(
          `Could not run ${LENS_NAMES[lensId] ?? "lens"}: ${getErrorMessage(error)}`,
          true,
          4000
        );
      } finally {
        await waitForMinimumDuration(startedAt, MIN_COMPUTING_VISIBLE_MS);
        setComputingLensIds((current) => current.filter((id) => id !== lensId));
        beginSettling(lensId);
      }
    },
    [beginSettling, showStatus, storage.storageState.storePageLenses]
  );

  const runSelectedLenses = useCallback(() => {
    if (unsupportedPage) {
      showStatus(unsupportedPage.message, true, 3200);
      return;
    }
    const lensIds = storage.selectedLensIds;
    if (lensIds.length === 0) return;
    for (const lensId of lensIds) void computeLensInPopup(lensId);
  }, [computeLensInPopup, showStatus, storage.selectedLensIds, unsupportedPage]);

  const submitComposer = useCallback(
    (mode = composerMode) => {
      if (unsupportedPage) {
        showStatus(unsupportedPage.message, true, 3200);
        return;
      }
      const action = resolveComposerAction(mode, composerInput);
      if (action.kind === "noop") return;

      if (action.kind === "lens") {
        chrome.runtime.sendMessage({
          type: "stage-lens-run",
          customLens: { instruction: action.instruction },
          storePageLenses: storage.storageState.storePageLenses,
        });
      } else {
        chrome.runtime.sendMessage({ type: "stage-ask", question: action.instruction });
      }
      openPanelAfterAction();
    },
    [
      composerInput,
      composerMode,
      openPanelAfterAction,
      showStatus,
      storage.storageState.storePageLenses,
      unsupportedPage,
    ]
  );

  const chooseComposerModeAndSubmit = useCallback(
    (mode: ComposerMode) => {
      setComposerMode(mode);
      setComposerMenuOpen(false);
      submitComposer(mode);
    },
    [submitComposer]
  );

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  const openSourcePanel = useCallback(async () => {
    await withBusy("open-source-panel", async () => {
      try {
        await openSourcePanelFromPopup();
        window.close();
      } catch (error) {
        const message = getErrorMessage(error);
        logPopupError("open source panel failed", { message });
        showStatus(`Could not open source panel: ${message}`, true, 5000);
      }
    });
  }, [showStatus, withBusy]);

  const openPageDebugView = useCallback(async () => {
    if (!__INTERNAL_TOOLS__) return;
    await withBusy("open-page-debug-view", async () => {
      const tab = await getActiveStorableTab();
      if (!tab?.id || !tab.url) {
        showStatus("No storable page URL found", true, 3000);
        return;
      }

      showStatus("Preparing debug view...");
      const pageText = await getPageTextWithRecovery(tab.id);
      if (!pageText) {
        showStatus("Could not read page content", true, 4000);
        return;
      }

      const runs = await collectDebugRunsForUrl(tab.url);
      const defuddle = await getDefuddleWithRecovery(tab.id);
      const readability = await getReadabilityWithRecovery(tab.id);
      await openDebugPayloadInNewTab({
        sourceUrl: tab.url,
        pageText,
        runs,
        defuddle,
        readability,
        generatedAt: new Date().toISOString(),
        theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
      });
      hideStatus();
    });
  }, [hideStatus, showStatus, withBusy]);

  const clearHighlights = useCallback(async () => {
    if (unsupportedPage) {
      showStatus(unsupportedPage.message, true, 3200);
      return;
    }
    await clearHighlightsOnActiveTab();
    hideStatus();
  }, [hideStatus, showStatus, unsupportedPage]);

  const enablePageDockOnCurrentSite = useCallback(async () => {
    await withBusy("enable-page-dock-site", async () => {
      const host = pageDockSite.host;
      if (!host) {
        showStatus("No website found for this tab", true, 3000);
        return;
      }

      const stored = await chrome.storage.local.get(PAGE_DOCK_DISABLED_HOSTS_KEY);
      const disabledHosts = readDisabledHosts(stored[PAGE_DOCK_DISABLED_HOSTS_KEY]).filter(
        (entry) => entry !== host
      );
      await chrome.storage.local.set({
        [PAGE_DOCK_DISABLED_HOSTS_KEY]: disabledHosts,
        [PAGE_DOCK_ENABLED_KEY]: true,
      });
      setPageDockSite({ host, disabled: false });
      showStatus("Page dock enabled. Reload this page to show it.", false, 3200);
    });
  }, [pageDockSite.host, showStatus, withBusy]);

  // Pin / unpin a lens for the current domain. The pin lives in the shared
  // pinned-lenses store, so the page rail picks it up and auto-runs the lens on
  // this domain. Flip local state optimistically for an instant response; the
  // storage listener above reconciles to the persisted value.
  const toggleLensPin = useCallback(
    async (lensId: string) => {
      const url = pinState.url;
      if (!url) return;
      setPinState((current) => {
        const isPinned = current.pinnedLensIds.includes(lensId);
        return {
          ...current,
          pinnedLensIds: isPinned
            ? current.pinnedLensIds.filter((id) => id !== lensId)
            : [...current.pinnedLensIds, lensId],
        };
      });
      await toggleLensPinForUrl(url, lensId);
    },
    [pinState.url]
  );

  const clearPageStorage = useCallback(async () => {
    if (!__INTERNAL_TOOLS__) return;
    await withBusy("clear-page-storage", async () => {
      const tab = await getActiveStorableTab();
      if (!tab?.url) {
        showStatus("No storable page URL found", true, 3000);
        return;
      }

      showStatus("Deleting stored lenses for this page...");
      const result = await sendRuntimeMessage<{ deletedRuns?: number; error?: string }>({
        type: "clear-page-storage",
        sourceUrl: tab.url,
      });
      if (result?.error) {
        logPopupError("clear page storage failed", {
          sourceUrl: tab.url,
          resultError: result.error,
        });
        showStatus("Could not delete stored lenses", true, 4000);
        return;
      }

      const deletedRuns = typeof result?.deletedRuns === "number" ? result.deletedRuns : 0;
      clearLiveDebugRuns(tab.url);
      showStatus(
        deletedRuns > 0
          ? `Deleted ${deletedRuns} stored run${deletedRuns === 1 ? "" : "s"}`
          : "No stored lenses found for this page",
        false,
        2500
      );
    });
  }, [showStatus, withBusy]);

  const renewCache = useCallback(async () => {
    if (!__INTERNAL_TOOLS__) return;
    await withBusy("renew-source-cache", async () => {
      showStatus("Renewing source cache...");
      try {
        const clearedCount = await renewSourceCache();
        showStatus(`Source cache renewed (${clearedCount} entries cleared)`, false, 1800);
      } catch (error) {
        logPopupError("renew source cache failed", {
          message: getErrorMessage(error),
        });
        showStatus("Could not renew source cache", true, 3000);
      }
    });
  }, [showStatus, withBusy]);

  const openFixture = useCallback(
    async (fixture: PopupFixture) => {
      if (!__INTERNAL_TOOLS__) return;
      await withBusy(`fixture:${fixture.id}:open`, async () => {
        showStatus("Opening fixture...");
        try {
          await openFixtureInNewTab(fixture);
          hideStatus();
        } catch (error) {
          logPopupError("open fixture failed", {
            fixtureId: fixture.id,
            message: getErrorMessage(error),
          });
          showStatus("Could not open fixture", true, 3000);
        }
      });
    },
    [hideStatus, showStatus, withBusy]
  );

  const copyPath = useCallback(
    async (fixture: PopupFixture) => {
      if (!__INTERNAL_TOOLS__) return;
      await withBusy(`fixture:${fixture.id}:path`, async () => {
        try {
          await copyFixturePath(fixture);
          showStatus("Fixture path copied", false, 1200);
        } catch (error) {
          logPopupError("copy fixture path failed", {
            fixtureId: fixture.id,
            message: getErrorMessage(error),
          });
          showStatus("Could not copy fixture path", true, 2500);
        }
      });
    },
    [showStatus, withBusy]
  );

  const copyText = useCallback(
    async (fixture: PopupFixture) => {
      if (!__INTERNAL_TOOLS__) return;
      await withBusy(`fixture:${fixture.id}:text`, async () => {
        showStatus("Loading fixture text...");
        try {
          await copyFixtureText(fixture);
          showStatus("Fixture text copied", false, 1200);
        } catch (error) {
          logPopupError("copy fixture text failed", {
            fixtureId: fixture.id,
            message: getErrorMessage(error),
          });
          showStatus("Could not copy fixture text", true, 3000);
        }
      });
    },
    [showStatus, withBusy]
  );

  return {
    ...storage,
    busy,
    computingLensIds,
    settlingLensIds,
    status,
    composerMode,
    composerInput,
    composerMenuOpen,
    connectionFooterHidden,
    unsupportedPage,
    pageDockSiteDisabled: pageDockSite.disabled,
    pageDockSiteHost: pageDockSite.host,
    domain: pinState.domain,
    pageTitle: pageIdentity.title,
    pinnedLensIds: pinState.pinnedLensIds,
    setComposerMode,
    setComposerInput,
    setComposerMenuOpen,
    chooseComposerModeAndSubmit,
    submitComposer,
    runSelectedLenses,
    openSettings,
    openSourcePanel,
    openPageDebugView,
    clearHighlights,
    enablePageDockOnCurrentSite,
    toggleLensPin,
    clearPageStorage,
    renewCache,
    openFixture,
    copyPath,
    copyText,
  };
}

function titleFromTab(tab: chrome.tabs.Tab | undefined): string | null {
  const title = tab?.title?.trim();
  if (!title || title === tab?.url) return null;
  return title;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function readDisabledHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
