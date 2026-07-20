// Unit tests for the document-attachment pipeline: turning attachment data URLs
// (PDF, text/markdown, images) into the extension's provider-neutral content
// blocks and translating them into the OpenAI Responses API shape. These cover the
// "paste/attach PDFs and text" feature end-to-end at the content layer, for both
// providers, without touching the side-effecting sidepanel module.

import { describe, it, expect } from "vitest";
import {
  attachmentToContent,
  buildContentWithAttachments,
} from "../src/lib/utils/screenshots";
import {
  buildOpenAIRequestBody,
  conversationToOpenAIInput,
} from "../src/background/api/openai-client";
import type { AiModel } from "../src/types/ai-models";

const PDF_BASE64 = "JVBERi0xLjQK"; // "%PDF-1.4\n"
const PDF_DATA_URL = `data:application/pdf;base64,${PDF_BASE64}`;
const MD_TEXT = "# Title\nhello world";
const MD_DATA_URL = `data:text/markdown;base64,${Buffer.from(MD_TEXT, "utf-8").toString("base64")}`;
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("attachmentToContent", () => {
  it("turns a PDF data URL into a base64 document block", () => {
    expect(attachmentToContent(PDF_DATA_URL)).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: PDF_BASE64 },
    });
  });

  it("decodes a text/markdown data URL into a plain-text document block", () => {
    expect(attachmentToContent(MD_DATA_URL)).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: MD_TEXT },
    });
  });

  it("still maps image data URLs to image blocks", () => {
    expect(attachmentToContent(PNG_DATA_URL)).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });
  });

  it("returns null for unsupported data URLs", () => {
    expect(attachmentToContent("data:application/zip;base64,AAAA")).toBeNull();
  });
});

describe("buildContentWithAttachments", () => {
  it("returns the bare string when there are no attachments", () => {
    expect(buildContentWithAttachments("hi")).toBe("hi");
  });

  it("leads with the attachment blocks, then the user text", () => {
    const content = buildContentWithAttachments("summarize this", [PDF_DATA_URL, MD_DATA_URL]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string }>;
    expect(parts[0].type).toBe("document");
    expect(parts[1].type).toBe("document");
    expect(parts[parts.length - 1]).toEqual({ type: "text", text: "summarize this" });
  });
});

describe("OpenAI translation of document blocks", () => {
  it("maps a PDF document to a base64 input_file with a filename", () => {
    const input = conversationToOpenAIInput([
      { role: "user", content: buildContentWithAttachments("read this", [PDF_DATA_URL]) },
    ]);
    const parts = input[0].content as Array<Record<string, unknown>>;
    expect(parts).toContainEqual({
      type: "input_file",
      filename: "document.pdf",
      file_data: PDF_DATA_URL,
    });
    expect(parts).toContainEqual({ type: "input_text", text: "read this" });
  });

  it("inlines a text/markdown document as input_text", () => {
    const input = conversationToOpenAIInput([
      { role: "user", content: buildContentWithAttachments("read this", [MD_DATA_URL]) },
    ]);
    const parts = input[0].content as Array<Record<string, unknown>>;
    expect(parts).toContainEqual({ type: "input_text", text: MD_TEXT });
  });

  it("passes reasoning effort for reasoning-capable OpenAI models", () => {
    expect(
      buildOpenAIRequestBody({
        apiKey: "sk-test",
        model: "gpt-5.6-terra",
        maxTokens: 1000,
        system: "system",
        messages: [{ role: "user", content: "hello" }],
        reasoningEffort: "xhigh",
      })
    ).toMatchObject({ reasoning: { effort: "xhigh" } });
  });

  it("does not send reasoning effort to older non-reasoning OpenAI models", () => {
    expect(
      buildOpenAIRequestBody({
        apiKey: "sk-test",
        model: "gpt-4.1" as AiModel,
        maxTokens: 1000,
        system: "system",
        messages: [{ role: "user", content: "hello" }],
        reasoningEffort: "high",
      })
    ).not.toHaveProperty("reasoning");
  });

  it("sends max effort to GPT-5.6 models", () => {
    expect(
      buildOpenAIRequestBody({
        apiKey: "sk-test",
        model: "gpt-5.6-sol",
        maxTokens: 1000,
        system: "system",
        messages: [{ role: "user", content: "hello" }],
        reasoningEffort: "max",
      })
    ).toMatchObject({ reasoning: { effort: "max" } });
  });
});
