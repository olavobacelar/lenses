import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import {
  CONVEX_URL_STORAGE_KEY,
  readConfiguredConvexUrl,
} from "./convex-url";

export function ConvexExtensionProvider({ children }: { children: ReactNode }) {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void readConfiguredConvexUrl().then((url) => {
      if (!cancelled) setConvexUrl(url);
    });

    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
      return () => {
        cancelled = true;
      };
    }

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[CONVEX_URL_STORAGE_KEY]) return;
      void readConfiguredConvexUrl().then((url) => {
        if (!cancelled) setConvexUrl(url);
      });
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [convexUrl]
  );

  useEffect(() => {
    return () => {
      void client?.close();
    };
  }, [client]);

  if (!client) return null;

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
