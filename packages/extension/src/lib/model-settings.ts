import {
  readAiSettingsStorage,
  readModelProvider,
  readProviderChatModel,
  readProviderExecutionModel,
  type AiSettingsStorageSnapshot,
} from "./ai-settings-compat";
import {
  REASONING_EFFORT_KEY,
  validateReasoningEffortForProvider,
  type ReasoningEffort,
} from "./reasoning-settings";
import {
  defaultChatModelForProvider,
  defaultExecutionModelForProvider,
  validateModelForProvider,
  type AiModel,
  type ModelProvider,
} from "../types/ai-models";

export type ModelKind = "chat" | "execution";

export interface StoredAiModelSettings {
  provider: ModelProvider;
  chatModel: AiModel;
  executionModel: AiModel;
  reasoningEffort: ReasoningEffort;
}

export interface StoredModelSettings {
  provider: ModelProvider;
  model: AiModel;
  reasoningEffort: ReasoningEffort;
}

/** Resolve the model settings used by both managed and Local BYOK requests. */
export function resolveStoredAiModelSettings(
  stored: AiSettingsStorageSnapshot,
  reasoningEffort: unknown
): StoredAiModelSettings {
  const provider = readModelProvider(stored);

  return {
    provider,
    chatModel: validateModelForProvider(
      readProviderChatModel(stored, provider),
      provider,
      defaultChatModelForProvider(provider)
    ),
    executionModel: validateModelForProvider(
      readProviderExecutionModel(stored, provider),
      provider,
      defaultExecutionModelForProvider(provider)
    ),
    reasoningEffort: validateReasoningEffortForProvider(reasoningEffort, provider),
  };
}

export function selectStoredModelSettings(
  settings: StoredAiModelSettings,
  modelKind: ModelKind
): StoredModelSettings {
  return {
    provider: settings.provider,
    model: modelKind === "execution" ? settings.executionModel : settings.chatModel,
    reasoningEffort: settings.reasoningEffort,
  };
}

export function resolveStoredModelSettings(
  stored: AiSettingsStorageSnapshot,
  reasoningEffort: unknown,
  modelKind: ModelKind = "chat"
): StoredModelSettings {
  return selectStoredModelSettings(
    resolveStoredAiModelSettings(stored, reasoningEffort),
    modelKind
  );
}

export async function readStoredAiModelSettings(): Promise<StoredAiModelSettings> {
  const [stored, effortStored] = await Promise.all([
    readAiSettingsStorage(),
    chrome.storage.sync.get(REASONING_EFFORT_KEY),
  ]);

  return resolveStoredAiModelSettings(
    stored,
    effortStored[REASONING_EFFORT_KEY]
  );
}

export async function readStoredModelSettings(
  modelKind: ModelKind = "chat"
): Promise<StoredModelSettings> {
  return selectStoredModelSettings(await readStoredAiModelSettings(), modelKind);
}
