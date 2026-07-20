import { useCallback, useEffect, useRef, useState } from "react";
import { sendRuntimeMessage } from "../lib/chrome";

const TOAST_DURATION_MS = 2600;

interface UseEvidenceCaptureOptions {
  activeEvidenceBaseId: string | null;
  activeEvidenceBaseTitle?: string;
  sourceKey?: string;
  onError: (message: string) => void;
}

/**
 * Surfaces auto-capture — the only way a source enters an evidence base now that
 * there's no explicit add control. Tracks whether the current source belongs to
 * the active base (for the selector's saved-source indicator) and raises a transient toast
 * the first time a run adds it.
 *
 * `sourceInBase` is a tri-state: `null` means "not applicable / unknown" (no
 * active base, no current source, or membership still loading); `false` means
 * not saved and `true` shows the explicit membership indicator.
 */
export function useEvidenceCapture({
  activeEvidenceBaseId,
  activeEvidenceBaseTitle,
  sourceKey,
  onError,
}: UseEvidenceCaptureOptions) {
  const [sourceInBase, setSourceInBase] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeEvidenceBaseId || !sourceKey) {
      setSourceInBase(null);
      return;
    }
    let cancelled = false;
    setSourceInBase(null);
    sendRuntimeMessage<{ present?: boolean; error?: string }>({
      type: "evidence-base-has-source",
      evidenceBaseId: activeEvidenceBaseId,
      sourceKey,
    })
      .then((response) => {
        if (cancelled) return;
        if (response.error) {
          onError(response.error);
          return;
        }
        setSourceInBase(response.present === true);
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeEvidenceBaseId, sourceKey, onError]);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const handleCaptured = useCallback(
    (added: boolean) => {
      // Starting the run saves the source regardless of whether its analysis
      // later completes, fails, or is stopped. Keep that lifecycle distinction
      // explicit in the UI.
      setSourceInBase(true);
      if (!added) return;
      setToast(`Source saved to ${activeEvidenceBaseTitle ?? "evidence base"}`);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, TOAST_DURATION_MS);
    },
    [activeEvidenceBaseTitle]
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  return { sourceInBase, toast, handleCaptured, dismissToast };
}
