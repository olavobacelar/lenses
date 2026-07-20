// Brief confirmation that a one-off lens was created, with a one-click promote
// so the user can keep it permanently. It renders nothing until a lens lands;
// `canPromote` gates the pin button so an already-promoted lens only shows the
// dismiss affordance.
import { Cross2Icon } from "@radix-ui/react-icons";

interface CustomLensToastProps {
  created: { name: string } | null;
  canPromote: boolean;
  onPromote: () => void;
  onDismiss: () => void;
}

export function CustomLensToast({
  created,
  canPromote,
  onPromote,
  onDismiss,
}: CustomLensToastProps) {
  if (!created) return null;

  return (
    <section className="lens-toast" role="status" aria-live="polite">
      <span className="lens-toast-dot" aria-hidden="true" />
      <span className="lens-toast-text">
        Created lens <strong>{created.name}</strong>
      </span>
      <span className="lens-toast-spacer" />
      {canPromote ? (
        <button type="button" className="lens-toast-pin" onClick={onPromote}>
          Pin as lens
        </button>
      ) : null}
      <button
        type="button"
        className="lens-toast-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <Cross2Icon aria-hidden="true" focusable="false" />
      </button>
    </section>
  );
}
