import { describe, expect, it } from "vitest";
import {
  applyChatStreamEvent,
  createChatStreamState,
  type ChatStreamEvent,
  type ChatStreamState,
} from "../src/lib/chat-stream.js";

function fold(events: ChatStreamEvent[], initial = createChatStreamState()): ChatStreamState {
  return events.reduce(applyChatStreamEvent, initial);
}

describe("chat stream fold engine", () => {
  it("starts empty", () => {
    const state = createChatStreamState();
    expect(state.text).toBe("");
    expect(state.thinkingText).toBe("");
    expect(state.thinkingOpen).toBe(false);
    expect(state.activity).toEqual([]);
    expect(state.searches).toEqual([]);
    expect(state.searching).toBe(false);
    expect(state.textSegments).toEqual([]);
    expect(state.meta).toBeUndefined();
  });

  it("accumulates chunk text and keeps the latest segments", () => {
    const state = fold([
      { type: "chunk", text: "Hello " },
      {
        type: "chunk",
        text: "world",
        textSegments: [{ text: "Hello world", citations: [] }],
      },
    ]);
    expect(state.text).toBe("Hello world");
    expect(state.textSegments).toEqual([{ text: "Hello world", citations: [] }]);
  });

  it("keeps previous segments when a chunk carries none", () => {
    const state = fold([
      {
        type: "chunk",
        text: "a",
        textSegments: [{ text: "a", citations: [] }],
      },
      { type: "chunk", text: "b" },
    ]);
    expect(state.textSegments).toEqual([{ text: "a", citations: [] }]);
  });

  it("folds a thinking start/delta/end cycle into text and activity", () => {
    const started = fold([{ type: "thinking", event: "start" }]);
    expect(started.thinkingOpen).toBe(true);
    expect(started.activity).toEqual([{ kind: "thinking", text: "", live: true }]);

    const during = fold(
      [
        { type: "thinking", event: "delta", text: "Let me " },
        { type: "thinking", event: "delta", text: "check." },
      ],
      started
    );
    expect(during.thinkingText).toBe("Let me check.");
    expect(during.activity).toEqual([
      { kind: "thinking", text: "Let me check.", live: true },
    ]);

    const ended = fold(
      [{ type: "thinking", event: "end", fullText: "Let me check the source." }],
      during
    );
    expect(ended.thinkingOpen).toBe(false);
    expect(ended.thinkingText).toBe("Let me check the source.");
    expect(ended.activity).toEqual([
      { kind: "thinking", text: "Let me check the source.", live: false },
    ]);
  });

  it("ignores an empty thinking delta", () => {
    const before = fold([{ type: "thinking", event: "start" }]);
    const after = applyChatStreamEvent(before, {
      type: "thinking",
      event: "delta",
      text: "",
    });
    expect(after).toBe(before);
  });

  it("folds search events into searches, activity, and the in-flight flag", () => {
    const searching = fold([
      { type: "searching", event: "start", kind: "search", query: "lab leak evidence" },
    ]);
    expect(searching.searching).toBe(true);
    expect(searching.searches).toHaveLength(1);
    expect(searching.searches[0]).toMatchObject({
      kind: "search",
      query: "lab leak evidence",
      done: false,
    });
    expect(searching.activity).toHaveLength(1);
    expect(searching.activity[0]).toMatchObject({ kind: "research", live: true });

    const settled = fold(
      [
        {
          type: "searching",
          event: "end",
          kind: "search",
          query: "lab leak evidence",
          results: [{ url: "https://example.com", title: "Example" }],
        },
      ],
      searching
    );
    expect(settled.searching).toBe(false);
    expect(settled.searches[0]).toMatchObject({ done: true });
    expect(settled.searches[0]?.results).toEqual([
      { url: "https://example.com", title: "Example" },
    ]);
  });

  it("interleaves thinking and research as separate activity items", () => {
    const state = fold([
      { type: "thinking", event: "start" },
      { type: "thinking", event: "delta", text: "hm" },
      { type: "thinking", event: "end" },
      { type: "searching", event: "start", kind: "search", query: "q" },
      { type: "searching", event: "end", kind: "search", query: "q", results: [] },
    ]);
    expect(state.activity.map((item) => item.kind)).toEqual(["thinking", "research"]);
  });

  it("replaces segments on a citations event and ignores one without segments", () => {
    const seeded = fold([
      { type: "chunk", text: "x", textSegments: [{ text: "x", citations: [] }] },
    ]);
    const cited = applyChatStreamEvent(seeded, {
      type: "citations",
      textSegments: [
        {
          text: "x",
          citations: [{ url: "https://example.com", title: "Example" }],
        },
      ],
    });
    expect(cited.textSegments[0]?.citations).toHaveLength(1);

    const unchanged = applyChatStreamEvent(cited, { type: "citations" });
    expect(unchanged.textSegments).toBe(cited.textSegments);
  });

  it("stores meta and lets done override text, segments, and meta", () => {
    const state = fold([
      { type: "chunk", text: "partial" },
      { type: "meta", meta: { model: "claude" } },
      { type: "thinking", event: "start" },
      {
        type: "done",
        fullText: "final answer",
        textSegments: [{ text: "final answer", citations: [] }],
        meta: { model: "claude", effort: "medium" },
      },
    ]);
    expect(state.text).toBe("final answer");
    expect(state.textSegments).toEqual([{ text: "final answer", citations: [] }]);
    expect(state.meta).toEqual({ model: "claude", effort: "medium" });
    expect(state.thinkingOpen).toBe(false);
    expect(state.searching).toBe(false);
  });

  it("falls back to accumulated text when done carries no fullText", () => {
    const state = fold([{ type: "chunk", text: "streamed" }, { type: "done" }]);
    expect(state.text).toBe("streamed");
  });

  it("returns the state unchanged on error", () => {
    const before = fold([{ type: "chunk", text: "a" }]);
    expect(applyChatStreamEvent(before, { type: "error", error: "boom" })).toBe(before);
  });

  it("never mutates the previous state", () => {
    const before = fold([
      { type: "chunk", text: "a" },
      { type: "thinking", event: "start" },
    ]);
    const snapshot = structuredClone(before);
    fold(
      [
        { type: "chunk", text: "b" },
        { type: "thinking", event: "delta", text: "t" },
        { type: "searching", event: "start", kind: "search", query: "q" },
        { type: "done", fullText: "z" },
      ],
      before
    );
    expect(before).toEqual(snapshot);
  });
});
