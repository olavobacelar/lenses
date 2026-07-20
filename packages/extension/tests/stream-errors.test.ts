import { describe, expect, it } from "vitest";
import { formatStreamingApiError } from "../src/background/stream-errors.js";

describe("formatStreamingApiError", () => {
  it("does not surface Cloudflare HTML/error bodies to the chat UI", () => {
    expect(
      formatStreamingApiError({
        status: 502,
        contentType: "text/html",
        bodyText:
          '<!doctype html><html><body><span>Performance &amp; security by</span><script>Cloudflare</script></body></html>',
      })
    ).toBe(
      "Chat failed because the AI service returned a temporary upstream error. Try again or choose another model."
    );

    expect(
      formatStreamingApiError({
        status: 502,
        contentType: "text/plain",
        bodyText: "error code: 502",
      })
    ).toBe(
      "Chat failed because the AI service returned a temporary upstream error. Try again or choose another model."
    );
  });

  it("keeps useful JSON provider errors", () => {
    expect(
      formatStreamingApiError({
        status: 400,
        contentType: "application/json",
        bodyText: JSON.stringify({
          error: "Anthropic API error (400): model does not support thinking",
        }),
      })
    ).toBe("Anthropic API error (400): model does not support thinking");
  });

  it("turns provider auth failures into an API-key action message", () => {
    expect(
      formatStreamingApiError({
        status: 401,
        contentType: "application/json",
        bodyText: JSON.stringify({ error: "invalid api key" }),
      })
    ).toContain("API key");
  });
});
