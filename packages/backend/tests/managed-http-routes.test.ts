import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicHttpAction } from "convex/server";
import http from "../convex/http.js";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "managed-anthropic-test-key");
  vi.stubEnv("OPENAI_API_KEY", "managed-openai-test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function managedNamingRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://example.test/managed/generate-lens-name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "Name this Lens",
      provider: "openai",
      model: "gpt-5.6-luna",
      ...overrides,
    }),
  });
}

function managedNamingHandler(): PublicHttpAction["_handler"] {
  const match = http.lookup("/managed/generate-lens-name", "POST");
  if (!match) throw new Error("Managed naming route is not registered");
  return match[0]._handler;
}

function actionContext(actionResult: unknown = "Suggested Lens") {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(async () => actionResult),
  };
}

describe("managed HTTP route enforcement", () => {
  it("dispatches without an access code or grant header", async () => {
    const ctx = actionContext("Evidence Mapper");

    const response = await managedNamingHandler()(ctx as never, managedNamingRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "success",
      value: "Evidence Mapper",
    });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runAction).toHaveBeenCalledOnce();
    expect(ctx.runAction.mock.calls[0]?.[1]).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
  });

  it("accepts a supported Anthropic model", async () => {
    const ctx = actionContext();
    const response = await managedNamingHandler()(
      ctx as never,
      managedNamingRequest({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
      })
    );

    expect(response.status).toBe(200);
    expect(ctx.runAction.mock.calls[0]?.[1]).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("rejects a malformed provider instead of silently switching providers", async () => {
    const ctx = actionContext();
    const response = await managedNamingHandler()(
      ctx as never,
      managedNamingRequest({ provider: "opneai" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported managed provider" });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("rejects a provider-model mismatch", async () => {
    const ctx = actionContext();
    const response = await managedNamingHandler()(
      ctx as never,
      managedNamingRequest({ provider: "anthropic", model: "gpt-5.6-luna" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported managed model" });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
