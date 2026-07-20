import { describe, expect, it } from "vitest";
import {
  canRunClaimExtractor,
  lensFindingToClaim,
  lensFindingsToClaimsForChunk,
} from "../src/sidepanel/lib/claims.js";
import { prepareSourceForLensRuns } from "../src/sidepanel/lib/lens-run-chunks.js";
import type { PanelSource } from "../src/sidepanel/types.js";
import type { TranscriptSegment } from "../src/types/transcript.js";

const transcript: TranscriptSegment[] = [
  { text: "The first claim.", start: 0, duration: 10, formatted: "0:00" },
  { text: "The later claim.", start: 301, duration: 10, formatted: "5:01" },
];

const source: PanelSource = {
  key: "youtube:test",
  kind: "youtube_video",
  title: "Test video",
  url: "https://www.youtube.com/watch?v=test",
  text: "[0:00] The first claim.\n[5:01] The later claim.",
  scope: "transcript",
};

describe("Claim Extractor source eligibility", () => {
  it("accepts readable webpages and PDFs", () => {
    const webPage: PanelSource = {
      ...source,
      key: "url:https://example.com/article",
      kind: "web_page",
      title: "Article",
      url: "https://example.com/article",
      text: "A readable article.",
      scope: "page",
    };
    const pdf: PanelSource = {
      ...webPage,
      key: "pdf:https://example.com/report.pdf",
      kind: "pdf",
      title: "Report",
      url: "https://example.com/report.pdf",
    };

    expect(canRunClaimExtractor(webPage, [])).toBe(true);
    expect(canRunClaimExtractor(pdf, [])).toBe(true);
  });

  it("requires the source content that will actually be analyzed", () => {
    const emptyWebPage: PanelSource = {
      ...source,
      key: "url:https://example.com/empty",
      kind: "web_page",
      url: "https://example.com/empty",
      text: "   ",
      scope: "page",
    };

    expect(canRunClaimExtractor(emptyWebPage, [])).toBe(false);
    expect(canRunClaimExtractor(source, [])).toBe(false);
    expect(canRunClaimExtractor(source, transcript)).toBe(true);
    expect(canRunClaimExtractor(null, transcript)).toBe(false);
  });
});

describe("claim finding conversion", () => {
  it("prefers persisted bounded quotations over legacy detail encoding", () => {
    expect(
      lensFindingToClaim({
        text: "A claim",
        category: "scientific",
        detail: "Quotes: legacy quote",
        confidence: 0.9,
        quotes: [" bounded quote "],
      }).quotes
    ).toEqual(["bounded quote"]);
  });

  it("gives unspanned managed findings the owning transcript chunk anchor", async () => {
    const prepared = await prepareSourceForLensRuns(source, transcript);
    const secondChunk = prepared.chunks[1];

    const claims = lensFindingsToClaimsForChunk(
      [
        {
          text: "The later claim.",
          category: "scientific",
          detail: "A verifiable assertion.",
          confidence: 0.9,
        },
      ],
      secondChunk
    );

    expect(claims).toEqual([
      expect.objectContaining({
        claim: "The later claim.",
        timestamp: "5:01",
      }),
    ]);
  });
});
