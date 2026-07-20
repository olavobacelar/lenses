import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXTRACTION_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TEST_MODEL,
  inferModelProvider,
  resolveRequestedModelProvider,
  resolveManagedProviderApiKey,
  resolveLensProviderModel,
  resolveModelProvider,
  resolveProviderModel,
} from "../src/findings/model.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lens model resolution", () => {
  it("honors a lens default model and infers its provider", () => {
    expect(
      resolveLensProviderModel({
        provider: "anthropic",
        settingsModel: "claude-haiku-4-5-20251001",
        lensDefaultModel: "gpt-5.6-luna",
      })
    ).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
    });

    expect(inferModelProvider("claude-sonnet-5")).toBe("anthropic");
  });

  it("falls back to the settings-selected model when the lens has no default", () => {
    expect(
      resolveLensProviderModel({
        provider: "openai",
        settingsModel: "gpt-5.6-sol",
        lensDefaultModel: "  ",
      })
    ).toEqual({
      provider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("lets a Lens model override the selected provider in either direction", () => {
    expect(
      resolveLensProviderModel({
        provider: "openai",
        settingsModel: "gpt-5.6-luna",
        lensDefaultModel: "claude-sonnet-5",
      })
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  it("defaults managed work to OpenAI with Luna extraction and Terra chat", () => {
    expect(resolveModelProvider()).toBe("openai");
    expect(DEFAULT_OPENAI_EXTRACTION_MODEL).toBe("gpt-5.6-luna");
    expect(DEFAULT_OPENAI_CHAT_MODEL).toBe("gpt-5.6-terra");
    expect(DEFAULT_OPENAI_MODEL).toBe(DEFAULT_OPENAI_EXTRACTION_MODEL);
    expect(DEFAULT_OPENAI_TEST_MODEL).toBe("gpt-5.4-mini");
    expect(resolveProviderModel()).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
    expect(resolveProviderModel({ purpose: "chat" })).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
  });

  it("resolves explicit providers and rejects malformed request providers", () => {
    expect(resolveProviderModel({ provider: "openai" })).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
    expect(resolveProviderModel({ provider: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
    });
    expect(resolveRequestedModelProvider(undefined)).toBe("openai");
    expect(resolveRequestedModelProvider("anthropic")).toBe("anthropic");
    expect(resolveRequestedModelProvider("opneai")).toBeNull();
    expect(resolveRequestedModelProvider(null)).toBeNull();
  });

  it("honors explicit models before environment overrides, then configured defaults", () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-env-openai");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-env-anthropic");

    expect(resolveProviderModel({ provider: "openai", model: "gpt-explicit" }).model).toBe(
      "gpt-explicit"
    );
    expect(resolveProviderModel({ provider: "openai" }).model).toBe("gpt-env-openai");
    expect(
      resolveProviderModel({ provider: "anthropic", model: "claude-explicit" }).model
    ).toBe("claude-explicit");
    expect(resolveProviderModel({ provider: "anthropic" }).model).toBe(
      "claude-env-anthropic"
    );
  });

  it("uses test-model overrides only for testing requests", () => {
    vi.stubEnv("OPENAI_TEST_MODEL", "gpt-openai-test");
    vi.stubEnv("ANTHROPIC_TEST_MODEL", "claude-anthropic-test");

    expect(resolveProviderModel({ provider: "openai", testing: true }).model).toBe(
      "gpt-openai-test"
    );
    expect(resolveProviderModel({ provider: "anthropic", testing: true }).model).toBe(
      "claude-anthropic-test"
    );
    expect(
      resolveProviderModel({ provider: "openai", testing: true, model: "gpt-explicit" })
        .model
    ).toBe("gpt-explicit");
  });
});

describe("managed provider credentials", () => {
  it("resolves only the selected provider's Convex environment secret", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "managed-anthropic-test-key");
    vi.stubEnv("OPENAI_API_KEY", "managed-openai-test-key");

    expect(resolveManagedProviderApiKey({ provider: "anthropic" })).toBe(
      "managed-anthropic-test-key"
    );
    expect(resolveManagedProviderApiKey({ provider: "openai" })).toBe(
      "managed-openai-test-key"
    );
  });

  it("does not substitute one provider's secret when the selected secret is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "managed-openai-only-key");

    expect(resolveManagedProviderApiKey({ provider: "openai" })).toBe(
      "managed-openai-only-key"
    );
    expect(resolveManagedProviderApiKey({ provider: "anthropic" })).toBeUndefined();
  });

  it("does not substitute an Anthropic secret for a missing OpenAI secret", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "managed-anthropic-only-key");

    expect(resolveManagedProviderApiKey({ provider: "anthropic" })).toBe(
      "managed-anthropic-only-key"
    );
    expect(resolveManagedProviderApiKey({ provider: "openai" })).toBeUndefined();
  });
});
