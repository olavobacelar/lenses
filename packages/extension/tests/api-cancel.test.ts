import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Either } from "effect";
import { makeApiCall, makeJsonApiCall } from "../src/background/api/claude-client";
import { makeOpenAIApiCall, makeOpenAIJsonApiCall } from "../src/background/api/openai-client";
import {
  ApiAbortedError,
  ApiParseError,
  ApiRequestError,
  isAbortError,
} from "../src/background/types";

const baseClaudeOptions = {
  apiKey: "test-key",
  model: "claude-sonnet-5" as const,
  maxTokens: 100,
  system: "",
  messages: [],
};

const baseOpenAiOptions = {
  apiKey: "test-key",
  model: "gpt-5" as never,
  maxTokens: 100,
  system: "",
  messages: [],
};

function makeAbortError(): Error {
  const err = new Error("The operation was aborted.");
  (err as Error & { name: string }).name = "AbortError";
  return err;
}

describe("isAbortError", () => {
  it("recognises DOMException-shaped abort errors", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(makeAbortError())).toBe(true);
  });

  it("rejects anything that isn't an abort", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError({ name: "TypeError" })).toBe(false);
    expect(isAbortError(new Error("network failure"))).toBe(false);
  });
});

describe("makeApiCall (Claude) — cancellation plumbing", () => {
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

  it("forwards the AbortSignal to fetch and surfaces ApiAbortedError without retrying", async () => {
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ signal: init?.signal });
      throw makeAbortError();
    }) as unknown as typeof globalThis.fetch;

    const controller = new AbortController();
    controller.abort();

    const result = await Effect.runPromise(
      Effect.either(makeApiCall({ ...baseClaudeOptions, signal: controller.signal }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiAbortedError);
    }

    // Critical: no retry storm. One aborted call → one fetch attempt, not three.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.signal).toBe(controller.signal);
  });

  it("still treats network errors as retryable ApiRequestError (regression guard)", async () => {
    let attempt = 0;
    globalThis.fetch = vi.fn(async () => {
      attempt++;
      // Non-abort failure — should be wrapped as ApiRequestError, but
      // status:0 isn't in the retryable list, so it shouldn't retry either.
      throw new TypeError("connection refused");
    }) as unknown as typeof globalThis.fetch;

    const result = await Effect.runPromise(
      Effect.either(makeApiCall({ ...baseClaudeOptions }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiRequestError);
      expect(result.left).not.toBeInstanceOf(ApiAbortedError);
    }
    expect(attempt).toBe(1);
  });

  it("converts abort during response body read into ApiAbortedError (not ApiParseError)", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            // Simulate an abort happening while we're consuming the body.
            controller.error(makeAbortError());
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await Effect.runPromise(
      Effect.either(makeJsonApiCall({ ...baseClaudeOptions }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiAbortedError);
      expect(result.left).not.toBeInstanceOf(ApiParseError);
    }
  });
});

describe("makeOpenAIApiCall — cancellation plumbing", () => {
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

  it("forwards the AbortSignal to fetch and surfaces ApiAbortedError without retrying", async () => {
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ signal: init?.signal });
      throw makeAbortError();
    }) as unknown as typeof globalThis.fetch;

    const controller = new AbortController();
    controller.abort();

    const result = await Effect.runPromise(
      Effect.either(makeOpenAIApiCall({ ...baseOpenAiOptions, signal: controller.signal }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiAbortedError);
    }
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.signal).toBe(controller.signal);
  });

  it("converts abort during response body read into ApiAbortedError (not ApiParseError)", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(makeAbortError());
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await Effect.runPromise(
      Effect.either(makeOpenAIJsonApiCall({ ...baseOpenAiOptions }))
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiAbortedError);
      expect(result.left).not.toBeInstanceOf(ApiParseError);
    }
  });
});
