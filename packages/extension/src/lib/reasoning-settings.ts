import {
  isClaudeModel,
  supportsClaudeEffort,
} from "../types/claude";
import {
  isOpenAIModel,
  supportsOpenAIReasoningEffort,
  type AiModel,
} from "../types/ai-models";

export type ModelProviderName = "anthropic" | "openai";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type OpenAIReasoningEffort = ReasoningEffort;

export const REASONING_EFFORT_KEY = "reasoningEffort";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export const OPENAI_REASONING_EFFORTS: OpenAIReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const ANTHROPIC_REASONING_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const REASONING_EFFORTS: ReasoningEffort[] = ANTHROPIC_REASONING_EFFORTS;

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

export const ANTHROPIC_REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

export const REASONING_EFFORT_SHORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

export function validateReasoningEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : DEFAULT_REASONING_EFFORT;
}

export function isOpenAIReasoningEffort(value: unknown): value is OpenAIReasoningEffort {
  return (
    typeof value === "string" &&
    OPENAI_REASONING_EFFORTS.includes(value as OpenAIReasoningEffort)
  );
}

export function reasoningEffortsForProvider(provider: ModelProviderName): ReasoningEffort[] {
  return provider === "anthropic" ? ANTHROPIC_REASONING_EFFORTS : OPENAI_REASONING_EFFORTS;
}

/**
 * The reasoning levels a specific model actually accepts — the single source of
 * truth the composer offers in its menu. It mirrors exactly what the API clients
 * honour, so the UI never displays (or sends) an effort the model would ignore.
 *
 * Within Anthropic only the adaptive-thinking models (Fable, Opus, Sonnet)
 * take an effort; Haiku ignores it entirely and so gets an empty list (no
 * reasoning control at all). Every exposed GPT-5.6 model accepts the full
 * OpenAI ladder.
 */
export function reasoningEffortsForModel(model: AiModel): ReasoningEffort[] {
  if (isOpenAIModel(model)) {
    return supportsOpenAIReasoningEffort(model) ? OPENAI_REASONING_EFFORTS : [];
  }
  if (isClaudeModel(model)) {
    return supportsClaudeEffort(model) ? ANTHROPIC_REASONING_EFFORTS : [];
  }
  return [];
}

export function modelSupportsReasoningEffort(model: AiModel): boolean {
  return reasoningEffortsForModel(model).length > 0;
}

/**
 * Coerce an effort to one the model accepts. Models that ignore effort keep the
 * incoming value untouched (it's hidden and never sent, so a user's preferred
 * level survives for the next model that does support it); models that accept
 * effort fall back to the default when the value isn't in their list.
 */
export function clampReasoningEffortToModel(
  effort: ReasoningEffort,
  model: AiModel
): ReasoningEffort {
  const options = reasoningEffortsForModel(model);
  if (options.length === 0) return effort;
  return options.includes(effort) ? effort : DEFAULT_REASONING_EFFORT;
}

export function validateReasoningEffortForProvider(
  value: unknown,
  provider: ModelProviderName
): ReasoningEffort {
  const effort = validateReasoningEffort(value);
  return reasoningEffortsForProvider(provider).includes(effort)
    ? effort
    : DEFAULT_REASONING_EFFORT;
}

export function reasoningEffortLabelForProvider(
  effort: ReasoningEffort,
  provider: ModelProviderName
): string {
  return provider === "anthropic"
    ? ANTHROPIC_REASONING_EFFORT_LABELS[effort]
    : REASONING_EFFORT_LABELS[effort];
}
