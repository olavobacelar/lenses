import { afterEach, describe, expect, it, vi } from "vitest";
import { positionChatbox } from "../src/content/ChatboxModel.js";

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeElement(bounds: DOMRect, classNames: string[] = []): HTMLElement {
  const style: Partial<CSSStyleDeclaration> = {};
  return {
    getBoundingClientRect: () => bounds,
    classList: {
      contains: (className: string) => classNames.includes(className),
    },
    style,
  } as HTMLElement;
}

describe("positionChatbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a tall selection chatbox inside the viewport when there is not enough room below", () => {
    vi.stubGlobal("window", { innerWidth: 1200, innerHeight: 900 });
    const anchor = fakeElement(rect({ left: 480, top: 420, width: 180, height: 32 }));
    const chatbox = fakeElement(
      rect({ left: 0, top: 0, width: 680, height: 800 }),
      ["lenses-chatbox--selection"]
    );

    positionChatbox(anchor, chatbox);

    expect(chatbox.style.left).toBe("480px");
    expect(chatbox.style.top).toBe("92px");
    expect(chatbox.style.maxHeight).toBe("800px");
    expect(chatbox.style.minHeight).toBe("800px");
  });

  it("shrinks a selection chatbox when the viewport is shorter than the preferred panel height", () => {
    vi.stubGlobal("window", { innerWidth: 900, innerHeight: 500 });
    const anchor = fakeElement(rect({ left: 80, top: 220, width: 180, height: 28 }));
    const chatbox = fakeElement(
      rect({ left: 0, top: 0, width: 680, height: 800 }),
      ["lenses-chatbox--selection"]
    );

    positionChatbox(anchor, chatbox);

    expect(chatbox.style.top).toBe("8px");
    expect(chatbox.style.maxHeight).toBe("484px");
    expect(chatbox.style.minHeight).toBe("484px");
  });

  it("uses the taller detached fallback for finding chatboxes", () => {
    vi.stubGlobal("window", { innerWidth: 900, innerHeight: 700 });
    const anchor = fakeElement(rect({ left: 120, top: 260, width: 160, height: 28 }));
    const chatbox = fakeElement(
      rect({ left: 0, top: 0, width: 0, height: 0 }),
      ["lenses-chatbox--detached"]
    );

    positionChatbox(anchor, chatbox);

    expect(chatbox.style.left).toBe("120px");
    expect(chatbox.style.top).toBe("52px");
    expect(chatbox.style.maxHeight).toBe("640px");
    expect(chatbox.style.minHeight).toBe("640px");
  });
});
