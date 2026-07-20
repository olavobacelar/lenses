// The sidebar chat thread persists through the same unified conversations
// store the in-page selection/finding chats use, addressed by
// ConversationIdentity {sourceKey, sourceKind, scope, focus} — not through the
// separate chrome.storage thread. These tests pin the identity mapping, the
// PanelMessage <-> stored-message projection, and the useChat wiring.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fromSavedConversationMessages,
  sidebarConversationIdentity,
  toSavedConversationMessages,
  SAVED_CONVERSATION_MESSAGE_LIMIT,
} from "../src/sidepanel/lib/conversation.js";
import type { PanelMessage, PanelSource } from "../src/sidepanel/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) =>
  readFileSync(join(here, "..", "src", ...parts), "utf-8");

function makeSource(overrides: Partial<PanelSource> = {}): PanelSource {
  return {
    key: "web:example.com/article",
    kind: "web_page",
    title: "An article",
    url: "https://example.com/article",
    text: "body",
    scope: "page",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<PanelMessage> = {}): PanelMessage {
  return {
    id: 1,
    role: "user",
    content: "What does this claim rest on?",
    timestamp: 1700000000000,
    ...overrides,
  };
}

describe("sidebarConversationIdentity", () => {
  it("addresses the whole-source thread with focus source and no focusRef", () => {
    const identity = sidebarConversationIdentity(makeSource());
    expect(identity).toEqual({
      sourceKey: "web:example.com/article",
      sourceUrl: "https://example.com/article",
      sourceKind: "web_page",
      scope: "page",
      focus: "source",
    });
    expect("focusRef" in identity).toBe(false);
  });

  it("maps a transcript source to transcript scope and anything else to page", () => {
    expect(
      sidebarConversationIdentity(
        makeSource({ kind: "youtube_video", scope: "transcript" })
      ).scope
    ).toBe("transcript");
    expect(sidebarConversationIdentity(makeSource({ kind: "pdf" })).scope).toBe("page");
    // "selection" is not a sidebar scope; degrade rather than invent a thread.
    expect(sidebarConversationIdentity(makeSource({ scope: "selection" })).scope).toBe(
      "page"
    );
  });

  it("omits the url when the source has none", () => {
    const identity = sidebarConversationIdentity(makeSource({ url: "" }));
    expect("sourceUrl" in identity).toBe(false);
  });
});

describe("toSavedConversationMessages", () => {
  it("keeps only substantive user/assistant turns", () => {
    const saved = toSavedConversationMessages([
      makeMessage(),
      makeMessage({ id: 2, role: "assistant", content: "It rests on one study." }),
      makeMessage({ id: 3, role: "error", content: "Streaming failed." }),
      makeMessage({ id: 4, role: "system", content: "system note" }),
      makeMessage({ id: 5, content: "   " }),
      makeMessage({
        id: 6,
        role: "assistant",
        content: "Response interrupted before completion.",
        isError: true,
      }),
    ]);
    expect(saved.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("never persists screenshots, ids, or timestamps", () => {
    const [saved] = toSavedConversationMessages([
      makeMessage({ screenshots: ["data:image/png;base64,xxx"] }),
    ]);
    expect(saved).toBeDefined();
    expect(Object.keys(saved!)).toEqual(["role", "content"]);
  });

  it("caps the thread at the message limit, keeping the newest turns", () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      makeMessage({ id: index, content: `turn ${index}` })
    );
    const saved = toSavedConversationMessages(many);
    expect(saved).toHaveLength(SAVED_CONVERSATION_MESSAGE_LIMIT);
    expect(saved[0]?.content).toBe("turn 20");
    expect(saved.at(-1)?.content).toBe("turn 99");
  });

  it("trims citations to the store's shape and keeps the reasoning trace", () => {
    const [saved] = toSavedConversationMessages([
      makeMessage({
        role: "assistant",
        content: "Answer",
        thinkingText: "considering…",
        textSegments: [
          {
            text: "Answer",
            citations: [
              {
                type: "web_search_result_location",
                url: "https://example.com",
                title: "Example",
                citedText: "quoted",
                encrypted_index: "abc",
              },
            ],
          },
        ],
        activity: [{ kind: "thinking", text: "considering…" }],
        searches: [
          { kind: "search", query: "q", url: "", results: [], done: true },
        ],
        meta: { verdict: "true" },
        videoTimestamp: {
          seconds: 90,
          formatted: "1:30",
          duration: 300,
          durationFormatted: "5:00",
        },
      }),
    ]);
    expect(saved?.textSegments?.[0]?.citations).toEqual([
      { url: "https://example.com", title: "Example", citedText: "quoted" },
    ]);
    expect(saved?.activity).toHaveLength(1);
    expect(saved?.searches).toHaveLength(1);
    expect(saved?.meta).toEqual({ verdict: "true" });
    expect(saved?.videoTimestamp).toEqual({ seconds: 90, formatted: "1:30" });
  });
});

describe("fromSavedConversationMessages", () => {
  it("round-trips a projected thread back into renderable panel messages", () => {
    const source: PanelMessage[] = [
      makeMessage(),
      makeMessage({
        id: 2,
        role: "assistant",
        content: "It rests on one study.",
        thinkingText: "checking",
        textSegments: [
          {
            text: "It rests on one study.",
            citations: [
              { type: "web", url: "https://example.com", title: "Example", citedText: "" },
            ],
          },
        ],
        activity: [{ kind: "thinking", text: "checking" }],
        videoTimestamp: {
          seconds: 12,
          formatted: "0:12",
          duration: 0,
          durationFormatted: "",
        },
      }),
    ];
    const restored = fromSavedConversationMessages(toSavedConversationMessages(source));

    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ role: "user", content: source[0]!.content });
    expect(restored[1]).toMatchObject({
      role: "assistant",
      content: "It rests on one study.",
      thinkingText: "checking",
    });
    expect(restored[1]?.textSegments?.[0]?.citations[0]).toMatchObject({
      type: "web",
      url: "https://example.com",
    });
    expect(restored[1]?.activity).toHaveLength(1);
    expect(restored[1]?.videoTimestamp).toMatchObject({ seconds: 12, formatted: "0:12" });
    // Synthesized ids only need to be unique within the session.
    expect(new Set(restored.map((message) => message.id)).size).toBe(2);
  });

  it("skips hidden rows and malformed entries instead of failing the restore", () => {
    const restored = fromSavedConversationMessages([
      { role: "user", content: "kept" },
      { role: "user", content: "hidden", hidden: true },
      { role: "finding", content: "wrong role" },
      { role: "assistant" },
      "not an object",
      null,
    ]);
    expect(restored.map((message) => message.content)).toEqual(["kept"]);
  });

  it("returns an empty thread for non-array input", () => {
    expect(fromSavedConversationMessages(undefined)).toEqual([]);
    expect(fromSavedConversationMessages({})).toEqual([]);
  });
});

describe("useChat wiring", () => {
  const useChat = read("sidepanel", "hooks", "useChat.ts");

  it("persists and restores through the unified conversations store", () => {
    expect(useChat).toContain('type: "save-conversation"');
    expect(useChat).toContain('type: "get-conversation"');
    expect(useChat).toContain("sidebarConversationIdentity");
  });

  it("imports the previous per-source storage thread once", () => {
    expect(useChat).toContain("importStoredConversation");
  });
});
