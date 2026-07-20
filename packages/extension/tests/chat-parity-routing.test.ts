import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConvexSiteBaseUrl } from "../src/lib/convex-url.js";
import { streamSourceChatViaManagedService } from "../src/background/managed-chat-stream.js";

const here = dirname(fileURLToPath(import.meta.url));
const extSrc = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(extSrc, ...parts), "utf-8");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getConvexSiteBaseUrl", () => {
  it("maps a convex.cloud API url to the convex.site action origin", () => {
    expect(getConvexSiteBaseUrl("https://abc-123.convex.cloud")).toBe("https://abc-123.convex.site");
  });

  it("strips path, query, and hash", () => {
    expect(getConvexSiteBaseUrl("https://abc-123.convex.cloud/api?x=1#y")).toBe(
      "https://abc-123.convex.site"
    );
  });

  it("leaves non-convex.cloud hosts as a clean origin", () => {
    expect(getConvexSiteBaseUrl("https://self-hosted.example.com/convex")).toBe(
      "https://self-hosted.example.com"
    );
  });
});

describe("both sidebar chat handlers route by access mode (parity)", () => {
  const sourceStream = read("background", "source-stream.ts");
  const youtube = read("background", "youtube.ts");

  it("the page chat handler picks the managed service in managed mode and direct streaming in BYOK", () => {
    expect(sourceStream).toContain("readAppAccessMode");
    expect(sourceStream).toContain("isLocalByokMode");
    expect(sourceStream).toContain("streamSourceChatViaManagedService");
    // BYOK direct path preserved (no regression):
    expect(sourceStream).toContain("streamSourceAPIEffect");
  });

  it("the YouTube chat handler picks the managed service in managed mode and direct streaming in BYOK", () => {
    expect(youtube).toContain("readAppAccessMode");
    expect(youtube).toContain("isLocalByokMode");
    expect(youtube).toContain("streamSourceChatViaManagedService");
    // BYOK direct path preserved (no regression):
    expect(youtube).toContain("streamClaudeAPIEffect");
  });
});

describe("managed source-chat relay", () => {
  it("posts the credential-free request and relays normalized stream events", async () => {
    const storageGet = vi.fn(async (key: string) =>
      key === "convexUrl" ? { convexUrl: "https://managed-test.convex.cloud" } : {}
    );
    vi.stubGlobal("chrome", { storage: { local: { get: storageGet } } });

    const fetchMock = vi.fn(async () =>
      new Response(
        'data: {"type":"chunk","text":"Answer"}\n\n' +
          'data: {"type":"done","fullText":"Answer"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const postMessage = vi.fn();

    await streamSourceChatViaManagedService(
      { postMessage } as unknown as chrome.runtime.Port,
      {
        question: "What does it say?",
        source: {
          kind: "web_page",
          url: "https://example.com/source",
          text: "Grounding text",
          scope: "page",
        },
      },
      {
        provider: "openai",
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
      },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://managed-test.convex.site/managed/ask-finding/stream");
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-terra",
      question: "What does it say?",
    });
    expect(payload).not.toHaveProperty("apiKey");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(postMessage.mock.calls.map(([event]) => event)).toEqual([
      { type: "chunk", text: "Answer" },
      { type: "done", fullText: "Answer" },
    ]);
  });
});
