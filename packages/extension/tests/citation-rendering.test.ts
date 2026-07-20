import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { readOpenAIStreamingResponse } from "../src/background/assistant-streaming.js";
import { buildCitationTokens, getHostname } from "../src/lib/RichText.js";

const here = dirname(fileURLToPath(import.meta.url));
const extSrc = join(here, "..", "src");
const read = (...parts: string[]) => readFileSync(join(extSrc, ...parts), "utf-8");

const messageList = read("sidepanel", "components", "MessageList.tsx");
const sidepanelCss = read("sidepanel", "sidepanel.css");
const chatboxView = read("content", "ChatboxView.tsx");
const chatboxCss = read("content", "styles", "chatbox.css");
const calloutStack = read("content", "SourceCalloutStack.tsx");
const chatUi = read("lib", "ChatUi.tsx");
const richText = read("lib", "RichText.tsx");

const cite = (url: string, title: string) => ({ url, title });
const citationTokens = (segments: Parameters<typeof buildCitationTokens>[0]) =>
  buildCitationTokens(segments).map((token) =>
    token.kind === "text" ? token.text : token.citations.map((citation) => citation.title).join("+")
  );
const citationGroups = (segments: Parameters<typeof buildCitationTokens>[0]) =>
  buildCitationTokens(segments).filter((token) => token.kind === "citations") as Array<{
    citations: Array<{ url: string; title: string }>;
  }>;

describe("getHostname", () => {
  it("returns the hostname of a URL", () => {
    expect(getHostname("https://www.cbc.ca/news/story")).toBe("www.cbc.ca");
  });

  it("returns an empty string for unparseable URLs", () => {
    expect(getHostname("not a url")).toBe("");
  });
});

describe("buildCitationTokens — aggregation", () => {
  it("merges co-located citations into a single group", () => {
    const groups = citationGroups([
      { text: "and ", citations: [cite("https://dw.com/x", "DW")] },
      { text: "", citations: [cite("https://pravda.com.ua/y", "Pravda")] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations).toHaveLength(2);
  });

  it("de-dupes the same source within a group (no 'tricycle / tricycle')", () => {
    const groups = citationGroups([
      { text: "joy ", citations: [cite("https://tricycle.org/a", "Joy")] },
      { text: "", citations: [cite("https://tricycle.org/a", "Joy again")] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations).toHaveLength(1);
  });

  it("waits to render a citation until the sentence ends", () => {
    const tokens = citationTokens([
      { text: "For credit", citations: [cite("https://quantamagazine.org/a", "Quanta")] },
      { text: " and authorship. The next sentence continues.", citations: [] },
    ]);
    expect(tokens).toEqual([
      "For credit and authorship. ",
      "Quanta",
      "The next sentence continues.",
    ]);
  });

  it("renders pending citations before a paragraph break", () => {
    const tokens = citationTokens([
      { text: "Frontier access is unequal", citations: [cite("https://quantamagazine.org/a", "Quanta")] },
      { text: "\n\nThe next paragraph continues.", citations: [] },
    ]);
    expect(tokens).toEqual([
      "Frontier access is unequal",
      "Quanta",
      "\n\nThe next paragraph continues.",
    ]);
  });

  it("moves trailing newlines after the citation so the chip sits inline", () => {
    // When a segment text already ends with \n\n (because the AI streamed the
    // paragraph break before the citation event), the chip must not be pushed
    // after the <br><br> — that would put it on its own line below the text.
    const tokens = citationTokens([
      { text: "Paragraph one text.\n\n", citations: [cite("https://example.com", "Source")] },
      { text: "Paragraph two text.", citations: [] },
    ]);
    expect(tokens).toEqual([
      "Paragraph one text.",
      "Source",
      "\n\nParagraph two text.",
    ]);
  });

  it("keeps citations separated by sentence boundaries", () => {
    const groups = citationGroups([
      { text: "foo.", citations: [cite("https://a.com", "A")] },
      { text: " bar.", citations: [cite("https://b.com", "B")] },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("skips citations with an unparseable URL", () => {
    const groups = citationGroups([{ text: "x", citations: [cite("not a url", "X")] }]);
    expect(groups).toHaveLength(0);
  });
});

describe("sidepanel renders aggregated, inline citations", () => {
  it("opts into grouping through the shared renderer", () => {
    expect(messageList).toContain("ChatMessageList");
    expect(chatUi).toContain("TextSegmentsWithCitations");
    expect(chatUi).toContain("grouped");
    expect(messageList).not.toContain("CitationList");
  });

  it("styles the chip + paginated popover, not an end-of-answer list", () => {
    expect(sidepanelCss).toContain(".citation-chip");
    expect(sidepanelCss).toContain(".citation-pop");
    expect(sidepanelCss).not.toContain(".citation-list");
    expect(sidepanelCss).not.toContain(".citation-card");
  });
});

describe("the inline renderer is shared from lib/", () => {
  it("lives in lib/, not under content/", () => {
    expect(existsSync(join(extSrc, "lib", "RichText.tsx"))).toBe(true);
    expect(existsSync(join(extSrc, "content", "RichText.tsx"))).toBe(false);
  });

  it("is imported by the chatbox and the source callout from lib/", () => {
    expect(chatboxView).toContain('from "../lib/RichText.js"');
    expect(calloutStack).toContain('from "../lib/RichText.js"');
  });
});

describe("aggregation applies to every chat surface", () => {
  it("the in-page chatbox opts into grouping too", () => {
    expect(chatboxView).toContain("ChatMessageList");
    expect(chatUi).toContain("grouped");
  });

  it("the source callout opts into grouping too", () => {
    expect(calloutStack).toContain("grouped");
  });

  it("the content bundle styles the chip and popover", () => {
    expect(chatboxCss).toContain(".citation-chip");
    expect(chatboxCss).toContain(".citation-pop");
  });
});

describe("OpenAI citation annotations", () => {
  it("uses url_citation character ranges to build citation-bearing segments", async () => {
    const latest: { textSegments: Parameters<typeof buildCitationTokens>[0] } = {
      textSegments: [],
    };
    const response = sseResponse([
      {
        type: "response.output_text.delta",
        delta: "Alpha cited text. Next sentence.",
      },
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Alpha cited text. Next sentence.",
                  annotations: [
                    {
                      type: "url_citation",
                      start_index: 0,
                      end_index: 17,
                      url: "https://quantamagazine.org/example",
                      title: "Quanta Magazine",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    await Effect.runPromise(
      readOpenAIStreamingResponse(response, {
        onChunk: (_text, textSegments) => {
          latest.textSegments = textSegments;
        },
        onCitations: (_citations, textSegments) => {
          latest.textSegments = textSegments;
        },
        onThinking: () => undefined,
        onSearching: () => undefined,
        onCredibility: () => undefined,
      })
    );

    expect(latest.textSegments).toEqual([
      {
        text: "Alpha cited text.",
        citations: [
          {
            type: "url_citation",
            url: "https://quantamagazine.org/example",
            title: "Quanta Magazine",
            citedText: "",
          },
        ],
      },
      { text: " Next sentence.", citations: [] },
    ]);
    expect(citationTokens(latest.textSegments)).toEqual([
      "Alpha cited text.",
      "Quanta Magazine",
      " Next sentence.",
    ]);
  });
});

describe("citation pills show resolved publisher names", () => {
  it("resolves publishers through the background resolver, shared + cached", () => {
    expect(richText).toContain("resolve-citation-publishers");
    expect(richText).toContain("publisherCache");
    expect(richText).toContain("authoritativeUrls.has(url)");
  });

  it("portals the popover out of clipping containers (theme scope in shadow DOM)", () => {
    expect(richText).toContain("resolvePopoverContainer");
    expect(richText).toContain("lenses-shadow-theme-scope");
  });
});

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body);
}

describe("citation popover opens on hover, above the source", () => {
  it("opens on hover rather than requiring a click toggle", () => {
    expect(richText).toContain("onMouseEnter={openMenu}");
    expect(richText).toContain("scheduleClose");
  });

  it("prefers placing the card above the badge (Claude-style)", () => {
    expect(richText).toContain("rect.top - gap - popHeight");
  });

  it("detects in-popover clicks via composedPath so shadow-DOM arrows don't close it", () => {
    expect(richText).toContain("composedPath()");
  });
});

describe("citation card content + controls", () => {
  it("shows the cited snippet only when the source provides it", () => {
    expect(richText).toContain("citation-pop-snippet");
    expect(richText).toContain("current.citedText");
  });

  it("styles the snippet in both chat surfaces", () => {
    expect(sidepanelCss).toContain(".citation-pop-snippet");
    expect(chatboxCss).toContain(".citation-pop-snippet");
  });

  it("gives the nav arrows a slight fill highlight, not a border frame", () => {
    expect(sidepanelCss).toContain("color-mix(in srgb, var(--ink) 6%, transparent)");
    expect(chatboxCss).toContain("color-mix(in srgb, var(--pop-ink) 8%, transparent)");
  });
});

describe("product logging", () => {
  it("uses Lenses branding in the streaming and transcript paths", () => {
    const retiredPrefix = `[${["Ask", "YouTube"].join(" ")}]`;
    const files = [
      ["background", "api", "stream-processor.ts"],
      ["background", "api", "claude-client.ts"],
      ["content", "youtube-transcript.ts"],
      ["content", "youtube-screenshot.ts"],
      ["schemas", "claude-api.ts"],
    ];
    for (const parts of files) {
      expect(read(...parts)).not.toContain(retiredPrefix);
    }
  });
});
