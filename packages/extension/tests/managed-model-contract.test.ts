import { describe, expect, it } from "vitest";
import { buildManagedSourceChatPayload } from "../src/background/managed-chat-stream.js";
import { AI_SETTINGS_STORAGE_KEYS } from "../src/lib/ai-settings-compat.js";
import { resolveStoredModelSettings } from "../src/lib/model-settings.js";

const REQUEST = {
  question: "What does this source establish?",
  source: {
    kind: "web_page" as const,
    title: "Example",
    url: "https://example.com/source",
    text: "Source text",
    scope: "page" as const,
  },
};

describe("stored model settings to managed request contract", () => {
  it("uses the configured default for a fresh managed installation", () => {
    const settings = resolveStoredModelSettings({}, undefined, "chat");
    const payload = buildManagedSourceChatPayload(REQUEST, settings);

    expect(settings).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    expect(payload).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("apiKeys");
  });

  it("keeps an Anthropic selection while excluding locally stored credentials", () => {
    const stored = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: "anthropic",
      [AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: "claude-haiku-4-5-20251001",
      [AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: "local-secret-that-must-not-be-sent",
    };
    const settings = resolveStoredModelSettings(stored, "high", "chat");
    const payload = buildManagedSourceChatPayload(REQUEST, settings);

    expect(payload).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      reasoningEffort: "high",
    });
    expect(JSON.stringify(payload)).not.toContain("local-secret-that-must-not-be-sent");
  });

  it("keeps the selected OpenAI model in managed mode", () => {
    const stored = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: "openai",
      [AI_SETTINGS_STORAGE_KEYS.openaiChatModel]: "gpt-5.6-sol",
      [AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: "claude-sonnet-5",
    };

    expect(resolveStoredModelSettings(stored, "medium", "chat")).toEqual({
      provider: "openai",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
    });
  });

  it("resolves the configured OpenAI execution default for Lens runs", () => {
    const settings = resolveStoredModelSettings({}, undefined, "execution");

    expect(settings).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    });
  });

  it("normalizes structured chat history before sending it to the managed route", () => {
    const settings = resolveStoredModelSettings({}, undefined, "chat");
    const payload = buildManagedSourceChatPayload(
      {
        ...REQUEST,
        conversation: [
          {
            role: "user",
            content: [
              { type: "text", text: "First" },
              { type: "text", text: "Second" },
            ],
          },
        ],
      },
      settings
    );

    expect(payload.conversation).toEqual([
      { role: "user", content: "First\nSecond" },
    ]);
  });
});
