import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKEND_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE,
  LEGACY_BACKEND_SETTINGS_FIELDS,
} from "../convex/legacy-settings-compat";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "convex", "schema.ts"), "utf-8");
const settingsStart = schema.indexOf("settings: defineTable({");
const settingsEnd = schema.indexOf("savedSelections: defineTable({", settingsStart);
const settingsSchema = schema.slice(settingsStart, settingsEnd);

describe("backend settings compatibility", () => {
  it("uses neutral names for current model settings", () => {
    expect(settingsSchema).toContain("chatModel: v.optional(v.string())");
    expect(settingsSchema).toContain("executionModel: v.optional(v.string())");
  });

  it("keeps retired schema fields behind the compatibility map", () => {
    expect(BACKEND_SETTINGS_COMPATIBILITY_REMOVAL_MILESTONE).toBe("2.0.0");
    expect(settingsSchema).toContain("[LEGACY_BACKEND_SETTINGS_FIELDS.chatModel]");
    expect(settingsSchema).toContain("[LEGACY_BACKEND_SETTINGS_FIELDS.executionModel]");
    for (const retiredField of Object.values(LEGACY_BACKEND_SETTINGS_FIELDS)) {
      expect(settingsSchema).not.toMatch(new RegExp(`^\\s*${retiredField}\\s*:`, "m"));
    }
  });
});
