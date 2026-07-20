import { LENS_NAMES } from "./constants";
import type {
  CopyChunk,
  DebugRun,
  DebugViewPayload,
  DefuddleData,
  ReadabilityData,
} from "./types";

export function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatTimestamp(epochMillis: number): string {
  if (!Number.isFinite(epochMillis) || epochMillis <= 0) return "unknown";
  return new Date(epochMillis).toISOString();
}

export function lensLabel(lensId: string): string {
  return LENS_NAMES[lensId] ?? lensId;
}

export function mergeDebugRuns(stored: DebugRun[], live: DebugRun[]): DebugRun[] {
  const byLens = new Map<string, DebugRun>();

  for (const run of stored) {
    byLens.set(run.lensId, run);
  }
  for (const run of live) {
    const existing = byLens.get(run.lensId);
    if (!existing || run.createdAt >= existing.createdAt) {
      byLens.set(run.lensId, run);
    }
  }

  return Array.from(byLens.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getDefuddleContentText(defuddle: DefuddleData | null): string {
  if (!defuddle) return "";

  const markdown = defuddle.contentMarkdown?.trim();
  if (markdown) return markdown;

  const html = defuddle.content?.trim();
  if (!html) return "";

  return htmlToText(html);
}

export function getReadabilityContentText(readability: ReadabilityData | null): string {
  if (!readability) return "";

  const textContent = readability.textContent?.trim();
  if (textContent) return textContent;

  const html = readability.content?.trim();
  if (!html) return "";

  return htmlToText(html);
}

export function getDefuddleFormattedText(defuddle: DefuddleData): string {
  return [
    `Site: ${defuddle.site ?? "unknown"}`,
    `Title: ${defuddle.title ?? "unknown"}`,
    `Byline: ${defuddle.author ?? "unknown"}`,
    `Published: ${defuddle.published ?? "unknown"}`,
    "",
    getDefuddleContentText(defuddle) || "No defuddled content available.",
  ].join("\n");
}

export function buildRunMarkdown(run: DebugRun): string {
  const lines: string[] = [];
  lines.push(`### ${lensLabel(run.lensId)}`);
  lines.push("");
  lines.push(`- Lens ID: \`${run.lensId}\``);
  lines.push(`- Run ID: \`${run.runId}\``);
  lines.push(`- Model: \`${run.modelUsed ?? "unknown"}\``);
  lines.push(`- Created At: ${formatTimestamp(run.createdAt)}`);
  lines.push(`- Finding Count: ${run.findings.length}`);
  lines.push("");
  lines.push("#### Parsed Findings");
  lines.push("");
  lines.push("```json");
  lines.push(toPrettyJson(run.findings));
  lines.push("```");
  lines.push("");
  lines.push("#### Raw Model Output");
  lines.push("");
  lines.push("```text");
  lines.push(run.rawResponse ?? "No raw response available.");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function buildPageContentMarkdown(pageText: string): string {
  return ["## Page Content", "", "```text", pageText, "```", ""].join("\n");
}

export function buildRawResultsMarkdown(runs: DebugRun[]): string {
  const lines: string[] = ["## Raw AI Results", ""];
  if (runs.length === 0) {
    lines.push("_No raw AI results found for this page._");
    lines.push("");
    return lines.join("\n");
  }

  for (const run of runs) {
    lines.push(buildRunMarkdown(run));
  }

  return lines.join("\n");
}

export function buildDefuddleMarkdown(defuddle: DefuddleData | null): string {
  const lines: string[] = ["## Defuddle View", ""];
  if (!defuddle) {
    lines.push("_Defuddle could not extract content for this page._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("### Defuddled Content");
  lines.push("");
  lines.push("```text");
  lines.push(getDefuddleFormattedText(defuddle));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function buildReadabilityMarkdown(readability: ReadabilityData | null): string {
  const lines: string[] = ["## Readability View", ""];
  if (!readability) {
    lines.push("_Readability could not extract content for this page._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`- Title: ${readability.title ?? "unknown"}`);
  lines.push(`- Site: ${readability.siteName ?? "unknown"}`);
  lines.push(`- Byline: ${readability.byline ?? "unknown"}`);
  lines.push(`- Excerpt: ${readability.excerpt ?? "unknown"}`);
  lines.push(
    `- Length: ${typeof readability.length === "number" ? readability.length : "unknown"}`
  );
  lines.push("");
  lines.push("### Readability Content");
  lines.push("");
  lines.push("```text");
  lines.push(getReadabilityContentText(readability) || "No readability content available.");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function buildPageDebugMarkdown(payload: DebugViewPayload): string {
  const lines: string[] = [];

  lines.push("# Lenses Debug View");
  lines.push("");
  lines.push(`- Source URL: ${payload.sourceUrl}`);
  lines.push(`- Generated at: ${payload.generatedAt}`);
  lines.push(`- Runs: ${payload.runs.length}`);
  lines.push("");
  lines.push(buildPageContentMarkdown(payload.pageText));
  lines.push(buildDefuddleMarkdown(payload.defuddle));
  lines.push(buildReadabilityMarkdown(payload.readability));
  lines.push(buildRawResultsMarkdown(payload.runs));

  return lines.join("\n");
}

export function getCopyChunks(payload: DebugViewPayload): Record<string, string> {
  const chunks: Record<string, string> = {
    full: buildPageDebugMarkdown(payload),
    page: buildPageContentMarkdown(payload.pageText),
    defuddle: buildDefuddleMarkdown(payload.defuddle),
    readability: buildReadabilityMarkdown(payload.readability),
    raw: buildRawResultsMarkdown(payload.runs),
  };

  payload.runs.forEach((run, index) => {
    chunks[`run-${index}`] = buildRunMarkdown(run);
  });

  return chunks;
}

export function getTopCopyActions(): CopyChunk[] {
  return [
    { key: "full", label: "Full page", markdown: "" },
    { key: "page", label: "Page content", markdown: "" },
    { key: "raw", label: "Raw AI results", markdown: "" },
  ];
}

function htmlToText(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const extracted = tmp.innerText.trim();
  if (extracted) return extracted;

  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
