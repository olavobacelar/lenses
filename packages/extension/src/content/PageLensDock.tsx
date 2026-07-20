import * as Checkbox from "@radix-ui/react-checkbox";
import {
  CircleBackslashIcon,
  Cross2Icon,
  DotsHorizontalIcon,
  DrawingPinFilledIcon,
  DrawingPinIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  Link2Icon,
  MagicWandIcon,
  ReaderIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LensConfig, LensDomainRules } from "@lenses/shared";
import {
  BAY_LENS_LABELS,
  BAY_LENS_ORDER,
  CUSTOM_LENS_DOT_COLOR,
  buildLensOptions,
  orderedSelectedLenses,
  withoutRetiredLensIds,
} from "../lib/control-bay.js";
import {
  fallbackLensName,
  newCustomLensId,
  persistedExtraLensIds,
  type ActiveCustomLens,
  type UserLens,
} from "../lib/custom-lens.js";
import {
  domainLensOptions,
  LENS_DOMAIN_RULES_KEY,
  readLensDomainRules,
  type DomainLensOption,
} from "../lib/lens-domain-rules.js";
import { lensFromRow } from "../lib/lens-library.js";
import {
  PINNED_IDS_BY_DOMAIN_KEY,
  parsePinnedIdsByDomain,
  pinKeyFromUrl,
  pinsForDomain,
  toggleLensPinForUrl,
} from "../lib/pinned-lenses.js";
import {
  disablePageLensDockForCurrentSite,
  setPageLensDockEnabled,
} from "./PageLensDockSettings.js";
import { noteDevInvalidatedContext } from "./dev-context.js";
import type { LensResultDisplayMode } from "./types.js";
import { publicErrorMessage } from "../lib/public-error.js";

const ACTIVE_CUSTOM_LENS_KEY = "customLens:active";
const STORE_PAGE_LENSES_KEY = "storePageLenses";
const USER_LENSES_CACHE_KEY = "userLenses";
const MIN_COMPUTING_VISIBLE_MS = 850;
const COMPUTING_SETTLE_MS = 420;
const COMPUTING_ANIMATION_DEBUG_DELAY_MS = 180;

type DockView = "lenses" | "results" | "custom";
type DockIconName =
  | "lenses"
  | "results"
  | "claims"
  | "sources"
  | "sidebar"
  | "custom"
  | "edit"
  | "close";

type DockStatus =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "success"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string; detail?: string };

interface RunPageLensResult {
  lensId: string;
  findingCount: number;
  renderedCount?: number;
  failedAnchorCount?: number;
  /** Worker sets this when the run was aborted via cancel-page-lens. */
  cancelled?: boolean;
}

interface RunPageLensesResponse {
  ranLenses?: number;
  error?: string;
  results?: RunPageLensResult[];
}

type DefaultLensId = (typeof BAY_LENS_ORDER)[number];
const DOCK_LENS_DOT_COLORS: Record<DefaultLensId, string> = {
  "claim-extractor": "#4f8df9",
  "source-tracer": "#059669",
};
const RESULT_DISPLAY_MODES: Array<{ mode: LensResultDisplayMode; label: string }> = [
  { mode: "inline", label: "Inline" },
  { mode: "notes", label: "Notes" },
  { mode: "list", label: "List" },
  { mode: "off", label: "Off" },
];
type DockLensConfig = Pick<
  LensConfig,
  "allowedDomains" | "focus" | "id" | "name" | "visible"
>;

interface DockLensOption extends DomainLensOption {
  accent: string;
  kind: "system" | "user";
}

interface DockResultItem {
  id: string;
  name: string;
  accent: string;
}

export interface PageLensDockLensState {
  computedLensIds: string[];
  findingCountByLensId?: Record<string, number>;
  renderedCountByLensId?: Record<string, number>;
  anchorFailureCountByLensId?: Record<string, number>;
  resultDisplayModeByLensId?: Record<string, LensResultDisplayMode>;
  visibleLensIds: string[];
}

const BUILT_IN_LENSES: Array<{
  id: DefaultLensId;
  icon: DockIconName;
  accent: string;
}> = [
  { id: "claim-extractor", icon: "claims", accent: DOCK_LENS_DOT_COLORS["claim-extractor"] },
  { id: "source-tracer", icon: "sources", accent: DOCK_LENS_DOT_COLORS["source-tracer"] },
];

const BUILT_IN_BY_ID = new Map(BUILT_IN_LENSES.map((lens) => [lens.id, lens]));
const FALLBACK_DEFAULT_LENSES: DockLensConfig[] = BUILT_IN_LENSES.map((lens) => ({
  id: lens.id,
  name: BAY_LENS_LABELS[lens.id],
  allowedDomains: [],
  focus: "source",
  visible: true,
}));

export function PageLensDock({
  onDismiss,
  onTurnedOff,
  getLensState,
  onLensDisplayModeChange,
  onLensResultsClear,
  onLensVisibilityChange,
  subscribeToLensState,
}: {
  onDismiss: () => void;
  onTurnedOff?: () => void;
  getLensState: () => PageLensDockLensState;
  onLensDisplayModeChange: (lensId: string, mode: LensResultDisplayMode) => void;
  onLensResultsClear: (lensId: string) => void;
  onLensVisibilityChange: (lensId: string, visible: boolean) => void;
  subscribeToLensState: (listener: () => void) => () => void;
}) {
  const [view, setView] = useState<DockView | null>(null);
  const [status, setStatus] = useState<DockStatus>({ kind: "idle" });
  const [customInstruction, setCustomInstruction] = useState("");
  const [dismissMenuOpen, setDismissMenuOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [lensRuntimeState, setLensRuntimeState] = useState<PageLensDockLensState>(() =>
    getLensState()
  );
  const [locallyComputedLensIds, setLocallyComputedLensIds] = useState<string[]>([]);
  const [locallyComputedFindingCountByLensId, setLocallyComputedFindingCountByLensId] =
    useState<Record<string, number>>({});
  const [locallyRenderedCountByLensId, setLocallyRenderedCountByLensId] =
    useState<Record<string, number>>({});
  const [locallyAnchorFailureCountByLensId, setLocallyAnchorFailureCountByLensId] =
    useState<Record<string, number>>({});
  const [pendingLensIds, setPendingLensIds] = useState<string[]>([]);
  const [queuedLensIds, setQueuedLensIds] = useState<string[]>([]);
  const [settlingLensIds, setSettlingLensIds] = useState<string[]>([]);
  const [lensOptions, setLensOptions] = useState<DockLensOption[]>(() =>
    buildDockLensOptions(FALLBACK_DEFAULT_LENSES, [], null, window.location.href, {})
  );
  const [selectedLensIds, setSelectedLensIds] = useState<string[]>(() =>
    orderDockLensIds(getLensState().visibleLensIds)
  );

  // Per-domain lens pins the user pinned to auto-run on the current domain
  // (see ../lib/pinned-lenses).
  const [pinnedLensIds, setPinnedLensIds] = useState<string[]>([]);
  const pinnedLensIdSet = useMemo(() => new Set(pinnedLensIds), [pinnedLensIds]);
  const autoRanPinnedRef = useRef(false);

  const busy = status.kind === "running";
  const customReady = customInstruction.trim().length > 0 && !busy;
  const activePanelView = dismissMenuOpen ? null : view;
  const activeViewTitle =
    activePanelView === "custom"
      ? "Custom lens"
      : activePanelView === "results"
        ? "Results"
        : "Lenses";
  const selectedDockLensIds = useMemo(
    () => orderDockLensIds(selectedLensIds),
    [selectedLensIds]
  );
  const computedLensIds = useMemo(
    () =>
      new Set([
        ...lensRuntimeState.computedLensIds,
        ...locallyComputedLensIds,
        ...Object.keys(locallyComputedFindingCountByLensId),
      ]),
    [lensRuntimeState.computedLensIds, locallyComputedLensIds, locallyComputedFindingCountByLensId]
  );
  const findingCountByLensId = useMemo(
    () => ({
      ...(lensRuntimeState.findingCountByLensId ?? {}),
      ...locallyComputedFindingCountByLensId,
    }),
    [lensRuntimeState.findingCountByLensId, locallyComputedFindingCountByLensId]
  );
  const renderedCountByLensId = useMemo(
    () => ({
      ...(lensRuntimeState.renderedCountByLensId ?? {}),
      ...locallyRenderedCountByLensId,
    }),
    [lensRuntimeState.renderedCountByLensId, locallyRenderedCountByLensId]
  );
  const anchorFailureCountByLensId = useMemo(
    () => ({
      ...(lensRuntimeState.anchorFailureCountByLensId ?? {}),
      ...locallyAnchorFailureCountByLensId,
    }),
    [lensRuntimeState.anchorFailureCountByLensId, locallyAnchorFailureCountByLensId]
  );
  const resultDisplayModeByLensId = useMemo(
    () => lensRuntimeState.resultDisplayModeByLensId ?? {},
    [lensRuntimeState.resultDisplayModeByLensId]
  );
  const pendingLensIdSet = useMemo(() => new Set(pendingLensIds), [pendingLensIds]);
  const settlingLensIdSet = useMemo(() => new Set(settlingLensIds), [settlingLensIds]);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const customInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const desiredVisibleLensIdsRef = useRef(new Set(selectedLensIds));
  const runningLensIdsRef = useRef(new Set<string>());
  const settlingTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    desiredVisibleLensIdsRef.current = new Set(selectedLensIds);
  }, [selectedLensIds]);

  useEffect(() => {
    if (activePanelView !== "custom") return;
    customInstructionRef.current?.focus({ preventScroll: true });
  }, [activePanelView]);

  useEffect(() => {
    let cancelled = false;

    void sendRuntimeMessage<{ open?: boolean; error?: string }>({
      action: "get-source-panel-state",
    })
      .then((response) => {
        if (!cancelled && typeof response?.open === "boolean") {
          setSourcePanelOpen(response.open);
        }
      })
      .catch(() => undefined);

    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const stateMessage = message as { type?: unknown; open?: unknown };
      if (stateMessage.type !== "source-panel-state") return;
      if (typeof stateMessage.open === "boolean") {
        setSourcePanelOpen(stateMessage.open);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  useEffect(() => {
    if (!sourcePanelOpen) return;
    setView(null);
    setDismissMenuOpen(false);
    setStatus({ kind: "idle" });
  }, [sourcePanelOpen]);

  useEffect(() => {
    return () => {
      for (const timer of settlingTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      settlingTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return subscribeToLensState(() => setLensRuntimeState(getLensState()));
  }, [getLensState, subscribeToLensState]);

  useEffect(() => {
    const desiredPendingLensIds = pendingLensIds.filter((lensId) =>
      desiredVisibleLensIdsRef.current.has(lensId)
    );
    setSelectedLensIds(
      orderDockLensIds([...lensRuntimeState.visibleLensIds, ...desiredPendingLensIds])
    );
  }, [lensRuntimeState.visibleLensIds, pendingLensIds]);

  useEffect(() => {
    if (pendingLensIds.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const firstSamples = pendingLensIds.map((lensId) =>
        readComputingAnimationDebug(dockRef.current, lensId)
      );
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const secondSamples = pendingLensIds.map((lensId) =>
          readComputingAnimationDebug(dockRef.current, lensId)
        );
        console.debug("[Lenses][page-dock] computing animation", {
          summary: summarizeComputingAnimationDebug(firstSamples, secondSamples),
          firstSamples,
          secondSamples,
        });
      }, COMPUTING_ANIMATION_DEBUG_DELAY_MS);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingLensIds]);

  useEffect(() => {
    if (queuedLensIds.length === 0) return;

    for (const lensId of queuedLensIds) {
      if (runningLensIdsRef.current.has(lensId)) continue;

      if (!desiredVisibleLensIdsRef.current.has(lensId)) {
        setQueuedLensIds((current) => current.filter((currentLensId) => currentLensId !== lensId));
        setPendingLensIds((current) => current.filter((currentLensId) => currentLensId !== lensId));
        continue;
      }

      runningLensIdsRef.current.add(lensId);
      console.debug(
        "[Lenses][page-dock] computing effect-start",
        summarizeComputingAnimationDebug([readComputingAnimationDebug(dockRef.current, lensId)])
      );
      void computeLens(lensId).finally(() => {
        runningLensIdsRef.current.delete(lensId);
        setQueuedLensIds((current) => current.filter((currentLensId) => currentLensId !== lensId));
      });
    }
  }, [queuedLensIds]);

  useEffect(() => {
    if (status.kind !== "success" && status.kind !== "empty" && status.kind !== "error") return;
    const timeout = status.kind === "error" ? 5600 : 3600;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), timeout);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!view && !dismissMenuOpen) return;

    const dismissOpenUi = () => {
      setView(null);
      setDismissMenuOpen(false);
      setStatus({ kind: "idle" });
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (eventTargetsDock(event, dockRef.current)) return;
      dismissOpenUi();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissOpenUi();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dismissMenuOpen, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadDomainLenses() {
      const sourceUrl = window.location.href;
      const stored = await chrome.storage.local
        .get([LENS_DOMAIN_RULES_KEY, USER_LENSES_CACHE_KEY, ACTIVE_CUSTOM_LENS_KEY])
        .catch(() => ({}) as Record<string, unknown>);
      if (cancelled) return;

      const cachedUserLenses = readUserLenses(stored[USER_LENSES_CACHE_KEY]);
      const activeLens = readActiveCustomLens(stored[ACTIVE_CUSTOM_LENS_KEY]);
      const rules = readLensDomainRules(stored[LENS_DOMAIN_RULES_KEY]);

      setLensOptions(
        buildDockLensOptions(
          FALLBACK_DEFAULT_LENSES,
          cachedUserLenses,
          activeLens,
          sourceUrl,
          rules
        )
      );

      const response = await sendRuntimeMessage<{ lenses?: unknown[]; error?: string }>({
        type: "list-lenses",
      }).catch((): { lenses?: unknown[]; error?: string } => ({}));
      if (cancelled) return;

      const libraryLenses = (response.lenses ?? [])
        .map(lensFromRow)
        .filter((lens): lens is NonNullable<ReturnType<typeof lensFromRow>> => lens !== null)
        .map((lens) => lens.config);
      const defaultLenses = defaultLensConfigs(libraryLenses);
      setLensOptions(
        buildDockLensOptions(defaultLenses, cachedUserLenses, activeLens, sourceUrl, rules)
      );

      const userLensResponse = await sendRuntimeMessage<{ lenses?: UserLens[]; error?: string }>({
        type: "list-user-lenses",
      }).catch((): { lenses?: UserLens[]; error?: string } => ({}));
      if (cancelled || !userLensResponse.lenses) return;

      void chrome.storage.local.set({ [USER_LENSES_CACHE_KEY]: userLensResponse.lenses });
      setLensOptions(
        buildDockLensOptions(
          defaultLenses,
          userLensResponse.lenses,
          activeLens,
          sourceUrl,
          rules
        )
      );
    }

    void loadDomainLenses();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pinned lens ids for the current domain. Loaded once on mount,
  // kept in sync via chrome.storage.onChanged so pin changes from any surface
  // (this dock, settings page, another tab) appear instantly.
  useEffect(() => {
    const domain = pinKeyFromUrl(window.location.href);
    if (!domain) return;
    const domainKey = domain;
    let cancelled = false;

    async function loadPins() {
      const stored = await chrome.storage.sync
        .get(PINNED_IDS_BY_DOMAIN_KEY)
        .catch(() => ({}) as Record<string, unknown>);
      if (cancelled) return;
      const map = parsePinnedIdsByDomain(stored[PINNED_IDS_BY_DOMAIN_KEY]);
      const pins = pinsForDomain(map, domainKey);
      setPinnedLensIds(pins.lensIds);
    }
    void loadPins();

    function onStorageChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) {
      if (areaName !== "sync" || !(PINNED_IDS_BY_DOMAIN_KEY in changes)) return;
      const map = parsePinnedIdsByDomain(changes[PINNED_IDS_BY_DOMAIN_KEY]?.newValue);
      const pins = pinsForDomain(map, domainKey);
      setPinnedLensIds(pins.lensIds);
    }

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  // Auto-run pinned lenses once per dock mount, after both the pin set and
  // the lens catalog are loaded. The ref keeps it firing exactly once even if
  // a downstream effect causes lensOptions to settle in two passes (cache,
  // then network) — the second pass shouldn't re-trigger runs we already
  // started. Pinned lenses that are already computed or in-flight are skipped.
  useEffect(() => {
    if (autoRanPinnedRef.current) return;
    if (pinnedLensIds.length === 0) return;
    if (lensOptions.length === 0) return;
    autoRanPinnedRef.current = true;
    const knownLensIds = new Set(lensOptions.map((option) => option.lensId));
    for (const lensId of pinnedLensIds) {
      if (!knownLensIds.has(lensId)) continue;
      if (computedLensIds.has(lensId)) continue;
      if (pendingLensIdSet.has(lensId)) continue;
      setDockLensSelected(lensId, true);
    }
  }, [pinnedLensIds, lensOptions, computedLensIds, pendingLensIdSet]);

  const statusText = useMemo(() => {
    if (status.kind === "idle") return "";
    if (status.kind === "running") return `Running ${status.label}...`;
    return status.message;
  }, [status]);
  const systemLensOptions = lensOptions.filter((lens) => lens.kind === "system");
  const userLensOptions = lensOptions.filter((lens) => lens.kind === "user");
  const resultItems = useMemo(
    () =>
      orderDockLensIds(Array.from(computedLensIds)).map((lensId) =>
        getResultItem(lensId, lensOptions)
      ),
    [computedLensIds, lensOptions]
  );

  function setDockLensSelected(lensId: string, selected: boolean) {
    // Clicking a pill that's still computing means "stop this run" rather than
    // "hide it" — silent revert to idle and tell the worker to abort the
    // in-flight fetch.
    if (!selected && pendingLensIdSet.has(lensId)) {
      cancelLensRun(lensId);
      return;
    }

    const nextDesired = new Set(desiredVisibleLensIdsRef.current);
    if (selected) {
      nextDesired.add(lensId);
    } else {
      nextDesired.delete(lensId);
    }
    desiredVisibleLensIdsRef.current = nextDesired;

    setSelectedLensIds((current) => {
      const next = selected
        ? [...current, lensId]
        : current.filter((currentLensId) => currentLensId !== lensId);
      return orderDockLensIds(next);
    });

    if (!selected) {
      onLensVisibilityChange(lensId, false);
      return;
    }

    onLensVisibilityChange(lensId, true);
    if (computedLensIds.has(lensId) || pendingLensIdSet.has(lensId)) return;
    queueLensComputation(lensId);
  }

  function setResultDisplayMode(lensId: string, mode: LensResultDisplayMode) {
    desiredVisibleLensIdsRef.current = new Set(
      mode === "off"
        ? Array.from(desiredVisibleLensIdsRef.current).filter((id) => id !== lensId)
        : [...desiredVisibleLensIdsRef.current, lensId]
    );
    setSelectedLensIds((current) =>
      mode === "off"
        ? current.filter((currentLensId) => currentLensId !== lensId)
        : orderDockLensIds(current.includes(lensId) ? current : [...current, lensId])
    );
    onLensDisplayModeChange(lensId, mode);
    setLensRuntimeState(getLensState());
    setStatus({ kind: "idle" });
  }

  function clearLensResults(lensId: string) {
    desiredVisibleLensIdsRef.current.delete(lensId);
    setSelectedLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    setLocallyComputedLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    setLocallyComputedFindingCountByLensId((current) => omitLensRecord(current, lensId));
    setLocallyRenderedCountByLensId((current) => omitLensRecord(current, lensId));
    setLocallyAnchorFailureCountByLensId((current) => omitLensRecord(current, lensId));
    onLensResultsClear(lensId);
    setLensRuntimeState(getLensState());
    setStatus({ kind: "idle" });
  }

  function cancelLensRun(lensId: string) {
    // Optimistically revert local UI state so the pill goes back to idle the
    // instant the user clicks — no waiting on the service worker round-trip.
    desiredVisibleLensIdsRef.current.delete(lensId);
    setSelectedLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    setPendingLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    setQueuedLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    clearLensSettling(lensId);
    setSettlingLensIds((current) =>
      current.filter((currentLensId) => currentLensId !== lensId)
    );
    onLensVisibilityChange(lensId, false);
    setStatus({ kind: "idle" });

    // Tell the worker to tear down the local fetch and request cancellation of
    // the short-lived managed run by its opaque request id.
    void sendRuntimeMessage({ type: "cancel-page-lens", lensId });
  }

  async function togglePinForLens(lensId: string) {
    await toggleLensPinForUrl(window.location.href, lensId).catch(() => undefined);
    // If the lens just became pinned and isn't already computed/running,
    // kick off a run so "pin = auto-runs on this domain" feels immediate
    // rather than waiting for the next popup-open.
    const willBePinned = !pinnedLensIdSet.has(lensId);
    if (
      willBePinned &&
      !computedLensIds.has(lensId) &&
      !pendingLensIdSet.has(lensId)
    ) {
      setDockLensSelected(lensId, true);
    }
  }

  function queueLensComputation(lensId: string) {
    setDismissMenuOpen(false);
    clearLensSettling(lensId);
    setSettlingLensIds((current) => current.filter((currentLensId) => currentLensId !== lensId));
    setPendingLensIds((current) => (current.includes(lensId) ? current : [...current, lensId]));
    setQueuedLensIds((current) => (current.includes(lensId) ? current : [...current, lensId]));
  }

  function clearLensSettling(lensId: string) {
    const timer = settlingTimersRef.current.get(lensId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      settlingTimersRef.current.delete(lensId);
    }
  }

  function beginLensSettling(lensId: string) {
    clearLensSettling(lensId);
    setSettlingLensIds((current) => (current.includes(lensId) ? current : [...current, lensId]));
    const timer = window.setTimeout(() => {
      settlingTimersRef.current.delete(lensId);
      setSettlingLensIds((current) =>
        current.filter((currentLensId) => currentLensId !== lensId)
      );
    }, COMPUTING_SETTLE_MS);
    settlingTimersRef.current.set(lensId, timer);
  }

  async function computeLens(lensId: string) {
    const computingStartedAt = performance.now();
    try {
      const response = await sendRuntimeMessage<RunPageLensesResponse>({
        type: "run-page-lenses",
        lensIds: [lensId],
        clearFirst: false,
        storePageLenses: await readStorePageLenses(),
      });
      if (response?.error) throw new Error(response.error);

      const result = response.results?.find((item) => item.lensId === lensId);
      // User cancelled this run by clicking the computing pill. The dock
      // already reverted local state optimistically in cancelLensRun — don't
      // toast "found no matches" or surface an error for what was an
      // explicit stop.
      if (result?.cancelled) return;
      const findingCount = result?.findingCount ?? 0;
      const renderedCount = result?.renderedCount ?? result?.findingCount ?? 0;
      const failedAnchorCount =
        result?.failedAnchorCount ?? Math.max(0, findingCount - renderedCount);

      if (findingCount === 0) {
        const name = getLensLabel(lensId);
        desiredVisibleLensIdsRef.current.delete(lensId);
        setSelectedLensIds((current) =>
          current.filter((currentLensId) => currentLensId !== lensId)
        );
        setStatus({ kind: "empty", message: `${name} found no matches.` });
        return;
      }

      setLocallyComputedLensIds((current) =>
        current.includes(lensId) ? current : [...current, lensId]
      );
      setLocallyComputedFindingCountByLensId((current) => ({
        ...current,
        [lensId]: findingCount,
      }));
      setLocallyRenderedCountByLensId((current) => ({
        ...current,
        [lensId]: renderedCount,
      }));
      setLocallyAnchorFailureCountByLensId((current) => ({
        ...current,
        [lensId]: failedAnchorCount,
      }));
      onLensVisibilityChange(lensId, desiredVisibleLensIdsRef.current.has(lensId));
      if (renderedCount === 0) {
        setStatus({
          kind: "empty",
          message: `${getLensLabel(lensId)}: 0 placed, ${findingCount} found.`,
        });
      } else if (renderedCount < findingCount) {
        setStatus({
          kind: "success",
          message: `${getLensLabel(lensId)}: ${renderedCount} placed, ${findingCount} found.`,
        });
      }
    } catch (error) {
      desiredVisibleLensIdsRef.current.delete(lensId);
      setSelectedLensIds((current) =>
        current.filter((currentLensId) => currentLensId !== lensId)
      );
      setStatus({ kind: "error", ...toastError(error) });
    } finally {
      await waitForMinimumDuration(computingStartedAt, MIN_COMPUTING_VISIBLE_MS);
      beginLensSettling(lensId);
      setPendingLensIds((current) => current.filter((currentLensId) => currentLensId !== lensId));
      setLensRuntimeState(getLensState());
    }
  }

  async function runCustomLens() {
    const instruction = customInstruction.trim();
    if (!instruction || busy) return;

    setDismissMenuOpen(false);
    const lensId = newCustomLensId();
    const name = fallbackLensName(instruction);
    const base = {
      lensId,
      name,
      instruction,
      status: "running" as const,
      createdAt: Date.now(),
      promoted: false,
    };

    setStatus({ kind: "running", label: name });
    await chrome.storage.local.set({ [ACTIVE_CUSTOM_LENS_KEY]: base }).catch(() => undefined);

    try {
      const response = await sendRuntimeMessage<RunPageLensesResponse>({
        type: "run-page-lenses",
        customLens: { instruction, name, lensId },
        clearFirst: false,
        storePageLenses: await readStorePageLenses(),
      });
      if (response?.error) throw new Error(response.error);

      const result = response.results?.find((item) => item.lensId === lensId);
      // User cancelled this run by clicking the computing pill. The dock
      // already reverted local state optimistically in cancelLensRun — don't
      // toast "found no matches" or surface an error for what was an
      // explicit stop.
      if (result?.cancelled) return;
      const findingCount = result?.findingCount ?? 0;
      const renderedCount = result?.renderedCount ?? result?.findingCount ?? 0;
      const failedAnchorCount =
        result?.failedAnchorCount ?? Math.max(0, findingCount - renderedCount);
      const storedFindingCount = findingCount > 0 ? findingCount : renderedCount;
      await chrome.storage.local
        .set({
          [ACTIVE_CUSTOM_LENS_KEY]: {
            ...base,
            status: "completed",
            findingCount: storedFindingCount,
          },
        })
        .catch(() => undefined);
      setCustomInstruction("");
      if (findingCount === 0) {
        setStatus({ kind: "empty", message: `${name} found no matches.` });
        return;
      }
      setLocallyComputedFindingCountByLensId((current) => ({
        ...current,
        [lensId]: findingCount,
      }));
      setLocallyRenderedCountByLensId((current) => ({
        ...current,
        [lensId]: renderedCount,
      }));
      setLocallyAnchorFailureCountByLensId((current) => ({
        ...current,
        [lensId]: failedAnchorCount,
      }));
      if (renderedCount < findingCount) {
        setStatus({
          kind: renderedCount === 0 ? "empty" : "success",
          message: `${name}: ${renderedCount} placed, ${findingCount} found.`,
        });
      } else {
        setStatus({ kind: "success", message: `${name}: ${renderedCount} marked.` });
      }
    } catch (error) {
      await chrome.storage.local
        .set({
          [ACTIVE_CUSTOM_LENS_KEY]: {
            ...base,
            status: "failed",
          },
        })
        .catch(() => undefined);
      setStatus({ kind: "error", ...toastError(error) });
    }
  }

  function openLensEditor() {
    setDismissMenuOpen(false);
    void sendRuntimeMessage({ type: "open-lens-editor" });
  }

  async function toggleSidebar() {
    setDismissMenuOpen(false);
    setView(null);
    try {
      const response = await sendRuntimeMessage<{
        success?: boolean;
        open?: boolean;
        error?: string;
      }>({
        action: "toggle-source-panel",
      });
      if (response?.error) throw new Error(response.error);
      if (typeof response?.open === "boolean") {
        setSourcePanelOpen(response.open);
      }
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", ...toastError(error) });
    }
  }

  async function hideUntilReload() {
    setDismissMenuOpen(false);
    onDismiss();
  }

  async function disableCurrentSite() {
    try {
      await disablePageLensDockForCurrentSite();
      onDismiss();
    } catch (error) {
      setDismissMenuOpen(false);
      setStatus({ kind: "error", ...toastError(error) });
    }
  }

  async function turnOffPageDock() {
    try {
      await setPageLensDockEnabled(false);
      // Surface the undo affordance before the dock tears itself down, since the
      // toast lives in a separate shadow host that survives onDismiss().
      onTurnedOff?.();
      onDismiss();
    } catch (error) {
      setDismissMenuOpen(false);
      setStatus({ kind: "error", ...toastError(error) });
    }
  }

  return (
    <div
      ref={dockRef}
      className="lenses-page-dock"
      data-view={activePanelView ?? (dismissMenuOpen ? "dismiss" : "rail")}
      data-source-panel-open={sourcePanelOpen ? "true" : undefined}
      data-state={status.kind}
      data-computing-lens-ids={pendingLensIds.join(" ") || undefined}
    >
      {statusText ? <DockStatusToast status={status} text={statusText} /> : null}
      {activePanelView ? (
        <div className="lenses-page-dock-panel" aria-live="polite">
          <div className="lenses-page-dock-panel-head">
            <span>{activeViewTitle}</span>
            {activePanelView === "lenses" ? (
              <button
                type="button"
                className="lenses-page-dock-panel-edit"
                title="Edit lenses"
                aria-label="Edit lenses"
                onClick={openLensEditor}
              >
                <DockIcon icon="edit" />
              </button>
            ) : null}
          </div>

          {activePanelView === "lenses" ? (
            <div className="lenses-page-dock-lens-list">
              {lensOptions.length > 0 ? (
                <>
                  <div className="lenses-page-dock-lens-pills" aria-label="Default lenses">
                    {systemLensOptions.map((lens) => {
                      const selected = selectedDockLensIds.includes(lens.lensId);
                      const computing = pendingLensIdSet.has(lens.lensId);
                      const settling = settlingLensIdSet.has(lens.lensId) && !computing;
                      const completed = computedLensIds.has(lens.lensId) && !computing;
                      const pinned = pinnedLensIdSet.has(lens.lensId);
                      const label = BAY_LENS_LABELS[lens.lensId] ?? lens.name;
                      return (
                        <Checkbox.Root
                          key={lens.lensId}
                          className={`lenses-page-dock-lens-pill ${
                            selected ? "is-selected" : ""
                          } ${computing ? "is-computing" : ""} ${
                            completed ? "is-computed" : ""
                          } ${settling ? "is-settling" : ""} ${pinned ? "is-pinned" : ""}`}
                          style={lensAccentStyle(lens.accent)}
                          title={dockLensTitle({
                            completed,
                            foundCount: findingCountByLensId[lens.lensId],
                            renderedCount: renderedCountByLensId[lens.lensId],
                            failedAnchorCount: anchorFailureCountByLensId[lens.lensId],
                            fallback: lens.scopeLabel,
                            name: label,
                          })}
                          aria-busy={computing ? "true" : undefined}
                          data-lens-id={lens.lensId}
                          checked={selected}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            setDockLensSelected(lens.lensId, checked === true)
                          }
                        >
                          <span
                            className="lenses-page-dock-dot"
                            style={lensDotStyle(lens.accent)}
                            aria-hidden="true"
                          />
                          <span>{label}</span>
                          <LensPinButton
                            pinned={pinned}
                            label={label}
                            onToggle={() => void togglePinForLens(lens.lensId)}
                          />
                        </Checkbox.Root>
                      );
                    })}
                  </div>
                  {userLensOptions.length > 0 ? (
                    <div className="lenses-page-dock-lens-user-group" aria-label="Custom lenses">
                      {userLensOptions.map((lens) => {
                        const selected = selectedDockLensIds.includes(lens.lensId);
                        const computing = pendingLensIdSet.has(lens.lensId);
                        const settling = settlingLensIdSet.has(lens.lensId) && !computing;
                        const completed = computedLensIds.has(lens.lensId) && !computing;
                        const pinned = pinnedLensIdSet.has(lens.lensId);
                        return (
                          <Checkbox.Root
                            key={lens.lensId}
                            className={`lenses-page-dock-lens-pill ${
                              selected ? "is-selected" : ""
                            } ${computing ? "is-computing" : ""} ${
                              completed ? "is-computed" : ""
                            } ${settling ? "is-settling" : ""} ${pinned ? "is-pinned" : ""}`}
                            style={lensAccentStyle(lens.accent)}
                            title={dockLensTitle({
                              completed,
                              foundCount: findingCountByLensId[lens.lensId],
                              renderedCount: renderedCountByLensId[lens.lensId],
                              failedAnchorCount: anchorFailureCountByLensId[lens.lensId],
                              fallback: lens.scopeLabel,
                              name: lens.name,
                            })}
                            aria-busy={computing ? "true" : undefined}
                            data-lens-id={lens.lensId}
                            checked={selected}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              setDockLensSelected(lens.lensId, checked === true)
                            }
                          >
                            <span
                              className="lenses-page-dock-dot"
                              style={lensDotStyle(lens.accent)}
                              aria-hidden="true"
                            />
                            <span>{lens.name}</span>
                            <LensPinButton
                              pinned={pinned}
                              label={lens.name}
                              onToggle={() => void togglePinForLens(lens.lensId)}
                            />
                          </Checkbox.Root>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="lenses-page-dock-empty">
                  No default lenses enabled.
                </div>
              )}
            </div>
          ) : activePanelView === "results" ? (
            <div className="lenses-page-dock-result-list" aria-label="Results">
              {resultItems.length > 0 ? (
                resultItems.map((item) => {
                  const mode = resultDisplayModeByLensId[item.id] ?? "inline";
                  return (
                    <div
                      key={item.id}
                      className="lenses-page-dock-result-row"
                      data-lens-id={item.id}
                      style={lensAccentStyle(item.accent)}
                    >
                      <div className="lenses-page-dock-result-main">
                        <span
                          className="lenses-page-dock-dot"
                          style={lensDotStyle(item.accent)}
                          aria-hidden="true"
                        />
                        <span className="lenses-page-dock-result-name">{item.name}</span>
                        <span className="lenses-page-dock-result-count">
                          {resultCountLabel({
                            foundCount: findingCountByLensId[item.id],
                            renderedCount: renderedCountByLensId[item.id],
                            failedAnchorCount: anchorFailureCountByLensId[item.id],
                          })}
                        </span>
                        <button
                          type="button"
                          className="lenses-page-dock-result-clear"
                          aria-label={`Clear ${item.name} results`}
                          title={`Clear ${item.name} results`}
                          onClick={() => clearLensResults(item.id)}
                        >
                          <Cross2Icon className="lenses-page-dock-icon" aria-hidden="true" />
                        </button>
                      </div>
                      <div
                        className="lenses-page-dock-result-modes"
                        aria-label={`${item.name} display`}
                      >
                        {RESULT_DISPLAY_MODES.map((option) => (
                          <button
                            key={option.mode}
                            type="button"
                            className={`lenses-page-dock-result-mode ${
                              mode === option.mode ? "is-active" : ""
                            }`}
                            aria-pressed={mode === option.mode}
                            onClick={() => setResultDisplayMode(item.id, option.mode)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="lenses-page-dock-empty">No results yet.</div>
              )}
            </div>
          ) : (
            <form
              className="lenses-page-dock-custom"
              onSubmit={(event) => {
                event.preventDefault();
                void runCustomLens();
              }}
            >
              <textarea
                ref={customInstructionRef}
                value={customInstruction}
                placeholder="Describe a lens"
                rows={3}
                disabled={busy}
                onChange={(event) => setCustomInstruction(event.currentTarget.value)}
              />
              <button type="submit" className="lenses-page-dock-run" disabled={!customReady}>
                Run
              </button>
            </form>
          )}
        </div>
      ) : null}

      {dismissMenuOpen ? (
        <DismissMenu
          onHideUntilReload={() => void hideUntilReload()}
          onDisableSite={() => void disableCurrentSite()}
          onTurnOffPageDock={() => void turnOffPageDock()}
        />
      ) : null}

      <nav className="lenses-page-dock-rail" aria-label="Lenses page tools">
        <DockButton
          icon="sidebar"
          label={sourcePanelOpen ? "Close sidebar" : "Open sidebar"}
          disabled={busy}
          railSlot="tail"
          onClick={() => void toggleSidebar()}
        />
        <DockButton
          icon="custom"
          label="Custom lens"
          active={activePanelView === "custom"}
          disabled={busy}
          railSlot="tail"
          onClick={() => {
            setDismissMenuOpen(false);
            setView("custom");
          }}
        />
        <DockButton
          icon="lenses"
          label="Lenses"
          active={activePanelView === "lenses"}
          disabled={busy}
          onClick={() => {
            setDismissMenuOpen(false);
            setView("lenses");
          }}
        />
        <DockButton
          icon="results"
          label="Results"
          active={activePanelView === "results"}
          disabled={busy}
          onClick={() => {
            setDismissMenuOpen(false);
            setView("results");
          }}
        />
        <DockButton
          icon="close"
          label="Dismiss Lenses"
          active={dismissMenuOpen}
          disabled={busy}
          railSlot="tail"
          onClick={() => {
            const nextOpen = !dismissMenuOpen;
            if (nextOpen) setView(null);
            setDismissMenuOpen(nextOpen);
            setStatus({ kind: "idle" });
          }}
        />
      </nav>
    </div>
  );
}

// Small affordance attached to each lens pill. Clicking it toggles the lens's
// pin for the current domain — visible-on-hover by default, always visible
// when pinned. Rendered as a span (not a button) because the parent
// Checkbox.Root is already a <button>, and nested buttons are invalid HTML.
// Pointer/click handlers swallow the event so the parent checkbox doesn't
// also fire (which would otherwise toggle the lens's selected state).
function LensPinButton({
  pinned,
  label,
  onToggle,
}: {
  pinned: boolean;
  label: string;
  onToggle: () => void;
}) {
  const stop = (event: { stopPropagation: () => void; preventDefault?: () => void }) => {
    event.stopPropagation();
    event.preventDefault?.();
  };
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label} from this site` : `Pin ${label} to this site`}
      className={`lenses-page-dock-pin ${pinned ? "is-pinned" : ""}`}
      onPointerDown={stop}
      onClick={(event) => {
        stop(event);
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          stop(event);
          onToggle();
        }
      }}
    >
      {pinned ? (
        <DrawingPinFilledIcon aria-hidden="true" />
      ) : (
        <DrawingPinIcon aria-hidden="true" />
      )}
    </span>
  );
}

function DismissMenu({
  onHideUntilReload,
  onDisableSite,
  onTurnOffPageDock,
}: {
  onHideUntilReload: () => void;
  onDisableSite: () => void;
  onTurnOffPageDock: () => void;
}) {
  return (
    <div
      className="lenses-page-dock-menu"
      aria-label="Dismiss Lenses dock"
      role="menu"
    >
      <button
        type="button"
        className="lenses-page-dock-menu-item"
        role="menuitem"
        onClick={onHideUntilReload}
      >
        <DismissIcon icon="reload" />
        <span>Hide until reload</span>
      </button>
      <button
        type="button"
        className="lenses-page-dock-menu-item"
        role="menuitem"
        onClick={onDisableSite}
      >
        <DismissIcon icon="site" />
        <span>Disable this site</span>
      </button>
      <button
        type="button"
        className="lenses-page-dock-menu-item"
        role="menuitem"
        onClick={onTurnOffPageDock}
      >
        <DismissIcon icon="off" />
        <span>Turn off page dock</span>
      </button>
    </div>
  );
}

function DockStatusToast({ status, text }: { status: DockStatus; text: string }) {
  const detail = status.kind === "error" ? status.detail : undefined;

  return (
    <div
      className="lenses-page-dock-toast"
      data-kind={status.kind}
      role={status.kind === "error" ? "alert" : "status"}
      aria-live={status.kind === "error" ? "assertive" : "polite"}
      title={detail && detail !== text ? detail : undefined}
    >
      <span className="lenses-page-dock-toast-dot" aria-hidden="true" />
      <span className="lenses-page-dock-toast-text">{text}</span>
    </div>
  );
}

function DockButton({
  icon,
  label,
  active,
  disabled = false,
  railSlot,
  onClick,
}: {
  icon: DockIconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  railSlot?: "tail";
  onClick: () => void;
}) {
  const isActive = active === true;
  return (
    <button
      type="button"
      className={`lenses-page-dock-button ${railSlot === "tail" ? "is-tail" : ""} ${
        isActive ? "is-active" : ""
      }`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : isActive}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <DockIcon icon={icon} />
      <span className="lenses-page-dock-tooltip">{label}</span>
    </button>
  );
}

function DockIcon({ icon }: { icon: DockIconName }) {
  if (icon === "sidebar") return <SidebarPanelIcon />;

  const Icon = {
    lenses: LayersIcon,
    results: ReaderIcon,
    claims: FileTextIcon,
    sources: Link2Icon,
    custom: MagicWandIcon,
    edit: DotsHorizontalIcon,
    close: Cross2Icon,
  }[icon];

  return <Icon className="lenses-page-dock-icon" aria-hidden="true" focusable="false" />;
}

function SidebarPanelIcon() {
  return (
    <svg
      className="lenses-page-dock-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function DismissIcon({ icon }: { icon: "reload" | "site" | "off" }) {
  const Icon =
    icon === "reload" ? ReloadIcon : icon === "site" ? GlobeIcon : CircleBackslashIcon;

  return <Icon className="lenses-page-dock-menu-icon" aria-hidden="true" focusable="false" />;
}

function lensDotStyle(accent: string): CSSProperties {
  return {
    backgroundColor: accent,
  };
}

function lensAccentStyle(accent: string): CSSProperties {
  return {
    "--lenses-dock-lens-accent": accent,
  } as CSSProperties;
}

function dockLensTitle({
  completed,
  failedAnchorCount,
  fallback,
  foundCount,
  name,
  renderedCount,
}: {
  completed: boolean;
  failedAnchorCount?: number;
  fallback?: string;
  foundCount?: number;
  name: string;
  renderedCount?: number;
}) {
  if (!completed || typeof foundCount !== "number") return fallback;
  if (
    typeof renderedCount === "number" &&
    (renderedCount !== foundCount || (failedAnchorCount ?? 0) > 0)
  ) {
    return `${name}: ${renderedCount} placed, ${foundCount} found`;
  }
  const noun = foundCount === 1 ? "finding" : "findings";
  return `${name}: ${foundCount} ${noun} computed`;
}

function readComputingAnimationDebug(root: HTMLElement | null, lensId: string) {
  if (!root) {
    return { lensId, found: false, reason: "dock-root-missing" };
  }

  const item = Array.from(root.querySelectorAll<HTMLElement>("[data-lens-id]")).find(
    (candidate) =>
      candidate.dataset.lensId === lensId && candidate.classList.contains("is-computing")
  );
  if (!item) {
    return { lensId, found: false, reason: "computing-item-missing" };
  }

  const dot = item.querySelector<HTMLElement>(".lenses-page-dock-dot");
  if (!dot) {
    return { lensId, found: false, reason: "computing-dot-missing" };
  }

  const itemStyle = window.getComputedStyle(item);
  const dotStyle = window.getComputedStyle(dot);
  return {
    lensId,
    found: true,
    itemClassName: item.className,
    itemAnimationName: itemStyle.animationName,
    itemAnimationDuration: itemStyle.animationDuration,
    itemAnimationPlayState: itemStyle.animationPlayState,
    itemAnimations: item.getAnimations({ subtree: true }).map((animation) => ({
      name: (animation as Animation & { animationName?: string }).animationName,
      playState: animation.playState,
      currentTime: animation.currentTime,
      playbackRate: animation.playbackRate,
    })),
    dotAnimationName: dotStyle.animationName,
    dotAnimationDuration: dotStyle.animationDuration,
    dotAnimationPlayState: dotStyle.animationPlayState,
    dotTransform: dotStyle.transform,
    dotAnimations: dot.getAnimations().map((animation) => ({
      name: (animation as Animation & { animationName?: string }).animationName,
      playState: animation.playState,
      currentTime: animation.currentTime,
      playbackRate: animation.playbackRate,
    })),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

function eventTargetsDock(event: Event, dock: HTMLElement | null) {
  if (!dock) return false;
  const path = event.composedPath();
  if (path.includes(dock)) return true;
  const target = event.target;
  return target instanceof Node && dock.contains(target);
}

type ComputingAnimationDebugSample = ReturnType<typeof readComputingAnimationDebug>;
type AnimationDebugTiming = { currentTime: CSSNumberish | null };
type FoundComputingAnimationDebugSample = ComputingAnimationDebugSample & {
  found: true;
  itemAnimationName: string;
  dotAnimationName: string;
  itemAnimations: AnimationDebugTiming[];
  dotAnimations: AnimationDebugTiming[];
  reducedMotion: boolean;
};

function summarizeComputingAnimationDebug(
  firstSamples: ComputingAnimationDebugSample[],
  secondSamples: ComputingAnimationDebugSample[] = []
) {
  return firstSamples.map((firstSample, index) => {
    const secondSample = secondSamples[index];
    if (!firstSample.found) {
      return {
        lensId: firstSample.lensId,
        found: false,
        reason: "reason" in firstSample ? firstSample.reason : undefined,
        itemAnimationName: undefined,
        dotAnimationName: undefined,
        firstItemTimes: [],
        secondItemTimes: [],
        firstDotTimes: [],
        secondDotTimes: [],
        reducedMotion: undefined,
      };
    }
    const firstFoundSample = firstSample as FoundComputingAnimationDebugSample;
    const secondFoundSample = secondSample?.found
      ? (secondSample as FoundComputingAnimationDebugSample)
      : null;
    return {
      lensId: firstFoundSample.lensId,
      found: true,
      reason: undefined,
      itemAnimationName: firstFoundSample.itemAnimationName,
      dotAnimationName: firstFoundSample.dotAnimationName,
      firstItemTimes: firstFoundSample.itemAnimations.map((animation) => animation.currentTime),
      secondItemTimes: secondFoundSample
        ? secondFoundSample.itemAnimations.map((animation) => animation.currentTime)
        : [],
      firstDotTimes: firstFoundSample.dotAnimations.map((animation) => animation.currentTime),
      secondDotTimes: secondFoundSample
        ? secondFoundSample.dotAnimations.map((animation) => animation.currentTime)
        : [],
      reducedMotion: firstFoundSample.reducedMotion,
    };
  });
}

async function waitForMinimumDuration(startedAt: number, durationMs: number) {
  const remainingMs = durationMs - (performance.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
}

function defaultLensConfigs(lenses: readonly LensConfig[]): DockLensConfig[] {
  const byId = new Map(lenses.map((lens) => [lens.id, lens]));
  return BUILT_IN_LENSES.map((fallback) => {
    const lens = byId.get(fallback.id);
    if (!lens) {
      return FALLBACK_DEFAULT_LENSES.find((entry) => entry.id === fallback.id) ?? {
        id: fallback.id,
        name: BAY_LENS_LABELS[fallback.id],
        allowedDomains: [],
        focus: "source",
        visible: true,
      };
    }

    return {
      id: lens.id,
      name: lens.name,
      allowedDomains: lens.allowedDomains,
      focus: lens.focus,
      visible: lens.visible,
    };
  });
}

function buildDockLensOptions(
  lenses: readonly DockLensConfig[],
  userLenses: readonly UserLens[],
  activeLens: ActiveCustomLens | null,
  sourceUrl: string,
  rules: LensDomainRules
): DockLensOption[] {
  const system = domainLensOptions(lenses, sourceUrl, rules).map((option) => ({
    ...option,
    accent: BUILT_IN_BY_ID.get(option.lensId as DefaultLensId)?.accent ?? "#4f8df9",
    kind: "system" as const,
  }));
  const extraIds = persistedExtraLensIds(activeLens, userLenses);
  const labelsById = new Map(
    buildLensOptions(userLenses).map((option) => [option.id, option.label])
  );
  if (activeLens?.name) labelsById.set(activeLens.lensId, activeLens.name);
  const user = extraIds.map((lensId) => ({
    lensId,
    name: labelsById.get(lensId) ?? humanizeLensId(lensId),
    checked: false,
    scopeLabel: "Custom lens",
    accent: CUSTOM_LENS_DOT_COLOR,
    kind: "user" as const,
  }));
  return [...system, ...user];
}

function orderDockLensIds(ids: readonly string[]): string[] {
  const activeIds = withoutRetiredLensIds(ids);
  const ordered = orderedSelectedLenses(activeIds, BAY_LENS_ORDER);
  const seen = new Set(ordered);
  const extra = activeIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...ordered, ...extra];
}

function getResultItem(lensId: string, lensOptions: readonly DockLensOption[]): DockResultItem {
  const option = lensOptions.find((lens) => lens.lensId === lensId);
  if (option) {
    return {
      id: lensId,
      name: BAY_LENS_LABELS[lensId as DefaultLensId] ?? option.name,
      accent: option.accent,
    };
  }
  const builtIn = BUILT_IN_BY_ID.get(lensId as DefaultLensId);
  if (builtIn) {
    return {
      id: lensId,
      name: BAY_LENS_LABELS[builtIn.id],
      accent: builtIn.accent,
    };
  }
  return {
    id: lensId,
    name: humanizeLensId(lensId),
    accent: CUSTOM_LENS_DOT_COLOR,
  };
}

function getLensLabel(lensId: string) {
  return BAY_LENS_LABELS[lensId as DefaultLensId] ?? humanizeLensId(lensId);
}

function resultCountLabel({
  failedAnchorCount,
  foundCount,
  renderedCount,
}: {
  failedAnchorCount?: number;
  foundCount?: number;
  renderedCount?: number;
}) {
  if (typeof foundCount !== "number") return "";
  if (
    typeof renderedCount === "number" &&
    (renderedCount !== foundCount || (failedAnchorCount ?? 0) > 0)
  ) {
    return `${renderedCount} shown / ${foundCount} found`;
  }
  return `${foundCount} found`;
}

function omitLensRecord<T>(record: Record<string, T>, lensId: string): Record<string, T> {
  if (!(lensId in record)) return record;
  const next = { ...record };
  delete next[lensId];
  return next;
}

function readUserLenses(value: unknown): UserLens[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is UserLens =>
      !!entry &&
      typeof (entry as UserLens).lensId === "string" &&
      typeof (entry as UserLens).name === "string"
  );
}

function readActiveCustomLens(value: unknown): ActiveCustomLens | null {
  if (!value || typeof value !== "object") return null;
  const lens = value as ActiveCustomLens;
  if (
    typeof lens.lensId !== "string" ||
    typeof lens.name !== "string" ||
    typeof lens.instruction !== "string" ||
    typeof lens.createdAt !== "number"
  ) {
    return null;
  }
  if (
    lens.status !== "naming" &&
    lens.status !== "running" &&
    lens.status !== "completed" &&
    lens.status !== "failed"
  ) {
    return null;
  }
  return lens;
}

function humanizeLensId(lensId: string) {
  const name = lensId
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
  return name || "Annotation";
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        const runtimeError = new Error(error.message);
        noteDevInvalidatedContext(runtimeError);
        reject(runtimeError);
        return;
      }
      resolve(response as T);
    });
  });
}

async function readStorePageLenses(): Promise<boolean> {
  const result = await chrome.storage.local
    .get(STORE_PAGE_LENSES_KEY)
    .catch(() => ({}) as Record<string, unknown>);
  return typeof result[STORE_PAGE_LENSES_KEY] === "boolean"
    ? (result[STORE_PAGE_LENSES_KEY] as boolean)
    : true;
}

function toastError(error: unknown): { message: string; detail?: string } {
  const detail = publicErrorMessage(error, "Could not run lenses.");
  if (!detail) return { message: "Could not run lenses." };

  const lower = detail.toLowerCase();
  if (lower.includes("api key")) {
    return { message: "Add an API key in Settings.", detail };
  }
  if (lower.includes("extension context invalidated")) {
    return { message: "Reload this page to reconnect Lenses.", detail };
  }
  if (lower.includes("no lenses selected")) {
    return { message: "Select at least one lens to run.", detail };
  }
  if (/\brequest id\b/i.test(detail) || /server error/i.test(detail)) {
    return { message: "Server error while running lenses.", detail };
  }

  const visible = detail.replace(/\[request id:[^\]]+\]\s*/i, "").trim();
  if (!visible) return { message: "Could not run lenses.", detail };
  return {
    message: visible.length > 72 ? `${visible.slice(0, 69)}...` : visible,
    detail,
  };
}
