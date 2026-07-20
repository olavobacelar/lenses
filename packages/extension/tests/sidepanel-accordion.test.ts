// The sidebar accordion: each section is a framed card (border + surface), but
// the in-header chrome is gone — no per-section color dot, no expand chevron —
// and there are no divider lines between rows (the frame is the separation).
// The header treatment is shared, so the chevron must be absent from all three
// section components (Source, Claims, every lens). Sections also hold their size
// so opening one scrolls the accordion rather than squashing its neighbors.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "sidepanel");
const read = (p: string) => readFileSync(join(root, p), "utf-8");

const css = read("sidepanel.css");
const app = read("App.tsx");
const source = read("components/SourceSection.tsx");
const claims = read("components/ClaimsSection.tsx");
const lenses = read("components/LensSections.tsx");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("sidebar accordion — clean headers", () => {
  it("drops the expand chevron from every section header", () => {
    expect(source).not.toContain("acc-chev");
    expect(claims).not.toContain("acc-chev");
    expect(lenses).not.toContain("acc-chev");
    expect(css).not.toContain("acc-chev");
  });

  it("removes the per-section color dot", () => {
    expect(css).not.toContain(".acc-head::before");
  });
});

describe("sidebar accordion — framed sections", () => {
  it("keeps every section closed when the side panel first opens", () => {
    expect(app).toContain('const [openSection, setOpenSection] = useState("");');
    expect(app).toContain('setOpenSection("");');
    expect(app).not.toContain('useState("claims")');
    expect(app).not.toContain('setOpenSection("claims")');
  });

  it("frames each section with a border, surface and radius", () => {
    const sec = ruleBody(".acc-section");
    expect(sec).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(sec).toMatch(/background:\s*var\(--paper\)/);
    expect(sec).toMatch(/border-radius/);
  });

  it("brightens the frame on hover instead of moving the surface", () => {
    expect(ruleBody(".acc-section:hover")).toMatch(/border-color:\s*var\(--icon-hover-border\)/);
  });

  it("flags a failed run by turning the frame to a warning color", () => {
    expect(ruleBody(".acc-section.run-failed")).toMatch(/border-color:\s*var\(--warn-border\)/);
  });

  it("holds each closed section at header height so its title is never crushed", () => {
    // Sections are flex children of the column accordion; the default
    // flex-shrink:1 let them collapse and clip when space was tight.
    expect(ruleBody(".acc-section")).toMatch(/flex:\s*0 0 auto/);
  });

  it("makes the open section flex and scroll its body so sibling headers stay visible", () => {
    // The open section grows/shrinks within the accordion; its header is pinned
    // and only its body scrolls, so a long open section can't push the other
    // section titles out of view (and the chat below can't crush them either).
    expect(ruleBody(".acc-section.open")).toMatch(/flex:\s*1 1 auto/);
    expect(ruleBody(".acc-section.open")).toMatch(/flex-direction:\s*column/);
    expect(ruleBody(".acc-head")).toMatch(/flex:\s*0 0 auto/);
    const openBody = ruleBody(".acc-section.open .acc-body");
    expect(openBody).toMatch(/overflow:\s*auto/);
    expect(openBody).toMatch(/min-height:\s*0/);
  });
});

describe("sidebar accordion — no inner separators", () => {
  it("removes the divider lines between rows in every list", () => {
    expect(ruleBody(".claim-row")).not.toMatch(/border-bottom/);
    expect(ruleBody(".claim-item")).not.toMatch(/border-bottom/);
    expect(ruleBody(".transcript-row")).not.toMatch(/border-bottom/);
  });

  it("keeps every content list flat — including the chat log, which sits on the panel background", () => {
    // The chat log used to keep its own raised surface; it is now frameless so
    // past messages dissolve into the panel background instead of a card.
    const messages = ruleBody(".messages");
    expect(messages).toMatch(/border:\s*0/);
    expect(messages).toMatch(/background:\s*transparent/);
    expect(messages).not.toMatch(/border:\s*1px solid var\(--line-soft\)/);
    expect(messages).not.toMatch(/background:\s*var\(--paper\)/);
    expect(css).not.toMatch(/\.claims-list,\s*\n\s*\.messages/);
  });
});

describe("sidebar accordion — clean panel edges", () => {
  it("drops the header underline and the chat divider; the framed sections carry the rhythm", () => {
    expect(ruleBody(".source-header")).not.toMatch(/border-bottom/);
    expect(ruleBody(".chat-dock")).not.toMatch(/border-top/);
  });

  it("keeps seek timestamps compact and tabular in a narrow column", () => {
    expect(ruleBody(".timestamp")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // The fixed 42px stamp column became an auto track (sized to the longest
    // stamp) shared across rows via subgrid; content takes the remaining space.
    expect(ruleBody(".transcript-row")).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);
  });
});
