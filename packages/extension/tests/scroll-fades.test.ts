import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeScrollOverflow } from "../src/lib/scroll.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "sidepanel", "sidepanel.css"), "utf-8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (m) => m[1]
  );
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("computeScrollOverflow", () => {
  it("reports no fades when the content fits without scrolling", () => {
    expect(
      computeScrollOverflow({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })
    ).toEqual({ top: false, bottom: false });
  });

  it("fades only the bottom when scrolled to the top of an overflowing log", () => {
    expect(
      computeScrollOverflow({ scrollTop: 0, scrollHeight: 600, clientHeight: 200 })
    ).toEqual({ top: false, bottom: true });
  });

  it("fades only the top when scrolled to the very bottom", () => {
    expect(
      computeScrollOverflow({ scrollTop: 400, scrollHeight: 600, clientHeight: 200 })
    ).toEqual({ top: true, bottom: false });
  });

  it("fades both edges when scrolled to the middle", () => {
    expect(
      computeScrollOverflow({ scrollTop: 200, scrollHeight: 600, clientHeight: 200 })
    ).toEqual({ top: true, bottom: true });
  });

  it("treats sub-pixel offsets at either edge as touching the edge", () => {
    expect(
      computeScrollOverflow({ scrollTop: 0.4, scrollHeight: 600, clientHeight: 200 })
    ).toEqual({ top: false, bottom: true });
    expect(
      computeScrollOverflow({ scrollTop: 399.4, scrollHeight: 600, clientHeight: 200 })
    ).toEqual({ top: true, bottom: false });
  });
});

describe("chat log fade mask (sidepanel.css)", () => {
  it("masks the log with a gradient so its edges can fade", () => {
    expect(ruleBody(".messages")).toMatch(/mask-image:\s*linear-gradient/);
  });

  it("defaults both fades off so a non-scrolling log shows none", () => {
    const messages = ruleBody(".messages");
    expect(messages).toMatch(/--messages-fade-top:\s*0px/);
    expect(messages).toMatch(/--messages-fade-bottom:\s*0px/);
  });

  it("arms each fade only when the matching overflow attribute is set", () => {
    expect(ruleBody('.messages[data-overflow-top="true"]')).toMatch(
      /--messages-fade-top:\s*\d/
    );
    expect(ruleBody('.messages[data-overflow-bottom="true"]')).toMatch(
      /--messages-fade-bottom:\s*\d/
    );
  });
});
