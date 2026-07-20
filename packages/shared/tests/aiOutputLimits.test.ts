import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_CLAUDE_HAIKU_4_5_MAX_OUTPUT_TOKENS,
  ANTHROPIC_FRONTIER_CONTEXT_WINDOW_TOKENS,
  ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS,
  ANTHROPIC_HAIKU_4_5_CONTEXT_WINDOW_TOKENS,
  FALLBACK_LENS_MAX_OUTPUT_TOKENS,
  OPENAI_GPT_4_1_MAX_OUTPUT_TOKENS,
  OPENAI_GPT_5_6_CONTEXT_WINDOW_TOKENS,
  OPENAI_GPT_5_MAX_OUTPUT_TOKENS,
  maxOutputTokensForLensRun,
} from "../src/aiOutputLimits.js";

describe("maxOutputTokensForLensRun", () => {
  it("uses current OpenAI max output limits for exposed model families", () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(maxOutputTokensForLensRun("openai", model)).toBe(
        OPENAI_GPT_5_MAX_OUTPUT_TOKENS
      );
    }
    expect(OPENAI_GPT_5_6_CONTEXT_WINDOW_TOKENS).toBe(1_050_000);
    expect(maxOutputTokensForLensRun("openai", "gpt-4.1-mini")).toBe(
      OPENAI_GPT_4_1_MAX_OUTPUT_TOKENS
    );
  });

  it("uses current Anthropic max output limits for exposed model families", () => {
    for (const model of ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5"]) {
      expect(maxOutputTokensForLensRun("anthropic", model)).toBe(
        ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS
      );
    }
    expect(maxOutputTokensForLensRun("anthropic", "claude-haiku-4-5-20251001")).toBe(
      ANTHROPIC_CLAUDE_HAIKU_4_5_MAX_OUTPUT_TOKENS
    );
    expect(ANTHROPIC_FRONTIER_CONTEXT_WINDOW_TOKENS).toBe(1_000_000);
    expect(ANTHROPIC_HAIKU_4_5_CONTEXT_WINDOW_TOKENS).toBe(200_000);
  });

  it("keeps the legacy cap for unknown models", () => {
    expect(maxOutputTokensForLensRun("openai", "gpt-unknown")).toBe(
      FALLBACK_LENS_MAX_OUTPUT_TOKENS
    );
    expect(maxOutputTokensForLensRun("anthropic", "")).toBe(FALLBACK_LENS_MAX_OUTPUT_TOKENS);
  });
});
