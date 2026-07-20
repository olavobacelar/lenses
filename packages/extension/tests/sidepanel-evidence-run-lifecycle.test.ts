import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLensRunsResponse } from "../src/sidepanel/schemas.js";
import type { LensSectionModel } from "../src/sidepanel/hooks/useLensRuns.js";
import type { LensRunState } from "../src/sidepanel/types.js";
import {
  reusedRunLabel,
  sectionCountLabel,
  sectionStatusClass,
  stoppedNoticeMessage,
  stoppedResumeAction,
} from "../src/sidepanel/lib/lens-run-lifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "src");
const read = (path: string) => readFileSync(join(sourceRoot, path), "utf-8");

function run(overrides: Partial<LensRunState>): LensRunState {
  return {
    runId: "run-1",
    lensId: "source-tracer",
    status: "completed",
    createdAt: 123,
    findings: [],
    ...overrides,
  };
}

function finding(text: string) {
  return { text, category: "claim", detail: "", confidence: 0.9 };
}

describe("sidepanel evidence-run lifecycle", () => {
  it("preserves a persisted cancelled run instead of dropping the response", () => {
    const parsed = parseLensRunsResponse({
      runs: [
        {
          runId: "run-1",
          lensId: "source-tracer",
          status: "cancelled",
          createdAt: 123,
          findings: [],
        },
      ],
    });

    expect(parsed.runs).toEqual([
      expect.objectContaining({
        runId: "run-1",
        status: "cancelled",
        findings: [],
      }),
    ]);
  });

  it("carries chunk coverage and origin base through the run schema", () => {
    const parsed = parseLensRunsResponse({
      runs: [
        {
          runId: "run-1",
          lensId: "source-tracer",
          status: "cancelled",
          createdAt: 123,
          findings: [],
          chunkCoverage: { done: 3, total: 7 },
          initiatedFromEvidenceBaseId: "eb-other",
          initiatedFromEvidenceBaseTitle: "Media Diet",
        },
      ],
    });

    expect(parsed.runs?.[0]).toMatchObject({
      chunkCoverage: { done: 3, total: 7 },
      initiatedFromEvidenceBaseId: "eb-other",
      initiatedFromEvidenceBaseTitle: "Media Diet",
    });
  });

  it("addresses managed sidebar calls with a cancellation token", () => {
    const hook = read("sidepanel/hooks/useLensRuns.ts");
    const worker = read("background/service-worker.ts");

    expect(hook).toContain("const runRequestId = crypto.randomUUID()");
    expect(hook).not.toContain("trackingRunId");
    expect(hook).toContain("if (result.cancelled) throw createAbortError()");
    expect(hook).toContain('type: "cancel-run-request"');
    expect(worker).toContain('type: "cancel-run-request"');
    expect(worker).toContain("requestManagedRunCancel(message.runRequestId)");
    expect(worker).toContain("/managed/cancel-run");
  });

  it("ignores persisted findings returned for a source that is no longer active", () => {
    const hook = read("sidepanel/hooks/useLensRuns.ts");

    expect(hook).toContain("currentSourceKeyRef");
    expect(hook).toContain("findingsLoadRequestIdRef");
    expect(hook).toContain("requestedSourceKey !== currentSourceKeyRef.current");
    expect(hook).toContain("const isLatest = () =>");
    expect(hook).toContain("if (!isLatest()) return");
    expect(hook).toContain("const isCurrentRunSource = () =>");
    expect(hook).toContain("if (isCurrentRunSource()) {");
  });

  // Locked decision: a persisted cancelled run renders as "Stopped" in the
  // sidepanel, never "cancelled" or an error. The wording now flows through the
  // pure lifecycle helpers rather than an inline string, so assert the behavior.
  it("renders a persisted cancelled run as Stopped, not failed", () => {
    const section: LensSectionModel = {
      lensId: "source-tracer",
      findings: [],
      run: run({ status: "cancelled" }),
    };
    expect(sectionCountLabel(section)).toBe("Stopped");
    expect(sectionStatusClass(section)).toBe("run-completed");
  });

  it("still names cancelled as the stopped status in the source", () => {
    const sections = read("sidepanel/components/LensSections.tsx");
    expect(sections).toContain('run.status === "cancelled"');
  });

  it("appends chunk coverage to a stopped chip", () => {
    const persisted: LensSectionModel = {
      lensId: "source-tracer",
      findings: [],
      run: run({ status: "cancelled", chunkCoverage: { done: 3, total: 7 } }),
    };
    expect(sectionCountLabel(persisted)).toBe("Stopped · 3/7");

    const clientStopped: LensSectionModel = {
      lensId: "source-tracer",
      findings: [finding("a"), finding("b"), finding("c"), finding("d"), finding("e")],
      clientStatus: "stopped",
      chunkProgress: { done: 3, total: 7 },
    };
    expect(sectionCountLabel(clientStopped)).toBe("5 · 3/7");
  });

  it("phrases the stopped notice by whether findings survived", () => {
    expect(stoppedNoticeMessage("resume", { done: 3, total: 7 }, true)).toBe(
      "Stopped at chunk 3 of 7 — these findings cover only the inspected part."
    );
    expect(stoppedNoticeMessage("rerun", { done: 3, total: 7 }, false)).toBe(
      "Stopped after 3 of 7 chunks. Findings from a stopped run aren't kept once the panel reloads."
    );
    expect(stoppedResumeAction("resume")).toBe("Run remaining chunks");
    expect(stoppedResumeAction("rerun")).toBe("Re-run");
  });

  it("names the origin base for a reused run", () => {
    const named: LensSectionModel = {
      lensId: "source-tracer",
      findings: [],
      reused: true,
      reusedFromTitle: "Media Diet",
    };
    expect(reusedRunLabel(named)).toBe("from Media Diet");

    const untitled: LensSectionModel = { lensId: "source-tracer", findings: [], reused: true };
    expect(reusedRunLabel(untitled)).toBe("reused");

    const fresh: LensSectionModel = { lensId: "source-tracer", findings: [] };
    expect(reusedRunLabel(fresh)).toBeUndefined();
  });

  it("counts only completed chunks as done, rendering the in-flight chunk active", () => {
    const hook = read("sidepanel/hooks/useLensRuns.ts");
    // The chunk being requested stays out of `done` until it resolves.
    expect(hook).toContain("{ done: index, total: chunks.length }");
    expect(hook).toContain("completedChunks = index + 1");
    // The old semantics counted the in-flight chunk as finished.
    expect(hook).not.toContain("current: index + 1");

    const sections = read("sidepanel/components/LensSections.tsx");
    expect(sections).toContain("index === done ? \"active\"");
  });

  it("exposes a resume path that reuses the stopped run's coverage", () => {
    const hook = read("sidepanel/hooks/useLensRuns.ts");
    expect(hook).toContain("resumeLensRun");
    expect(hook).toContain("resumableRuns");
    expect(hook).toContain("resume?: boolean");
  });

  it("maps cancelled to Stopped in the library run pill", () => {
    const library = read("evidence-bases/App.tsx");
    expect(library).toContain("runStatusLabel");
    expect(library).toContain('status === "cancelled" ? "Stopped" : status');
    // The class hook stays keyed on the raw status so styling is unchanged.
    expect(library).toContain("run-status status-${run.status}");
  });
});
