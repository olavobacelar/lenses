import { env } from "../../convex/_generated/server.js";
import {
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  DEFAULT_ANTHROPIC_TEST_MODEL,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  DEFAULT_OPENAI_TEST_MODEL,
  type ModelProvider,
} from "@lenses/shared";

export {
  DEFAULT_ANTHROPIC_TEST_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_TEST_MODEL,
};
export type { ModelProvider };

export const DEFAULT_ANTHROPIC_MODEL = DEFAULT_ANTHROPIC_EXECUTION_MODEL;
export const DEFAULT_OPENAI_EXTRACTION_MODEL = DEFAULT_OPENAI_EXECUTION_MODEL;
/** Backward-compatible alias for callers whose work is extraction by default. */
export const DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_EXTRACTION_MODEL;

export type ModelPurpose = "extraction" | "chat";

type ModelEnvironmentName =
  | "ANTHROPIC_API_KEY"
  | "ANTHROPIC_MODEL"
  | "ANTHROPIC_TEST_MODEL"
  | "OPENAI_API_KEY"
  | "OPENAI_MODEL"
  | "OPENAI_TEST_MODEL";

function readEnv(name: ModelEnvironmentName): string | undefined {
  const value = env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimmed(value?: string): string | undefined {
  const result = value?.trim();
  return result && result.length > 0 ? result : undefined;
}

export function resolveModelProvider(provider?: ModelProvider): ModelProvider {
  return provider ?? DEFAULT_MODEL_PROVIDER;
}

export function isModelProvider(value: unknown): value is ModelProvider {
  return value === "anthropic" || value === "openai";
}

/**
 * Resolve a provider supplied at an external request boundary. Missing values
 * use the product default; malformed values are rejected instead of silently
 * changing providers.
 */
export function resolveRequestedModelProvider(value: unknown): ModelProvider | null {
  if (value === undefined) return DEFAULT_MODEL_PROVIDER;
  return isModelProvider(value) ? value : null;
}

export function inferModelProvider(model?: string): ModelProvider | undefined {
  const normalized = trimmed(model)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.startsWith("claude-")) return "anthropic";
  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("chatgpt-") ||
    /^o\d/.test(normalized)
  ) {
    return "openai";
  }
  return undefined;
}

export function resolveAnthropicModel(options?: { testing?: boolean }): string {
  if (options?.testing) {
    return readEnv("ANTHROPIC_TEST_MODEL") ?? DEFAULT_ANTHROPIC_TEST_MODEL;
  }

  const forceModel = readEnv("ANTHROPIC_MODEL");
  if (forceModel) return forceModel;

  return DEFAULT_ANTHROPIC_MODEL;
}

export function resolveOpenAIModel(options?: {
  testing?: boolean;
  model?: string;
  purpose?: ModelPurpose;
}): string {
  if (options?.model?.trim()) return options.model.trim();

  if (options?.testing) {
    return readEnv("OPENAI_TEST_MODEL") ?? DEFAULT_OPENAI_TEST_MODEL;
  }

  const forceModel = readEnv("OPENAI_MODEL");
  if (forceModel) return forceModel;

  return options?.purpose === "chat"
    ? DEFAULT_OPENAI_CHAT_MODEL
    : DEFAULT_OPENAI_EXTRACTION_MODEL;
}

export function resolveProviderModel(options?: {
  provider?: ModelProvider;
  testing?: boolean;
  model?: string;
  purpose?: ModelPurpose;
}): { provider: ModelProvider; model: string } {
  const provider = resolveModelProvider(options?.provider);
  if (provider === "openai") {
    return { provider, model: resolveOpenAIModel(options) };
  }
  return {
    provider,
    model: options?.model?.trim() || resolveAnthropicModel({ testing: options?.testing }),
  };
}

export function resolveLensProviderModel(options?: {
  provider?: ModelProvider;
  testing?: boolean;
  settingsModel?: string;
  lensDefaultModel?: string;
}): { provider: ModelProvider; model: string } {
  const lensModel = trimmed(options?.lensDefaultModel);
  if (lensModel) {
    return {
      provider: inferModelProvider(lensModel) ?? resolveModelProvider(options?.provider),
      model: lensModel,
    };
  }

  return resolveProviderModel({
    provider: options?.provider,
    testing: options?.testing,
    model: options?.settingsModel,
    purpose: "extraction",
  });
}

export function resolveManagedProviderApiKey(options?: {
  provider?: ModelProvider;
}): string | undefined {
  const provider = resolveModelProvider(options?.provider);
  if (provider === "openai") {
    return readEnv("OPENAI_API_KEY");
  }

  return readEnv("ANTHROPIC_API_KEY");
}
