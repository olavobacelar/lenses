import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { LEGACY_BACKEND_SETTINGS_FIELDS } from "./legacy-settings-compat";

const outputCategory = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  color: v.string(),
  label: v.optional(v.string()),
});

const sourceKind = v.union(
  v.literal("web_page"),
  v.literal("youtube_video"),
  v.literal("pdf")
);

const sourceScopeKind = v.union(
  v.literal("page"),
  v.literal("selection"),
  v.literal("transcript")
);

const pdfTextRect = v.object({
  x: v.float64(),
  y: v.float64(),
  width: v.float64(),
  height: v.float64(),
});

const sourceAnchor = v.object({
  kind: v.union(
    v.literal("text"),
    v.literal("transcript"),
    v.literal("pdf"),
    v.literal("none")
  ),
  start: v.optional(v.float64()),
  end: v.optional(v.float64()),
  timestamp: v.optional(v.float64()),
  duration: v.optional(v.float64()),
  formatted: v.optional(v.string()),
  pageNumber: v.optional(v.float64()),
  pageLabel: v.optional(v.string()),
  rects: v.optional(v.array(pdfTextRect)),
  pageWidth: v.optional(v.float64()),
  pageHeight: v.optional(v.float64()),
  extractionVersion: v.optional(v.string()),
});

const focusKind = v.union(
  v.literal("source"),
  v.literal("selection"),
  v.literal("finding"),
  v.literal("run")
);

const outputKind = v.union(v.literal("items"), v.literal("holistic"));
const runMode = v.union(v.literal("manual"), v.literal("auto"));

const suggestedEnrichment = v.object({
  lensId: v.string(),
  auto: v.boolean(),
});

const textSegment = v.object({
  text: v.string(),
  citations: v.array(
    v.object({
      url: v.string(),
      title: v.string(),
      citedText: v.optional(v.string()),
    })
  ),
});

// One web search or page fetch performed while answering; `query`/`url` are
// optional because entries persisted before web_fetch existed lack them.
const webSearchEntry = v.object({
  kind: v.union(v.literal("search"), v.literal("fetch")),
  query: v.optional(v.string()),
  url: v.optional(v.string()),
  results: v.array(v.object({ url: v.string(), title: v.string() })),
  done: v.boolean(),
});

// The assistant's visible reasoning trace: interleaved thinking blocks and
// research (search/fetch) rounds, in stream order.
const activityItem = v.union(
  v.object({
    kind: v.literal("thinking"),
    text: v.string(),
    live: v.optional(v.boolean()),
  }),
  v.object({
    kind: v.literal("research"),
    searches: v.array(webSearchEntry),
    live: v.optional(v.boolean()),
  })
);

const chatMessage = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  hidden: v.optional(v.boolean()),
  thinkingText: v.optional(v.string()),
  textSegments: v.optional(v.array(textSegment)),
  meta: v.optional(v.record(v.string(), v.string())),
});

const videoTimestamp = v.object({
  seconds: v.float64(),
  formatted: v.string(),
});

// Result of running a finding-focused lens (focus: "finding") against a finding,
// e.g. verifying a claim. Generic so new enrichment kinds need no schema change.
const enrichment = v.object({
  lensId: v.string(),
  summary: v.string(),
  data: v.optional(v.record(v.string(), v.string())),
  sources: v.optional(
    v.array(v.object({ url: v.string(), title: v.string() }))
  ),
  addedBy: v.union(v.literal("agent"), v.literal("user")),
  at: v.float64(),
});

const extractedClaim = v.object({
  quotes: v.array(v.string()),
  claim: v.string(),
  timestamp: v.string(),
  category: v.string(),
  verification: v.optional(
    v.object({
      credibility: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
      explanation: v.string(),
      sources: v.array(
        v.object({
          url: v.string(),
          title: v.string(),
        })
      ),
    })
  ),
});

export default defineSchema({
  // These source, evidence, lens, result, conversation, and settings tables
  // remain so deployments predating local-only persistence can validate and
  // migrate stored rows. Active managed requests use only short-lived,
  // content-free rows in `runs` for cancellation.
  evidenceBases: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    guidingQuestion: v.optional(v.string()),
    // Legacy hosted rows may still carry these fields. Active evidence-base
    // persistence is browser-local and no longer reads or writes them.
    iconKind: v.optional(v.union(v.literal("emoji"), v.literal("icon"))),
    iconValue: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  }).index("by_updatedAt", ["updatedAt"]),

  sources: defineTable({
    sourceKey: v.string(),
    kind: sourceKind,
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    externalId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_kind_externalId", ["kind", "externalId"])
    .index("by_url", ["url"]),

  sourceFingerprints: defineTable({
    sourceId: v.id("sources"),
    contentHash: v.string(),
    fileHash: v.optional(v.string()),
    hashAlgorithm: v.literal("sha256"),
    extractionVersion: v.string(),
    contentLength: v.float64(),
    observedAt: v.float64(),
  })
    .index("by_source", ["sourceId"])
    .index("by_source_hash", ["sourceId", "contentHash"]),

  sourceSegments: defineTable({
    sourceId: v.id("sources"),
    sourceFingerprintId: v.id("sourceFingerprints"),
    segmentKey: v.string(),
    ordinal: v.float64(),
    kind: v.union(v.literal("text"), v.literal("transcript"), v.literal("pdf")),
    anchor: sourceAnchor,
    contentHash: v.string(),
    normalizedLength: v.float64(),
    normalizationVersion: v.string(),
    segmentationVersion: v.string(),
    extractionStatus: v.union(v.literal("complete"), v.literal("ocr_required")),
    createdAt: v.float64(),
  })
    .index("by_source", ["sourceId"])
    .index("by_fingerprint", ["sourceFingerprintId"])
    .index("by_fingerprint_key", ["sourceFingerprintId", "segmentKey"])
    .index("by_segmentKey", ["segmentKey"]),

  evidenceBaseSources: defineTable({
    evidenceBaseId: v.id("evidenceBases"),
    sourceId: v.id("sources"),
    latestFingerprintId: v.optional(v.id("sourceFingerprints")),
    addedAt: v.float64(),
    updatedAt: v.float64(),
    note: v.optional(v.string()),
  })
    .index("by_evidenceBase", ["evidenceBaseId"])
    .index("by_source", ["sourceId"])
    .index("by_evidenceBase_source", ["evidenceBaseId", "sourceId"]),

  lenses: defineTable({
    lensId: v.string(),
    name: v.string(),
    description: v.string(),
    promptTemplate: v.string(),
    outputInstructions: v.string(),
    highlightRules: v.array(
      v.object({
        condition: v.string(),
        value: v.string(),
        color: v.string(),
        label: v.optional(v.string()),
      })
    ),
    version: v.string(),
    authorType: v.optional(
      v.union(v.literal("builtin"), v.literal("user"), v.literal("managed"))
    ),
    defaultModel: v.optional(v.string()),
    contentTypeHints: v.optional(v.array(v.string())),
    outputCategories: v.optional(v.array(outputCategory)),
    fallbackColor: v.optional(v.string()),
    focus: v.optional(focusKind),
    scope: v.optional(v.array(sourceScopeKind)),
    itemNoun: v.optional(v.string()),
    outputKind: v.optional(outputKind),
    runMode: v.optional(runMode),
    triggers: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    tools: v.optional(v.array(v.string())),
    suggestedEnrichments: v.optional(v.array(suggestedEnrichment)),
    visible: v.optional(v.boolean()),
    markdown: v.optional(v.string()),
    isBuiltIn: v.boolean(),
  }).index("by_lensId", ["lensId"]),

  runs: defineTable({
    runGroupId: v.optional(v.string()),
    lensId: v.string(),
    sourceKey: v.optional(v.string()),
    sourceKind: v.optional(sourceKind),
    sourceTitle: v.optional(v.string()),
    scope: v.optional(sourceScopeKind),
    sourceUrl: v.optional(v.string()),
    sourceId: v.optional(v.id("sources")),
    sourceFingerprintId: v.optional(v.id("sourceFingerprints")),
    initiatedFromEvidenceBaseId: v.optional(v.id("evidenceBases")),
    lensVersion: v.optional(v.string()),
    lensMarkdownSnapshot: v.optional(v.string()),
    chunkingVersion: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    findingCount: v.optional(v.float64()),
    error: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    // Compatibility-only column for rows already deployed before managed runs
    // became response-only. Active backend code neither writes nor reads it.
    rawResponse: v.optional(v.string()),
    /**
     * Client-supplied id used to address an in-flight run from outside this
     * action's lifecycle (e.g. so the extension can request cancellation by a
     * token it knows before the action returns).
     */
    runRequestId: v.optional(v.string()),
    /** True when the row exists only to carry an in-flight cancel signal. */
    ephemeral: v.optional(v.boolean()),
    /**
     * Set by the requestCancel mutation when a caller asks to stop this run.
     * The runs.run action polls for this value at await points and aborts the
     * upstream LLM call when it appears.
     */
    cancelRequestedAt: v.optional(v.float64()),
  })
    .index("by_status", ["status"])
    .index("by_lens", ["lensId"])
    .index("by_sourceKey", ["sourceKey"])
    .index("by_sourceKey_lens_status", ["sourceKey", "lensId", "status"])
    .index("by_sourceUrl", ["sourceUrl"])
    .index("by_sourceId", ["sourceId"])
    .index("by_sourceFingerprint", ["sourceFingerprintId"])
    .index("by_evidenceBase", ["initiatedFromEvidenceBaseId"])
    .index("by_sourceUrl_lens_status", ["sourceUrl", "lensId", "status"])
    .index("by_runRequestId", ["runRequestId"]),

  runSegmentRefs: defineTable({
    runId: v.id("runs"),
    sourceSegmentId: v.id("sourceSegments"),
    segmentKey: v.string(),
    chunkIndex: v.float64(),
    role: v.union(v.literal("core"), v.literal("context")),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
  })
    .index("by_run", ["runId"])
    .index("by_run_chunk", ["runId", "chunkIndex"])
    .index("by_segment", ["sourceSegmentId"])
    .index("by_run_segment", ["runId", "sourceSegmentId"]),

  findings: defineTable({
    runId: v.id("runs"),
    runGroupId: v.optional(v.string()),
    lensId: v.string(),
    sourceKey: v.optional(v.string()),
    sourceKind: v.optional(sourceKind),
    sourceUrl: v.optional(v.string()),
    findingIndex: v.float64(),
    text: v.string(),
    category: v.string(),
    detail: v.string(),
    confidence: v.float64(),
    sourceSpan: v.optional(
      v.object({
        start: v.float64(),
        end: v.float64(),
      })
    ),
    anchor: v.optional(sourceAnchor),
    quotes: v.optional(v.array(v.string())),
    // Enrichments accumulated on a finding over time (verification, etc.),
    // each produced by a finding-focused lens. Defaults to absent/empty.
    enrichments: v.optional(v.array(enrichment)),
  })
    .index("by_run", ["runId"])
    .index("by_sourceKey_lens", ["sourceKey", "lensId"])
    .index("by_sourceUrl_lens", ["sourceUrl", "lensId"]),

  findingEvidenceRefs: defineTable({
    findingId: v.id("findings"),
    runId: v.id("runs"),
    sourceSegmentId: v.id("sourceSegments"),
    segmentKey: v.string(),
    role: v.union(v.literal("basis"), v.literal("context")),
    exactQuote: v.string(),
    quoteHash: v.string(),
    anchor: sourceAnchor,
    relevanceNote: v.optional(v.string()),
  })
    .index("by_finding", ["findingId"])
    .index("by_run", ["runId"])
    .index("by_segment", ["sourceSegmentId"])
    .index("by_finding_segment", ["findingId", "sourceSegmentId"]),

  messages: defineTable({
    userId: v.optional(v.string()),
    sourceKey: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceKind: sourceKind,
    focus: focusKind,
    scope: sourceScopeKind,
    focusRef: v.optional(v.string()),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("error")
    ),
    content: v.string(),
    hidden: v.optional(v.boolean()),
    screenshots: v.optional(v.array(v.string())),
    videoTimestamp: v.optional(videoTimestamp),
    timestamp: v.float64(),
    thinkingText: v.optional(v.string()),
    textSegments: v.optional(v.array(textSegment)),
    meta: v.optional(v.record(v.string(), v.string())),
    activity: v.optional(v.array(activityItem)),
    searches: v.optional(v.array(webSearchEntry)),
  })
    .index("by_source", ["sourceKey"])
    .index("by_source_focus", ["sourceKey", "focus", "focusRef"])
    .index("by_timestamp", ["timestamp"]),

  claims: defineTable({
    userId: v.optional(v.string()),
    sourceKey: v.string(),
    videoId: v.optional(v.string()),
    claims: v.array(extractedClaim),
    timestamp: v.float64(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_user_video", ["userId", "videoId"]),

  agentLog: defineTable({
    runGroupId: v.string(),
    sourceKey: v.optional(v.string()),
    actor: v.union(v.literal("agent"), v.literal("user"), v.literal("system")),
    event: v.string(),
    payload: v.optional(v.record(v.string(), v.string())),
    timestamp: v.float64(),
  })
    .index("by_runGroupId", ["runGroupId"])
    .index("by_sourceKey", ["sourceKey"]),

  settings: defineTable({
    userId: v.optional(v.string()),
    localProfileId: v.optional(v.string()),
    chatModel: v.optional(v.string()),
    [LEGACY_BACKEND_SETTINGS_FIELDS.chatModel]: v.optional(v.string()),
    executionModel: v.optional(v.string()),
    [LEGACY_BACKEND_SETTINGS_FIELDS.executionModel]: v.optional(v.string()),
    autoExtractClaims: v.boolean(),
    debugMode: v.boolean(),
    permissionMode: v.optional(v.union(v.literal("broad"), v.literal("on_demand"))),
    updatedAt: v.float64(),
  })
    .index("by_user", ["userId"])
    .index("by_localProfile", ["localProfileId"]),

  savedSelections: defineTable({
    sourceKey: v.optional(v.string()),
    sourceKind: v.optional(sourceKind),
    scope: v.optional(sourceScopeKind),
    url: v.string(),
    selectedText: v.string(),
    title: v.string(),
    createdAt: v.float64(),
    anchorPrefix: v.optional(v.string()),
    anchorSuffix: v.optional(v.string()),
    textStart: v.optional(v.float64()),
    textEnd: v.optional(v.float64()),
    pageTitle: v.optional(v.string()),
    messages: v.optional(v.array(chatMessage)),
  })
    .index("by_url", ["url"])
    .index("by_sourceKey", ["sourceKey"]),
});
