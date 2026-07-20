// Data layer for the browser-local Lens library. AI execution mode does not
// change where reusable Lenses are stored.

import { useCallback, useEffect, useMemo, useState } from "react";
import { lensFromRow, type LibraryLens } from "../lib/lens-library.js";

export interface LensLibrary {
  lenses: LibraryLens[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Persist the editor's canonical markdown. Returns the (possibly forked) id so
  // the caller can re-select the saved lens — editing a built-in yields a new id.
  saveLens: (markdown: string) => Promise<{ lensId?: string; name?: string }>;
  deleteLens: (lensId: string) => Promise<void>;
  eraseLens: (lensId: string) => Promise<void>;
  reorderUserLenses: (lensIds: string[]) => Promise<void>;
  reorderBuiltInLenses: (lensIds: string[]) => Promise<void>;
}

export function useLensLibrary(): LensLibrary {
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lenses = useMemo(
    () =>
      rows
        .map(lensFromRow)
        .filter((lens): lens is LibraryLens => lens !== null),
    [rows]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await sendRuntimeMessage<{ lenses?: unknown[]; error?: string }>({
        type: "list-lenses",
      });
      if (response.error) throw new Error(response.error);
      setRows(response.lenses ?? []);
      setError(null);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveLens = useCallback(
    async (markdown: string) => {
      const response = await sendRuntimeMessage<{
        lensId?: string;
        name?: string;
        error?: string;
      }>({
        type: "save-lens-config",
        markdown,
      });
      if (response.error) throw new Error(response.error);
      await refresh();
      return { lensId: response?.lensId, name: response?.name };
    },
    [refresh]
  );

  const deleteLens = useCallback(
    async (lensId: string) => {
      const response = await sendRuntimeMessage<{ deleted?: boolean; error?: string }>({
        type: "delete-user-lens",
        lensId,
      });
      if (response.error) throw new Error(response.error);
      await refresh();
    },
    [refresh]
  );

  const eraseLens = useCallback(
    async (lensId: string) => {
      const response = await sendRuntimeMessage<{ erased?: boolean; error?: string }>({
        type: "erase-lens",
        lensId,
      });
      if (response.error) throw new Error(response.error);
      await refresh();
    },
    [refresh]
  );

  const reorderUserLenses = useCallback(
    async (lensIds: string[]) => {
      const cleanLensIds = dedupeLensIds(lensIds);
      setRows((current) => orderRowsByUserLensIds(current, cleanLensIds));
      try {
        const response = await sendRuntimeMessage<{ lensIds?: string[]; error?: string }>({
          type: "reorder-user-lenses",
          lensIds: cleanLensIds,
        });
        if (response.error) throw new Error(response.error);
        await refresh();
      } catch (caught) {
        await refresh();
        throw caught;
      }
    },
    [refresh]
  );

  const reorderBuiltInLenses = useCallback(
    async (lensIds: string[]) => {
      const cleanLensIds = dedupeLensIds(lensIds);
      setRows((current) => orderRowsByBuiltInLensIds(current, cleanLensIds));
      try {
        const response = await sendRuntimeMessage<{ lensIds?: string[]; error?: string }>({
          type: "reorder-built-in-lenses",
          lensIds: cleanLensIds,
        });
        if (response.error) throw new Error(response.error);
        await refresh();
      } catch (caught) {
        await refresh();
        throw caught;
      }
    },
    [refresh]
  );

  return {
    lenses,
    loading,
    error,
    refresh,
    saveLens,
    deleteLens,
    eraseLens,
    reorderUserLenses,
    reorderBuiltInLenses,
  };
}

function orderRowsByUserLensIds(rows: unknown[], lensIds: readonly string[]): unknown[] {
  if (lensIds.length === 0) return rows;
  const rank = new Map(lensIds.map((lensId, index) => [lensId, index]));
  const decorated = rows.map((row, index) => {
    const lens = lensFromRow(row);
    return { row, index, lens };
  });
  const sortedUserRows = decorated
    .filter((item) => item.lens && !item.lens.isBuiltIn)
    .sort((a, b) => {
      const aRank = rank.get(a.lens?.config.id ?? "") ?? lensIds.length + a.index;
      const bRank = rank.get(b.lens?.config.id ?? "") ?? lensIds.length + b.index;
      return aRank - bRank || a.index - b.index;
    })
    .map((item) => item.row);

  let userIndex = 0;
  return decorated.map((item) => {
    if (item.lens && !item.lens.isBuiltIn) return sortedUserRows[userIndex++];
    return item.row;
  });
}

function orderRowsByBuiltInLensIds(rows: unknown[], lensIds: readonly string[]): unknown[] {
  if (lensIds.length === 0) return rows;
  const rank = new Map(lensIds.map((lensId, index) => [lensId, index]));
  const decorated = rows.map((row, index) => {
    const lens = lensFromRow(row);
    return { row, index, lens };
  });
  const sortedBuiltInRows = decorated
    .filter((item) => item.lens?.isBuiltIn)
    .sort((a, b) => {
      const aRank = rank.get(a.lens?.config.id ?? "") ?? lensIds.length + a.index;
      const bRank = rank.get(b.lens?.config.id ?? "") ?? lensIds.length + b.index;
      return aRank - bRank || a.index - b.index;
    })
    .map((item) => item.row);

  let builtInIndex = 0;
  return decorated.map((item) => {
    if (item.lens?.isBuiltIn) return sortedBuiltInRows[builtInIndex++];
    return item.row;
  });
}

function dedupeLensIds(lensIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const lensId of lensIds) {
    const trimmed = lensId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response as T);
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
