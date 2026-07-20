import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_ACTIONS_USE_SIDE_PANEL_KEY } from "../src/lib/chat-surface-settings.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(src, ...parts), "utf-8");

describe("chat actions surface routing", () => {
  const content = read("content", "content.ts");
  const popup = read("popup", "PopupApp.tsx");
  const options = read("options", "OptionsApp.tsx");
  const useChat = read("sidepanel", "hooks", "useChat.ts");

  it("uses a single local-storage key for the route toggle", () => {
    expect(CHAT_ACTIONS_USE_SIDE_PANEL_KEY).toBe("chatActions:useSidePanel");
    expect(content).toContain("chatActionsUseSidePanelFromStorage");
    expect(popup).not.toContain("chat-actions-use-side-panel");
    expect(options).toContain("chat-actions-use-side-panel");
  });

  it("keeps the floating chat as the false branch outside contest builds", () => {
    expect(content).toMatch(
      /if \(!CONTEST_BUILD && !chatActionsUseSidePanel\)[\s\S]*openChatbox\(anchor, context\)/
    );
  });

  it("stages contextual sidepanel asks and opens the source panel", () => {
    expect(content).toContain('type: "stage-ask"');
    expect(content).toContain('action: "open-source-panel"');
    expect(content).toContain("pendingAskContextFromChatContext");
  });

  it("keeps full selected text in the sidepanel draft", () => {
    const start = content.indexOf("function pendingAskFromChatContext");
    const end = content.indexOf("function pendingAskContextFromChatContext");
    const pendingAskBody = content.slice(start, end);

    expect(content).toContain("function selectionDraft(selectedText: string)");
    expect(pendingAskBody).toContain("draft: selectionDraft(context.selectedText)");
    expect(pendingAskBody).not.toContain("formatSelectionSnippet(context.selectedText)");
  });

  it("has the sidepanel consume contextual asks through the finding stream", () => {
    expect(useChat).toContain('chrome.runtime.connect({ name: "lenses-finding-stream" })');
    expect(useChat).toContain('action: "ask-finding-stream"');
    expect(useChat).toContain("selectionText: contextual.context.selectedText");
    expect(useChat).toContain("annotations:");
  });
});
