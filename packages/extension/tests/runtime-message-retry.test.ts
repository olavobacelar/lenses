/**
 * MV3 cold-start resilience for sidepanel → service-worker messaging: a reply
 * port lost while the worker spins up ("The message port closed…") is retried
 * once, and a persistent outage surfaces a human-readable message instead of
 * Chrome's internal port wording (which used to land verbatim in the warning
 * banner).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  isTransientWorkerError,
  sendRuntimeMessage,
} from "../src/sidepanel/lib/chrome.js";

type SendMessage = (message: unknown, callback: (response: unknown) => void) => void;

interface ChromeStub {
  runtime: { lastError?: { message: string }; sendMessage: SendMessage };
}

const globalWithChrome = globalThis as { chrome?: ChromeStub };

/** Installs a chrome stub whose sendMessage runs the scripted behaviors in
 *  order (repeating the last one), mimicking lastError's callback scoping. */
function stubChrome(...behaviors: Array<{ error?: string; response?: unknown }>) {
  let attempt = 0;
  const stub: ChromeStub = {
    runtime: {
      sendMessage: (_message, callback) => {
        const behavior = behaviors[Math.min(attempt, behaviors.length - 1)];
        attempt += 1;
        if (behavior.error) {
          stub.runtime.lastError = { message: behavior.error };
          callback(undefined);
          stub.runtime.lastError = undefined;
        } else {
          callback(behavior.response);
        }
      },
    },
  };
  globalWithChrome.chrome = stub;
  return { attempts: () => attempt };
}

afterEach(() => {
  delete globalWithChrome.chrome;
});

const PORT_CLOSED = "The message port closed before a response was received.";

describe("sendRuntimeMessage cold-worker retry", () => {
  it("retries once when the reply port closes and returns the retried response", async () => {
    const stub = stubChrome({ error: PORT_CLOSED }, { response: { ok: true } });
    await expect(sendRuntimeMessage({ type: "ping" })).resolves.toEqual({ ok: true });
    expect(stub.attempts()).toBe(2);
  });

  it("also treats a missing runtime receiver as transient", async () => {
    const stub = stubChrome(
      { error: "Could not establish connection. Receiving end does not exist." },
      { response: { ok: true } }
    );
    await expect(sendRuntimeMessage({ type: "ping" })).resolves.toEqual({ ok: true });
    expect(stub.attempts()).toBe(2);
  });

  it("does not retry real errors", async () => {
    const stub = stubChrome({ error: "Run failed: model unavailable" });
    await expect(sendRuntimeMessage({ type: "run" })).rejects.toThrow(
      "Run failed: model unavailable"
    );
    expect(stub.attempts()).toBe(1);
  });

  it("maps a persistent transient failure to a human-readable message", async () => {
    const stub = stubChrome({ error: PORT_CLOSED });
    await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow(
      "Lenses couldn't reach its background service. Try again in a moment."
    );
    expect(stub.attempts()).toBe(2);
  });

  it("keeps a non-transient retry failure's own message", async () => {
    const stub = stubChrome({ error: PORT_CLOSED }, { error: "Quota exceeded" });
    await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow("Quota exceeded");
    expect(stub.attempts()).toBe(2);
  });
});

describe("isTransientWorkerError", () => {
  it("matches only the cold-worker signatures", () => {
    expect(isTransientWorkerError(new Error(PORT_CLOSED))).toBe(true);
    expect(
      isTransientWorkerError(new Error("Could not establish connection. Receiving end does not exist."))
    ).toBe(true);
    expect(isTransientWorkerError(new Error("Extension context invalidated."))).toBe(false);
    expect(isTransientWorkerError("not an error")).toBe(false);
  });
});
