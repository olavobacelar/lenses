import * as Checkbox from "@radix-ui/react-checkbox";
import { DrawingPinFilledIcon, DrawingPinIcon } from "@radix-ui/react-icons";
import { BUILT_IN_LENSES } from "../constants";

export function LensPicker({
  selectedLensIds,
  computingLensIds,
  settlingLensIds,
  pinnedLensIds,
  onLensChecked,
  onLensPinToggle,
  onRun,
}: {
  selectedLensIds: string[];
  computingLensIds: string[];
  settlingLensIds: string[];
  pinnedLensIds: string[];
  onLensChecked: (lensId: string, checked: boolean) => void;
  onLensPinToggle: (lensId: string) => void;
  onRun: () => void;
}) {
  const selected = new Set(selectedLensIds);
  const computing = new Set(computingLensIds);
  const settling = new Set(settlingLensIds);
  const pinned = new Set(pinnedLensIds);
  const isBusy = computingLensIds.length > 0;

  return (
    <section className="lens-picker">
      {/* The site heading already names the scope for pins, so the picker row
          carries only the run pill, mirroring the side panel's `.bay-run`. */}
      <div className="picker-bar">
        <button
          id="run-lenses"
          className="run-pill"
          type="button"
          disabled={selectedLensIds.length === 0 || isBusy}
          onClick={onRun}
        >
          <span className="run-dot" aria-hidden="true" />
          Highlight
        </button>
      </div>
      {/* One list: the chip selects a lens to highlight now, the pin auto-runs
          it on this domain. Same chip + pin language the page rail uses. */}
      <div className="lens-options">
        {BUILT_IN_LENSES.map((lens) => {
          const isComputing = computing.has(lens.id);
          const isSettling = settling.has(lens.id) && !isComputing;
          return (
            <Checkbox.Root
              className={`lens-chip${isComputing ? " is-computing" : ""}${
                isSettling ? " is-settling" : ""
              }`}
              key={lens.id}
              value={lens.id}
              checked={selected.has(lens.id)}
              aria-busy={isComputing || undefined}
              onCheckedChange={(checked) => onLensChecked(lens.id, checked === true)}
            >
              <span className="lens-dot" data-lens={lens.id} aria-hidden="true" />
              <span className="lens-name">{lens.label}</span>
              <LensPinButton
                pinned={pinned.has(lens.id)}
                label={lens.label}
                onToggle={() => onLensPinToggle(lens.id)}
              />
            </Checkbox.Root>
          );
        })}
      </div>
    </section>
  );
}

// Pin affordance on each lens chip — the same control the page rail carries. A
// pin means "auto-run this lens on the current domain" via the shared
// pinned-lenses store. Rendered as a span, not a button, because the parent
// Checkbox.Root is already a <button> and nested buttons are invalid HTML; the
// handlers swallow the event so toggling the pin doesn't also toggle selection.
function LensPinButton({
  pinned,
  label,
  onToggle,
}: {
  pinned: boolean;
  label: string;
  onToggle: () => void;
}) {
  const stop = (event: { stopPropagation: () => void; preventDefault?: () => void }) => {
    event.stopPropagation();
    event.preventDefault?.();
  };
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label} from this domain` : `Pin ${label} to this domain`}
      className={`lens-pin${pinned ? " is-pinned" : ""}`}
      onPointerDown={stop}
      onClick={(event) => {
        stop(event);
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          stop(event);
          onToggle();
        }
      }}
    >
      {pinned ? (
        <DrawingPinFilledIcon aria-hidden="true" />
      ) : (
        <DrawingPinIcon aria-hidden="true" />
      )}
    </span>
  );
}
