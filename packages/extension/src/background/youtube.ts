import { Effect } from "effect";
import {
  type ClaudeModel,
} from "../types/claude";
import type { ConversationMessage } from "../types/ai-content";
import type { VideoTime } from "../types/transcript";
import {
  getStreamingErrorMessage,
  makePortCallbacks,
  streamClaudeAPIEffect,
  streamOpenAIAPIEffect,
} from "./assistant-streaming";
import {
  extractAllClaimsEffect,
  extractChunkClaimsEffect,
  extractSegmentClaimsEffect,
} from "./effects/claims";
import { getCredibilityRatingEffect } from "./effects/credibility";
import { getApiKey, getSessionMetadata, getSettings } from "./effects/storage";
import { buildSystemPrompt } from "./prompts/system";
import { extractTranscriptFunction } from "./transcript-extractor";
import { streamSourceChatViaManagedService } from "./managed-chat-stream";
import { isLocalByokMode, readAppAccessMode } from "../lib/app-mode";
import { readStoredModelSettings } from "../lib/model-settings";
import {
  ScriptInjectionError,
  TranscriptNotAvailableError,
} from "./types";

export function setupYouTubeHandlers(): void {
  setupYouTubeMessageHandlers();
  setupYouTubeStreamingHandlers();
}

function setupYouTubeMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("action" in message)) {
      return undefined;
    }

    const action = String((message as { action: unknown }).action);

    switch (action) {
      case "transcriptLoaded":
        console.log("[Lenses] Transcript loaded", {
          videoId: (message as { videoId?: string }).videoId,
          segmentCount: (message as { segmentCount?: number }).segmentCount,
        });
        break;

      case "timeUpdate":
        chrome.storage.session.set({ currentTime: (message as { time?: unknown }).time });
        break;

      case "extractTranscript":
        if (sender.tab?.id) {
          extractTranscriptInMainWorld(sender.tab.id)
            .then(sendResponse)
            .catch((error) =>
              sendResponse({ error: error instanceof Error ? error.message : String(error) })
            );
        } else {
          sendResponse({ error: "No tab ID" });
        }
        return true;

      default:
        return undefined;
    }

    return undefined;
  });
}

function setupYouTubeStreamingHandlers(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "claude-stream") return;

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") return;

      const action = String((message as { action?: unknown }).action ?? "");

      if (action === "getCredibilityRating") {
        Effect.runPromise(
          getCredibilityRatingEffect((message as { conversationHistory?: ConversationMessage[] }).conversationHistory ?? []).pipe(
            Effect.tap((rating) =>
              Effect.sync(() => {
                port.postMessage({ type: "credibilityRatingDone", rating });
              })
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                port.postMessage({
                  type: "credibilityRatingError",
                  error: getStreamingErrorMessage(error),
                });
              })
            )
          )
        );
        return;
      }

      if (action === "extractAllClaims") {
        const request = message as { transcriptText?: string; videoTitle?: string };
        Effect.runPromise(
          extractAllClaimsEffect(request.transcriptText ?? "", request.videoTitle ?? "").pipe(
            Effect.tap((claims) =>
              Effect.sync(() => {
                port.postMessage({ type: "allClaimsDone", claims });
              })
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                port.postMessage({ type: "allClaimsError", error: getStreamingErrorMessage(error) });
              })
            )
          )
        );
        return;
      }

      if (action === "extractChunkClaims") {
        const request = message as {
          chunkText?: string;
          startTime?: string;
          endTime?: string;
          videoTitle?: string;
          previousClaims?: string[];
        };
        Effect.runPromise(
          extractChunkClaimsEffect(
            request.chunkText ?? "",
            request.startTime ?? "",
            request.endTime ?? "",
            request.videoTitle ?? "",
            request.previousClaims ?? []
          ).pipe(
            Effect.tap(({ claims, rawResponse }) =>
              Effect.sync(() => {
                port.postMessage({ type: "chunkClaimsDone", claims, rawResponse });
              })
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                port.postMessage({
                  type: "chunkClaimsError",
                  error: getStreamingErrorMessage(error),
                });
              })
            )
          )
        );
        return;
      }

      if (action === "extractClaims") {
        const request = message as {
          transcriptSegment?: string;
          currentTime?: string;
          startTime?: string;
          endTime?: string;
        };
        Effect.runPromise(
          extractSegmentClaimsEffect(
            request.transcriptSegment ?? "",
            request.currentTime ?? "",
            request.startTime ?? "",
            request.endTime ?? ""
          ).pipe(
            Effect.tap((jsonText) =>
              Effect.sync(() => {
                port.postMessage({ type: "done", fullText: jsonText });
              })
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                port.postMessage({ type: "error", error: getStreamingErrorMessage(error) });
              })
            )
          )
        );
        return;
      }

      if (action === "askClaudeStream") {
        streamYouTubeOverPort(port, message as {
          question?: string;
          transcript?: unknown;
          currentTime?: VideoTime | null;
          conversationHistory?: ConversationMessage[];
          screenshots?: string[];
        });
      }
    });
  });
}

const extractTranscriptEffect = (tabId: number) =>
  Effect.tryPromise({
    try: async () => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: extractTranscriptFunction,
      });
      return { success: true };
    },
    catch: (error) => new ScriptInjectionError({ message: (error as Error).message }),
  });

function extractTranscriptInMainWorld(
  tabId: number
): Promise<{ success?: boolean; error?: string }> {
  return Effect.runPromise(
    extractTranscriptEffect(tabId).pipe(
      Effect.catchTag("ScriptInjectionError", (error) => Effect.succeed({ error: error.message }))
    )
  );
}

/** Flatten transcript segments into timestamped lines for the source payload. */
function formatTranscriptForSource(transcript: unknown): string {
  if (!Array.isArray(transcript)) return "";
  return transcript
    .map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      const record = segment as { formatted?: unknown; text?: unknown };
      const stamp = typeof record.formatted === "string" ? record.formatted : "";
      const text = typeof record.text === "string" ? record.text : "";
      if (!text) return "";
      return stamp ? `[${stamp}] ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function streamYouTubeOverPort(
  port: chrome.runtime.Port,
  request: {
    question?: string;
    transcript?: unknown;
    currentTime?: VideoTime | null;
    conversationHistory?: ConversationMessage[];
    screenshots?: string[];
  }
): void {
  void routeYouTubeStream(port, request);
}

async function routeYouTubeStream(
  port: chrome.runtime.Port,
  request: {
    question?: string;
    transcript?: unknown;
    currentTime?: VideoTime | null;
    conversationHistory?: ConversationMessage[];
    screenshots?: string[];
  }
): Promise<void> {
  // Parity routing: managed mode streams the transcript as a source through the
  // same Convex pipeline as the other surfaces; BYOK keeps direct streaming.
  const mode = await readAppAccessMode();
  if (!isLocalByokMode(mode)) {
    if (!request.transcript) {
      port.postMessage({ type: "error", error: "No transcript available for this video." });
      return;
    }
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    const { provider, model, reasoningEffort } = await readStoredModelSettings("chat");
    const metadata = await Effect.runPromise(getSessionMetadata);
    const transcriptText = formatTranscriptForSource(request.transcript);
    const question = request.currentTime?.formatted
      ? `[Currently at ${request.currentTime.formatted} / ${request.currentTime.durationFormatted || "?"}] ${request.question ?? ""}`
      : request.question ?? "";
    await streamSourceChatViaManagedService(
      port,
      {
        question,
        source: {
          kind: "youtube_video",
          title: metadata?.title,
          text: transcriptText,
          scope: "transcript",
        },
        conversation: request.conversationHistory ?? [],
      },
      { provider, model, reasoningEffort },
      controller.signal
    );
    return;
  }

  Effect.runPromise(
    Effect.gen(function* () {
      const apiKey = yield* getApiKey;
      const { provider, chatModel, reasoningEffort } = yield* getSettings;
      const metadata = yield* getSessionMetadata;
      const transcript = request.transcript;

      if (!transcript) {
        return yield* Effect.fail(new TranscriptNotAvailableError());
      }

      const systemPrompt = buildSystemPrompt(metadata, transcript as never);
      const callbacks = makePortCallbacks(port);
      let fullResponse: string;
      if (provider === "openai") {
        fullResponse = yield* streamOpenAIAPIEffect(
          apiKey,
          systemPrompt,
          request.question ?? "",
          request.conversationHistory ?? [],
          request.screenshots ?? [],
          request.currentTime ?? null,
          callbacks,
          chatModel,
          reasoningEffort
        );
      } else {
        fullResponse = yield* streamClaudeAPIEffect(
          apiKey,
          systemPrompt,
          request.question ?? "",
          request.conversationHistory ?? [],
          request.screenshots ?? [],
          request.currentTime ?? null,
          callbacks,
          chatModel as ClaudeModel,
          reasoningEffort
        );
      }

      port.postMessage({ type: "done", fullText: fullResponse });
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          port.postMessage({ type: "error", error: getStreamingErrorMessage(error) });
        })
      )
    )
  );
}
