import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretDownIcon, CheckIcon } from "@radix-ui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, PanelMessage, PanelSource } from "../types";
import { formatError } from "../lib/format";
import { ChatComposer } from "../../lib/ChatUi.js";
import { computeScrollOverflow } from "../../lib/scroll";
import {
  REASONING_EFFORT_SHORT_LABELS,
  reasoningEffortLabelForProvider,
  type ReasoningEffort,
} from "../../lib/reasoning-settings";
import type { AiModel } from "../../types/ai-models";
import type { useControlBay } from "../hooks/useControlBay";
import { DocumentChip } from "./DocumentChip";
import {
  CaptureIcon,
  CloseIcon,
  PaperclipIcon,
  SlidesIcon,
  VideoSlidesIcon,
} from "./Icons";
import { MessageList } from "./MessageList";

interface ChatDraft {
  id: number;
  text: string;
}

interface ImagePreview {
  src: string;
  alt: string;
}

type ChatModelControls = Pick<
  ReturnType<typeof useControlBay>,
  | "isModelMenuOpen"
  | "setIsModelMenuOpen"
  | "chatModel"
  | "modelOptions"
  | "reasoningEffort"
  | "reasoningEffortOptions"
  | "modelSupportsReasoning"
  | "modelProvider"
  | "chooseChatModel"
  | "chooseReasoningEffort"
>;

const CHAT_INPUT_MAX_HEIGHT = 240;

interface ChatDockProps {
  source: PanelSource | null;
  messages: PanelMessage[];
  isStreaming: boolean;
  attachments: Attachment[];
  draft: ChatDraft;
  modelControls: ChatModelControls;
  exportingPipeline: "frames" | "video" | null;
  contextualChat: { label: string } | null;
  onClearContext: () => void;
  onSend: (question: string, attachments: string[]) => Promise<boolean>;
  onClearChat: () => void;
  onRetryMessage: (message: PanelMessage) => void;
  onRewindMessage: (message: PanelMessage) => void;
  onClearAttachments: () => void;
  onRemoveAttachment: (id: number) => void;
  onStageFile: (file: File) => void;
  onCaptureScreenshot: () => Promise<void>;
  onExportSlides: (pipeline: "frames" | "video") => void;
  onSeek: (seconds: number) => void;
  onOpenApiKeys: () => void;
  showWarning: (message: string) => void;
}

export function ChatDock({
  source,
  messages,
  isStreaming,
  attachments,
  draft,
  modelControls,
  exportingPipeline,
  contextualChat,
  onClearContext,
  onSend,
  onClearChat,
  onRetryMessage,
  onRewindMessage,
  onClearAttachments,
  onRemoveAttachment,
  onStageFile,
  onCaptureScreenshot,
  onExportSlides,
  onSeek,
  onOpenApiKeys,
  showWarning,
}: ChatDockProps) {
  const [input, setInput] = useState("");
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showYouTubeTools = source?.kind === "youtube_video";
  const hasYouTubeVideoId = !!source?.videoId;
  const captureTitle = showYouTubeTools ? "Capture frame" : "Capture screenshot";

  // Arm the log's top/bottom fade masks only where content is actually clipped,
  // mirrored onto data attributes the CSS reads (see .messages in sidepanel.css).
  const syncScrollFades = useCallback(() => {
    const log = messagesRef.current;
    if (!log) return;
    const { top, bottom } = computeScrollOverflow(log);
    log.dataset.overflowTop = String(top);
    log.dataset.overflowBottom = String(bottom);
  }, []);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    syncScrollFades();
  }, [messages, isStreaming, syncScrollFades]);

  // The fades also depend on the log's own height, so track manual scrolling and
  // panel resizes — not just message changes — to keep them in sync.
  useEffect(() => {
    const log = messagesRef.current;
    if (!log) return;
    syncScrollFades();
    log.addEventListener("scroll", syncScrollFades, { passive: true });
    const observer = new ResizeObserver(syncScrollFades);
    observer.observe(log);
    return () => {
      log.removeEventListener("scroll", syncScrollFades);
      observer.disconnect();
    };
  }, [syncScrollFades]);

  useEffect(() => {
    if (!draft.text) return;
    setInput(draft.text);
    requestAnimationFrame(() => {
      const inputEl = inputRef.current;
      if (!inputEl) return;
      autoGrow(inputEl);
      inputEl.focus();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    });
  }, [draft]);

  useEffect(() => {
    if (!previewImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  const submit = async (question: string) => {
    const sent = await onSend(
      question,
      attachments.map((attachment) => attachment.dataUrl)
    );
    if (!sent) return false;
    setInput("");
    onClearAttachments();
    if (inputRef.current) autoGrow(inputRef.current);
    return true;
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      onStageFile(file);
      break;
    }
  };

  const copyMessage = (message: PanelMessage) => {
    const text = message.content.trim();
    if (!text) return;
    copyTextToClipboard(message.content).catch((error) => showWarning(formatError(error)));
  };

  return (
    <section className="chat-dock">
      <div className="chat-dock-head">
        <h2>Chat</h2>
        <button id="clear-chat" className="text-btn" type="button" onClick={onClearChat}>
          Clear
        </button>
      </div>
      <div id="messages" className="messages" ref={messagesRef}>
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          onSeek={onSeek}
          onPreviewImage={setPreviewImage}
          onOpenApiKeys={onOpenApiKeys}
          onCopyMessage={copyMessage}
          onRetryMessage={onRetryMessage}
          onRewindMessage={onRewindMessage}
        />
      </div>
      {/* A staged selection/finding context reroutes sends to the contextual
          stream; surface that as removable state instead of a hidden latch. */}
      {contextualChat ? (
        <div className="chat-context-chip" role="status">
          <span className="chat-context-chip-label" title={contextualChat.label}>
            {contextualChat.label}
          </span>
          <button
            type="button"
            className="chat-context-chip-clear"
            title="Return to whole-page chat"
            aria-label="Return to whole-page chat"
            onClick={onClearContext}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      <ChatComposer
        id="chat-form"
        className="chat-form"
        inputId="chat-input"
        inputName="chat-input"
        value={input}
        inputRef={inputRef}
        placeholder="Ask, paste an image, or attach a file"
        submitDisabled={isStreaming}
        leadingContent={
          <AttachmentTray
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
            onPreviewImage={setPreviewImage}
          />
        }
        actionRowClassName="composer-actions"
        actions={
          <>
            <input
              id="file-input"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.pdf,text/plain,text/markdown,.txt,.md,.markdown"
              hidden
              onChange={(event) => {
                for (const file of Array.from(event.currentTarget.files ?? [])) {
                  onStageFile(file);
                }
                event.currentTarget.value = "";
              }}
            />
            <button
              id="attach-file"
              className="action-btn"
              type="button"
              title="Attach file"
              aria-label="Attach file"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
            <button
              id="capture-screenshot"
              className="action-btn"
              type="button"
              title={captureTitle}
              aria-label={captureTitle}
              disabled={!source}
              onClick={() => {
                onCaptureScreenshot().catch((error) => showWarning(formatError(error)));
              }}
            >
              <CaptureIcon />
            </button>
            {__LOCAL_SLIDE_EXPORT__ && showYouTubeTools && (
              <>
                <button
                  id="export-slides"
                  className="action-btn"
                  type="button"
                  title="Export slides"
                  aria-label="Export slides"
                  disabled={!hasYouTubeVideoId || exportingPipeline === "frames"}
                  onClick={() => onExportSlides("frames")}
                >
                  <SlidesIcon />
                </button>
                <button
                  id="export-video-slides"
                  className="action-btn"
                  type="button"
                  title="Export video slides"
                  aria-label="Export video slides"
                  disabled={!hasYouTubeVideoId || exportingPipeline === "video"}
                  onClick={() => onExportSlides("video")}
                >
                  <VideoSlidesIcon />
                </button>
              </>
            )}
            <ChatModelReasoningMenu controls={modelControls} />
          </>
        }
        spacer={<span className="composer-spacer" />}
        sendButtonId="send-chat"
        sendButtonClassName="send-btn"
        onSubmit={submit}
        onInputChange={(event) => {
          setInput(event.target.value);
          autoGrow(event.currentTarget);
        }}
        onInputPaste={handlePaste}
      />
      {previewImage ? (
        <ImagePreviewDialog image={previewImage} onClose={() => setPreviewImage(null)} />
      ) : null}
    </section>
  );
}

function ChatModelReasoningMenu({ controls }: { controls: ChatModelControls }) {
  const suppressModelMenuFocusRestoreRef = useRef(false);

  const chooseFromModelMenu = (choose: () => void) => {
    suppressModelMenuFocusRestoreRef.current = true;
    choose();
    controls.setIsModelMenuOpen(false);
  };

  return (
    <DropdownMenu.Root
      open={controls.isModelMenuOpen}
      onOpenChange={controls.setIsModelMenuOpen}
    >
      <DropdownMenu.Trigger asChild>
        <button
          id="chat-model"
          className="c2-model chat-model"
          type="button"
          aria-controls="chat-model-menu"
          title={
            controls.modelSupportsReasoning
              ? `${formatModelLabel(controls.chatModel)} · ${reasoningEffortLabelForProvider(
                  controls.reasoningEffort,
                  controls.modelProvider
                )}`
              : formatModelLabel(controls.chatModel)
          }
        >
          <span className="c2-model-label">{formatModelLabel(controls.chatModel)}</span>
          {controls.modelSupportsReasoning ? (
            <span className="c2-model-effort">
              {REASONING_EFFORT_SHORT_LABELS[controls.reasoningEffort]}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        id="chat-model-menu"
        className="c2-menu c2-model-menu"
        align="start"
        side="top"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          if (!suppressModelMenuFocusRestoreRef.current) return;
          suppressModelMenuFocusRestoreRef.current = false;
          event.preventDefault();
        }}
      >
        {controls.modelSupportsReasoning ? (
          <>
            <div className="c2-menu-section">Reasoning</div>
            <DropdownMenu.RadioGroup value={controls.reasoningEffort}>
              {controls.reasoningEffortOptions.map((effort) => (
                <ReasoningItem
                  key={effort}
                  value={effort}
                  active={controls.reasoningEffort === effort}
                  label={reasoningEffortLabelForProvider(effort, controls.modelProvider)}
                  onSelect={() =>
                    chooseFromModelMenu(() => controls.chooseReasoningEffort(effort))
                  }
                />
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="c2-menu-separator" />
          </>
        ) : null}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className="c2-menu-item c2-menu-item-compact c2-submenu-trigger">
            <span className="c2-menu-check" aria-hidden="true" />
            <span className="c2-menu-label">{formatModelLabel(controls.chatModel)}</span>
            <CaretDownIcon
              className="mchev c2-submenu-chev"
              aria-hidden="true"
              focusable="false"
            />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent
            id="chat-model-submenu"
            className="c2-menu c2-model-submenu"
            sideOffset={8}
            alignOffset={-4}
          >
            <DropdownMenu.RadioGroup value={controls.chatModel}>
              {controls.modelOptions.map((model) => (
                <ModelItem
                  key={model}
                  value={model}
                  active={controls.chatModel === model}
                  label={formatModelLabel(model)}
                  onSelect={() => chooseFromModelMenu(() => controls.chooseChatModel(model))}
                />
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function ModelItem({
  value,
  active,
  label,
  onSelect,
}: {
  value: AiModel;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.RadioItem
      className={`c2-menu-item c2-menu-item-compact ${active ? "is-active" : ""}`}
      value={value}
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <span className="c2-menu-check" aria-hidden="true">
        <DropdownMenu.ItemIndicator>
          <CheckIcon width={12} height={12} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="c2-menu-label">{label}</span>
    </DropdownMenu.RadioItem>
  );
}

function ReasoningItem({
  value,
  active,
  label,
  onSelect,
}: {
  value: ReasoningEffort;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.RadioItem
      className={`c2-menu-item c2-menu-item-compact ${active ? "is-active" : ""}`}
      value={value}
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <span className="c2-menu-check" aria-hidden="true">
        <DropdownMenu.ItemIndicator>
          <CheckIcon width={12} height={12} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="c2-menu-label">{label}</span>
    </DropdownMenu.RadioItem>
  );
}

function formatModelLabel(model: string): string {
  if (model.startsWith("claude-")) {
    return formatClaudeModelLabel(model);
  }
  return model
    .split("-")
    .map((part) => (part === "gpt" ? "GPT" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("-");
}

function formatClaudeModelLabel(model: string): string {
  const [family = "", ...versionParts] = model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .split("-");
  const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);
  if (versionParts.length > 0 && versionParts.every((part) => /^\d+$/.test(part))) {
    return `${familyLabel} ${versionParts.join(".")}`;
  }
  return [familyLabel, ...versionParts.map((part) => part.charAt(0).toUpperCase() + part.slice(1))]
    .filter(Boolean)
    .join(" ");
}

function AttachmentTray({
  attachments,
  onRemoveAttachment,
  onPreviewImage,
}: {
  attachments: Attachment[];
  onRemoveAttachment: (id: number) => void;
  onPreviewImage: (image: ImagePreview) => void;
}) {
  return (
    <div id="screenshot-list" className={`screenshot-list ${attachments.length ? "" : "hidden"}`}>
      {attachments.map((attachment) => {
        const alt = attachment.formatted
          ? `Screenshot at ${attachment.formatted}`
          : "Screenshot";
        const item =
          attachment.kind === "image" ? (
            <div className="screenshot" key={attachment.id}>
              <button
                type="button"
                className="screenshot-preview-btn"
                title="View screenshot"
                aria-label="View screenshot"
                onClick={() => onPreviewImage({ src: attachment.dataUrl, alt })}
              >
                <img src={attachment.dataUrl} alt={alt} />
              </button>
              <RemoveAttachmentButton id={attachment.id} onRemove={onRemoveAttachment} />
            </div>
          ) : (
            <DocumentChip
              key={attachment.id}
              label={attachment.name}
              src={attachment.dataUrl}
              className="attachment-chip"
            >
              <RemoveAttachmentButton id={attachment.id} onRemove={onRemoveAttachment} />
            </DocumentChip>
          );
        return item;
      })}
    </div>
  );
}

function RemoveAttachmentButton({
  id,
  onRemove,
}: {
  id: number;
  onRemove: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className="screenshot-remove"
      title="Remove attachment"
      aria-label="Remove attachment"
      onClick={() => onRemove(id)}
    >
      <CloseIcon size={12} />
    </button>
  );
}

function ImagePreviewDialog({
  image,
  onClose,
}: {
  image: ImagePreview;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="image-preview-backdrop" onClick={onClose}>
          <Dialog.Content
            className="image-preview-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <Dialog.Title className="image-preview-title">Image preview</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="image-preview-close"
                title="Close preview"
                aria-label="Close preview"
              >
                <CloseIcon size={16} />
              </button>
            </Dialog.Close>
            <img src={image.src} alt={image.alt} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT)}px`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path below; side panels can be picky about
      // clipboard permissions depending on focus and browser version.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Could not copy message.");
}
