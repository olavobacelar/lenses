// Tests for attaching PDF and text/markdown files to the composer (alongside the
// existing image capture/paste). Files are staged like screenshots and flow over
// the same `screenshots` wire field as data URLs; the content layer turns each
// into the right block per provider (covered by attachment-content.test.ts).
//
// The sidepanel is now React, so source assertions target the focused component
// or hook that owns the behavior instead of a single side-effecting entry file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "src", "sidepanel");
const css = readFileSync(join(dir, "sidepanel.css"), "utf-8");
const chatDock = readFileSync(join(dir, "components", "ChatDock.tsx"), "utf-8");
const messageList = readFileSync(join(dir, "components", "MessageList.tsx"), "utf-8");
const icons = readFileSync(join(dir, "components", "Icons.tsx"), "utf-8");
const attachmentUtils = readFileSync(join(dir, "lib", "attachments.ts"), "utf-8");
const chromeUtils = readFileSync(join(dir, "lib", "chrome.ts"), "utf-8");
const attachmentHook = readFileSync(join(dir, "hooks", "useAttachments.ts"), "utf-8");
const chatHook = readFileSync(join(dir, "hooks", "useChat.ts"), "utf-8");
const aiContentTypes = readFileSync(
  join(here, "..", "src", "types", "ai-content.ts"),
  "utf-8"
);

function extractRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector} in sidepanel.css`);
  return bodies.join("\n");
}

describe("composer — file attach affordance", () => {
  it("adds a paperclip button and a hidden file input", () => {
    expect(chatDock).toContain('id="attach-file"');
    expect(chatDock).toMatch(/id="file-input"[\s\S]*type="file"/);
  });

  it("accepts images, PDFs and text/markdown in the picker", () => {
    const accept = chatDock.match(/accept="([^"]*)"/)?.[1] ?? "";
    expect(accept).toContain("application/pdf");
    expect(accept).toMatch(/\.md/);
    expect(accept).toMatch(/\.txt/);
  });

  it("widens the composer placeholder beyond images", () => {
    expect(chatDock).toMatch(/placeholder="Ask[^"]*attach a file"/);
  });

  it("shows the screenshot capture control for all source kinds", () => {
    expect(chatDock).toContain('id="capture-screenshot"');
    expect(chatDock).toContain('showYouTubeTools ? "Capture frame" : "Capture screenshot"');
    expect(chatDock).toMatch(
      /id="capture-screenshot"[\s\S]*?\{__LOCAL_SLIDE_EXPORT__ && showYouTubeTools &&/
    );
  });
});

describe("composer — attachment staging logic", () => {
  it("classifies picked files into image or document attachments", () => {
    expect(attachmentUtils).toMatch(/function classifyFile/);
    expect(attachmentUtils).toMatch(/application\/pdf/);
    expect(attachmentUtils).toMatch(/text\/markdown/);
  });

  it("normalizes the data URL to the classified media type when staging", () => {
    expect(attachmentHook).toMatch(/const stageFile/);
    expect(attachmentHook).toMatch(/data:\$\{classified\.mediaType\};base64,/);
  });

  it("guards file size against the per-file byte cap", () => {
    expect(attachmentHook).toMatch(/MAX_ATTACHMENT_BYTES/);
    expect(attachmentHook).toMatch(/file\.size > MAX_ATTACHMENT_BYTES/);
  });

  it("captures visible screenshots on non-YouTube pages", () => {
    expect(chromeUtils).toMatch(/function captureVisibleTabScreenshot/);
    expect(chromeUtils).toMatch(/chrome\.tabs\.captureVisibleTab/);
    expect(attachmentHook).toMatch(/captureVisibleTabScreenshot/);
    expect(attachmentHook).toMatch(/source\.kind !== "youtube_video"/);
  });

  it("keeps the YouTube frame capture path for video sources", () => {
    expect(attachmentHook).toMatch(/sendToActiveTab<[\s\S]*?\{ action: "captureScreenshot" \}/);
    expect(attachmentHook).toMatch(/formatted: result\.formatted/);
  });

  it("allows attachment-backed chat even when source text is empty", () => {
    expect(chatHook).toMatch(/!targetSource\.text\.trim\(\) && attachedFiles\.length === 0/);
  });
});

describe("composer — document rendering", () => {
  it("splits message attachments into images and document chips", () => {
    expect(messageList).toMatch(/isImageAttachment/);
    expect(messageList).toMatch(/className="message-attachments"/);
    expect(messageList).toMatch(/DocumentChip/);
  });

  it("labels document chips by media type", () => {
    expect(attachmentUtils).toMatch(/function documentAttachmentLabel[\s\S]*?application\/pdf[\s\S]*?"PDF"/);
    expect(attachmentUtils).toMatch(/function documentAttachmentLabel[\s\S]*?text\/[\s\S]*?"Text"/);
  });

  it("styles the in-message document chip and the staging chip", () => {
    const messageChip = extractRuleBody(".message-attachment");
    expect(messageChip).toMatch(/border-radius:/);
    const stagingChip = extractRuleBody(".attachment-chip");
    expect(stagingChip).toMatch(/display:\s*inline-flex/);
  });
});

describe("composer — image preview and remove controls", () => {
  it("opens sent screenshots and staged screenshots in an image preview dialog", () => {
    expect(messageList).toMatch(/onPreviewImage/);
    expect(messageList).toContain('className="message-thumbnail-btn"');
    expect(chatDock).toContain("ImagePreviewDialog");
    expect(chatDock).toContain('className="screenshot-preview-btn"');
    expect(chatDock).toContain('className="image-preview-frame"');
  });

  it("uses an icon remove button with hover/focus styling", () => {
    expect(icons).toMatch(/function CloseIcon/);
    expect(chatDock).toContain('className="screenshot-remove"');
    expect(chatDock).toContain("<CloseIcon size={12} />");
    const remove = extractRuleBody(".screenshot-remove");
    expect(remove).toMatch(/display:\s*grid/);
    expect(remove).toMatch(/place-items:\s*center/);
    const hover = extractRuleBody(".screenshot-remove:hover");
    expect(hover).toMatch(/background:/);
  });

  it("adds a slight black frame around enlarged images", () => {
    const frame = extractRuleBody(".image-preview-frame");
    expect(frame).toMatch(/background:\s*#050505/);
    expect(frame).toMatch(/border:\s*1px solid rgba\(0,\s*0,\s*0/);
  });
});

describe("type layer — document content block", () => {
  it("declares a DocumentContent type for PDFs and text", () => {
    expect(aiContentTypes).toMatch(/interface DocumentContent/);
    expect(aiContentTypes).toMatch(/media_type:\s*'application\/pdf'/);
  });

  it("includes DocumentContent in the MessageContent union", () => {
    expect(aiContentTypes).toMatch(/MessageContent =[^;]*DocumentContent/);
  });
});
