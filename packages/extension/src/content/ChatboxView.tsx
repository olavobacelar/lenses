import { ArrowUpIcon, Cross2Icon, TrashIcon as RadixTrashIcon } from "@radix-ui/react-icons";
import type { FocusEvent, MouseEvent } from "react";
import { splitQuoteForReferences } from "./selection-helpers.js";
import {
  ChatComposer,
  ChatMessageList,
  type ChatUiMessage,
  type ChatUiStreaming,
} from "../lib/ChatUi.js";
import type { RichTextSegment } from "../lib/RichText.js";
import type { WebSearchEntry } from "../lib/web-search.js";

export type ChatboxRole = "user" | "assistant";
export type ChatboxAction = "api-keys";

export type ChatboxTextSegment = RichTextSegment;

export type ChatboxMessageMeta = Record<string, string>;

export interface ChatboxMessageView extends ChatUiMessage {
  id: number;
  role: ChatboxRole;
  content: string;
  conversationIndex?: number;
  retryTargetLensId?: string;
  retryQuestion?: string;
  canRetry?: boolean;
  isError?: boolean;
  isImplicit?: boolean;
  thinkingText?: string;
  textSegments?: ChatboxTextSegment[];
  meta?: ChatboxMessageMeta;
  action?: ChatboxAction;
  searches?: WebSearchEntry[];
}

export interface ChatboxStreamingView extends ChatUiStreaming {
  thinkingText: string;
  thinkingOpen: boolean;
  searching: boolean;
  searches: WebSearchEntry[];
  assistantText: string;
  textSegments: ChatboxTextSegment[];
  meta?: ChatboxMessageMeta;
}

export interface ChatboxAnnotationView {
  id: string;
  label: string;
  detail: string;
  confidence: number;
  color: string;
}

export interface ChatboxSelectionHeaderView {
  eyebrow: string;
  quote: string;
}

export interface ChatboxMessageSelectionPrompt {
  text: string;
  left: number;
  top: number;
}

export function ChatboxView({
  selectionHeader,
  annotationSubtitle,
  annotationRows,
  selectedAnnotationId,
  debugMode,
  messages,
  messageSelectionPrompt,
  streaming,
  waiting,
  placeholder,
  canDelete,
  canRemoveAnnotation,
  onClose,
  onDelete,
  onRemoveAnnotation,
  onRawResults,
  onAnnotationSelect,
  onSubmit,
  onCopyMessage,
  onRetryMessage,
  onRewindMessage,
  onOpenApiKeySettings,
  onInputElement,
  onMessagesElement,
  onMessagesScroll,
  onMessagesMouseUp,
  onMessagesMouseOver,
  onMessagesMouseOut,
  onMessagesFocusIn,
  onMessagesFocusOut,
  onInsertMessageSelection,
}: {
  selectionHeader?: ChatboxSelectionHeaderView;
  annotationSubtitle?: string;
  annotationRows: ChatboxAnnotationView[];
  selectedAnnotationId: string | null;
  debugMode: boolean;
  messages: ChatboxMessageView[];
  messageSelectionPrompt: ChatboxMessageSelectionPrompt | null;
  streaming: ChatboxStreamingView | null;
  waiting: boolean;
  placeholder: string;
  canDelete: boolean;
  canRemoveAnnotation: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRemoveAnnotation: () => void;
  onRawResults: () => void;
  onAnnotationSelect: (id: string) => void;
  onSubmit: (value: string) => void;
  onCopyMessage: (message: ChatboxMessageView) => void;
  onRetryMessage: (message: ChatboxMessageView) => void;
  onRewindMessage: (message: ChatboxMessageView) => void;
  onOpenApiKeySettings: () => void;
  onInputElement: (element: HTMLTextAreaElement | null) => void;
  onMessagesElement: (element: HTMLDivElement | null) => void;
  onMessagesScroll: () => void;
  onMessagesMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
  onMessagesMouseOver: (event: MouseEvent<HTMLDivElement>) => void;
  onMessagesMouseOut: (event: MouseEvent<HTMLDivElement>) => void;
  onMessagesFocusIn: (event: FocusEvent<HTMLDivElement>) => void;
  onMessagesFocusOut: (event: FocusEvent<HTMLDivElement>) => void;
  onInsertMessageSelection: () => void;
}) {
  const isSelectionMode = !!selectionHeader;
  const headerEyebrow = selectionHeader?.eyebrow ?? "AI chat";
  const showAnnotationContext = !isSelectionMode && annotationRows.length > 0;

  return (
    <>
      <header className="lenses-chatbox-header">
        <div className="lenses-chatbox-header-main">
          <div className="lenses-chatbox-header-text">
            <span className="lenses-chatbox-eyebrow">{headerEyebrow}</span>
            {!isSelectionMode && annotationSubtitle ? (
              <p className="lenses-chatbox-subtitle">{annotationSubtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="lenses-chatbox-header-actions">
          <DeleteButton
            visible={isSelectionMode ? canDelete : canRemoveAnnotation}
            onClick={isSelectionMode ? onDelete : onRemoveAnnotation}
            label={isSelectionMode ? "Delete saved chat" : "Remove result"}
          />
          <CloseButton onClick={onClose} />
        </div>
      </header>

      {selectionHeader || showAnnotationContext ? (
        <div className="lenses-chatbox-context-list lenses-chatbox-annotation-list">
          {selectionHeader ? (
            <div className="lenses-chatbox-selection-card">
              <blockquote className="lenses-chatbox-selection-quote">
                <SelectionQuote text={selectionHeader.quote} />
              </blockquote>
            </div>
          ) : null}
          {showAnnotationContext
            ? annotationRows.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  className={`lenses-chatbox-annotation-row ${
                    selectedAnnotationId === annotation.id ? "active" : ""
                  }`}
                  disabled={waiting}
                  style={{ borderLeftColor: annotation.color }}
                  onClick={() => onAnnotationSelect(annotation.id)}
                >
                  <div className="lenses-chatbox-annotation-top">
                    <span className="lenses-chatbox-annotation-label">{annotation.label}</span>
                    <span className="lenses-chatbox-annotation-confidence">
                      {Math.round(annotation.confidence * 100)}%
                    </span>
                  </div>
                  <div className="lenses-chatbox-annotation-detail">{annotation.detail}</div>
                </button>
              ))
            : null}
        </div>
      ) : null}

      {__INTERNAL_TOOLS__ && !isSelectionMode && debugMode ? (
        <div className="lenses-chatbox-debug-actions">
          <button type="button" className="lenses-chatbox-debug-btn" onClick={onRawResults}>
            Raw AI results
          </button>
        </div>
      ) : null}

      <div
        ref={onMessagesElement}
        className="lenses-chatbox-messages"
        onScroll={onMessagesScroll}
        onMouseUp={onMessagesMouseUp}
        onMouseOver={onMessagesMouseOver}
        onMouseOut={onMessagesMouseOut}
        onFocus={onMessagesFocusIn}
        onBlur={onMessagesFocusOut}
      >
        <ChatMessageList
          messages={messages}
          streaming={streaming}
          onCopyMessage={onCopyMessage}
          onRetryMessage={onRetryMessage}
          onRewindMessage={onRewindMessage}
          onOpenApiKeySettings={onOpenApiKeySettings}
        />
      </div>

      {messageSelectionPrompt ? (
        <button
          type="button"
          className="lenses-chat-selection-insert"
          style={{
            left: `${messageSelectionPrompt.left}px`,
            top: `${messageSelectionPrompt.top}px`,
          }}
          aria-label="Insert selected chat text"
          title="Insert selected chat text"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onInsertMessageSelection();
          }}
        >
          <ChatInsertIcon />
        </button>
      ) : null}

      <ChatComposer
        inputRef={onInputElement}
        placeholder={placeholder}
        disabled={waiting}
        clearOnSubmit
        onSubmit={onSubmit}
      />

      <div style={{ display: "none" }}></div>
    </>
  );
}

function ChatInsertIcon() {
  return (
    <ArrowUpIcon
      className="lenses-chat-selection-insert-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}

function SelectionQuote({ text }: { text: string }) {
  return (
    <>
      {splitQuoteForReferences(text).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <sup key={index} className="lenses-quote-ref">
            {segment.value}
          </sup>
        )
      )}
    </>
  );
}

function DeleteButton({
  visible,
  onClick,
  label = "Delete saved chat",
}: {
  visible: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="lenses-chatbox-delete"
      aria-label={label}
      title={label}
      style={{ display: visible ? "" : "none" }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <TrashIcon />
    </button>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="lenses-chatbox-close"
      aria-label="Close"
      title="Close"
      onClick={onClick}
    >
      <Cross2Icon className="lenses-chatbox-action-icon" aria-hidden="true" focusable="false" />
    </button>
  );
}

function TrashIcon() {
  return (
    <RadixTrashIcon
      className="lenses-chatbox-action-icon"
      aria-hidden="true"
      focusable="false"
    />
  );
}
