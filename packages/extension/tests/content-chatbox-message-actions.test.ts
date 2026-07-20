import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "src", "content");
const libDir = join(here, "..", "src", "lib");
const chatbox = readFileSync(join(contentDir, "ChatboxView.tsx"), "utf-8");
const content = readFileSync(join(contentDir, "content.ts"), "utf-8");
const chatUi = readFileSync(join(libDir, "ChatUi.tsx"), "utf-8");
const css = readCssFile(join(contentDir, "highlight.css"));

function readCssFile(path: string, seen = new Set<string>()): string {
  const fullPath = resolve(path);
  if (seen.has(fullPath)) throw new Error(`Circular CSS import in ${fullPath}`);
  seen.add(fullPath);

  const source = readFileSync(fullPath, "utf-8");
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*@import\s+["'](.+)["'];\s*$/);
      if (!match) return line;
      return readCssFile(resolve(dirname(fullPath), match[1]), seen);
    })
    .join("\n");
}

function extractFunctionBody(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`function ${escaped}\\b`);
  const match = re.exec(source);
  if (!match) throw new Error(`Could not find function ${name}`);

  const paramsStart = source.indexOf("(", match.index);
  if (paramsStart < 0) throw new Error(`Could not find function params for ${name}`);

  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index++) {
    const char = source[index];
    if (char === "(") paramsDepth++;
    if (char === ")") paramsDepth--;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  if (paramsEnd < 0) throw new Error(`Could not find function params end for ${name}`);

  const openIndex = source.indexOf("{", paramsEnd);
  if (openIndex < 0) throw new Error(`Could not find function body for ${name}`);

  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return source.slice(match.index, index + 1);
  }

  throw new Error(`Could not find function end for ${name}`);
}

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((match) => match[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("content chatbox message actions", () => {
  it("renders copy, retry, and rewind controls without adding a fork option", () => {
    expect(chatbox).toContain("<ChatMessageList");
    expect(chatUi).toContain('title="Copy message"');
    expect(chatUi).toContain('title="Retry response"');
    expect(chatUi).toContain('title="Rewind to composer"');
    expect(chatUi).toMatch(/message\.role === "assistant" && message\.canRetry/);
    expect(chatUi).toMatch(/message\.role === "user" \?/);
    expect(`${chatbox}\n${chatUi}`).not.toMatch(/ForkIcon|Fork|fork/i);
  });

  it("copies only message content, not assistant thinking text", () => {
    const handleCopy = extractFunctionBody(content, "handleCopyMessage");
    expect(handleCopy).toContain("copyTextToClipboard(message.content)");
    expect(handleCopy).not.toContain("thinkingText");
    expect(chatUi).toContain("legacyActivityItems({");
    expect(chatUi).toContain("<ChatActivityTimeline activity={activity} live={isLive} />");
    expect(chatUi).toContain("<ThinkingDetails text={item.text} open={item.live} />");
    expect(chatUi).toContain("<WebSearchGroups searches={item.searches} live={item.live} />");
  });

  it("rewinds a user message into the composer and truncates model history", () => {
    const handleRewind = extractFunctionBody(content, "handleRewindMessage");
    const truncate = extractFunctionBody(content, "truncateChatAtMessage");
    expect(handleRewind).toMatch(/message\.role !== "user"/);
    expect(truncate).toMatch(/messageViews\.splice\(messageIndex\)/);
    expect(truncate).toMatch(/conversation\.splice\(message\.conversationIndex\)/);
    expect(handleRewind).toContain("inputElement.value = message.content");
    expect(content).toContain("conversationIndex: options?.conversationIndex");
  });

  it("inserts selected chat message text into the composer at the current cursor range", () => {
    const insertText = extractFunctionBody(content, "insertTextAtCursor");
    const selectionInfo = extractFunctionBody(content, "getChatMessageSelectionInfo");
    const insertSelection = extractFunctionBody(content, "insertSelectedChatMessageText");

    expect(content).not.toContain("insertSelectionIntoChatbox");
    expect(content).not.toContain("activeChatbox?.insertTextAtCursor(text) ?? false");
    expect(content).not.toContain("function hasActiveTextSelection()");
    expect(chatbox).toContain("messageSelectionPrompt");
    expect(chatbox).toContain('className="lenses-chat-selection-insert"');
    expect(chatbox).toContain("onMouseUp={onMessagesMouseUp}");
    expect(chatbox).toContain("onInsertMessageSelection();");
    expect(selectionInfo).toContain("isNodeInsideMessages(selection.anchorNode)");
    expect(selectionInfo).toContain("isNodeInsideMessages(selection.focusNode)");
    expect(selectionInfo).toContain("normalizeChatboxInsertedText(selection.toString())");
    expect(insertSelection).toContain("const text = messageSelectionPrompt?.text");
    expect(insertSelection).toContain("insertTextAtCursor(text)");
    expect(insertSelection).toContain("selection?.removeAllRanges()");
    expect(insertText).toContain("normalizeChatboxInsertedText(text)");
    expect(insertText).toContain("const start = input.selectionStart ?? value.length");
    expect(insertText).toContain("const end = input.selectionEnd ?? start");
    expect(insertText).toContain("value.slice(0, start) + insertText + value.slice(end)");
    expect(insertText).toContain("input.setSelectionRange(nextCursor, nextCursor)");
    expect(css).toContain(".lenses-chat-selection-insert");
  });

  it("uses popup-style up-arrow actions instead of a wand identity button", () => {
    expect(chatbox).toContain("<ChatInsertIcon />");
    expect(chatbox).toContain("<ArrowUpIcon");
    expect(chatbox).not.toContain("MagicWandIcon");
    expect(chatbox).not.toContain("lenses-chatbox-brand-mark");

    const actionRowBody = extractRuleBody(".lenses-chatbox-action-row");
    expect(actionRowBody).toMatch(/display:\s*flex/);
    expect(actionRowBody).toMatch(/justify-content:\s*flex-end/);

    const insertBody = extractRuleBody(".lenses-chat-selection-insert");
    expect(insertBody).toMatch(/width:\s*30px/);
    expect(insertBody).toMatch(/height:\s*30px/);
    expect(insertBody).toMatch(/display:\s*inline-grid/);
    expect(insertBody).not.toMatch(/min-width:\s*48px/);
  });

  it("retries assistant responses from the preceding user turn", () => {
    const handleRetry = extractFunctionBody(content, "handleRetryMessage");
    expect(handleRetry).toMatch(/message\.role !== "assistant"/);
    expect(handleRetry).toContain("const retryTarget = findRetryTarget(message)");
    expect(handleRetry).toContain("truncateChatAtMessage(retryTarget.message, retryTarget.index)");
    expect(handleRetry).toContain("askQuestion(retryTarget.message.content");
    expect(content).toContain("retryTargetLensId: targetLensId");
  });

  it("saves hidden initial prompts in the conversation chain and retries them", () => {
    const handleRetry = extractFunctionBody(content, "handleRetryMessage");
    expect(handleRetry).toContain("const conversationRetryTarget = findConversationRetryTarget(message)");
    expect(handleRetry).toContain("const messageIndex = findAssistantMessageIndex(message)");
    expect(handleRetry).toContain("conversationRetryTarget?.conversationIndex");
    expect(handleRetry).toContain("hideUserMessage: true");

    expect(content).toContain("hidden: shouldRenderUserMessage ? undefined : true");
    expect(content).toContain("if (message.hidden) continue");
    expect(content).toContain("function findConversationRetryTarget");
    expect(content).toContain("retryQuestion: trimmed");
    expect(content).toContain("canRetry: true");
  });

  it("does not create saved highlights before chat has useful content", () => {
    const autoSave = extractFunctionBody(content, "autoSave");
    const hasPersistableMessages = extractFunctionBody(content, "hasPersistableMessages");

    expect(autoSave).toContain("if (!hasPersistableMessages(messagesSnapshot)) return;");
    expect(autoSave).toContain('if (context.kind !== "selection")');
    expect(autoSave).toContain("saveConversationMessages(messagesSnapshot)");
    expect(content).not.toContain('if (context.kind === "selection" && !autoSavedId)');
    expect(hasPersistableMessages).toContain('if (message.role === "assistant") return true');
    expect(hasPersistableMessages).toContain("return !message.hidden");
  });

  it("stores selection and finding chats through the shared conversation API", () => {
    const saveConversation = extractFunctionBody(content, "saveConversationMessages");
    const loadConversation = extractFunctionBody(content, "loadConversationMessages");

    expect(saveConversation).toContain('type: "save-conversation"');
    expect(loadConversation).toContain('type: "get-conversation"');
    expect(content).toContain('focus: "selection" as const');
    expect(content).toContain('focus: "finding" as const');
    expect(content).toContain("loadConversationMessages(annotation.id");
  });

  it("renders selection and finding chatboxes through the same detached shell", () => {
    expect(content).toContain('root.classList.add("lenses-chatbox--detached")');
    expect(content).toContain('root.classList.add("lenses-chatbox--selection")');
    expect(chatbox).toContain('const headerEyebrow = selectionHeader?.eyebrow ?? "AI chat"');
    expect(chatbox).toContain('className="lenses-chatbox-context-list lenses-chatbox-annotation-list"');
    expect(chatbox).toContain('className="lenses-chatbox-selection-card"');
    expect(chatbox).not.toContain("lenses-chatbox-header--chat");
  });

  it("keeps automatic quick-action prompts out of saved chat titles", () => {
    const getTitle = extractFunctionBody(content, "getSavedSelectionTitle");

    expect(getTitle).toContain('message.role === "user" && !message.hidden');
    expect(getTitle).toContain("context.selectedText.slice(0, 60)");
  });

  it("can create the saved highlight when assistant streaming content starts", () => {
    const maybeAutoSave = extractFunctionBody(content, "maybeAutoSaveStartedAssistantResponse");
    const snapshot = extractFunctionBody(content, "buildAutoSaveMessagesSnapshot");

    expect(maybeAutoSave).toContain("if (!getStreamingAssistantContent()) return;");
    expect(maybeAutoSave).toContain("hasAutoSavedStreamingAssistant = true;");
    expect(maybeAutoSave).toContain("autoSave();");
    expect(snapshot).toContain('role: "assistant"');
    expect(snapshot).toContain("content: streamingAssistantContent");
  });

  it("closes the matching chatbox after a saved highlight is deleted", () => {
    const deleteSavedSelection = extractFunctionBody(content, "deleteSavedSelection");

    expect(content).toContain("getSavedId: () => autoSavedId");
    expect(deleteSavedSelection).toContain("if (activeChatbox?.getSavedId() === id)");
    expect(deleteSavedSelection).toContain("closeActiveChatbox();");
  });

  it("styles actions as a compact icon row under the message", () => {
    const frameBody = extractRuleBody(".lenses-chat-message-frame");
    expect(frameBody).toMatch(/display:\s*flex/);
    expect(frameBody).toMatch(/flex-direction:\s*column/);
    const toolsBody = extractRuleBody(".lenses-chat-message-tools");
    expect(toolsBody).toMatch(/display:\s*flex/);
    const buttonBody = extractRuleBody(".lenses-chat-message-tool");
    expect(buttonBody).toMatch(/width:\s*22px/);
    expect(buttonBody).toMatch(/height:\s*22px/);
  });

  it("uses a compact arrow-up send button in the chatbox composer", () => {
    expect(chatbox).toContain("<ChatComposer");
    expect(chatUi).toContain('aria-label="Send message"');
    expect(chatUi).toContain("<SendArrowIcon />");

    const body = extractRuleBody(".lenses-chatbox-send");
    expect(body).toMatch(/width:\s*var\(--lenses-chat-composer-send-size\)/);
    expect(body).toMatch(/border-radius:\s*var\(--lenses-radius-round\)/);
    expect(body).toMatch(/display:\s*inline-grid/);
    expect(body).toMatch(/align-self:\s*center/);
  });

  it("uses a textarea composer so Shift+Enter can insert a newline", () => {
    expect(chatUi).toContain("<textarea");
    expect(chatUi).toContain("HTMLTextAreaElement");
    expect(chatUi).toContain('event.key !== "Enter" || event.shiftKey');
    expect(chatUi).toContain("requestSubmit()");
    expect(content).toContain("let inputElement: HTMLTextAreaElement | null = null");

    const inputBody = extractRuleBody(".lenses-chatbox-input");
    expect(inputBody).toMatch(/resize:\s*none/);
    expect(inputBody).toMatch(/field-sizing:\s*content/);
    expect(inputBody).toMatch(/max-height:\s*140px/);
    expect(inputBody).toMatch(/overflow-y:\s*auto/);
  });

  it("keeps the selection composer visually aligned with the sidebar composer", () => {
    const rootBody = extractRuleBody(".lenses-chatbox");
    expect(rootBody).toMatch(/font-size:\s*14px/);
    expect(rootBody).toMatch(/line-height:\s*1\.5/);

    const baseFormBody = extractRuleBody(".lenses-chatbox-form");
    expect(baseFormBody).toMatch(/flex-direction:\s*column/);
    expect(baseFormBody).toMatch(/align-items:\s*stretch/);
    expect(baseFormBody).toMatch(/border:\s*1px solid var\(--lenses-chat-line\)/);
    expect(baseFormBody).toMatch(/border-radius:\s*var\(--lenses-radius-lg\)/);
    expect(baseFormBody).toMatch(/padding:\s*8px/);
    expect(baseFormBody).toMatch(/background:\s*var\(--lenses-chat-paper\)/);

    const baseFocusBody = extractRuleBody(".lenses-chatbox-form:focus-within");
    expect(baseFocusBody).toMatch(/border-color:\s*var\(--lenses-chat-accent\)/);

    const baseInputBody = extractRuleBody(".lenses-chatbox-input");
    expect(baseInputBody).toMatch(/border:\s*0/);
    expect(baseInputBody).toMatch(/background-color:\s*transparent !important/);
    expect(baseInputBody).toMatch(/min-height:\s*40px/);
    expect(baseInputBody).toMatch(/max-height:\s*140px/);
    expect(baseInputBody).toMatch(/padding:\s*2px 4px/);

    expect(css).not.toContain(".lenses-chatbox--selection .lenses-chatbox-form {");

    const inputBody = extractRuleBody(".lenses-chatbox--selection .lenses-chatbox-input");
    expect(inputBody).toMatch(/min-height:\s*40px/);

    const sendBody = extractRuleBody(".lenses-chatbox--selection .lenses-chatbox-send");
    expect(sendBody).toMatch(/width:\s*var\(--lenses-chat-composer-send-size\)/);
    expect(sendBody).toMatch(/height:\s*var\(--lenses-chat-composer-send-size\)/);
    expect(sendBody).toMatch(/align-self:\s*center/);
    expect(sendBody).toMatch(/color:\s*var\(--lenses-chat-send-ink\)/);
  });

  it("keeps the dark selection composer input borderless inside the focused row", () => {
    const inputBody = extractRuleBody(
      'html[data-lenses-theme="dark"] .lenses-chatbox--selection .lenses-chatbox-input'
    );
    expect(inputBody).toMatch(/border:\s*0/);
    expect(inputBody).toMatch(/background:\s*transparent !important/);

    const focusBody = extractRuleBody(
      'html[data-lenses-theme="dark"] .lenses-chatbox--selection .lenses-chatbox-input:focus'
    );
    expect(focusBody).toMatch(/border:\s*0/);
    expect(focusBody).toMatch(/background:\s*transparent !important/);
    expect(focusBody).toMatch(/box-shadow:\s*none/);
    expect(focusBody).not.toMatch(/lenses-chat-accent-ring/);
  });
});
