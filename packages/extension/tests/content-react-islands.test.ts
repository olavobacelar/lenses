import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..");
const contentDir = join(here, "..", "src", "content");

function read(path: string) {
  return readFileSync(path, "utf-8");
}

function readCssFile(path: string, seen = new Set<string>()): string {
  const fullPath = resolve(path);
  if (seen.has(fullPath)) throw new Error(`Circular CSS import in ${fullPath}`);
  seen.add(fullPath);

  const source = read(fullPath);
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*@import\s+["'](.+)["'];\s*$/);
      if (!match) return line;
      return readCssFile(resolve(dirname(fullPath), match[1]), seen);
    })
    .join("\n");
}

describe("content script React UI islands", () => {
  it("lives under the package test directory, not a repo-root tests directory", () => {
    expect(extensionDir.endsWith(join("packages", "extension"))).toBe(true);
  });

  it("renders source callouts through a React root", () => {
    const content = read(join(contentDir, "content.ts"));
    const component = read(join(contentDir, "SourceCalloutStack.tsx"));

    expect(content).toContain("createLensesShadowMount");
    expect(content).toContain('surface: "source-callouts"');
    expect(content).toContain("createRoot(sourceCalloutStack)");
    expect(content).toContain("createElement(SourceCalloutStack");
    expect(content).toContain("removeSourceCalloutStack()");
    expect(content).not.toContain("stack.innerHTML = \"\"");

    for (const className of [
      "lenses-source-callout",
      "lenses-source-callout-header",
      "lenses-source-callout-close",
      "lenses-source-callout-intermediate",
      "lenses-source-callout-list",
    ]) {
      expect(component).toContain(className);
    }
  });

  it("renders the selection trigger menu through React", () => {
    const content = read(join(contentDir, "content.ts"));
    const component = read(join(contentDir, "SelectionTrigger.tsx"));
    const controller = read(join(contentDir, "SelectionTriggerController.ts"));

    expect(content).toContain("createSelectionTriggerController");
    expect(controller).toContain("createElement(SelectionTriggerContent");
    expect(controller).toContain('surface: "selection-trigger"');
    expect(controller).toContain("reactRoot: createRoot(root)");
    expect(controller).toContain("activeSelectionTrigger.reactRoot.unmount()");
    expect(controller).not.toContain("isChatboxOpen");
    expect(controller).not.toContain("insertSelectionIntoChatbox");
    expect(controller).not.toContain("chat-insert");
    expect(content).not.toContain("renderSelectionLensActions(");
    expect(content).not.toContain("createSelectionActionIcon(");

    for (const label of ["Summarize this", "Is this true?", "Explain this", "Ask"]) {
      expect(component).toContain(label);
    }
    expect(component).not.toContain("chat-insert");
    expect(component).not.toContain("Annotate page");
    expect(controller).not.toContain('type: "run-selection-lens"');
  });

  it("renders the orphaned saved-chat panel through React", () => {
    const content = read(join(contentDir, "content.ts"));
    const component = read(join(contentDir, "OrphanedSavedChatsPanel.tsx"));

    expect(content).toContain("createElement(OrphanedSavedChatsPanel");
    expect(content).toContain('surface: "orphaned-panel"');
    expect(content).toContain("orphanedPanelRoot = createRoot(panel)");
    expect(content).toContain("orphanedPanelRoot?.unmount()");
    expect(content).not.toContain("list.style.display = isOpen ? \"none\" : \"flex\"");

    for (const className of [
      "lenses-orphaned-toggle",
      "lenses-orphaned-list",
      "lenses-orphaned-item",
      "lenses-orphaned-item-delete",
    ]) {
      expect(component).toContain(className);
    }
  });

  it("renders the content chatbox through React", () => {
    const content = read(join(contentDir, "content.ts"));
    const component = read(join(contentDir, "ChatboxView.tsx"));
    const chatUi = read(join(here, "..", "src", "lib", "ChatUi.tsx"));
    const richText = read(join(here, "..", "src", "lib", "RichText.tsx"));

    expect(content).toContain("const chatboxRoot = createRoot(root)");
    expect(content).toContain('surface: "chatbox"');
    expect(content).toContain('surface: "citation-tooltip"');
    expect(content).toContain("createElement(ChatboxView");
    expect(content).toContain("chatboxRoot.unmount()");
    expect(content).not.toContain("createChatboxDeleteIcon(");
    expect(content).not.toContain("document.createElement(\"form\")");
    expect(content).not.toContain("appendInlineMarkdownWithLineBreaks");

    for (const className of [
      "lenses-chatbox-header",
      "lenses-chatbox-messages",
      "lenses-chatbox-form",
      "lenses-chatbox-selection-quote",
      "lenses-chatbox-annotation-row",
      "lenses-chat-message-action",
    ]) {
      expect(`${component}\n${chatUi}`).toContain(className);
    }

    expect(richText).toContain("TextSegmentsWithCitations");
    expect(richText).toContain("citation-badge");
    expect(richText).toContain("export function Markdown");
  });

  it("isolates floating content UI in shadow roots with synchronized themes", () => {
    const content = read(join(contentDir, "content.ts"));
    const shadowUi = read(join(contentDir, "shadow-ui.ts"));
    const css = readCssFile(join(contentDir, "highlight.css"));

    expect(content).toContain("setLensesShadowTheme(effectiveTheme)");
    expect(content).toContain("LENSES_SHADOW_HOST_CLASS");
    expect(shadowUi).toContain('host.attachShadow({ mode: "open" })');
    expect(shadowUi).toContain('chrome.runtime.getURL("content/highlight.css")');
    expect(shadowUi).toContain("themeScope.setAttribute(\"data-lenses-theme\", theme)");
    expect(css).toContain('[data-lenses-theme="dark"] .lenses-chatbox');
    expect(css).toContain('[data-lenses-theme="dark"] .lenses-selection-trigger-key');
  });
});
