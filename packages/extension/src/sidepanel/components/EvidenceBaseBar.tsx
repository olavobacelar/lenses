import { useState, type FormEvent } from "react";
import { GearIcon } from "@radix-ui/react-icons";
import type { EvidenceBase } from "@lenses/shared";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import {
  Check,
  ChevronDown,
  LibraryBig,
  Plus,
  X,
} from "lucide-react";
import type { EvidenceBaseCreateInput } from "../hooks/useEvidenceBases";

interface EvidenceBaseBarProps {
  evidenceBases: EvidenceBase[];
  activeEvidenceBaseId: string | null;
  isLoading: boolean;
  // Whether the current source is saved in the active base. Null means there
  // is no applicable source yet or membership is still loading.
  sourceInBase: boolean | null;
  onSelect: (evidenceBaseId: string | null) => Promise<void>;
  onCreate: (input: EvidenceBaseCreateInput) => Promise<string>;
  onOpenLibrary: () => void;
  onOpenOptions: () => void;
  onError: (message: string) => void;
}

const NO_EVIDENCE_BASE = "__none__";

export function EvidenceBaseBar({
  evidenceBases,
  activeEvidenceBaseId,
  isLoading,
  sourceInBase,
  onSelect,
  onCreate,
  onOpenLibrary,
  onOpenOptions,
  onError,
}: EvidenceBaseBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [guidingQuestion, setGuidingQuestion] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const activeEvidenceBase = evidenceBases.find((item) => item.id === activeEvidenceBaseId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || isCreating) return;
    setIsCreating(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || undefined,
        guidingQuestion: guidingQuestion.trim() || undefined,
      });
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setGuidingQuestion("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="evidence-base-bar">
      <Select.Root
        value={activeEvidenceBaseId ?? NO_EVIDENCE_BASE}
        onValueChange={(value) => {
          void onSelect(value === NO_EVIDENCE_BASE ? null : value).catch((error) =>
            onError(error instanceof Error ? error.message : String(error))
          );
        }}
        disabled={isLoading}
      >
        <Select.Trigger
          className="evidence-base-trigger"
          aria-label="Active evidence base"
          title="Active evidence base"
        >
          <Select.Value>
            {activeEvidenceBase ? (
              <span className="evidence-base-trigger-value">
                <span className="evidence-base-trigger-name">{activeEvidenceBase.title}</span>
                {sourceInBase === true ? (
                  <SourceSavedIndicator baseTitle={activeEvidenceBase.title} />
                ) : null}
              </span>
            ) : (
              "No evidence base"
            )}
          </Select.Value>
          <Select.Icon className="evidence-base-chevron">
            <ChevronDown aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="evidence-base-menu" position="popper" sideOffset={5}>
            <Select.Viewport>
              <Select.Item className="evidence-base-option" value={NO_EVIDENCE_BASE}>
                <Select.ItemText>No evidence base</Select.ItemText>
                <Select.ItemIndicator className="evidence-base-option-check">
                  <Check aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
              {evidenceBases.map((item) => (
                <Select.Item className="evidence-base-option" value={item.id} key={item.id}>
                  <Select.ItemText>{item.title}</Select.ItemText>
                  <Select.ItemIndicator className="evidence-base-option-check">
                    <Check aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      <div className="evidence-base-actions">
        <button
          className="icon-btn evidence-base-icon-btn"
          type="button"
          data-tooltip="Open evidence bases"
          aria-label="Open evidence bases"
          onClick={onOpenLibrary}
        >
          <LibraryBig aria-hidden="true" />
        </button>

        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <button
              className="icon-btn evidence-base-icon-btn"
              type="button"
              data-tooltip="New evidence base"
              aria-label="New evidence base"
            >
              <Plus aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="evidence-dialog-overlay" />
            <Dialog.Content className="evidence-dialog-content">
              <div className="evidence-dialog-head">
                <Dialog.Title>New evidence base</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="icon-btn" type="button" aria-label="Close" title="Close">
                    <X aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
              <form className="evidence-dialog-form" onSubmit={submit}>
                <label>
                  <span>Title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={160}
                    autoFocus
                    required
                  />
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={2000}
                    rows={2}
                  />
                </label>
                <label>
                  <span>Guiding question</span>
                  <textarea
                    value={guidingQuestion}
                    onChange={(event) => setGuidingQuestion(event.target.value)}
                    maxLength={1000}
                    rows={2}
                  />
                </label>
                <div className="evidence-dialog-actions">
                  <Dialog.Close asChild>
                    <button className="evidence-secondary-button" type="button">Cancel</button>
                  </Dialog.Close>
                  <button className="evidence-primary-button" type="submit" disabled={isCreating}>
                    {isCreating ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <button
          id="options-btn"
          className="icon-btn evidence-base-icon-btn"
          type="button"
          data-tooltip="Settings"
          aria-label="Settings"
          onClick={onOpenOptions}
        >
          <GearIcon aria-hidden="true" focusable="false" />
        </button>
      </div>
    </div>
  );
}

/* Source membership is deliberately distinct from Lens run status. A source
   is saved when a run starts, even if that run later stops or fails. */
function SourceSavedIndicator({ baseTitle }: { baseTitle: string }) {
  const label = `Current source is saved in ${baseTitle}. Analysis status appears in each Lens section.`;
  return (
    <span className="evidence-source-saved" role="status" aria-label={label} title={label}>
      <Check aria-hidden="true" />
      <span>Saved</span>
    </span>
  );
}
