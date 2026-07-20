/**
 * Claims Extraction Effects
 *
 * Effect-wrapped claim extraction from transcripts.
 */

import { Effect } from 'effect';
import { getApiKey, getSettings } from './storage';
import { makeJsonAiCall } from '../api/ai-client';
import {
  buildAllClaimsExtractionPrompt,
  buildChunkClaimsExtractionPrompt,
  buildSegmentClaimExtractionPrompt,
} from '../prompts/claims';
import { ALL_CLAIMS_JSON_SCHEMA, SEGMENT_CLAIMS_JSON_SCHEMA } from '../../schemas/claims';

/**
 * Extract all claims from a full transcript
 */
export const extractAllClaimsEffect = (transcriptText: string, videoTitle: string) =>
  Effect.gen(function* () {
    const apiKey = yield* getApiKey;
    const { provider, executionModel } = yield* getSettings;

    const systemPrompt = buildAllClaimsExtractionPrompt(transcriptText, videoTitle);

    const result = yield* makeJsonAiCall<{ content: Array<{ text: string }> }>({
      provider,
      apiKey,
      model: executionModel,
      maxTokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Extract all verifiable claims from this transcript.' }],
      outputFormat: ALL_CLAIMS_JSON_SCHEMA,
    });

    const jsonText = result.content?.[0]?.text || '{"claims":[]}';
    const parsed = JSON.parse(jsonText);
    return parsed.claims || [];
  });

/**
 * Extract claims from a single transcript chunk
 */
export const extractChunkClaimsEffect = (
  chunkText: string,
  startTime: string,
  endTime: string,
  videoTitle: string,
  previousClaims: string[]
) =>
  Effect.gen(function* () {
    const apiKey = yield* getApiKey;
    const { provider, executionModel } = yield* getSettings;

    const systemPrompt = buildChunkClaimsExtractionPrompt(
      chunkText,
      startTime,
      endTime,
      videoTitle,
      previousClaims
    );

    const result = yield* makeJsonAiCall<{ content: Array<{ text: string }> }>({
      provider,
      apiKey,
      model: executionModel,
      maxTokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Extract all verifiable claims from this chunk.' }],
      outputFormat: ALL_CLAIMS_JSON_SCHEMA,
    });

    const jsonText = result.content?.[0]?.text || '{"claims":[]}';
    const parsed = JSON.parse(jsonText);
    return { claims: parsed.claims || [], rawResponse: jsonText };
  });

/**
 * Extract claims from a segment around current time
 */
export const extractSegmentClaimsEffect = (
  transcriptSegment: string,
  currentTime: string,
  startTime: string,
  endTime: string
) =>
  Effect.gen(function* () {
    const apiKey = yield* getApiKey;
    const { provider, executionModel } = yield* getSettings;

    const systemPrompt = buildSegmentClaimExtractionPrompt(
      transcriptSegment,
      currentTime,
      startTime,
      endTime
    );

    const result = yield* makeJsonAiCall<{ content: Array<{ text: string }> }>({
      provider,
      apiKey,
      model: executionModel,
      maxTokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Extract claims from this transcript segment.' }],
      outputFormat: SEGMENT_CLAIMS_JSON_SCHEMA,
    });

    return result.content?.[0]?.text || '{"claims":[]}';
  });
