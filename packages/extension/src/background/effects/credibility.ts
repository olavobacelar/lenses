/**
 * Credibility Rating Effect
 *
 * Effect-wrapped credibility rating extraction.
 */

import { Effect } from 'effect';
import type { ConversationMessage } from '../../types/ai-content';
import { getApiKey, getSettings } from './storage';
import { makeJsonAiCall } from '../api/ai-client';
import { CREDIBILITY_RATING_JSON_SCHEMA } from '../../schemas/claims';

/**
 * Get credibility rating based on conversation history
 */
export const getCredibilityRatingEffect = (
  conversationHistory: ConversationMessage[]
) =>
  Effect.gen(function* () {
    const apiKey = yield* getApiKey;
    const { provider, executionModel } = yield* getSettings;

    const systemPrompt = `You are evaluating the credibility of a claim verification.

Based on the conversation above where a claim was verified, determine the credibility rating:
- high: Multiple reliable sources confirm the claim, evidence is strong
- medium: Some supporting evidence but incomplete, sources conflict, or claim is partially true
- low: No credible sources support the claim, claim is misleading or false

Respond with only the rating.`;

    const messages: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content: 'Based on your verification analysis above, what is the credibility rating?' },
    ];

    const result = yield* makeJsonAiCall<{ content: Array<{ text: string }> }>({
      provider,
      apiKey,
      model: executionModel,
      maxTokens: 100,
      system: systemPrompt,
      messages,
      outputFormat: CREDIBILITY_RATING_JSON_SCHEMA,
    });

    const jsonText = result.content?.[0]?.text || '{"rating":"medium"}';
    const parsed = JSON.parse(jsonText);
    return parsed.rating as 'low' | 'medium' | 'high';
  });
