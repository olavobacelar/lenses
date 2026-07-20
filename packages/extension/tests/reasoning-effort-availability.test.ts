// Unit tests for per-model reasoning-effort availability. The composer must only
// offer (and only persist) effort levels the chosen model actually accepts —
// otherwise the UI shows an effort the API client silently drops. These cover
// the single source of truth (reasoning-settings) and its agreement with the
// model-capability predicates colocated in the types module.

import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_REASONING_EFFORTS,
  OPENAI_REASONING_EFFORTS,
  clampReasoningEffortToModel,
  modelSupportsReasoningEffort,
  reasoningEffortsForModel,
} from "../src/lib/reasoning-settings";
import { supportsClaudeEffort } from "../src/types/claude";
import { supportsOpenAIReasoningEffort } from "../src/types/ai-models";

describe("reasoning-effort availability per model", () => {
  it("offers the full Anthropic ladder for adaptive-thinking Claude models", () => {
    expect(reasoningEffortsForModel("claude-fable-5")).toEqual(ANTHROPIC_REASONING_EFFORTS);
    expect(reasoningEffortsForModel("claude-opus-4-8")).toEqual(ANTHROPIC_REASONING_EFFORTS);
    expect(reasoningEffortsForModel("claude-sonnet-5")).toEqual(ANTHROPIC_REASONING_EFFORTS);
    expect(reasoningEffortsForModel("claude-opus-4-8")).toContain("max");
  });

  it("offers no reasoning levels for Haiku, which ignores effort", () => {
    expect(reasoningEffortsForModel("claude-haiku-4-5-20251001")).toEqual([]);
    expect(modelSupportsReasoningEffort("claude-haiku-4-5-20251001")).toBe(false);
  });

  it("offers the full reasoning ladder for every exposed OpenAI GPT-5.6 model", () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const) {
      expect(reasoningEffortsForModel(model)).toEqual(OPENAI_REASONING_EFFORTS);
      expect(reasoningEffortsForModel(model)).toContain("max");
    }
  });

  it("agrees with the capability predicates the API clients use", () => {
    // The UI list is non-empty exactly when the client would attach an effort.
    expect(modelSupportsReasoningEffort("claude-opus-4-8")).toBe(
      supportsClaudeEffort("claude-opus-4-8")
    );
    expect(modelSupportsReasoningEffort("claude-haiku-4-5-20251001")).toBe(
      supportsClaudeEffort("claude-haiku-4-5-20251001")
    );
    expect(modelSupportsReasoningEffort("gpt-5.6-luna")).toBe(
      supportsOpenAIReasoningEffort("gpt-5.6-luna")
    );
  });

  it("downgrades an out-of-range effort to the default when switching models", () => {
    expect(clampReasoningEffortToModel("max", "gpt-5.6-sol")).toBe("max");
    // A level both providers share is preserved.
    expect(clampReasoningEffortToModel("high", "gpt-5.6-terra")).toBe("high");
    expect(clampReasoningEffortToModel("max", "claude-opus-4-8")).toBe("max");
  });

  it("leaves the stored effort untouched for models that ignore it", () => {
    // Haiku never sends effort, so a user's preferred 'max' survives for the next
    // Claude model that does honour it rather than being silently reset.
    expect(clampReasoningEffortToModel("max", "claude-haiku-4-5-20251001")).toBe("max");
  });
});
