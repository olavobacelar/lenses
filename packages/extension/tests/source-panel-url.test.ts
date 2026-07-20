import { describe, expect, it } from "vitest";
import {
  getUnsupportedSourcePage,
  isSourcePanelSupportedUrl,
  UNSUPPORTED_SOURCE_PAGE_MESSAGE,
} from "../src/lib/source-panel-url";

describe("source panel URL support", () => {
  it("supports http and https pages as readable sources", () => {
    expect(isSourcePanelSupportedUrl("https://example.com/story")).toBe(true);
    expect(isSourcePanelSupportedUrl("http://localhost:3000")).toBe(true);
  });

  it("describes browser pages as unsupported instead of attempting a content script read", () => {
    expect(isSourcePanelSupportedUrl("chrome://extensions/")).toBe(false);
    expect(
      getUnsupportedSourcePage({
        title: "Extensions",
        url: "chrome://extensions/",
      })
    ).toEqual({
      title: "Extensions",
      message: UNSUPPORTED_SOURCE_PAGE_MESSAGE,
      url: "chrome://extensions/",
    });
  });

  it("does not mark supported pages as unsupported", () => {
    expect(
      getUnsupportedSourcePage({
        title: "Example",
        url: "https://example.com/story",
      })
    ).toBeNull();
  });
});
