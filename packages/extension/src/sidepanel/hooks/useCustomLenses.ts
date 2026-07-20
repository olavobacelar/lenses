import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIVE_CUSTOM_LENS_KEY,
  STORE_PAGE_LENSES_KEY,
  USER_LENSES_CACHE_KEY,
} from "../constants";
import { sendRuntimeMessage } from "../lib/chrome";
import { formatError } from "../lib/format";
import { BAY_LENS_LABELS } from "../../lib/control-bay";
import {
  fallbackLensName,
  lensNameMap,
  newCustomLensId,
  persistedExtraLensIds,
  type ActiveCustomLens,
  type UserLens,
} from "../../lib/custom-lens";

interface UseCustomLensesOptions {
  showWarning: (message: string) => void;
}

// Owns the one-off-lens lifecycle and the promoted (permanent) lens list. The
// active lens is mirrored to chrome.storage.local so it survives a panel reload;
// the promoted list is backend-truth (lenses table) with a local cache for
// instant first paint.
export function useCustomLenses({ showWarning }: UseCustomLensesOptions) {
  const [activeLens, setActiveLensState] = useState<ActiveCustomLens | null>(null);
  const [userLenses, setUserLenses] = useState<UserLens[]>([]);
  const [created, setCreated] = useState<{ name: string } | null>(null);

  const setActiveLens = useCallback((next: ActiveCustomLens | null) => {
    setActiveLensState(next);
    if (next) {
      void chrome.storage.local.set({ [ACTIVE_CUSTOM_LENS_KEY]: next });
    } else {
      void chrome.storage.local.remove(ACTIVE_CUSTOM_LENS_KEY);
    }
  }, []);

  const refreshUserLenses = useCallback(async () => {
    const result = await sendRuntimeMessage<{
      lenses?: UserLens[];
      error?: string;
    }>({ type: "list-user-lenses" }).catch(
      (error): { lenses?: UserLens[]; error?: string } => ({ error: formatError(error) })
    );
    if (result.error || !result.lenses) return;
    setUserLenses(result.lenses);
    void chrome.storage.local.set({ [USER_LENSES_CACHE_KEY]: result.lenses });
  }, []);

  const refreshForAppModeChange = useCallback(async () => {
    setActiveLens(null);
    setCreated(null);
    setUserLenses([]);
    await refreshUserLenses();
  }, [refreshUserLenses, setActiveLens]);

  // Hydrate from storage (active lens + cached user lenses) then refresh the
  // permanent list from the backend.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await chrome.storage.local
        .get([ACTIVE_CUSTOM_LENS_KEY, USER_LENSES_CACHE_KEY])
        .catch(() => ({}) as Record<string, unknown>);
      if (cancelled) return;
      const storedActive = local[ACTIVE_CUSTOM_LENS_KEY];
      if (isActiveCustomLens(storedActive)) setActiveLensState(storedActive);
      const cached = local[USER_LENSES_CACHE_KEY];
      if (Array.isArray(cached)) setUserLenses(cached.filter(isUserLens));
    })();
    void refreshUserLenses();
    return () => {
      cancelled = true;
    };
  }, [refreshUserLenses]);

  const extraLensIds = useMemo(
    () => persistedExtraLensIds(activeLens, userLenses),
    [activeLens, userLenses]
  );
  const lensNames = useMemo(
    () => lensNameMap(BAY_LENS_LABELS, activeLens, userLenses),
    [activeLens, userLenses]
  );
  const userLensIds = useMemo(() => userLenses.map((lens) => lens.lensId), [userLenses]);

  // Create a one-off lens: name it the same way lenses are run (a model call via
  // the SW → Convex), run it over the page, and track Naming → Running →
  // completed so its accordion section animates like a built-in.
  const createFromInstruction = useCallback(
    async (
      instruction: string,
      refreshFindings: () => Promise<void>,
      options: { storePageLenses?: boolean } = {}
    ) => {
      const trimmed = instruction.trim();
      if (!trimmed) return;

      const lensId = newCustomLensId();
      const base: ActiveCustomLens = {
        lensId,
        name: fallbackLensName(trimmed),
        instruction: trimmed,
        status: "naming",
        createdAt: Date.now(),
        promoted: false,
      };
      setActiveLens(base);

      const named = await sendRuntimeMessage<{ name?: string; error?: string }>({
        type: "generate-lens-name",
        instruction: trimmed,
      }).catch((error): { name?: string; error?: string } => ({ error: formatError(error) }));
      const name = named.name?.trim() || base.name;
      setActiveLens({ ...base, name, status: "running" });

      const storePageLenses =
        options.storePageLenses ?? (await readStorePageLenses());
      const result = await sendRuntimeMessage<{ error?: string }>({
        type: "run-page-lenses",
        customLens: { instruction: trimmed, name, lensId },
        storePageLenses,
      }).catch((error) => ({ error: formatError(error) }));

      if (result?.error) {
        showWarning(result.error);
        setActiveLens({ ...base, name, status: "failed" });
        return;
      }

      setActiveLens({ ...base, name, status: "completed" });
      setCreated({ name });
      await refreshFindings();
    },
    [setActiveLens, showWarning]
  );

  // Promote the active one-off into a permanent user lens stored in the backend
  // lenses table, then refresh the permanent list so it surfaces as a chip. The
  // one-off slot is cleared; the lens now lives on as a saved lens.
  const promoteActive = useCallback(async () => {
    if (!activeLens || activeLens.status !== "completed" || activeLens.promoted) return;
    const result = await sendRuntimeMessage<{
      lensId?: string;
      name?: string;
      error?: string;
    }>({
      type: "save-user-lens",
      lensId: activeLens.lensId,
      name: activeLens.name,
      instruction: activeLens.instruction,
    }).catch((error) => ({ error: formatError(error) }));

    if (result.error) {
      showWarning(result.error);
      return;
    }
    await refreshUserLenses();
    setActiveLens(null);
  }, [activeLens, refreshUserLenses, setActiveLens, showWarning]);

  const dismissCreated = useCallback(() => setCreated(null), []);

  return {
    activeLens,
    userLenses,
    userLensIds,
    extraLensIds,
    lensNames,
    created,
    refreshUserLenses,
    refreshForAppModeChange,
    createFromInstruction,
    promoteActive,
    dismissCreated,
  };
}

async function readStorePageLenses(): Promise<boolean> {
  const local = await chrome.storage.local
    .get(STORE_PAGE_LENSES_KEY)
    .catch(() => ({}) as Record<string, unknown>);
  return typeof local[STORE_PAGE_LENSES_KEY] === "boolean"
    ? (local[STORE_PAGE_LENSES_KEY] as boolean)
    : true;
}

function isUserLens(value: unknown): value is UserLens {
  return (
    !!value &&
    typeof (value as UserLens).lensId === "string" &&
    typeof (value as UserLens).name === "string"
  );
}

function isActiveCustomLens(value: unknown): value is ActiveCustomLens {
  if (!value || typeof value !== "object") return false;
  const lens = value as ActiveCustomLens;
  return (
    typeof lens.lensId === "string" &&
    typeof lens.name === "string" &&
    typeof lens.instruction === "string" &&
    (lens.status === "naming" ||
      lens.status === "running" ||
      lens.status === "completed" ||
      lens.status === "failed")
  );
}
