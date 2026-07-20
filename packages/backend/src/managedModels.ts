import type { ModelProvider } from "./findings/model.js";

const MANAGED_MODELS = new Set([
  "gpt-5.4-mini",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-fable-5",
]);

export function isManagedModelAllowed(provider: ModelProvider, model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (provider === "anthropic" && !normalized.startsWith("claude-")) return false;
  if (provider === "openai" && normalized.startsWith("claude-")) return false;
  return MANAGED_MODELS.has(normalized);
}
