import { describe, expect, it } from "vitest";
import { isManagedModelAllowed } from "../src/managedModels.js";

describe("managed model allowlist", () => {
  it("supports the configured OpenAI and Anthropic models", () => {
    expect(isManagedModelAllowed("openai", "gpt-5.6-luna")).toBe(true);
    expect(isManagedModelAllowed("anthropic", "claude-haiku-4-5-20251001")).toBe(true);
  });

  it("rejects unknown and provider-mismatched models", () => {
    expect(isManagedModelAllowed("anthropic", "gpt-5.6-luna")).toBe(false);
    expect(isManagedModelAllowed("openai", "claude-sonnet-5")).toBe(false);
    expect(isManagedModelAllowed("openai", "unknown-model")).toBe(false);
  });
});
