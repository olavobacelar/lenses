import type { ModelProvider } from '../../types/ai-models';
import type { ReasoningEffort } from '../../lib/reasoning-settings';
import { makeJsonApiCall, type ApiCallOptions } from './claude-client';
import { makeOpenAIJsonApiCall } from './openai-client';

export type AiCallOptions = ApiCallOptions & {
  provider: ModelProvider;
  reasoningEffort?: ReasoningEffort;
};

export const makeJsonAiCall = <T>(options: Omit<AiCallOptions, 'stream'>) => {
  if (options.provider === 'openai') {
    return makeOpenAIJsonApiCall<T>(options);
  }

  return makeJsonApiCall<T>(options);
};
