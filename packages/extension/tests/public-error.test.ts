import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "../src/lib/public-error.js";

describe("publicErrorMessage", () => {
  it("removes Convex argument payloads while retaining the validator error", () => {
    const message = publicErrorMessage(
      new Error(
        '[Request ID: abc123] Server Error ArgumentValidationError: Object contains extra field `reasoningEffort` that is not in the validator. Object: {apiKey: "sk-ant-secret-value-123456", reasoningEffort: "high"}'
      ),
      "Run failed"
    );

    expect(message).toContain("reasoningEffort");
    expect(message).toContain("abc123");
    expect(message).not.toContain("apiKey");
    expect(message).not.toContain("sk-ant-secret");
  });

  it("redacts standalone credentials", () => {
    expect(
      publicErrorMessage("Authorization failed for Bearer token_value_1234567890", "Failed")
    ).toBe("Authorization failed for [redacted]");
  });

  it("uses a fallback for empty errors", () => {
    expect(publicErrorMessage("", "Run failed")).toBe("Run failed");
  });
});
