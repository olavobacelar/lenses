import {
  ChatBubbleIcon,
  CheckCircledIcon,
  MagnifyingGlassIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { SelectionChatMode } from "./types.js";

export type SelectionIconName = SelectionChatMode;

export type SelectionPrimaryAction = {
  mode: SelectionIconName;
  label: string;
  keyHint: string;
};

export const SELECTION_PRIMARY_ACTIONS: SelectionPrimaryAction[] = [
  { mode: "summarize", label: "Summarize this", keyHint: "S" },
  { mode: "truth", label: "Is this true?", keyHint: "T" },
  { mode: "explain", label: "Explain this", keyHint: "E" },
  { mode: "ask", label: "Ask", keyHint: "A" },
];

export function SelectionTriggerContent({
  disabled,
  onPrimaryAction,
}: {
  disabled: boolean;
  onPrimaryAction: (mode: SelectionIconName) => void;
}) {
  return (
    <>
      {SELECTION_PRIMARY_ACTIONS.map((action) => (
        <PrimaryActionButton
          key={action.mode}
          action={action}
          disabled={disabled}
          onClick={() => onPrimaryAction(action.mode)}
        />
      ))}
    </>
  );
}

function PrimaryActionButton({
  action,
  disabled,
  onClick,
}: {
  action: SelectionPrimaryAction;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="lenses-selection-trigger-action"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="lenses-selection-trigger-action-main">
        <SelectionActionIcon icon={action.mode} />
        <span className="lenses-selection-trigger-label">{action.label}</span>
      </span>
      <kbd className="lenses-selection-trigger-key">{action.keyHint}</kbd>
    </button>
  );
}

function SelectionActionIcon({ icon }: { icon: SelectionIconName }) {
  const Icon = {
    summarize: ReaderIcon,
    truth: CheckCircledIcon,
    explain: ChatBubbleIcon,
    ask: MagnifyingGlassIcon,
  }[icon];

  return <Icon className="lenses-selection-trigger-icon" aria-hidden="true" focusable="false" />;
}
