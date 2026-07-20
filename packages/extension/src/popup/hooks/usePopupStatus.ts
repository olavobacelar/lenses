import { useCallback, useEffect, useRef, useState } from "react";
import type { PopupStatus } from "../types";

const INITIAL_STATUS: PopupStatus = {
  message: "Running...",
  isError: false,
  visible: false,
};

export function usePopupStatus() {
  const [status, setStatus] = useState<PopupStatus>(INITIAL_STATUS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((message: string, isError = false, hideAfterMs?: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus({ message, isError, visible: true });
    if (hideAfterMs) {
      timerRef.current = setTimeout(() => {
        setStatus((current) => ({ ...current, visible: false }));
        timerRef.current = null;
      }, hideAfterMs);
    }
  }, []);

  const hideStatus = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus((current) => ({ ...current, visible: false }));
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { status, showStatus, hideStatus };
}
