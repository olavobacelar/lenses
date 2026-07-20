// The Claims list moved from the stacked card layout (meta line + Seek/Verify
// buttons on every row) to a compact single-line presentation:
//   - the timestamp itself is the seek control (no separate Seek button)
//   - category is a colored dot instead of a text label
//   - Verify is an icon revealed on hover/focus
//   - the header Extract button is a primary CTA only until claims exist, then
//     it recedes to a quiet re-extract icon.
//
// The other lens sections still share FindingView, so its default (stacked)
// branch must stay intact. These tests target the components/CSS directly,
// matching the file-reading style used across the sidepanel suite.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "sidepanel");

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf-8");
}

const css = read("sidepanel.css");
const findingView = read("components/FindingView.tsx");
const claimsSection = read("components/ClaimsSection.tsx");
const icons = read("components/Icons.tsx");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (bodies.length === 0) throw new Error(`Could not find rule for ${selector}`);
  return bodies.join("\n");
}

describe("Claims section — compact single-line rows", () => {
  it("renders each claim through FindingView's compact variant", () => {
    expect(claimsSection).toContain('variant="compact"');
    // The timestamp stamp only renders for time-anchored claims; webpage claims
    // have no locator and PDF claims get a page chip in that slot instead.
    expect(claimsSection).toContain(
      'const hasTimestamp = page === undefined && claim.timestamp !== "--:--";'
    );
    expect(claimsSection).toContain(
      "timestampLabel={hasTimestamp ? claim.timestamp : undefined}"
    );
    expect(claimsSection).toContain("category={claim.category}");
    // The pre-formatted "timestamp | category" meta string is no longer built.
    expect(claimsSection).not.toContain("${claim.timestamp} | ${claim.category}");
  });

  it("locates PDF claims by page instead of a dead --:-- stamp", () => {
    expect(claimsSection).toContain("onPageJump: (pageNumber: number) => void");
    expect(claimsSection).toContain("p.${claim.pageLabel ?? page}");
    expect(claimsSection).toContain(
      "onPageJump={page === undefined ? undefined : () => onPageJump(page)}"
    );
    // parseTimestamp("--:--") is 0, which would render a stamp that seeks to 0;
    // page-anchored claims must suppress the seek pair entirely.
    expect(claimsSection).toContain(
      "hasTimestamp ? parseTimestamp(claim.timestamp) : undefined"
    );
  });

  it("uses source-neutral loading copy for webpage, PDF, and transcript runs", () => {
    expect(claimsSection).toContain("Extracting claims...");
    expect(claimsSection).not.toContain("Extracting claims from transcript...");
  });

  it("keeps sending the claim text to chat and verifying on demand", () => {
    expect(claimsSection).toContain("onSendToChat={onSendToChat}");
    expect(claimsSection).toContain("onVerify={() => onVerifyClaim(claim)}");
  });
});

describe("FindingView compact variant", () => {
  // Isolate the compact branch: everything from the guard up to the default
  // `return (` that opens the stacked layout.
  const compactBranch = (() => {
    const start = findingView.indexOf('variant === "compact"');
    const rest = findingView.slice(start);
    const defaultReturn = rest.indexOf('<article className="claim-item">');
    return defaultReturn === -1 ? rest : rest.slice(0, defaultReturn);
  })();

  it("uses the timestamp as the seek control instead of a Seek button", () => {
    expect(compactBranch).toContain('className="claim-stamp"');
    expect(compactBranch).toContain("onClick={() => onSeek(seekSeconds)}");
    // The compact branch carries no "Seek"/"Verify" text buttons.
    expect(compactBranch).not.toMatch(/>\s*Seek\s*</);
    expect(compactBranch).not.toMatch(/>\s*Verify\s*</);
  });

  it("shows category as a colored dot and a hover/focus icon Verify", () => {
    expect(compactBranch).toContain('className="claim-cat-dot"');
    expect(compactBranch).toContain("data-category={category}");
    expect(compactBranch).toContain('className="claim-verify"');
    expect(compactBranch).toContain("<VerifyIcon />");
  });

  it("keeps the stacked default branch for the other lens sections", () => {
    expect(findingView).toContain('className="claim-item"');
    expect(findingView).toMatch(/>\s*Seek\s*</);
    expect(findingView).toContain("finding-enrichment");
  });
});

describe("Verify icon", () => {
  it("is exported as a shield-check from Icons", () => {
    expect(icons).toContain("export function VerifyIcon");
    expect(icons).toContain('stroke="currentColor"');
  });
});

describe("Claims header — state-aware Extract", () => {
  it("is a primary CTA when empty and a quiet re-extract icon once claims exist", () => {
    expect(claimsSection).toContain("const hasClaims = claims.length > 0;");
    expect(claimsSection).toContain("acc-action--primary");
    expect(claimsSection).toContain("acc-action--icon");
    expect(claimsSection).toContain("<RetryIcon");
    expect(claimsSection).toContain('title={hasClaims ? "Re-extract claims" : undefined}');
  });
});

describe("compact claim CSS", () => {
  it("lays each claim out as a single hover-highlighted row", () => {
    const row = ruleBody(".claim-row");
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/align-items:\s*center/);
  });

  it("styles the timestamp chip as an accent-colored seek control", () => {
    // .claim-stamp now shares its rule with the transcript .timestamp (same
    // seek-control treatment), so match the merged selector list.
    const stamp = ruleBody(".claim-stamp,\n.timestamp");
    expect(stamp).toMatch(/color:\s*var\(--accent\)/);
    expect(stamp).toMatch(/cursor:\s*pointer/);
  });

  it("colors the category dot per category", () => {
    expect(ruleBody('.claim-cat-dot[data-category="statistic"]')).toMatch(/background:\s*#4f8df9/);
    expect(ruleBody('.claim-cat-dot[data-category="other"]')).toMatch(/border:/);
  });

  it("keeps Verify quiet at rest and reveals it on hover or focus", () => {
    expect(ruleBody(".claim-verify")).toMatch(/opacity:\s*0/);
    const reveal = ruleBody(".claim-row:hover .claim-verify,\n.claim-verify:focus-visible");
    expect(reveal).toMatch(/opacity:\s*1/);
  });

  it("maps credibility to green (high) and red (low)", () => {
    expect(ruleBody('.claim-cred-dot[data-credibility="high"]')).toMatch(/var\(--ok\)/);
    expect(ruleBody('.claim-cred-dot[data-credibility="low"]')).toMatch(/var\(--danger\)/);
  });

  it("gives Extract a primary fill and an icon-only variant", () => {
    expect(ruleBody(".acc-action--primary")).toMatch(/background:\s*var\(--accent\)/);
    const icon = ruleBody(".acc-action--icon");
    expect(icon).toMatch(/width:\s*26px/);
  });
});
