import { validateProvider, type ModelProvider } from '../types/ai-models';

/**
 * Compatibility bridge for settings written before the provider-neutral model
 * vocabulary. Remove this module when the extension reaches 2.0.0.
 */
export const AI_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE = '2.0.0';
export const AI_SETTINGS_MIGRATION_VERSION = 1;

export const LEGACY_ANTHROPIC_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'claude-sonnet-4-6': 'claude-sonnet-5',
};

export const AI_SETTINGS_STORAGE_KEYS = {
  migrationVersion: 'aiSettingsMigrationVersion',
  provider: 'modelProvider',
  anthropicApiKey: 'anthropicApiKey',
  openaiApiKey: 'openaiApiKey',
  anthropicChatModel: 'anthropicModel',
  openaiChatModel: 'openaiModel',
  anthropicExecutionModel: 'anthropicExecutionModel',
  openaiExecutionModel: 'openaiExecutionModel',
} as const;

export const LEGACY_AI_SETTINGS_STORAGE_KEYS = {
  anthropicApiKey: 'claudeApiKey',
  activeChatModel: 'model',
  anthropicChatModel: 'claudeModel',
  activeExecutionModel: 'claimModel',
  openaiExecutionModel: 'openaiClaimModel',
} as const;

export const AI_SETTINGS_STORAGE_READ_KEYS = [
  ...Object.values(AI_SETTINGS_STORAGE_KEYS),
  ...Object.values(LEGACY_AI_SETTINGS_STORAGE_KEYS),
] as const;

export const AI_CREDENTIAL_STORAGE_KEYS = [
  AI_SETTINGS_STORAGE_KEYS.anthropicApiKey,
  AI_SETTINGS_STORAGE_KEYS.openaiApiKey,
  LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey,
] as const;

export type AiSettingsStorageSnapshot = Record<string, unknown>;

export function migrateLegacyAiSettingsRecord(stored: AiSettingsStorageSnapshot): {
  snapshot: AiSettingsStorageSnapshot;
  updates: AiSettingsStorageSnapshot;
} {
  const updates: AiSettingsStorageSnapshot = {};
  const storedProvider = readString(stored[AI_SETTINGS_STORAGE_KEYS.provider]);
  const inferredLegacyProvider = storedProvider ? undefined : inferLegacyModelProvider(stored);
  const provider = validateProvider(storedProvider ?? inferredLegacyProvider);

  if (inferredLegacyProvider) {
    updates[AI_SETTINGS_STORAGE_KEYS.provider] = inferredLegacyProvider;
  }

  replaceRetiredAnthropicModel(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.anthropicChatModel
  );
  replaceRetiredAnthropicModel(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.anthropicExecutionModel
  );

  copyIfMissing(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.anthropicApiKey,
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey])
  );
  copyIfMissing(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.anthropicChatModel,
    readCompatibleAnthropicModel(
      stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]
    ) ??
      (provider === 'anthropic'
        ? readCompatibleAnthropicModel(
            stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel]
          )
        : undefined)
  );
  copyIfMissing(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.openaiChatModel,
    provider === 'openai'
      ? readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel])
      : undefined
  );
  copyIfMissing(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.anthropicExecutionModel,
    provider === 'anthropic'
      ? readCompatibleAnthropicModel(
          stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]
        )
      : undefined
  );
  copyIfMissing(
    stored,
    updates,
    AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel,
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]) ??
      (provider === 'openai'
        ? readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel])
        : undefined)
  );

  if (readNumber(stored[AI_SETTINGS_STORAGE_KEYS.migrationVersion]) < AI_SETTINGS_MIGRATION_VERSION) {
    updates[AI_SETTINGS_STORAGE_KEYS.migrationVersion] = AI_SETTINGS_MIGRATION_VERSION;
  }

  return { snapshot: { ...stored, ...updates }, updates };
}

export async function readAiSettingsStorage(
  syncStorage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'> =
    chrome.storage.sync,
  localStorage: Pick<chrome.storage.StorageArea, 'get' | 'set'> = chrome.storage.local
): Promise<AiSettingsStorageSnapshot> {
  const [syncStored, localCredentials] = await Promise.all([
    syncStorage.get([...AI_SETTINGS_STORAGE_READ_KEYS]),
    localStorage.get([...AI_CREDENTIAL_STORAGE_KEYS]),
  ]);
  const stored = { ...syncStored, ...localCredentials };
  const migrated = migrateLegacyAiSettingsRecord(stored);
  const syncUpdates: AiSettingsStorageSnapshot = {};
  const localUpdates: AiSettingsStorageSnapshot = {};

  for (const [key, value] of Object.entries(migrated.updates)) {
    if (isCredentialStorageKey(key)) {
      localUpdates[key] = value;
    } else {
      syncUpdates[key] = value;
    }
  }

  const syncedCredentialKeys = AI_CREDENTIAL_STORAGE_KEYS.filter((key) => key in syncStored);
  if (syncedCredentialKeys.length > 0) {
    for (const key of [
      AI_SETTINGS_STORAGE_KEYS.anthropicApiKey,
      AI_SETTINGS_STORAGE_KEYS.openaiApiKey,
    ] as const) {
      const value = readString(migrated.snapshot[key]);
      if (value !== undefined) localUpdates[key] = value;
    }
  }

  if (Object.keys(localUpdates).length > 0) {
    await localStorage.set(localUpdates);
  }
  if (Object.keys(syncUpdates).length > 0) {
    await syncStorage.set(syncUpdates);
  }
  // Credentials written by older versions are copied locally before removal.
  // Presence in sync is the migration marker, making this cleanup idempotent.
  if (syncedCredentialKeys.length > 0) {
    await syncStorage.remove([...syncedCredentialKeys]);
  }
  return { ...migrated.snapshot, ...localUpdates };
}

export function readModelProvider(stored: AiSettingsStorageSnapshot): ModelProvider {
  return validateProvider(readString(stored[AI_SETTINGS_STORAGE_KEYS.provider]));
}

export function readProviderApiKey(
  stored: AiSettingsStorageSnapshot,
  provider: ModelProvider
): string | undefined {
  if (provider === 'openai') {
    return readString(stored[AI_SETTINGS_STORAGE_KEYS.openaiApiKey]);
  }
  return readString(stored[AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]) ??
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]);
}

export function readProviderChatModel(
  stored: AiSettingsStorageSnapshot,
  provider: ModelProvider
): string | undefined {
  if (provider === 'openai') {
    return readString(stored[AI_SETTINGS_STORAGE_KEYS.openaiChatModel]) ??
      (readModelProvider(stored) === 'openai'
        ? readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel])
        : undefined);
  }
  return readCompatibleAnthropicModel(stored[AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]) ??
    readCompatibleAnthropicModel(
      stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]
    ) ??
    (readModelProvider(stored) === 'anthropic'
      ? readCompatibleAnthropicModel(
          stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel]
        )
      : undefined);
}

export function readProviderExecutionModel(
  stored: AiSettingsStorageSnapshot,
  provider: ModelProvider
): string | undefined {
  if (provider === 'openai') {
    return readString(stored[AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]) ??
      readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]) ??
      (readModelProvider(stored) === 'openai'
        ? readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel])
        : undefined);
  }
  return readCompatibleAnthropicModel(
    stored[AI_SETTINGS_STORAGE_KEYS.anthropicExecutionModel]
  ) ??
    (readModelProvider(stored) === 'anthropic'
      ? readCompatibleAnthropicModel(
          stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]
        )
      : undefined);
}

const DEPRECATED_CLIENT_CREDENTIAL_ACTIONS = {
  read: 'getApiKey',
  write: 'saveApiKey',
} as const;

/**
 * Retains the pre-1.0 credential messages for already-open extension pages.
 * New code reads settings directly and must not send these messages.
 */
export function handleDeprecatedClientCredentialMessage(
  message: unknown,
  sendResponse: (response: unknown) => void
): boolean {
  if (!isRecord(message)) return false;
  const action = message.action;

  if (action === DEPRECATED_CLIENT_CREDENTIAL_ACTIONS.read) {
    void readAiSettingsStorage().then((stored) => {
      const provider = readModelProvider(stored);
      sendResponse({ apiKey: readProviderApiKey(stored, provider) ?? null });
    });
    return true;
  }

  if (action === DEPRECATED_CLIENT_CREDENTIAL_ACTIONS.write) {
    void readAiSettingsStorage().then(async (stored) => {
      const provider = readModelProvider(stored);
      const key =
        provider === 'openai'
          ? AI_SETTINGS_STORAGE_KEYS.openaiApiKey
          : AI_SETTINGS_STORAGE_KEYS.anthropicApiKey;
      await chrome.storage.local.set({ [key]: readString(message.apiKey) ?? '' });
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
}

function copyIfMissing(
  stored: AiSettingsStorageSnapshot,
  updates: AiSettingsStorageSnapshot,
  key: string,
  value: string | undefined
): void {
  if (readString(stored[key]) === undefined && value !== undefined) {
    updates[key] = value;
  }
}

function replaceRetiredAnthropicModel(
  stored: AiSettingsStorageSnapshot,
  updates: AiSettingsStorageSnapshot,
  key: string
): void {
  const current = readString(stored[key]);
  const replacement = current && LEGACY_ANTHROPIC_MODEL_REPLACEMENTS[current];
  if (replacement) updates[key] = replacement;
}

function readCompatibleAnthropicModel(value: unknown): string | undefined {
  const model = readString(value);
  return model ? LEGACY_ANTHROPIC_MODEL_REPLACEMENTS[model] ?? model : undefined;
}

function inferLegacyModelProvider(
  stored: AiSettingsStorageSnapshot
): ModelProvider | undefined {
  const activeModels = [
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel]),
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]),
  ];
  if (activeModels.some((model) => model?.startsWith('claude-'))) return 'anthropic';
  if (
    activeModels.some(
      (model) =>
        model?.startsWith('gpt-') ||
        model?.startsWith('chatgpt-') ||
        /^o\d/.test(model ?? '')
    )
  ) {
    return 'openai';
  }
  if (
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]) ||
    readString(stored[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey])
  ) {
    return 'anthropic';
  }
  return undefined;
}

function isCredentialStorageKey(key: string): boolean {
  return (AI_CREDENTIAL_STORAGE_KEYS as readonly string[]).includes(key);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
