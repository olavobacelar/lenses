import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  VALID_CLAUDE_MODELS,
  isClaudeModel,
} from "../src/types/claude";
import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  VALID_OPENAI_MODELS,
  isOpenAIModel,
  validModelsForProvider,
  validateModelForProvider,
} from "../src/types/ai-models";

describe("OpenAI model settings", () => {
  const expectedModels = ["gpt-5.4-mini", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

  it("exposes the configured OpenAI model allowlist", () => {
    expect(VALID_OPENAI_MODELS).toEqual(expectedModels);
    expect(validModelsForProvider("openai")).toEqual(expectedModels);
    for (const model of expectedModels) {
      expect(isOpenAIModel(model)).toBe(true);
    }
    expect(isOpenAIModel("gpt-5.5")).toBe(false);
    expect(isOpenAIModel("gpt-4.1-mini")).toBe(false);
  });

  it("uses Luna for extraction and Terra for chat by default", () => {
    expect(DEFAULT_MODEL_PROVIDER).toBe("openai");
    expect(DEFAULT_OPENAI_CHAT_MODEL).toBe("gpt-5.6-terra");
    expect(DEFAULT_OPENAI_EXECUTION_MODEL).toBe("gpt-5.6-luna");
    expect(validateModelForProvider("gpt-4.1-mini", "openai")).toBe("gpt-5.6-terra");
  });
});

describe("Anthropic model settings", () => {
  const expectedModels = [
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
  ];

  it("exposes the configured Anthropic model allowlist", () => {
    expect(VALID_CLAUDE_MODELS).toEqual(expectedModels);
    expect(validModelsForProvider("anthropic")).toEqual(expectedModels);
    for (const model of expectedModels) {
      expect(isClaudeModel(model)).toBe(true);
    }
    expect(isClaudeModel("claude-mythos-5")).toBe(false);
  });

  it("uses the configured Haiku defaults and rejects unknown active choices", () => {
    expect(DEFAULT_ANTHROPIC_CHAT_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(DEFAULT_ANTHROPIC_EXECUTION_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(validateModelForProvider("claude-retired-example", "anthropic")).toBe(
      "claude-haiku-4-5-20251001"
    );
  });
});
