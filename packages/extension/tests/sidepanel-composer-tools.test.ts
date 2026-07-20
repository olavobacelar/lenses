// Tests for the Lenses sidepanel composer interaction model:
//   1. The source-specific tools (capture frame, export slides, export video
//      slides) move OUT of the Source accordion and INTO a docked action row in
//      the chat composer — "the functions available for that URL" live next to
//      the input. URL-specific tools are hidden for mismatched sources and only
//      dimmed when source data is missing or work is in progress.
//   2. Screenshots attached to a message render in the chat as a thumbnail
//      gallery (previously they were captured but never shown in the history).
//   3. The user can paste an external image into the composer, not just capture
//      a video frame.
//
// The sidepanel is React now, so source assertions target the focused component
// or hook that owns the behavior instead of a single side-effecting entry file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "src", "sidepanel");
const libDir = join(here, "..", "src", "lib");
const typesDir = join(here, "..", "src", "types");
const html = readFileSync(join(dir, "sidepanel.html"), "utf-8");
const css = readFileSync(join(dir, "sidepanel.css"), "utf-8");
const app = readFileSync(join(dir, "App.tsx"), "utf-8");
const controlBay = readFileSync(join(dir, "components", "ControlBay.tsx"), "utf-8");
const chatDock = readFileSync(join(dir, "components", "ChatDock.tsx"), "utf-8");
const messageList = readFileSync(join(dir, "components", "MessageList.tsx"), "utf-8");
const chatUi = readFileSync(join(libDir, "ChatUi.tsx"), "utf-8");
const aiModelTypes = readFileSync(join(typesDir, "ai-models.ts"), "utf-8");
const reasoningSettings = readFileSync(join(libDir, "reasoning-settings.ts"), "utf-8");
const useControlBay = readFileSync(join(dir, "hooks", "useControlBay.ts"), "utf-8");
const attachmentHook = readFileSync(join(dir, "hooks", "useAttachments.ts"), "utf-8");

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector} in sidepanel.css`);
  return bodies.join("\n");
}

describe("composer tools — relocated into the chat", () => {
  it("places the source tools inside the chat form, not the Source section", () => {
    const formStart = chatDock.indexOf("<ChatComposer");
    const formEnd = chatDock.indexOf("{previewImage", formStart);
    expect(formStart).toBeGreaterThan(-1);
    const formMarkup = chatDock.slice(formStart, formEnd);
    expect(formMarkup).toContain('id="chat-form"');
    for (const id of ["capture-screenshot", "export-slides", "export-video-slides"]) {
      expect(formMarkup).toContain(`id="${id}"`);
    }
  });

  it("hides YouTube tools for non-YouTube sources instead of disabling them", () => {
    expect(chatDock).toContain('const showYouTubeTools = source?.kind === "youtube_video";');
    expect(chatDock).toContain("{__LOCAL_SLIDE_EXPORT__ && showYouTubeTools && (");
    expect(chatDock).not.toContain('disabled={source?.kind !== "youtube_video"}');
  });

  it("only dims YouTube export tools when video data is missing or export is running", () => {
    expect(chatDock).toContain("const hasYouTubeVideoId = !!source?.videoId;");
    expect(chatDock).toContain('disabled={!hasYouTubeVideoId || exportingPipeline === "frames"}');
    expect(chatDock).toContain('disabled={!hasYouTubeVideoId || exportingPipeline === "video"}');
  });

  it("removes the old Source-section tool strip", () => {
    expect(html).not.toContain("tool-strip");
    expect(html).not.toContain('class="tool-btn"');
  });

  it("docks the tools in a flex action row with a send button", () => {
    expect(chatDock).toContain('actionRowClassName="composer-actions"');
    expect(chatDock).toContain('sendButtonClassName="send-btn"');
    const body = extractRuleBody(".composer-actions");
    expect(body).toMatch(/display:\s*flex/);
  });

  it("uses the same compact arrow-up send affordance as the control bay", () => {
    expect(chatDock).toContain('sendButtonId="send-chat"');
    expect(chatUi).toContain('aria-label="Send message"');
    expect(chatUi).toContain("<SendArrowIcon />");
    expect(chatDock).not.toContain(">Send</button>");

    const body = extractRuleBody(".send-btn");
    expect(body).toMatch(/width:\s*var\(--composer-send-size\)/);
    expect(body).toMatch(/height:\s*var\(--composer-send-size\)/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-round\)/);
    expect(body).toMatch(/display:\s*inline-grid/);
  });

  it("uses the same composer type and placeholder color as the control bay", () => {
    const input = extractRuleBody("#chat-input");
    expect(input).toMatch(/font-size:\s*var\(--composer-font-size\)/);
    expect(input).toMatch(/line-height:\s*var\(--composer-line-height\)/);

    const placeholder = extractRuleBody("#chat-input::placeholder");
    expect(placeholder).toMatch(/color:\s*var\(--composer-placeholder\)/);
  });

  it("keeps the page composer send button on the shared size token", () => {
    const input = extractRuleBody(".composer2 .ta2");
    expect(input).toMatch(/font-size:\s*var\(--composer-font-size\)/);
    expect(input).toMatch(/line-height:\s*var\(--composer-line-height\)/);

    const placeholder = extractRuleBody(".composer2 .ta2::placeholder");
    expect(placeholder).toMatch(/color:\s*var\(--composer-placeholder\)/);

    const send = extractRuleBody(".c2-send");
    expect(send).toMatch(/width:\s*var\(--composer-send-size\)/);
    expect(send).toMatch(/height:\s*var\(--composer-send-size\)/);
    expect(send).toMatch(/font-weight:\s*600/);
  });

  it("exposes model and reasoning controls from the control bay composer", () => {
    expect(controlBay).toContain('id="bay-model"');
    expect(controlBay).toContain("bay.reasoningEffortOptions.map");
    expect(controlBay).toContain("bay.chooseChatModel(model)");
    expect(controlBay).toContain("bay.chooseReasoningEffort(effort)");

    const model = extractRuleBody(".c2-model");
    expect(model).toMatch(/display:\s*inline-flex/);
    expect(model).toMatch(/max-width:\s*min\(210px, 52%\)/);
    expect(model).toMatch(/height:\s*30px/);
    const label = extractRuleBody(".c2-model-label");
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("styles the model control as a borderless icon button, not a bordered pill", () => {
    const model = extractRuleBody(".c2-model");
    // Frameless at rest (transparent border keeps layout stable on hover) and
    // square-cornered like the sibling .action-btn tools, not a rounded pill.
    expect(model).toMatch(/border:\s*1px solid transparent/);
    expect(model).toMatch(/border-radius:\s*var\(--radius-button\)/);
    expect(model).not.toMatch(/border-radius:\s*var\(--radius-pill\)/);
    // Hover and the open menu share the icon-button wash, not a pill background.
    expect(css).toMatch(
      /\.c2-model:hover,\s*\.c2-model\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--icon-hover-bg\)/
    );
  });

  it("shows the model and reasoning control in the docked chat composer", () => {
    expect(app).toContain("modelControls={controlBay}");
    expect(chatDock).toContain('id="chat-model"');
    expect(chatDock).toContain('id="chat-model-menu"');
    expect(chatDock).toContain('id="chat-model-submenu"');
    expect(chatDock).toContain("DropdownMenu.SubTrigger");
    expect(chatDock).toContain("controls.reasoningEffortOptions.map");
    expect(chatDock).toContain("controls.chooseChatModel(model)");
    expect(chatDock).toContain("controls.chooseReasoningEffort(effort)");
    expect(chatDock).not.toContain("chooseModelProvider");
    expect(chatDock).not.toContain('className="c2-menu-section">Provider');
    expect(chatDock).not.toContain('className="c2-menu-section">Model');

    const model = extractRuleBody(".chat-model");
    expect(model).toMatch(/max-width:\s*min\(220px, 50%\)/);
    // The model/reasoning menus hug their (short) labels rather than reserving
    // the old wide gutters.
    const menu = extractRuleBody(".c2-model-menu");
    expect(menu).toMatch(/min-width:\s*150px/);
    const submenu = extractRuleBody(".c2-model-submenu");
    expect(submenu).toMatch(/min-width:\s*138px/);

    // The tick reads last: label fills the row and the check sits flush right.
    // Both cells are pinned to row 1 (grid-area) so the DOM-first check can sit
    // in column 2 without grid auto-placement dropping the label to a 2nd row.
    const compact = extractRuleBody(".c2-menu-item-compact");
    expect(compact).toMatch(/grid-template-columns:\s*1fr auto/);
    expect(extractRuleBody(".c2-menu-item-compact .c2-menu-label")).toMatch(/grid-area:\s*1 \/ 1/);
    expect(extractRuleBody(".c2-menu-item-compact .c2-menu-check")).toMatch(/grid-area:\s*1 \/ 2/);

    // The submenu trigger drops its (always-empty) check gutter and keeps just
    // the label + expand chevron.
    const submenuTrigger = extractRuleBody(".c2-submenu-trigger");
    expect(submenuTrigger).toMatch(/grid-template-columns:\s*1fr auto/);
    expect(extractRuleBody(".c2-submenu-trigger .c2-menu-check")).toMatch(/display:\s*none/);
  });

  it("does not leave the model trigger focused after choosing model settings", () => {
    for (const source of [chatDock, controlBay]) {
      expect(source).toContain("suppressModelMenuFocusRestoreRef");
      expect(source).toContain("onCloseAutoFocus");
      expect(source).toContain("event.preventDefault()");
      expect(source).toContain("chooseFromModelMenu");
    }
    expect(chatDock).toContain("controls.setIsModelMenuOpen(false)");
    expect(controlBay).toContain("bay.setIsModelMenuOpen(false)");
  });

  it("keeps provider selection owned by settings, not the composer menus", () => {
    expect(controlBay).not.toContain("chooseModelProvider");
    expect(controlBay).not.toContain('className="c2-menu-section">Provider');
    expect(chatDock).not.toContain("ProviderItem");
    expect(controlBay).not.toContain("ProviderItem");
  });

  it("keeps model selection in a nested submenu across composer variants", () => {
    expect(chatDock).toContain('id="chat-model-submenu"');
    expect(controlBay).toContain('id="bay-model-submenu"');
    expect(chatDock).toContain("DropdownMenu.SubContent");
    expect(controlBay).toContain("DropdownMenu.SubContent");
    expect(controlBay).not.toContain('className="c2-menu-section">Model');
  });

  it("uses provider-specific reasoning options with max available for current models", () => {
    expect(reasoningSettings).toContain('ANTHROPIC_REASONING_EFFORTS');
    expect(reasoningSettings).toContain('"max"');
    expect(reasoningSettings).toContain('OPENAI_REASONING_EFFORTS');
    expect(reasoningSettings).toContain('reasoningEffortsForProvider');
  });

  it('labels the xhigh effort "Extra" (not "XHigh") across menus and the pill', () => {
    // The level reads "Extra" everywhere it surfaces: the Anthropic/OpenAI menu
    // labels and the compact pill badge. The stored value stays "xhigh".
    expect(reasoningSettings).not.toContain('"XHigh"');
    expect(reasoningSettings).not.toContain('"Extra High"');
    expect(reasoningSettings).toMatch(/xhigh:\s*"Extra"/);
  });

  it("derives reasoning options from the chosen model, not just its provider", () => {
    // Single source of truth lives in reasoning-settings and mirrors the API
    // clients' per-model capability checks (so Haiku, which ignores effort,
    // exposes no levels rather than the provider's full ladder).
    expect(reasoningSettings).toContain("reasoningEffortsForModel");
    expect(reasoningSettings).toContain("clampReasoningEffortToModel");
    expect(reasoningSettings).toContain("supportsClaudeEffort");
    expect(reasoningSettings).toContain("supportsOpenAIReasoningEffort");
    // The OpenAI capability predicate is colocated with the other model
    // predicates in the types module so the client and UI can't diverge.
    expect(aiModelTypes).toContain("export function supportsOpenAIReasoningEffort");
    // The hook keys options off the model and clamps the stored effort to it.
    expect(useControlBay).toContain("reasoningEffortsForModel(chatModel)");
    expect(useControlBay).toContain("clampReasoningEffortToModel(current, chatModel)");
  });

  it("hides the reasoning control on both composers when the model ignores effort", () => {
    expect(controlBay).toContain("bay.modelSupportsReasoning");
    expect(chatDock).toContain("controls.modelSupportsReasoning");
    // The effort badge in the trigger is gated, not always rendered.
    expect(controlBay).toMatch(/modelSupportsReasoning\s*\?[\s\S]*c2-model-effort/);
    expect(chatDock).toMatch(/modelSupportsReasoning\s*\?[\s\S]*c2-model-effort/);
  });

  it("drops the dropdown caret from the model trigger on both composers", () => {
    // The model pill opens its menu on click; the down/up caret was redundant
    // chrome. The submenu's expand chevron (inside the menu) is unaffected.
    const bayModelStart = controlBay.indexOf('id="bay-model"');
    const bayModelTrigger = controlBay.slice(
      bayModelStart,
      controlBay.indexOf("</DropdownMenu.Trigger>", bayModelStart)
    );
    expect(bayModelTrigger).not.toContain("mchev");

    const chatModelStart = chatDock.indexOf('id="chat-model"');
    const chatModelTrigger = chatDock.slice(
      chatModelStart,
      chatDock.indexOf("</DropdownMenu.Trigger>", chatModelStart)
    );
    expect(chatModelTrigger).not.toContain("mchev");

    // The mode pill keeps its caret; only the model trigger's chevron is gone.
    expect(css).not.toContain(".c2-model .mchev");
    expect(css).not.toContain('.c2-model[aria-expanded="true"] .mchev');
    expect(css).toContain(".c2-mode .mchev");
  });

  it("formats provider model labels in both model menus", () => {
    expect(chatDock).toContain('part === "gpt" ? "GPT"');
    expect(controlBay).toContain('part === "gpt" ? "GPT"');
    expect(chatDock).toContain("formatClaudeModelLabel");
    expect(controlBay).toContain("formatClaudeModelLabel");
  });

  it("styles the tools as borderless icon buttons that dim when unavailable", () => {
    const base = extractRuleBody(".action-btn");
    expect(base).toMatch(/cursor:\s*pointer/);
    const disabled = extractRuleBody(".action-btn:disabled");
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
  });
});

describe("composer — message screenshots", () => {
  it("renders attached screenshots as a thumbnail gallery in the chat", () => {
    expect(messageList).toMatch(/className="message-screenshots"/);
    expect(messageList).toMatch(/className="message-thumbnail"/);
    const gallery = extractRuleBody(".message-screenshots");
    expect(gallery).toMatch(/display:\s*flex/);
    const thumb = extractRuleBody(".message-thumbnail");
    expect(thumb).toMatch(/object-fit:\s*cover/);
  });

  it("overlays the timestamp on the first screenshot", () => {
    const overlay = extractRuleBody(".message-timestamp-overlay");
    expect(overlay).toMatch(/position:\s*absolute/);
    expect(overlay).toMatch(/font-family:[^;]*monospace/);
  });
});

describe("composer — paste and attach files", () => {
  it("listens for paste events on the chat input", () => {
    expect(chatDock).toMatch(/onInputPaste=\{handlePaste\}/);
    expect(chatUi).toMatch(/onPaste=\{onInputPaste\}/);
  });

  it("reads pasted files and stages them through the shared pipeline", () => {
    // Pasted images and copied files both arrive as clipboard items of kind
    // "file"; stageFile reads them and funnels into addAttachment.
    expect(chatDock).toMatch(/item\.kind !== "file"/);
    expect(chatDock).toMatch(/onStageFile\(file\)/);
    expect(attachmentHook).toMatch(/readAsDataURL\(file\)/);
  });

  it("opens the OS file picker from the paperclip button", () => {
    expect(chatDock).toMatch(/id="attach-file"/);
    expect(chatDock).toMatch(/fileInputRef\.current\?\.click\(\)/);
    expect(chatDock).toMatch(/onChange=\{\(event\) =>/);
  });

  it("shares the per-message cap across frames, pastes, and picks", () => {
    // captureScreenshot, the paste handler, and the picker all funnel through
    // addAttachment, which enforces MAX_ATTACHMENTS — so the cap holds.
    expect(attachmentHook).toMatch(/const addAttachment[\s\S]*?current\.length >= MAX_ATTACHMENTS/);
  });
});
