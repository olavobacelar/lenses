import {
  ArrowUpIcon,
  CopyIcon as RadixCopyIcon,
  ReloadIcon,
  ResetIcon,
} from "@radix-ui/react-icons";
import { Globe, History } from "lucide-react";
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  Ref,
} from "react";
import { Markdown, TextSegmentsWithCitations, type RichTextSegment } from "./RichText.js";
import { WebSearchGroups } from "./WebSearchGroups.js";
import { legacyActivityItems, type ChatActivityItem } from "./chat-activity.js";
import type { WebSearchEntry } from "./web-search.js";

export type ChatUiRole = "user" | "assistant" | "system" | "error";
export type ChatUiAction = "api-keys";
export type ChatUiMeta = Record<string, string>;

export interface ChatUiMessage {
  id: number;
  role: ChatUiRole;
  content: string;
  canRetry?: boolean;
  isError?: boolean;
  isImplicit?: boolean;
  thinkingText?: string;
  activity?: ChatActivityItem[];
  textSegments?: RichTextSegment[];
  meta?: ChatUiMeta;
  action?: ChatUiAction;
  searches?: WebSearchEntry[];
}

export interface ChatUiStreaming {
  thinkingText: string;
  thinkingOpen: boolean;
  activity?: ChatActivityItem[];
  searching: boolean;
  searches: WebSearchEntry[];
  assistantText: string;
  textSegments: RichTextSegment[];
  meta?: ChatUiMeta;
}

export function ChatMessageList<TMessage extends ChatUiMessage>({
  messages,
  isStreaming = false,
  liveMessageId,
  streaming,
  renderMessageBeforeContent,
  onCopyMessage,
  onRetryMessage,
  onRewindMessage,
  onOpenApiKeySettings,
}: {
  messages: TMessage[];
  isStreaming?: boolean;
  liveMessageId?: number;
  streaming?: ChatUiStreaming | null;
  renderMessageBeforeContent?: (message: TMessage) => ReactNode;
  onCopyMessage: (message: TMessage) => void;
  onRetryMessage: (message: TMessage) => void;
  onRewindMessage: (message: TMessage) => void;
  onOpenApiKeySettings: () => void;
}) {
  const activeLiveMessageId =
    liveMessageId ?? (isStreaming ? messages[messages.length - 1]?.id : undefined);

  return (
    <>
      {messages.map((message) => (
        <ChatMessageView
          key={message.id}
          message={message}
          isLive={message.id === activeLiveMessageId}
          renderMessageBeforeContent={renderMessageBeforeContent}
          onCopyMessage={onCopyMessage}
          onRetryMessage={onRetryMessage}
          onRewindMessage={onRewindMessage}
          onOpenApiKeySettings={onOpenApiKeySettings}
        />
      ))}
      {streaming ? <StreamingMessageView streaming={streaming} /> : null}
    </>
  );
}

function ChatMessageView<TMessage extends ChatUiMessage>({
  message,
  isLive,
  renderMessageBeforeContent,
  onCopyMessage,
  onRetryMessage,
  onRewindMessage,
  onOpenApiKeySettings,
}: {
  message: TMessage;
  isLive: boolean;
  renderMessageBeforeContent?: (message: TMessage) => ReactNode;
  onCopyMessage: (message: TMessage) => void;
  onRetryMessage: (message: TMessage) => void;
  onRewindMessage: (message: TMessage) => void;
  onOpenApiKeySettings: () => void;
}) {
  const isAssistant = message.role === "assistant";
  const isError = message.role === "error" || (message.isError ?? false);
  const textSegments = message.textSegments ?? [];
  const activity =
    isAssistant && !isError
      ? message.activity && message.activity.length > 0
        ? message.activity
        : legacyActivityItems({
            thinkingText: message.thinkingText,
            thinkingLive: isLive,
            searches: message.searches,
            searching: isLive,
          })
      : [];
  const bubble = (
    <div
      className={[
        "lenses-chat-message",
        message.role,
        isError ? "error" : "",
        message.isImplicit ? "implicit" : "",
        isAssistant && !isError ? (textSegments.length > 0 ? "plain" : "markdown") : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {message.role === "system" || message.role === "error" ? (
        <div className="lenses-chat-message-role">{message.role}</div>
      ) : null}
      {renderMessageBeforeContent?.(message)}
      {isAssistant && !isError ? (
        <>
          <MessageMeta meta={message.meta} />
          {textSegments.length > 0 ? (
            <TextSegmentsWithCitations
              segments={textSegments}
              fallbackText={message.content}
              grouped
            />
          ) : (
            <Markdown content={message.content} />
          )}
        </>
      ) : (
        <>
          <span>{message.content || (isAssistant && isLive ? "..." : "")}</span>
          {message.action === "api-keys" ? (
            <button
              type="button"
              className="lenses-chat-message-action"
              onClick={onOpenApiKeySettings}
            >
              Open AI settings
            </button>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className={`lenses-chat-message-frame ${message.role}`}>
      {activity.length > 0 ? <ChatActivityTimeline activity={activity} live={isLive} /> : null}
      {bubble}
      <MessageActions
        message={message}
        isLive={isLive}
        onCopyMessage={onCopyMessage}
        onRetryMessage={onRetryMessage}
        onRewindMessage={onRewindMessage}
      />
    </div>
  );
}

function MessageActions<TMessage extends ChatUiMessage>({
  message,
  isLive,
  onCopyMessage,
  onRetryMessage,
  onRewindMessage,
}: {
  message: TMessage;
  isLive: boolean;
  onCopyMessage: (message: TMessage) => void;
  onRetryMessage: (message: TMessage) => void;
  onRewindMessage: (message: TMessage) => void;
}) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  if (isLive) return null;

  const canCopy = message.content.trim().length > 0;

  return (
    <div className="lenses-chat-message-tools" aria-label="Message actions">
      <button
        type="button"
        className="lenses-chat-message-tool"
        title="Copy message"
        aria-label="Copy message"
        disabled={!canCopy}
        onClick={() => onCopyMessage(message)}
      >
        <ChatCopyIcon />
      </button>
      {message.role === "assistant" && message.canRetry ? (
        <button
          type="button"
          className="lenses-chat-message-tool"
          title="Retry response"
          aria-label="Retry response"
          onClick={() => onRetryMessage(message)}
        >
          <ChatRetryIcon />
        </button>
      ) : null}
      {message.role === "user" ? (
        <button
          type="button"
          className="lenses-chat-message-tool"
          title="Rewind to composer"
          aria-label="Rewind to composer"
          onClick={() => onRewindMessage(message)}
        >
          <ChatRewindIcon />
        </button>
      ) : null}
    </div>
  );
}

export function StreamingMessageView({ streaming }: { streaming: ChatUiStreaming }) {
  const hasAssistant =
    streaming.assistantText.trim().length > 0 ||
    streaming.textSegments.length > 0 ||
    !!streaming.meta;

  return (
    <>
      <ChatActivityTimeline
        activity={
          streaming.activity && streaming.activity.length > 0
            ? streaming.activity
            : legacyActivityItems({
                thinkingText: streaming.thinkingText,
                thinkingLive: streaming.thinkingOpen,
                searches: streaming.searches,
                searching: streaming.searching,
              })
        }
        live
      />
      {hasAssistant ? (
        <div className="lenses-chat-message assistant streaming">
          <MessageMeta meta={streaming.meta} />
          <TextSegmentsWithCitations
            segments={streaming.textSegments}
            fallbackText={streaming.assistantText}
            grouped
          />
        </div>
      ) : null}
    </>
  );
}

export function ChatActivityTimeline({
  activity,
  live = false,
}: {
  activity: ChatActivityItem[];
  live?: boolean;
}) {
  const visibleActivity = activity.filter((item) =>
    item.kind === "thinking" ? item.text.trim().length > 0 || item.live : item.searches.length > 0
  );
  if (visibleActivity.length === 0) return null;

  return (
    <div className="lenses-chat-activity" aria-label="Assistant activity">
      {visibleActivity.map((item, index) => (
        <div className="lenses-chat-activity-step" key={`${item.kind}:${index}`}>
          <div className="lenses-chat-activity-marker" aria-hidden="true">
            {item.kind === "research" ? (
              <Globe className="lenses-chat-activity-icon" strokeWidth={1.75} />
            ) : null}
          </div>
          <div className="lenses-chat-activity-body">
            {item.kind === "thinking" ? (
              <ThinkingDetails text={item.text} open={item.live} />
            ) : (
              <WebSearchGroups searches={item.searches} live={item.live} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThinkingDetails({ text, open = false }: { text: string; open?: boolean }) {
  // Render thinking as the same disclosure shape as the research ("Searched the
  // web") block — it reuses the shared .lenses-websearch chrome so the two read
  // as one family. Live = expanded and non-collapsible; finalized = a collapsed
  // disclosure. There is intentionally no "Done" row.
  const summary = (
    <span className="lenses-websearch-summary">
      <span className="lenses-websearch-label">{open ? "Thinking" : "Thought"}</span>
    </span>
  );
  // The reasoning glyph sits to the left of the trace itself — it only appears
  // once the disclosure is expanded, never up in the summary row.
  const body = (
    <div className="lenses-chat-thinking-row">
      <History className="lenses-chat-thinking-icon" strokeWidth={1.75} aria-hidden="true" />
      <pre className="lenses-chat-thinking-content">{text.trim()}</pre>
    </div>
  );

  if (open) {
    return (
      <div className="lenses-websearch lenses-websearch--thinking is-live">
        {summary}
        {body}
      </div>
    );
  }

  return (
    <details className="lenses-websearch lenses-websearch--thinking">
      <summary className="lenses-websearch-trigger">{summary}</summary>
      {body}
    </details>
  );
}

function MessageMeta({ meta }: { meta: ChatUiMeta | undefined }) {
  if (!meta) return null;

  const verdict = meta.verdict;
  if (typeof verdict === "string") {
    const normalized = verdict.toLowerCase();
    const labelByVerdict: Record<string, string> = {
      true: "True",
      false: "False",
      mixed: "Mixed",
      unverifiable: "Unverifiable",
    };
    const label = labelByVerdict[normalized];
    if (label) {
      return (
        <div className="lenses-chat-meta">
          <span className={`lenses-chat-verdict lenses-chat-verdict--${normalized}`}>
            {label}
          </span>
        </div>
      );
    }
  }

  const entries = Object.entries(meta).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return null;

  return (
    <div className="lenses-chat-meta">
      {entries.map(([key, value]) => (
        <span key={key} className="lenses-chat-meta-pill">
          {key}: {value}
        </span>
      ))}
    </div>
  );
}

export function ChatComposer({
  id,
  className,
  inputId,
  inputName = "lenses-chatbox-input",
  inputClassName,
  actionRowClassName,
  value,
  placeholder,
  disabled = false,
  submitDisabled = false,
  clearOnSubmit = false,
  inputRef,
  leadingContent,
  actions,
  spacer,
  sendButtonId,
  sendButtonClassName,
  onSubmit,
  onInputChange,
  onInputPaste,
}: {
  id?: string;
  className?: string;
  inputId?: string;
  inputName?: string;
  inputClassName?: string;
  actionRowClassName?: string;
  value?: string;
  placeholder: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  clearOnSubmit?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  leadingContent?: ReactNode;
  actions?: ReactNode;
  spacer?: ReactNode;
  sendButtonId?: string;
  sendButtonClassName?: string;
  onSubmit: (value: string) => void | boolean | Promise<void | boolean>;
  onInputChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onInputPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const formClassName = ["lenses-chatbox-form", className].filter(Boolean).join(" ");
  const textareaClassName = ["lenses-chatbox-input", inputClassName].filter(Boolean).join(" ");
  const rowClassName = ["lenses-chatbox-action-row", actionRowClassName]
    .filter(Boolean)
    .join(" ");
  const buttonClassName = ["lenses-chatbox-send", sendButtonClassName]
    .filter(Boolean)
    .join(" ");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem(inputName);
    if (!(input instanceof HTMLTextAreaElement)) return;
    const nextValue = input.value.trim();
    if (!nextValue) return;
    const result = await onSubmit(nextValue);
    if (clearOnSubmit && result !== false) {
      input.value = "";
    }
  };

  return (
    <form id={id} className={formClassName} onSubmit={(event) => void submit(event)}>
      {leadingContent}
      <textarea
        id={inputId}
        ref={inputRef}
        name={inputName}
        className={textareaClassName}
        rows={1}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        value={value}
        onChange={onInputChange}
        onPaste={onInputPaste}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      ></textarea>
      <div className={rowClassName} aria-label={actions ? "Source tools" : undefined}>
        {actions}
        {spacer}
        <button
          id={sendButtonId}
          className={buttonClassName}
          type="submit"
          aria-label="Send message"
          title="Send message"
          disabled={disabled || submitDisabled}
        >
          <SendArrowIcon />
        </button>
      </div>
    </form>
  );
}

export function ChatCopyIcon() {
  return (
    <RadixCopyIcon
      className="lenses-chatbox-action-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function ChatRewindIcon() {
  return (
    <ResetIcon
      className="lenses-chatbox-action-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function ChatRetryIcon() {
  return (
    <ReloadIcon
      className="lenses-chatbox-action-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function SendArrowIcon() {
  return (
    <ArrowUpIcon
      className="lenses-chatbox-send-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}
