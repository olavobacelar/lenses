// Pure, DOM-free helpers for the lens-creation flow: turning a free-text
// instruction into a named one-off lens, tracking its Naming → Running →
// completed state, and promoting it into a permanent user lens. Keeping the
// state-machine and labelling rules here lets them be unit-tested without chrome
// APIs or React (the wiring lives in hooks/useCustomLenses.ts).

export type CustomLensStatus = "naming" | "running" | "completed" | "failed";

// Only one one-off lens is active at a time. It stays outside the permanent
// chip row and is mirrored to chrome.storage.local so it survives a panel
// reload and remains visible to other extension surfaces.
export interface ActiveCustomLens {
  lensId: string;
  name: string;
  instruction: string;
  status: CustomLensStatus;
  findingCount?: number;
  promoted?: boolean;
  createdAt: number;
}

export interface UserLens {
  lensId: string;
  name: string;
}

const CUSTOM_LENS_NAME_MAX_WORDS = 3;

// A fresh id per creation so two one-off lenses run on the same page keep
// separate stored findings instead of overwriting a single shared slot.
export function newCustomLensId(now: number = Date.now()): string {
  return `custom-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// A deterministic name derived from the instruction, used while the naming model
// is still running and as the fallback if that call fails. Mirrors the backend
// normalizer (2-3 words, Title Case) so the optimistic name matches the model's.
export function fallbackLensName(instruction: string): string {
  const words = (instruction ?? "")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .split(" ")
    .filter((word) => word.length > 0);
  if (words.length === 0) return "Custom Lens";
  return words
    .slice(0, CUSTOM_LENS_NAME_MAX_WORDS)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// The accordion count-chip text for a one-off lens, mirroring built-in lenses:
// built-ins show "Running" then a number, so a one-off shows "Naming…" first
// (while the title is being generated), then "Running", then the finding count.
export function customLensCountLabel(
  status: CustomLensStatus,
  findingCount: number | undefined
): string {
  if (status === "naming") return "Naming…";
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  return String(findingCount ?? 0);
}

// Whether the "Pin as lens" affordance should show: only a completed one-off that
// hasn't already been promoted can become permanent.
export function canPromote(active: ActiveCustomLens | null): boolean {
  return !!active && active.status === "completed" && !active.promoted;
}

// The lens ids whose findings the panel must fetch on top of the built-ins: every
// promoted user lens, plus the active one-off once it has completed (only then
// does it have stored findings). Naming/running render from client state instead.
export function persistedExtraLensIds(
  active: ActiveCustomLens | null,
  userLenses: readonly UserLens[]
): string[] {
  const ids = userLenses.map((lens) => lens.lensId);
  if (
    active &&
    active.status === "completed" &&
    !active.promoted &&
    !ids.includes(active.lensId)
  ) {
    ids.push(active.lensId);
  }
  return ids;
}

// Name lookup for sections/summaries: built-in labels are supplied by the caller;
// user lenses and the active one-off add their generated names on top.
export function lensNameMap(
  base: Record<string, string>,
  active: ActiveCustomLens | null,
  userLenses: readonly UserLens[]
): Record<string, string> {
  const map: Record<string, string> = { ...base };
  for (const lens of userLenses) map[lens.lensId] = lens.name;
  if (active && active.name) map[active.lensId] = active.name;
  return map;
}
