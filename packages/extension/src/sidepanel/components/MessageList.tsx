import { ChatMessageList } from "../../lib/ChatUi.js";
import { documentAttachmentLabel, isImageAttachment } from "../lib/attachments";
import type { PanelMessage } from "../types";
import { DocumentChip } from "./DocumentChip";
import { SeekButton } from "./SeekButton";

interface MessageListProps {
  messages: PanelMessage[];
  isStreaming: boolean;
  onSeek: (seconds: number) => void;
  onPreviewImage: (image: { src: string; alt: string }) => void;
  onOpenApiKeys: () => void;
  onCopyMessage: (message: PanelMessage) => void;
  onRetryMessage: (message: PanelMessage) => void;
  onRewindMessage: (message: PanelMessage) => void;
}

export function MessageList({
  messages,
  isStreaming,
  onSeek,
  onPreviewImage,
  onOpenApiKeys,
  onCopyMessage,
  onRetryMessage,
  onRewindMessage,
}: MessageListProps) {
  const chatMessages: Array<PanelMessage & { canRetry?: boolean }> = messages.map((message) => ({
    ...message,
    canRetry: message.role === "assistant",
  }));

  return (
    <ChatMessageList
      messages={chatMessages}
      isStreaming={isStreaming}
      renderMessageBeforeContent={(message) => (
        <MessageAttachments
          message={message}
          onSeek={onSeek}
          onPreviewImage={onPreviewImage}
        />
      )}
      onOpenApiKeySettings={onOpenApiKeys}
      onCopyMessage={onCopyMessage}
      onRetryMessage={onRetryMessage}
      onRewindMessage={onRewindMessage}
    />
  );
}

function MessageAttachments({
  message,
  onSeek,
  onPreviewImage,
}: {
  message: PanelMessage;
  onSeek: (seconds: number) => void;
  onPreviewImage: (image: { src: string; alt: string }) => void;
}) {
  const stamp = message.videoTimestamp;
  const hasStamp = message.role === "user" && Boolean(stamp?.formatted);
  const shots = message.screenshots ?? [];
  const imageShots = shots.filter(isImageAttachment);
  const docShots = shots.filter((src) => !isImageAttachment(src));

  return (
    <>
      {imageShots.length > 0 ? (
        <div className="message-screenshots">
          {imageShots.map((src, index) => {
            const alt = index === 0 && hasStamp && stamp
              ? `Screenshot at ${stamp.formatted}`
              : "Screenshot";
            return (
              <div className="message-screenshot-wrap" key={`${index}:${src.slice(0, 32)}`}>
                <button
                  type="button"
                  className="message-thumbnail-btn"
                  title="View screenshot"
                  aria-label="View screenshot"
                  onClick={() => onPreviewImage({ src, alt })}
                >
                  <img className="message-thumbnail" src={src} alt={alt} />
                </button>
                {index === 0 && hasStamp && stamp ? (
                  <SeekButton
                    stamp={stamp}
                    className="message-timestamp-overlay"
                    onSeek={onSeek}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : hasStamp && stamp ? (
        <SeekButton stamp={stamp} className="message-timestamp" onSeek={onSeek} />
      ) : null}

      {docShots.length > 0 ? (
        <div className="message-attachments">
          {docShots.map((src, index) => (
            <DocumentChip
              key={`${index}:${src.slice(0, 32)}`}
              src={src}
              label={documentAttachmentLabel(src)}
              className="message-attachment"
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
