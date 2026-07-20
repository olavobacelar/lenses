import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  type ModelProvider,
} from '@lenses/shared';
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  VALID_CLAUDE_MODELS,
  isClaudeModel,
  validateClaudeModel,
  type ClaudeModel,
} from './claude';

export {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
};
export type { ModelProvider };

export type OpenAIModel =
  | 'gpt-5.4-mini'
  | 'gpt-5.6-sol'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-luna';

export type AiModel = ClaudeModel | OpenAIModel;

export const VALID_OPENAI_MODELS: OpenAIModel[] = [
  'gpt-5.4-mini',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
];

/** Whether an OpenAI model accepts a `reasoning.effort` parameter. */
export function supportsOpenAIReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('gpt-5') ||
    normalized.startsWith('chatgpt-') ||
    /^o\d/.test(normalized);
}

export function isModelProvider(value: string | undefined): value is ModelProvider {
  return value === 'anthropic' || value === 'openai';
}

export function isOpenAIModel(value: string | undefined): value is OpenAIModel {
  return VALID_OPENAI_MODELS.includes(value as OpenAIModel);
}

export function validateProvider(value: string | undefined): ModelProvider {
  return isModelProvider(value) ? value : DEFAULT_MODEL_PROVIDER;
}

export function defaultChatModelForProvider(provider: ModelProvider): AiModel {
  return provider === 'openai' ? DEFAULT_OPENAI_CHAT_MODEL : DEFAULT_ANTHROPIC_CHAT_MODEL;
}

export function defaultExecutionModelForProvider(provider: ModelProvider): AiModel {
  return provider === 'openai'
    ? DEFAULT_OPENAI_EXECUTION_MODEL
    : DEFAULT_ANTHROPIC_EXECUTION_MODEL;
}

export function validModelsForProvider(provider: ModelProvider): AiModel[] {
  return provider === 'openai' ? VALID_OPENAI_MODELS : VALID_CLAUDE_MODELS;
}

export function validateModelForProvider(
  model: string | undefined,
  provider: ModelProvider,
  fallback = defaultChatModelForProvider(provider)
): AiModel {
  if (provider === 'openai') {
    return isOpenAIModel(model) ? model : fallback;
  }
  return isClaudeModel(model) ? model : validateClaudeModel(model, fallback as ClaudeModel);
}
