/**
 * Chrome Storage Effects
 *
 * Effect-wrapped access to Chrome storage APIs.
 */

import { Effect } from 'effect';
import {
  readAiSettingsStorage,
  readModelProvider,
  readProviderApiKey,
} from '../../lib/ai-settings-compat';
import {
  readStoredAiModelSettings,
  resolveStoredAiModelSettings,
  type StoredAiModelSettings,
} from '../../lib/model-settings';
import type { VideoMetadata } from '../../types/transcript';
import { ApiKeyNotConfiguredError } from '../types';

/**
 * Get the API key from Chrome storage
 */
export const getApiKey = Effect.async<string, ApiKeyNotConfiguredError>((resume) => {
  void readAiSettingsStorage()
    .then((result) => {
      const provider = readModelProvider(result);
      const apiKey = readProviderApiKey(result, provider);
      if (apiKey?.trim()) {
        resume(Effect.succeed(apiKey.trim()));
      } else {
        resume(Effect.fail(new ApiKeyNotConfiguredError()));
      }
    })
    .catch(() => resume(Effect.fail(new ApiKeyNotConfiguredError())));
});

/**
 * Get model settings from Chrome storage
 */
export const getSettings = Effect.async<StoredAiModelSettings, never>((resume) => {
  void readStoredAiModelSettings()
    .then((settings) => resume(Effect.succeed(settings)))
    .catch(() => resume(Effect.succeed(resolveStoredAiModelSettings({}, undefined))));
});

/**
 * Get session metadata from Chrome storage
 */
export const getSessionMetadata = Effect.async<VideoMetadata | null, never>((resume) => {
  chrome.storage.session.get<{ metadata?: VideoMetadata }>(['metadata'], (result) => {
    resume(Effect.succeed(result.metadata || null));
  });
});
