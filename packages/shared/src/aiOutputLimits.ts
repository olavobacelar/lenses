import type { ModelProvider } from "./aiModelDefaults.js";

export type AiProvider = ModelProvider;

export const FALLBACK_LENS_MAX_OUTPUT_TOKENS = 4096;
export const OPENAI_GPT_5_6_CONTEXT_WINDOW_TOKENS = 1_050_000;
export const OPENAI_GPT_5_MAX_OUTPUT_TOKENS = 128_000;
export const OPENAI_GPT_4_1_MAX_OUTPUT_TOKENS = 32_768;
export const ANTHROPIC_FRONTIER_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const ANTHROPIC_HAIKU_4_5_CONTEXT_WINDOW_TOKENS = 200_000;
export const ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS = 128_000;
/** @deprecated Use ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS. */
export const ANTHROPIC_CLAUDE_4_MAX_OUTPUT_TOKENS = ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS;
export const ANTHROPIC_CLAUDE_HAIKU_4_5_MAX_OUTPUT_TOKENS = 64_000;

export function maxOutputTokensForLensRun(provider: AiProvider, model: string): number {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return FALLBACK_LENS_MAX_OUTPUT_TOKENS;

  if (provider === "openai") {
    if (normalized.startsWith("gpt-5")) return OPENAI_GPT_5_MAX_OUTPUT_TOKENS;
    if (normalized.startsWith("gpt-4.1")) return OPENAI_GPT_4_1_MAX_OUTPUT_TOKENS;
    return FALLBACK_LENS_MAX_OUTPUT_TOKENS;
  }

  if (normalized.startsWith("claude-haiku-4-5")) {
    return ANTHROPIC_CLAUDE_HAIKU_4_5_MAX_OUTPUT_TOKENS;
  }
  if (
    normalized.startsWith("claude-fable-5") ||
    normalized.startsWith("claude-mythos-5") ||
    normalized.startsWith("claude-opus-4") ||
    normalized.startsWith("claude-sonnet-")
  ) {
    return ANTHROPIC_FRONTIER_MAX_OUTPUT_TOKENS;
  }

  return FALLBACK_LENS_MAX_OUTPUT_TOKENS;
}
