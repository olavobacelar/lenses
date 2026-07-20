import { useCallback, useState } from "react";
import type { PanelSource } from "../types";
import {
  downloadBlob,
  getResponseFileName,
  getSlideExportServerUrl,
  readSlideExportError,
} from "../lib/slides";

export type SlideExportPipeline = "frames" | "video";

interface UseSlideExportOptions {
  source: PanelSource | null;
  showWarning: (message: string) => void;
}

export function useSlideExport({ source, showWarning }: UseSlideExportOptions) {
  return (__LOCAL_SLIDE_EXPORT__ ? useLocalSlideExport : useDisabledSlideExport)({
    source,
    showWarning,
  });
}

function useDisabledSlideExport(_options: UseSlideExportOptions) {
  return {
    exportingPipeline: null,
    slideStatus: null,
    exportSlides: async (_pipeline: SlideExportPipeline) => undefined,
  };
}

function useLocalSlideExport({ source, showWarning }: UseSlideExportOptions) {
  const [exportingPipeline, setExportingPipeline] = useState<SlideExportPipeline | null>(
    null
  );
  const [status, setStatus] = useState<string | null>(null);

  const exportSlides = useCallback(
    async (pipeline: SlideExportPipeline) => {
      if (!source?.videoId) return;
      setExportingPipeline(pipeline);
      setStatus(pipeline === "video" ? "Exporting video slides..." : "Exporting slides...");

      try {
        const endpoint = pipeline === "video" ? "/slides/export/video" : "/slides/export";
        const response = await fetch(`${getSlideExportServerUrl()}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: source.videoId,
            videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(source.videoId)}`,
            title: source.title,
          }),
        });

        if (!response.ok) {
          throw new Error(await readSlideExportError(response));
        }

        const blob = await response.blob();
        downloadBlob(blob, getResponseFileName(response, source.videoId));
        setStatus("Downloaded");
      } catch (error) {
        setStatus(null);
        showWarning(
          error instanceof TypeError
            ? "Slide export server is not running. Start it with bun run slides:server."
            : error instanceof Error
              ? error.message
              : String(error)
        );
      } finally {
        setExportingPipeline(null);
      }
    },
    [showWarning, source]
  );

  return {
    exportingPipeline,
    slideStatus: status,
    exportSlides,
  };
}
