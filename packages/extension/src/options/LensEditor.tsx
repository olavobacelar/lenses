// The lens detail editor. The master list (built-ins + user lenses + the
// "New lens" button) lives in the global settings sidebar — this component is
// now purely the form. It reads a draft, renders inputs, and on save serializes
// to canonical markdown for the backend to re-parse.

import * as Checkbox from "@radix-ui/react-checkbox";
import { CheckIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LensFocusKind,
  LensOutputKind,
  LensRunMode,
  SourceScopeKind,
} from "@lenses/shared";
import { normalizeDomainList } from "@lenses/shared";
import type { LensLibrary } from "./useLensLibrary";
import {
  CategoryDraft,
  DEFAULT_CATEGORY_COLOR,
  LensDraft,
  draftFromConfig,
  draftToMarkdown,
  emptyDraft,
  exportFilename,
  listToInput,
  parseListInput,
  validateDraft,
} from "../lib/lens-library.js";
import { SelectControl } from "./SelectControl";

const SCOPE_OPTIONS: { value: SourceScopeKind; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "selection", label: "Selection" },
  { value: "transcript", label: "Transcript" },
];

const FOCUS_OPTIONS: { value: LensFocusKind; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "selection", label: "Selection" },
  { value: "finding", label: "Finding" },
  { value: "run", label: "Run" },
];

export function LensEditor({
  initialLensId,
  startBlank = false,
  lensLibrary,
}: {
  initialLensId?: string;
  // When true, ignore the lens list and seed the form with an empty draft.
  // Used for the sidebar's "New lens" entry (#lenses/new).
  startBlank?: boolean;
  lensLibrary: LensLibrary;
}) {
  const { lenses, loading, error, saveLens, deleteLens } = lensLibrary;

  // `selectedId` is the lensId of the lens being edited, or null for an unsaved
  // draft. `draft` is the working copy the form mutates; it only syncs from the
  // library when the selection changes, so typing never gets clobbered by a
  // background refresh.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LensDraft | null>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const showStatus = useCallback((message: string, isError = false) => {
    setStatus({ message, isError });
  }, []);

  // Reset the draft when the route changes — switching lenses via the sidebar
  // or arriving at "New lens" should discard in-form edits and load fresh data.
  useEffect(() => {
    if (loading) return;
    if (startBlank) {
      setSelectedId(null);
      setDraft(emptyDraft());
      setStatus(null);
      return;
    }
    if (lenses.length === 0) {
      setSelectedId(null);
      setDraft(emptyDraft());
      setStatus(null);
      return;
    }
    const target =
      (initialLensId && lenses.find((lens) => lens.config.id === initialLensId)) ||
      lenses[0];
    setSelectedId(target.config.id);
    setDraft(draftFromConfig(target.config));
    setStatus(null);
  }, [loading, lenses, initialLensId, startBlank]);

  const selectedLens = useMemo(
    () => lenses.find((lens) => lens.config.id === selectedId) ?? null,
    [lenses, selectedId]
  );
  const isBuiltIn = selectedLens?.isBuiltIn ?? false;

  const update = useCallback(<K extends keyof LensDraft>(key: K, value: LensDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }, []);

  const validationErrors = draft ? validateDraft(draft) : [];

  const onSave = async () => {
    if (!draft) return;
    const errors = validateDraft(draft);
    if (errors.length > 0) {
      showStatus(errors[0], true);
      return;
    }
    setSaving(true);
    try {
      const markdown = draftToMarkdown(draft);
      const result = await saveLens(markdown);
      const savedId = result.lensId ?? draft.id;
      showStatus(
        isBuiltIn ? `Saved a copy as “${result.name ?? draft.name}”` : "Saved"
      );
      // After a built-in fork or a brand-new save the id changes; navigating to
      // the saved lens lets the sidebar highlight it and keeps the URL truthful.
      if (savedId) {
        window.location.hash = `#lenses/${encodeURIComponent(savedId)}`;
      }
    } catch (caught) {
      showStatus(formatError(caught), true);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!draft || !selectedLens || isBuiltIn) return;
    if (!confirm(`Are you sure you want to delete the lens "${draft.name}"?`)) return;
    try {
      await deleteLens(draft.id);
      showStatus("Deleted");
      window.location.hash = "#lenses";
    } catch (caught) {
      showStatus(formatError(caught), true);
    }
  };

  const onExport = async () => {
    if (!draft) return;
    try {
      const markdown = draftToMarkdown(draft);
      downloadMarkdown(markdown, exportFilename(draft));
      try {
        await navigator.clipboard.writeText(markdown);
        showStatus("Exported markdown (also copied to clipboard)");
      } catch {
        showStatus("Exported markdown");
      }
    } catch (caught) {
      showStatus(formatError(caught), true);
    }
  };

  return (
    <section className="lens-editor">
      <div className="lens-detail">
        {error ? <p className="lens-detail-error">{error}</p> : null}
        {loading && !draft ? (
          <div className="lens-detail-empty">
            <p>Loading lenses…</p>
          </div>
        ) : null}
        {draft ? (
          <LensForm
            draft={draft}
            isBuiltIn={isBuiltIn}
            canDelete={Boolean(selectedLens) && !isBuiltIn}
            saving={saving}
            status={status}
            validationErrors={validationErrors}
            onChange={update}
            onSave={onSave}
            onDelete={onDelete}
            onExport={onExport}
          />
        ) : null}
      </div>
    </section>
  );
}

function LensForm({
  draft,
  isBuiltIn,
  canDelete,
  saving,
  status,
  validationErrors,
  onChange,
  onSave,
  onDelete,
  onExport,
}: {
  draft: LensDraft;
  isBuiltIn: boolean;
  canDelete: boolean;
  saving: boolean;
  status: { message: string; isError: boolean } | null;
  validationErrors: string[];
  onChange: <K extends keyof LensDraft>(key: K, value: LensDraft[K]) => void;
  onSave: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  // Advanced starts collapsed so the essential authoring path stays short; the
  // user opens it only when they need URL triggers, tools, or the other knobs.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <form
      className="lens-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <header className="lens-form-head">
        <div>
          <p className="eyebrow">{isBuiltIn ? "Built-in lens" : "Lens"}</p>
          <h1>{draft.name || "New lens"}</h1>
          <p className="lens-form-sub">
            A lens finds spans of text on a page and highlights them.
          </p>
        </div>
        <div className="lens-form-actions">
          <button type="button" className="ghost" onClick={onExport}>
            Export
          </button>
          {canDelete ? (
            <button type="button" className="danger" onClick={onDelete}>
              Delete
            </button>
          ) : null}
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "Saving…" : isBuiltIn ? "Save a copy" : "Save"}
          </button>
        </div>
      </header>

      {isBuiltIn ? (
        <p className="lens-notice">
          This is a built-in lens. Saving creates your own editable copy (it won’t
          overwrite the original).
        </p>
      ) : null}

      <div className="lens-form-body">
        <Section title="Basics" hint="Name it and say, in a sentence, what it looks for.">
          <Field label="Name">
            <input
              type="text"
              className="lens-name-input"
              value={draft.name}
              onChange={(event) => onChange("name", event.target.value)}
              placeholder="Date Finder"
            />
          </Field>

          <Field label="Description">
            <textarea
              rows={2}
              value={draft.description}
              onChange={(event) => onChange("description", event.target.value)}
              placeholder="What this lens finds and why."
            />
          </Field>

          <Field label="Item noun" hint="Singular label for one finding, e.g. “claim”.">
            <input
              type="text"
              value={draft.itemNoun}
              onChange={(event) => onChange("itemNoun", event.target.value)}
              placeholder="finding"
            />
          </Field>
        </Section>

        <Section
          title="Instructions"
          hint="The prompt sent to the model, and how it should shape its answer."
        >
          <Field
            label="Prompt"
            hint="Must include the {{text}} placeholder for the source text."
          >
            <textarea
              className="mono"
              rows={8}
              value={draft.promptTemplate}
              onChange={(event) => onChange("promptTemplate", event.target.value)}
            />
          </Field>

          <Field label="Output format" hint="How the model should structure its JSON output.">
            <textarea
              className="mono"
              rows={6}
              value={draft.outputInstructions}
              onChange={(event) => onChange("outputInstructions", event.target.value)}
            />
          </Field>
        </Section>

        <Section title="Findings" hint="The highlight colors and labels each finding can carry.">
          <CategoryEditor
            categories={draft.categories}
            onChange={(categories) => onChange("categories", categories)}
          />
        </Section>

        <Section
          title="Behavior"
          hint="When it runs, what it reads, and the shape of its result."
        >
          <div className="lens-pair">
            <Field label="Run mode" hint="Auto runs without a click.">
              <SelectControl<LensRunMode>
                value={draft.runMode}
                onChange={(value) => onChange("runMode", value)}
                options={[
                  { value: "manual", label: "Manual" },
                  { value: "auto", label: "Auto" },
                ]}
                ariaLabel="Run mode"
              />
            </Field>

            <Field label="Output kind" hint="A list, or one holistic finding.">
              <SelectControl<LensOutputKind>
                value={draft.outputKind}
                onChange={(value) => onChange("outputKind", value)}
                options={[
                  { value: "items", label: "Items (a list)" },
                  { value: "holistic", label: "Holistic (one finding)" },
                ]}
                ariaLabel="Output kind"
              />
            </Field>
          </div>

          <Field label="Scope" hint="Which content this lens is allowed to read.">
            <div className="lens-scope">
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="lens-check">
                  <Checkbox.Root
                    className="lens-checkbox"
                    checked={draft.scope.includes(option.value)}
                    onCheckedChange={(checked) => {
                      const next = checked === true
                        ? [...draft.scope, option.value]
                        : draft.scope.filter((scope) => scope !== option.value);
                      onChange("scope", next.length > 0 ? next : draft.scope);
                    }}
                  >
                    <Checkbox.Indicator>
                      <CheckIcon width={11} height={11} />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Focus">
            <SelectControl<LensFocusKind>
              value={draft.focus}
              onChange={(value) => onChange("focus", value)}
              options={FOCUS_OPTIONS}
              ariaLabel="Focus"
            />
          </Field>
        </Section>

        <Section
          title="Where it runs"
          hint="Leave empty to allow every site. Subdomains are included."
        >
          <Field label="Allowed domains" hint="One domain per line.">
            <textarea
              className="mono"
              rows={3}
              value={listToInput(draft.allowedDomains)}
              onChange={(event) =>
                onChange("allowedDomains", normalizeDomainList(parseListInput(event.target.value)))
              }
              placeholder="nytimes.com"
            />
          </Field>
        </Section>

        <div className="lens-advanced" data-open={advancedOpen}>
          <button
            type="button"
            className="lens-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronRightIcon className="lens-advanced-chevron" width={16} height={16} />
            Advanced <small>URL triggers, tools, model override, version, visibility</small>
          </button>
          {advancedOpen ? (
            <div className="lens-advanced-body">
              <div className="lens-section-head">
                <p>Power-user options — most lenses never touch these.</p>
              </div>
              <div className="lens-section-fields">
                <Field
                  label="URL triggers"
                  hint="Optional path-specific globs, e.g. https://*.nytimes.com/2026/*."
                >
                  <textarea
                    className="mono"
                    rows={2}
                    value={listToInput(draft.triggers)}
                    onChange={(event) => onChange("triggers", parseListInput(event.target.value))}
                    placeholder="https://*.nytimes.com/*"
                  />
                </Field>

                <div className="lens-pair">
                  <Field label="Content type hints" hint="Comma or newline separated.">
                    <input
                      type="text"
                      value={listToInput(draft.contentTypeHints)}
                      onChange={(event) =>
                        onChange("contentTypeHints", parseListInput(event.target.value))
                      }
                      placeholder="text"
                    />
                  </Field>

                  <Field label="Tools" hint="Primitive tools the lens may call.">
                    <input
                      type="text"
                      value={listToInput(draft.tools)}
                      onChange={(event) => onChange("tools", parseListInput(event.target.value))}
                      placeholder="web_search"
                    />
                  </Field>
                </div>

                <div className="lens-pair">
                  <Field label="Default model" hint="Blank uses your account setting.">
                    <input
                      type="text"
                      value={draft.defaultModel}
                      onChange={(event) => onChange("defaultModel", event.target.value)}
                      placeholder="(use account default)"
                    />
                  </Field>

                  <Field label="Version">
                    <input
                      type="text"
                      value={draft.version}
                      onChange={(event) => onChange("version", event.target.value)}
                      placeholder="0.0.1"
                    />
                  </Field>
                </div>

                <Field label="Fallback color" hint="Used when a finding has no matching category.">
                  <ColorInput
                    value={draft.fallbackColor}
                    onChange={(value) => onChange("fallbackColor", value)}
                  />
                </Field>

                <Field label="Visibility">
                  <label className="lens-check">
                    <Checkbox.Root
                      className="lens-checkbox"
                      checked={draft.visible}
                      onCheckedChange={(checked) => onChange("visible", checked === true)}
                    >
                      <Checkbox.Indicator>
                        <CheckIcon width={11} height={11} />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <span>Show in the lens picker</span>
                  </label>
                </Field>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="lens-form-foot">
        {validationErrors.length > 0 ? (
          <ul className="lens-errors">
            {validationErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        {status ? (
          <p className={`lens-status ${status.isError ? "error" : ""}`} aria-live="polite">
            {status.message}
          </p>
        ) : null}
      </footer>
    </form>
  );
}

function CategoryEditor({
  categories,
  onChange,
}: {
  categories: CategoryDraft[];
  onChange: (categories: CategoryDraft[]) => void;
}) {
  const updateAt = (index: number, patch: Partial<CategoryDraft>) => {
    onChange(categories.map((category, i) => (i === index ? { ...category, ...patch } : category)));
  };
  const removeAt = (index: number) => {
    onChange(categories.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...categories, { value: "", color: DEFAULT_CATEGORY_COLOR, label: "" }]);
  };

  return (
    <div className="lens-categories">
      {categories.map((category, index) => (
        <div key={index} className="lens-category-row">
          <ColorInput
            value={category.color}
            onChange={(color) => updateAt(index, { color })}
            compact
          />
          <input
            type="text"
            className="lens-category-value"
            value={category.value}
            onChange={(event) => updateAt(index, { value: event.target.value })}
            placeholder="value"
            aria-label="Category value"
          />
          <input
            type="text"
            className="lens-category-label"
            value={category.label}
            onChange={(event) => updateAt(index, { label: event.target.value })}
            placeholder="Label (optional)"
            aria-label="Category label"
          />
          <button
            type="button"
            className="lens-category-remove"
            onClick={() => removeAt(index)}
            aria-label="Remove category"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="lens-category-add" onClick={add}>
        + Add category
      </button>
    </div>
  );
}

// Pairs a native color swatch with a text input so a user can either pick or
// paste a hex value — the swatch alone can't show or accept arbitrary strings.
function ColorInput({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <span className={`lens-color ${compact ? "compact" : ""}`}>
      <input
        type="color"
        value={swatch}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Color picker"
      />
      {!compact ? (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Color value"
        />
      ) : null}
    </span>
  );
}

// A titled group of fields. The left rail (title + one-line description) gives
// the long form skimmable chapters instead of one flat wall of inputs.
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lens-section">
      <div className="lens-section-head">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="lens-section-fields">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="lens-field">
      <span className="lens-field-label">{label}</span>
      {hint ? <span className="lens-field-hint">{hint}</span> : null}
      {children}
    </label>
  );
}

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
