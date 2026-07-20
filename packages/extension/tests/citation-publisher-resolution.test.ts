import { describe, expect, it } from "vitest";
import { parseCitationPublisherResolution } from "../src/lib/citation-publisher-resolution";

describe("citation publisher resolution", () => {
  it("does not turn transport failures into cached misses", () => {
    const parsed = parseCitationPublisherResolution(
      { publishers: {}, authoritativeUrls: ["https://example.com/article"] },
      true
    );

    expect(parsed.authoritativeUrls.size).toBe(0);
  });

  it("identifies misses only when the managed resolver covered the URL", () => {
    const parsed = parseCitationPublisherResolution({
      publishers: {},
      authoritativeUrls: ["https://example.com/article"],
    });

    expect(parsed.authoritativeUrls.has("https://example.com/article")).toBe(true);
    expect(parsed.authoritativeUrls.has("https://unresolved.example/article")).toBe(false);
  });

  it("keeps successful publisher labels alongside authoritative coverage", () => {
    const parsed = parseCitationPublisherResolution({
      publishers: { "https://example.com/article": "Example Publisher" },
      authoritativeUrls: ["https://example.com/article"],
    });

    expect(parsed.publishers["https://example.com/article"]).toBe("Example Publisher");
  });
});
