import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUpIcon, CaretDownIcon, CheckIcon } from "@radix-ui/react-icons";
import type { KeyboardEvent } from "react";
import type { ComposerMode } from "../../lib/composer";
import { COMPOSER_COPY } from "../constants";

// Short nouns for the inline mode pill (the menu items carry the verb + blurb).
const MODE_LABEL: Record<ComposerMode, string> = { lens: "Lens", ask: "Ask" };

export function ComposerSection({
  mode,
  value,
  menuOpen,
  onModeChange,
  onValueChange,
  onMenuOpenChange,
  onSubmit,
}: {
  mode: ComposerMode;
  value: string;
  menuOpen: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onValueChange: (value: string) => void;
  onMenuOpenChange: (open: boolean) => void;
  onSubmit: (mode?: ComposerMode) => void;
}) {
  const copy = COMPOSER_COPY[mode];

  const submitDisabled = value.trim().length === 0;

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className="composer">
      <p className="section-label">Query</p>
      {/* Mirrors the side panel composer: textarea on top, a bottom bar with
          the mode pill (switch only) on the left and a round send on the right. */}
      <div className="composer2">
        <textarea
          id="composer-input"
          className="ta2"
          rows={2}
          placeholder={copy.placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onInputKeyDown}
        ></textarea>
        <div className="c2-bar">
          <DropdownMenu.Root open={menuOpen} onOpenChange={onMenuOpenChange}>
            <DropdownMenu.Trigger asChild>
              <button
                id="composer-switch"
                className="c2-mode"
                type="button"
                aria-controls="composer-menu"
                aria-label="Choose mode"
              >
                <span className="mdot" aria-hidden="true" />
                <span className="c2-mode-label">{MODE_LABEL[mode]}</span>
                <CaretDownIcon className="mchev" aria-hidden="true" focusable="false" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              id="composer-menu"
              className="c2-menu"
              align="start"
              side="top"
              sideOffset={6}
            >
              <DropdownMenu.RadioGroup value={mode}>
                <ComposerMenuItem
                  id="mode-lens"
                  value="lens"
                  active={mode === "lens"}
                  label="Run lens"
                  description="Highlight matches on the page"
                  onSelect={() => onModeChange("lens")}
                />
                <ComposerMenuItem
                  id="mode-ask"
                  value="ask"
                  active={mode === "ask"}
                  label="Ask"
                  description="Answer in the side panel"
                  onSelect={() => onModeChange("ask")}
                />
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <span className="c2-spacer" />
          <button
            id="composer-submit"
            className="c2-send"
            type="button"
            aria-label={copy.submit}
            title={copy.submit}
            disabled={submitDisabled}
            onClick={() => onSubmit()}
          >
            <ArrowUpIcon aria-hidden="true" focusable="false" />
          </button>
        </div>
      </div>
    </section>
  );
}

function ComposerMenuItem({
  id,
  value,
  active,
  label,
  description,
  onSelect,
}: {
  id: string;
  value: ComposerMode;
  active: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.RadioItem
      id={id}
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
