import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidepanelDir = join(here, "..", "src", "sidepanel");
const libDir = join(here, "..", "src", "lib");
const messageList = readFileSync(
  join(sidepanelDir, "components", "MessageList.tsx"),
  "utf-8"
);
const chatUi = readFileSync(join(libDir, "ChatUi.tsx"), "utf-8");
const chatDock = readFileSync(join(sidepanelDir, "components", "ChatDock.tsx"), "utf-8");
const app = readFileSync(join(sidepanelDir, "App.tsx"), "utf-8");
const useChat = readFileSync(join(sidepanelDir, "hooks", "useChat.ts"), "utf-8");
const useAttachments = readFileSync(
  join(sidepanelDir, "hooks", "useAttachments.ts"),
  "utf-8"
);
const css = readFileSync(join(sidepanelDir, "sidepanel.css"), "utf-8");

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("sidepanel message actions", () => {
  it("renders copy, retry, and rewind controls without adding a fork action", () => {
    expect(messageList).toContain("<ChatMessageList");
    expect(chatUi).toContain('title="Copy message"');
    expect(chatUi).toContain('title="Retry response"');
    expect(chatUi).toContain('title="Rewind to composer"');
    expect(messageList).toContain('canRetry: message.role === "assistant"');
    expect(chatUi).toMatch(/message\.role === "assistant" && message\.canRetry/);
    expect(chatUi).toMatch(/message\.role === "user" \?/);
    expect(`${messageList}\n${chatUi}`).not.toMatch(/ForkIcon|Fork|fork/i);
  });

  it("copies message text through the chat dock clipboard handler", () => {
    expect(chatDock).toContain("copyTextToClipboard(message.content)");
    expect(chatDock).toContain("navigator.clipboard?.writeText");
    expect(chatDock).toContain('document.execCommand("copy")');
  });

  it("rewinds a user turn back into the composer with its attachments", () => {
    expect(useChat).toMatch(/const rewindToMessage[\s\S]*?message\.role === "user"/);
    expect(useChat).toMatch(/const nextMessages = messagesRef\.current\.slice\(0, targetIndex\)/);
    expect(useChat).toMatch(/persistMessages\(targetSource, nextMessages\)/);
    expect(app).toContain("attachments.restoreAttachments(message.screenshots ?? [], message.videoTimestamp)");
    expect(app).toContain("text: message.content");
    expect(useAttachments).toMatch(/const restoreAttachments[\s\S]*?dataUrls\.slice\(0, MAX_ATTACHMENTS\)/);
    expect(useAttachments).toMatch(/isImageAttachment\(dataUrl\)/);
  });

  it("retries assistant responses through the hook's preserved request payload", () => {
    expect(useChat).toMatch(/const retryFromMessage[\s\S]*?message\.role === "assistant"/);
    expect(useChat).toMatch(/messagesRef\.current\[index\]\?\.role === "user"/);
    expect(useChat).toMatch(/const nextMessages = messagesRef\.current\.slice\(0, userIndex\)/);
    expect(useChat).toContain("retryRequestByAssistantIdRef.current.get(messageId)");
    expect(useChat).toContain("contextual: retryRequest.contextual");
    expect(useChat).toContain("contextualOverride: null");
    expect(app).toContain(".retryFromMessage(message.id)");
    expect(app).not.toContain("target.content");
  });

  it("places message actions in a compact icon row under bubbles", () => {
    const body = extractRuleBody(".lenses-chat-message-tools");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/gap:\s*4px/);
    const buttonBody = extractRuleBody(".lenses-chat-message-tool");
    expect(buttonBody).toMatch(/width:\s*24px/);
    expect(buttonBody).toMatch(/height:\s*24px/);
  });
});
