export type ModelProvider = "anthropic" | "openai";

export const DEFAULT_MODEL_PROVIDER: ModelProvider = "openai";

export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5.6-terra" as const;
export const DEFAULT_OPENAI_EXECUTION_MODEL = "gpt-5.6-luna" as const;
export const DEFAULT_OPENAI_TEST_MODEL = "gpt-5.4-mini" as const;

export const DEFAULT_ANTHROPIC_CHAT_MODEL = "claude-haiku-4-5-20251001" as const;
export const DEFAULT_ANTHROPIC_EXECUTION_MODEL = "claude-haiku-4-5-20251001" as const;
export const DEFAULT_ANTHROPIC_TEST_MODEL = "claude-haiku-4-5-20251001" as const;
