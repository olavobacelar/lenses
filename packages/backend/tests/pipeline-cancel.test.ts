import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Either } from "effect";
import {
  callClaude,
  callOpenAI,
  LLMAbortedError,
  LLMCallError,
} from "../src/findings/pipeline.js";

/** Provider aborts must remain distinct from network or API failures. */

function makeAbortError(): Error {
  const err = new Error("The operation was aborted.");
  (err as Error & { name: string }).name = "AbortError";
  return err;
}

describe("callOpenAI — abort handling", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: Array<{ signal?: AbortSignal | null }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("forwards the AbortSignal to fetch and surfaces LLMAbortedError on abort", async () => {
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      fetchCalls.push({ signal: init?.signal });
      throw makeAbortError();
    }) as unknown as typeof globalThis.fetch;

    const controller = new AbortController();
    controller.abort();

    const result = await Effect.runPromise(
      Effect.either(callOpenAI("prompt", "key", "gpt-5", { signal: controller.signal }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LLMAbortedError);
      // Critical: the abort must NOT come back as a generic LLMCallError,
      // because the action layer special-cases LLMAbortedError to mean
      // "user clicked cancel" rather than "API failure".
      expect(result.left).not.toBeInstanceOf(LLMCallError);
    }
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.signal).toBe(controller.signal);
  });

  it("surfaces non-abort errors as LLMCallError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof globalThis.fetch;

    const result = await Effect.runPromise(
      Effect.either(callOpenAI("prompt", "key", "gpt-5"))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LLMCallError);
      expect(result.left).not.toBeInstanceOf(LLMAbortedError);
    }
  });
});

describe("callClaude — abort handling via the Anthropic SDK", () => {
  // The Anthropic SDK ultimately calls fetch under the hood, but it does its
  // own bookkeeping first. We can't easily mock the SDK without bringing it
  // in as a test dep, so instead we mock the underlying fetch and assert
  // that *any* abort-shaped error coming out gets tagged as LLMAbortedError.

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("classifies a thrown AbortError as LLMAbortedError, not LLMCallError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw makeAbortError();
    }) as unknown as typeof globalThis.fetch;

    const controller = new AbortController();
    controller.abort();

    const result = await Effect.runPromise(
      Effect.either(
        callClaude("prompt", "sk-ant-test", "claude-sonnet-5", {
          signal: controller.signal,
        })
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      // The SDK might wrap the abort in an APIUserAbortError or similar; in
      // both cases the name should still be "AbortError" by the time it
      // surfaces, which is what isAbortError catches.
      expect(result.left).toBeInstanceOf(LLMAbortedError);
    }
  });
});
