import * as Checkbox from "@radix-ui/react-checkbox";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Switch from "@radix-ui/react-switch";
import { ArrowUpIcon, CaretDownIcon, CheckIcon, Pencil1Icon } from "@radix-ui/react-icons";
import { useEffect, useRef } from "react";
import type { useControlBay } from "../hooks/useControlBay";
import { openLensEditor } from "../lib/chrome";
import {
  REASONING_EFFORT_SHORT_LABELS,
  reasoningEffortLabelForProvider,
  type ReasoningEffort,
} from "../../lib/reasoning-settings";
import type { AiModel } from "../../types/ai-models";

type ControlBayState = ReturnType<typeof useControlBay>;

export function ControlBay({ bay }: { bay: ControlBayState }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressModelMenuFocusRestoreRef = useRef(false);

  const chooseFromModelMenu = (choose: () => void) => {
    suppressModelMenuFocusRestoreRef.current = true;
    choose();
    bay.setIsModelMenuOpen(false);
  };

  useEffect(() => {
    if (inputRef.current) autoGrow(inputRef.current);
  }, [bay.input]);

  return (
    <section
      id="control-bay"
      className={`control-bay ${bay.isUnified ? "" : "hidden"}`}
      aria-label="Lens controls"
    >
      <div className="bay-bar">
        <span className="bay-title">Lenses</span>
        <span className="bay-spacer" />
        <button
          id="bay-run"
          className="bay-run"
          type="button"
          disabled={!bay.canRun}
          onClick={() => void bay.runSelectedLenses()}
        >
          <span className="rdot" aria-hidden="true" />
          Run
        </button>
      </div>

      <div id="bay-extra" className="bay-extra">
        <div className="bay-chips" id="bay-chips">
          {bay.lensOptions.map((lens) => (
            <Checkbox.Root
              className="bay-chip"
              key={lens.id}
              value={lens.id}
                checked={bay.selectedLensIds.includes(lens.id)}
              onCheckedChange={(checked) => bay.setLensSelected(lens.id, checked === true)}
            >
              <span
                className="dot"
                data-lens={lens.id}
                aria-hidden="true"
                style={lens.color ? { background: lens.color } : undefined}
              />
              <span className="nm">{lens.label}</span>
            </Checkbox.Root>
          ))}
        </div>
        <div className="bay-auto">
          <label htmlFor="bay-auto-run">Auto-run on page load</label>
          <Switch.Root
            className="bay-switch"
            id="bay-auto-run"
            checked={bay.autoRun}
            onCheckedChange={bay.setAutoRunEnabled}
          >
            <Switch.Thumb className="bay-switch-thumb" />
          </Switch.Root>
        </div>
        <button type="button" className="bay-edit-lenses" onClick={() => openLensEditor()}>
          <Pencil1Icon aria-hidden="true" focusable="false" />
          <span>Edit &amp; create lenses</span>
        </button>
      </div>

      <div className="bay-composer">
        <div className="composer2" id="bay-composer">
          <textarea
            id="bay-input"
            ref={inputRef}
            className="ta2"
            rows={1}
            placeholder={bay.copy.placeholder}
            value={bay.input}
            onChange={(event) => bay.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              void bay.submitComposer();
            }}
          />
          <div className="c2-bar">
            <DropdownMenu.Root open={bay.isModeMenuOpen} onOpenChange={bay.setIsModeMenuOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  id="bay-mode"
                  className="c2-mode"
                  type="button"
                  aria-controls="bay-mode-menu"
                >
                  <span className="mdot" aria-hidden="true" />
                  <span id="bay-mode-label">{bay.copy.menuLabel}</span>
                  <CaretDownIcon className="mchev" aria-hidden="true" focusable="false" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                id="bay-mode-menu"
                className="c2-menu"
                align="start"
                side="top"
                sideOffset={6}
              >
                <DropdownMenu.RadioGroup value={bay.mode}>
                  <ModeItem
                    value="lens"
                    active={bay.mode === "lens"}
                    label="Run lens"
                    description="Highlight matches on the page"
                    onSelect={() => void bay.chooseMode("lens")}
                  />
                  <ModeItem
                    value="ask"
                    active={bay.mode === "ask"}
                    label="Ask"
                    description="Answer in the conversation below"
                    onSelect={() => void bay.chooseMode("ask")}
                  />
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <DropdownMenu.Root open={bay.isModelMenuOpen} onOpenChange={bay.setIsModelMenuOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  id="bay-model"
                  className="c2-model"
                  type="button"
                  aria-controls="bay-model-menu"
                  title={
                    bay.modelSupportsReasoning
                      ? `${formatModelLabel(bay.chatModel)} · ${reasoningEffortLabelForProvider(
                          bay.reasoningEffort,
                          bay.modelProvider
                        )}`
                      : formatModelLabel(bay.chatModel)
                  }
                >
                  <span className="c2-model-label">{formatModelLabel(bay.chatModel)}</span>
                  {bay.modelSupportsReasoning ? (
                    <span className="c2-model-effort">
                      {REASONING_EFFORT_SHORT_LABELS[bay.reasoningEffort]}
                    </span>
                  ) : null}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                id="bay-model-menu"
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
                {bay.modelSupportsReasoning ? (
                  <>
                    <div className="c2-menu-section">Reasoning</div>
                    <DropdownMenu.RadioGroup value={bay.reasoningEffort}>
                      {bay.reasoningEffortOptions.map((effort) => (
                        <ReasoningItem
                          key={effort}
                          value={effort}
                          active={bay.reasoningEffort === effort}
                          label={reasoningEffortLabelForProvider(effort, bay.modelProvider)}
                          onSelect={() =>
                            chooseFromModelMenu(() => bay.chooseReasoningEffort(effort))
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
                    <span className="c2-menu-label">{formatModelLabel(bay.chatModel)}</span>
                    <CaretDownIcon
                      className="mchev c2-submenu-chev"
                      aria-hidden="true"
                      focusable="false"
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.SubContent
                    id="bay-model-submenu"
                    className="c2-menu c2-model-submenu"
                    sideOffset={8}
                    alignOffset={-4}
                  >
                    <DropdownMenu.RadioGroup value={bay.chatModel}>
                      {bay.modelOptions.map((model) => (
                        <ModelItem
                          key={model}
                          value={model}
                          active={bay.chatModel === model}
                          label={formatModelLabel(model)}
                          onSelect={() => chooseFromModelMenu(() => bay.chooseChatModel(model))}
                        />
                      ))}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <span className="c2-spacer" />
            <button
              id="bay-send"
              className="c2-send"
              type="button"
              aria-label="Run"
              title="Run"
              disabled={!bay.canSubmit}
              onClick={() => void bay.submitComposer()}
            >
              <ArrowUpIcon aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>
        {bay.copy.hint ? (
          <p className="bay-hint" id="bay-hint">
            {bay.copy.hint}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ModeItem({
  value,
  active,
  label,
  description,
  onSelect,
}: {
  value: ControlBayState["mode"];
  active: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.RadioItem
      className={`c2-menu-item ${active ? "is-active" : ""}`}
      value={value}
      data-mode={value}
      onSelect={onSelect}
    >
      <span className="c2-menu-check" aria-hidden="true">
        <DropdownMenu.ItemIndicator>
          <CheckIcon width={12} height={12} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="c2-menu-text">
        <span className="c2-menu-label">{label}</span>
        <span className="c2-menu-desc">{description}</span>
      </span>
    </DropdownMenu.RadioItem>
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

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}
