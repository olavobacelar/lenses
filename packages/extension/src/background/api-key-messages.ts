import { Effect } from "effect";
import { DEFAULT_ANTHROPIC_CHAT_MODEL } from "../types/claude";
import {
  DEFAULT_OPENAI_CHAT_MODEL,
  type ModelProvider,
  validateProvider,
} from "../types/ai-models";
import { CLAUDE_API_URL } from "./api/claude-client";
import { OPENAI_RESPONSES_URL } from "./api/openai-client";
import { isLocalByokMode, readAppAccessMode } from "../lib/app-mode";
import {
  handleDeprecatedClientCredentialMessage,
  readAiSettingsStorage,
  readModelProvider,
  readProviderApiKey,
} from "../lib/ai-settings-compat";

export function setupApiKeyMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("action" in message)) {
      return undefined;
    }

    const action = String((message as { action: unknown }).action);
    if (handleDeprecatedClientCredentialMessage(message, sendResponse)) return true;

    switch (action) {
      case "openApiKeySettings":
        chrome.tabs.create(
          {
            url: chrome.runtime.getURL("settings.html#api-keys"),
          },
          () => {
            sendResponse({ success: true });
          }
        );
        return true;

      case "checkApiKey":
        hasRequiredApiKeyForCurrentMode()
          .then((hasKey) => sendResponse({ hasKey }))
          .catch(() => sendResponse({ hasKey: false }));
        return true;

      case "testApiKey":
        testApiKey(
          String((message as { apiKey?: string }).apiKey ?? ""),
          validateProvider((message as { provider?: string }).provider),
          String((message as { model?: string }).model ?? "")
        ).then((valid) => {
          sendResponse({ valid });
        });
        return true;

      default:
        return undefined;
    }
  });
}

async function hasRequiredApiKeyForCurrentMode(): Promise<boolean> {
  if (!isLocalByokMode(await readAppAccessMode())) return true;

  const result = await readAiSettingsStorage();
  const provider = readModelProvider(result);
  const apiKey = readProviderApiKey(result, provider);
  return Boolean(apiKey?.trim());
}

const testApiKeyEffect = (apiKey: string, provider: ModelProvider, model?: string) =>
  Effect.gen(function* () {
    if (provider === "openai") {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model || DEFAULT_OPENAI_CHAT_MODEL,
              max_output_tokens: 10,
              input: "Hi",
            }),
          }),
        catch: () => ({ ok: true, status: 0 }) as Response,
      });

      return response.ok || response.status === 400;
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(CLAUDE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: DEFAULT_ANTHROPIC_CHAT_MODEL,
            max_tokens: 10,
            messages: [{ role: "user", content: "Hi" }],
          }),
        }),
      catch: () => ({ ok: true, status: 0 }) as Response,
    });

    return response.ok || response.status === 400;
  });

function testApiKey(apiKey: string, provider: ModelProvider, model?: string): Promise<boolean> {
  return Effect.runPromise(
    testApiKeyEffect(apiKey, provider, model).pipe(Effect.catchAll(() => Effect.succeed(true)))
  );
}
