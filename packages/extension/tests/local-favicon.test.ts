import { describe, expect, it } from "vitest";
import { getLocalFaviconUrl } from "../src/lib/local-favicon";

describe("local citation source marks", () => {
  it("creates a deterministic data URL without contacting a favicon service", () => {
    const first = getLocalFaviconUrl("https://www.example.org/report");
    const second = getLocalFaviconUrl("https://www.example.org/another-page");

    expect(first).toBe(second);
    expect(first).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(first)).toContain(">E</text>");
  });

  it("uses a safe fallback for malformed URLs", () => {
    expect(decodeURIComponent(getLocalFaviconUrl("not a URL"))).toContain(">?</text>");
  });
});
