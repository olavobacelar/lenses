import { describe, expect, it } from 'vitest';
import {
  AI_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE,
  AI_SETTINGS_MIGRATION_VERSION,
  AI_SETTINGS_STORAGE_KEYS,
  LEGACY_ANTHROPIC_MODEL_REPLACEMENTS,
  LEGACY_AI_SETTINGS_STORAGE_KEYS,
  migrateLegacyAiSettingsRecord,
  readAiSettingsStorage,
  readProviderApiKey,
  readProviderChatModel,
  readProviderExecutionModel,
} from '../src/lib/ai-settings-compat';

function memoryStorage(initial: Record<string, unknown>) {
  const data = { ...initial };
  const area = {
    async get(keys: string[]) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values: Record<string, unknown>) {
      Object.assign(data, values);
    },
    async remove(keys: string[]) {
      for (const key of keys) delete data[key];
    },
  } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
  return { area, data };
}

describe('AI settings compatibility', () => {
  it('has an explicit, versioned removal milestone', () => {
    expect(AI_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE).toBe('2.0.0');
    expect(AI_SETTINGS_MIGRATION_VERSION).toBe(1);
  });

  it('keeps current provider settings unchanged', () => {
    const current = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'anthropic',
      [AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: 'current-key',
      [AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: 'claude-opus-4-8',
      [AI_SETTINGS_STORAGE_KEYS.anthropicExecutionModel]: 'claude-sonnet-5',
      [AI_SETTINGS_STORAGE_KEYS.migrationVersion]: AI_SETTINGS_MIGRATION_VERSION,
    };

    const { snapshot, updates } = migrateLegacyAiSettingsRecord(current);

    expect(updates).toEqual({});
    expect(readProviderApiKey(snapshot, 'anthropic')).toBe('current-key');
    expect(readProviderChatModel(snapshot, 'anthropic')).toBe('claude-opus-4-8');
    expect(readProviderExecutionModel(snapshot, 'anthropic')).toBe('claude-sonnet-5');
  });

  it('never overwrites current values while completing a migration', () => {
    const current = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'openai',
      [AI_SETTINGS_STORAGE_KEYS.openaiChatModel]: 'gpt-5.6-sol',
      [AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]: 'gpt-5.6-luna',
    };

    const { snapshot } = migrateLegacyAiSettingsRecord(current);

    expect(readProviderChatModel(snapshot, 'openai')).toBe('gpt-5.6-sol');
    expect(readProviderExecutionModel(snapshot, 'openai')).toBe('gpt-5.6-luna');
    expect(snapshot[AI_SETTINGS_STORAGE_KEYS.migrationVersion]).toBe(
      AI_SETTINGS_MIGRATION_VERSION
    );
  });

  it('preserves Anthropic credentials and model choices from pre-migration storage', () => {
    const legacy = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'anthropic',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: 'preserved-key',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: 'claude-opus-4-8',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]: 'claude-sonnet-5',
    };

    const { snapshot, updates } = migrateLegacyAiSettingsRecord(legacy);

    expect(readProviderApiKey(snapshot, 'anthropic')).toBe('preserved-key');
    expect(readProviderChatModel(snapshot, 'anthropic')).toBe('claude-opus-4-8');
    expect(readProviderExecutionModel(snapshot, 'anthropic')).toBe('claude-sonnet-5');
    expect(updates[AI_SETTINGS_STORAGE_KEYS.migrationVersion]).toBe(
      AI_SETTINGS_MIGRATION_VERSION
    );
  });

  it('infers Anthropic for providerless settings written before provider selection existed', () => {
    const legacy = {
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel]: 'claude-opus-4-8',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]: 'claude-sonnet-5',
    };

    const { snapshot, updates } = migrateLegacyAiSettingsRecord(legacy);

    expect(updates[AI_SETTINGS_STORAGE_KEYS.provider]).toBe('anthropic');
    expect(readProviderChatModel(snapshot, 'anthropic')).toBe('claude-opus-4-8');
    expect(readProviderExecutionModel(snapshot, 'anthropic')).toBe('claude-sonnet-5');
  });

  it('preserves the OpenAI execution choice from pre-migration storage', () => {
    const legacy = {
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'openai',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.activeChatModel]: 'gpt-5.6-sol',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]: 'gpt-5.6-luna',
    };

    const { snapshot } = migrateLegacyAiSettingsRecord(legacy);

    expect(readProviderChatModel(snapshot, 'openai')).toBe('gpt-5.6-sol');
    expect(readProviderExecutionModel(snapshot, 'openai')).toBe('gpt-5.6-luna');
  });

  it('moves retired Anthropic choices into the current model vocabulary', () => {
    const [retiredModel] = Object.keys(LEGACY_ANTHROPIC_MODEL_REPLACEMENTS);
    const replacement = LEGACY_ANTHROPIC_MODEL_REPLACEMENTS[retiredModel];
    const { snapshot, updates } = migrateLegacyAiSettingsRecord({
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'anthropic',
      [AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: retiredModel,
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.activeExecutionModel]: retiredModel,
    });

    expect(updates[AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]).toBe(replacement);
    expect(readProviderChatModel(snapshot, 'anthropic')).toBe(replacement);
    expect(readProviderExecutionModel(snapshot, 'anthropic')).toBe(replacement);
  });

  it('moves synced credentials to device-local storage before removing them', async () => {
    const sync = memoryStorage({
      [AI_SETTINGS_STORAGE_KEYS.provider]: 'openai',
      [AI_SETTINGS_STORAGE_KEYS.openaiApiKey]: 'sync-openai-secret',
      [LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: 'sync-anthropic-secret',
    });
    const local = memoryStorage({});

    const snapshot = await readAiSettingsStorage(sync.area, local.area);

    expect(local.data[AI_SETTINGS_STORAGE_KEYS.openaiApiKey]).toBe('sync-openai-secret');
    expect(local.data[AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]).toBe(
      'sync-anthropic-secret'
    );
    expect(sync.data[AI_SETTINGS_STORAGE_KEYS.openaiApiKey]).toBeUndefined();
    expect(sync.data[LEGACY_AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]).toBeUndefined();
    expect(readProviderApiKey(snapshot, 'openai')).toBe('sync-openai-secret');
    expect(readProviderApiKey(snapshot, 'anthropic')).toBe('sync-anthropic-secret');
  });

  it('keeps an existing local credential when cleaning a stale synced copy', async () => {
    const sync = memoryStorage({
      [AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: 'stale-synced-secret',
    });
    const local = memoryStorage({
      [AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: 'current-local-secret',
    });

    const snapshot = await readAiSettingsStorage(sync.area, local.area);

    expect(local.data[AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]).toBe(
      'current-local-secret'
    );
    expect(sync.data[AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]).toBeUndefined();
    expect(readProviderApiKey(snapshot, 'anthropic')).toBe('current-local-secret');
  });
});
