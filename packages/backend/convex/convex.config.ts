import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    ANTHROPIC_API_KEY: v.optional(v.string()),
    ANTHROPIC_MODEL: v.optional(v.string()),
    ANTHROPIC_TEST_MODEL: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
    OPENAI_TEST_MODEL: v.optional(v.string()),
    LENSES_MANAGED_DIAGNOSTICS: v.optional(v.string()),
  },
});

export default app;
