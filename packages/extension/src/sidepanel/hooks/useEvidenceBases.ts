import { useCallback, useEffect, useMemo, useState } from "react";
import type { EvidenceBase } from "@lenses/shared";
import {
  ACTIVE_EVIDENCE_BASE_STORAGE_KEY,
  readActiveEvidenceBaseId,
  writeActiveEvidenceBaseId,
} from "../../lib/evidence-bases";
import { isAppModeChangedMessage } from "../../lib/app-mode";
import { sendRuntimeMessage } from "../lib/chrome";

export interface EvidenceBaseCreateInput {
  title: string;
  description?: string;
  guidingQuestion?: string;
}

export function useEvidenceBases({ showWarning }: { showWarning: (message: string) => void }) {
  const [evidenceBases, setEvidenceBases] = useState<EvidenceBase[]>([]);
  const [activeEvidenceBaseId, setActiveEvidenceBaseIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await sendRuntimeMessage<{
      evidenceBases?: EvidenceBase[];
      error?: string;
    }>({ type: "list-evidence-bases" });
    if (response.error) throw new Error(response.error);
    const nextEvidenceBases = response.evidenceBases ?? [];
    const storedActiveId = await readActiveEvidenceBaseId();
    const nextActiveId = nextEvidenceBases.some((item) => item.id === storedActiveId)
      ? storedActiveId
      : null;
    if (storedActiveId && !nextActiveId) {
      await writeActiveEvidenceBaseId(null);
    }
    setEvidenceBases(nextEvidenceBases);
    setActiveEvidenceBaseIdState(nextActiveId);
    setIsLoading(false);
  }, []);

  const setActiveEvidenceBaseId = useCallback(
    async (nextId: string | null) => {
      await writeActiveEvidenceBaseId(nextId);
      setActiveEvidenceBaseIdState(nextId);
    },
    []
  );

  const createEvidenceBase = useCallback(
    async (input: EvidenceBaseCreateInput) => {
      const response = await sendRuntimeMessage<{ id?: string; error?: string }>({
        type: "create-evidence-base",
        ...input,
      });
      if (response.error || !response.id) {
        throw new Error(response.error || "Could not create evidence base");
      }
      await writeActiveEvidenceBaseId(response.id);
      await refresh();
      setActiveEvidenceBaseIdState(response.id);
      return response.id;
    },
    [refresh]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    refresh().catch((error) => {
      if (!cancelled) {
        setIsLoading(false);
        showWarning(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, showWarning]);

  useEffect(() => {
    const onRuntimeMessage = (message: unknown) => {
      if (!isAppModeChangedMessage(message)) return;
      setIsLoading(true);
      void refresh().catch((error) =>
        showWarning(error instanceof Error ? error.message : String(error))
      );
    };
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[ACTIVE_EVIDENCE_BASE_STORAGE_KEY]) return;
      void readActiveEvidenceBaseId().then(setActiveEvidenceBaseIdState);
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [refresh, showWarning]);

  const activeEvidenceBase = useMemo(
    () => evidenceBases.find((item) => item.id === activeEvidenceBaseId) ?? null,
    [activeEvidenceBaseId, evidenceBases]
  );

  return {
    evidenceBases,
    activeEvidenceBase,
    activeEvidenceBaseId,
    isLoading,
    refresh,
    setActiveEvidenceBaseId,
    createEvidenceBase,
  };
}
