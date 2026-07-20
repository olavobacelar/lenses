import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  DEFAULT_ANTHROPIC_TEST_MODEL,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  DEFAULT_OPENAI_TEST_MODEL,
} from "../src/aiModelDefaults.js";

describe("AI model defaults", () => {
  it("keeps the product-wide provider and runtime defaults together", () => {
    expect(DEFAULT_MODEL_PROVIDER).toBe("openai");
    expect(DEFAULT_OPENAI_CHAT_MODEL).toBe("gpt-5.6-terra");
    expect(DEFAULT_OPENAI_EXECUTION_MODEL).toBe("gpt-5.6-luna");
    expect(DEFAULT_ANTHROPIC_CHAT_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(DEFAULT_ANTHROPIC_EXECUTION_MODEL).toBe("claude-haiku-4-5-20251001");
  });

  it("keeps backend test-mode defaults in the same contract", () => {
    expect(DEFAULT_OPENAI_TEST_MODEL).toBe("gpt-5.4-mini");
    expect(DEFAULT_ANTHROPIC_TEST_MODEL).toBe("claude-haiku-4-5-20251001");
  });
});
