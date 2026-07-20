import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB, MAX_ATTACHMENTS } from "../constants";
import { captureVisibleTabScreenshot, sendToActiveTab } from "../lib/chrome";
import { classifyFile, documentAttachmentLabel, isImageAttachment } from "../lib/attachments";
import type { Attachment, PanelSource } from "../types";
import type { VideoTime } from "../../types/transcript";

interface UseAttachmentsOptions {
  activeTabId: number | null;
  source: PanelSource | null;
  showWarning: (message: string) => void;
}

export function useAttachments({
  activeTabId,
  source,
  showWarning,
}: UseAttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const nextAttachmentId = useRef(1);

  const addAttachment = useCallback(
    (attachment: Omit<Attachment, "id">): boolean => {
      let added = false;
      setAttachments((current) => {
        if (current.length >= MAX_ATTACHMENTS) {
          showWarning(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
          return current;
        }
        added = true;
        return [...current, { id: nextAttachmentId.current++, ...attachment }];
      });
      return added;
    },
    [showWarning]
  );

  const removeAttachment = useCallback((id: number) => {
    setAttachments((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const restoreAttachments = useCallback(
    (dataUrls: string[], videoTimestamp?: VideoTime | null) => {
      if (dataUrls.length > MAX_ATTACHMENTS) {
        showWarning(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
      }

      const restored = dataUrls.slice(0, MAX_ATTACHMENTS).map((dataUrl, index) => {
        const isImage = isImageAttachment(dataUrl);
        return {
          id: nextAttachmentId.current++,
          dataUrl,
          kind: isImage ? "image" : "document",
          name: isImage ? undefined : documentAttachmentLabel(dataUrl),
          formatted: isImage && index === 0 ? videoTimestamp?.formatted : undefined,
        } satisfies Attachment;
      });

      setAttachments(restored);
    },
    [showWarning]
  );

  const stageFile = useCallback(
    (file: File) => {
      const classified = classifyFile(file);
      if (!classified) {
        showWarning("Unsupported file. Attach an image, PDF, or text/markdown file.");
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        showWarning(`Files must be under ${MAX_ATTACHMENT_MB} MB.`);
        return;
      }
      if (attachments.length >= MAX_ATTACHMENTS) {
        showWarning(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        const base64 = reader.result.split(",")[1];
        if (!base64) return;
        addAttachment({
          dataUrl: `data:${classified.mediaType};base64,${base64}`,
          kind: classified.kind,
          name: file.name,
        });
      };
      reader.readAsDataURL(file);
    },
    [addAttachment, attachments.length, showWarning]
  );

  const captureScreenshot = useCallback(async () => {
    if (!source || !activeTabId) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      showWarning(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
      return;
    }

    if (source.kind !== "youtube_video") {
      const screenshot = await captureVisibleTabScreenshot(activeTabId);
      addAttachment({
        dataUrl: screenshot,
        kind: "image",
      });
      return;
    }

    const result = await sendToActiveTab<{
      screenshot?: string;
      formatted?: string;
      error?: string;
    }>(activeTabId, { action: "captureScreenshot" }, false);

    if (result.error || !result.screenshot) {
      throw new Error(result.error ?? "Screenshot failed.");
    }

    addAttachment({
      dataUrl: result.screenshot,
      kind: "image",
      formatted: result.formatted,
    });
  }, [activeTabId, addAttachment, attachments.length, showWarning, source]);

  useEffect(() => {
    setAttachments([]);
  }, [source?.key]);

  return {
    attachments,
    addAttachment,
    restoreAttachments,
    removeAttachment,
    clearAttachments,
    stageFile,
    captureScreenshot,
  };
}
