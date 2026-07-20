import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const httpPath = join(here, "..", "convex", "http.ts");
const source = readFileSync(httpPath, "utf-8");

function extractFunctionBody(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`function ${escaped}\\b[\\s\\S]*?^\\}`, "m");
  const match = source.match(re);
  if (!match) throw new Error(`Could not find function ${name}`);
  return match[0];
}

describe("selection stream settings", () => {
  it("keeps selection chat web search and citations enabled for all selection modes", () => {
    expect(source).toMatch(/const SELECTION_CHAT_SETTINGS: LensChatSettings = \{\s*webSearch: true,\s*requireCitations: true,\s*\}/);
    expect(source).toMatch(/\? SELECTION_CHAT_SETTINGS\s*: resolveLensChatSettings/);
  });

  it("avoids returning HTTP 502 from provider failures so the edge does not replace the body", () => {
    const body = extractFunctionBody("mapUpstreamErrorStatus");
    expect(body).toMatch(/return 503/);
    expect(source).not.toMatch(/mapUpstreamErrorStatus[\s\S]*return 502/);
  });

  it("threads reasoning effort into managed provider requests", () => {
    expect(source).toContain("resolveReasoningEffort(payload.reasoningEffort)");
    expect(source).toContain("supportsOpenAIReasoningEffort(model)");
    expect(source).toContain("reasoning: { effort: reasoningEffort }");
    expect(source).toContain(
      'OPENAI_REASONING_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"]'
    );
    expect(source).toContain("output_config: { effort: reasoningEffort }");
    expect(source).toContain("thinking: { type: \"adaptive\", display: \"summarized\" }");
    expect(source).not.toContain("claudeThinkingBudgetForEffort");
  });
});
