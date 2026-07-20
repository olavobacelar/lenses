import { customLensCountLabel } from "../../lib/custom-lens";
import type { LensChunkProgress, LensSectionModel } from "../hooks/useLensRuns";

// Pure presentation logic for the run-lifecycle accordion header and stopped
// notice. Kept free of React so the wording and coverage rules can be spec-
// tested directly (see tests/sidepanel-evidence-run-lifecycle.test.ts).

export type StoppedResumeVariant = "resume" | "rerun";

// The class hook that drives a section's CSS state. Client-side transitions have
// no backend run yet; their status drives the hook so every lens animates the
// same way mid-run. A cancelled persisted run reads as a finished (not failed)
// card — it's "Stopped", not an error.
export function sectionStatusClass(section: LensSectionModel): string {
  if (section.clientStatus) {
    if (section.clientStatus === "failed") return "run-failed";
    if (section.clientStatus === "stopped") return "run-completed";
    if (section.clientStatus === "completed") return "run-completed";
    return "run-running";
  }
  if (section.run?.status === "cancelled") return "run-completed";
  return section.run ? `run-${section.run.status}` : "run-completed";
}

// The count-chip label. Stopped/cancelled runs carry chunk coverage so the chip
// says how far the run got instead of presenting a partial result as complete.
export function sectionCountLabel(section: LensSectionModel): string {
  if (section.clientStatus) {
    if (section.clientStatus === "running" && section.findings.length > 0) {
      return `${section.findings.length} found`;
    }
    if (section.clientStatus === "stopped") {
      return stoppedCountLabel(section.findings.length, section.chunkProgress);
    }
    return customLensCountLabel(section.clientStatus, section.findings.length);
  }
  const run = section.run;
  if (run?.status === "cancelled") {
    return stoppedCountLabel(run.findings.length, run.chunkCoverage);
  }
  if (run?.status === "failed") return "Failed";
  if (run && run.status !== "completed") return "Running";
  return String(run?.findingCount ?? section.findings.length);
}

// A stopped run's chip carries how far it got: "5 · 3/7" when it kept findings,
// "Stopped · 3/7" when it didn't. Coverage is dropped only when the run has no
// chunk manifest at all — a cancelled run then still renders as "Stopped".
export function stoppedCountLabel(
  findingCount: number,
  coverage?: LensChunkProgress
): string {
  const cov = coverage && coverage.total > 0 ? `${coverage.done}/${coverage.total}` : undefined;
  if (findingCount > 0) return cov ? `${findingCount} · ${cov}` : `${findingCount} found`;
  return cov ? `Stopped · ${cov}` : "Stopped";
}

// A reused run was initiated from a different evidence base; name the origin
// when it still exists, otherwise a bare "reused" like the library page.
export function reusedRunLabel(section: LensSectionModel): string | undefined {
  if (!section.reused) return undefined;
  return section.reusedFromTitle ? `from ${section.reusedFromTitle}` : "reused";
}

// The coverage sentence above a stopped run's findings. "resume" carries the
// session's partial findings forward; "rerun" starts over because a persisted
// stopped run kept none.
export function stoppedNoticeMessage(
  variant: StoppedResumeVariant,
  coverage: LensChunkProgress | undefined,
  hasFindings: boolean
): string {
  const cov = coverage && coverage.total > 0 ? coverage : undefined;
  if (variant === "rerun") {
    return cov
      ? `Stopped after ${cov.done} of ${cov.total} chunks. Findings from a stopped run aren't kept once the panel reloads.`
      : "Stopped. Findings from a stopped run aren't kept once the panel reloads.";
  }
  if (cov) {
    return hasFindings
      ? `Stopped at chunk ${cov.done} of ${cov.total} — these findings cover only the inspected part.`
      : `Stopped at chunk ${cov.done} of ${cov.total} before this lens found anything to show.`;
  }
  return hasFindings
    ? "Stopped — these findings cover only the inspected part."
    : "Extraction stopped before this lens found anything to show.";
}

// The action verb on the stopped notice: a just-stopped run continues from where
// it left off; a persisted stopped run has to start over.
export function stoppedResumeAction(variant: StoppedResumeVariant): string {
  return variant === "rerun" ? "Re-run" : "Run remaining chunks";
}
