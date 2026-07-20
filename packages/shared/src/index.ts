export {
  ClaimType,
  Verifiability,
  ClaimFinding,
  ClaimExtractionResult,
  ExtractedClaim,
  ExtractionResult,
} from "./schemas/claim.js";

export {
  HighlightRule,
  LensAuthorType,
  LensConfig,
  LensFocusKind,
  LensOutputKind,
  LensRunMode,
  OutputCategory,
  SuggestedEnrichment,
} from "./schemas/lens.js";

export {
  Anchor,
  Enrichment,
  Finding,
  PdfTextRect,
  RunResult,
  Verification,
} from "./schemas/finding.js";

export {
  FindingEvidenceRef,
  FindingEvidenceRefInput,
  RunSegmentInspection,
  SegmentExtractionStatus,
  SourceSegment,
  SourceSegmentDescriptor,
} from "./schemas/sourceEvidence.js";

export {
  SourceFocus,
  SourceKind,
  SourceScope,
  SourceScopeKind,
  TranscriptSegment,
} from "./schemas/source.js";

export {
  EvidenceBase,
  EvidenceBaseDeletePreview,
  EvidenceBaseDetail,
  EvidenceBaseExport,
  EvidenceBaseFinding,
  EvidenceBaseRun,
  EvidenceBaseSource,
  SourceFingerprint,
} from "./schemas/evidenceBase.js";

export { parseLensMarkdown, serializeLensMarkdown } from "./lensMarkdown.js";
export {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  DEFAULT_ANTHROPIC_TEST_MODEL,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  DEFAULT_OPENAI_TEST_MODEL,
  type ModelProvider,
} from "./aiModelDefaults.js";
export {
  ANTHROPIC_CLAUDE_4_MAX_OUTPUT_TOKENS,
  ANTHROPIC_CLAUDE_HAIKU_4_5_MAX_OUTPUT_TOKENS,
  FALLBACK_LENS_MAX_OUTPUT_TOKENS,
  OPENAI_GPT_4_1_MAX_OUTPUT_TOKENS,
  OPENAI_GPT_5_6_CONTEXT_WINDOW_TOKENS,
  OPENAI_GPT_5_MAX_OUTPUT_TOKENS,
  maxOutputTokensForLensRun,
  type AiProvider,
} from "./aiOutputLimits.js";
export {
  allowedDomainsMatchUrl,
  defaultDomainRuleForLens,
  domainAllowedByRule,
  domainFromUrl,
  domainMatchesAllowedDomain,
  effectiveDomainRuleForLens,
  globToRegExp,
  lensAppliesToUrl,
  lensMatchesUrl,
  normalizeDomain,
  normalizeDomainList,
  parseLensDomainRules,
  setDomainAllowedForRule,
  type LensDomainMode,
  type LensDomainRule,
  type LensDomainRules,
} from "./urlMatch.js";
export { claimExtractorMarkdown } from "./builtInLensMarkdown.js";
export {
  MetaHeaderExtractor,
  SELECTION_META_SCHEMAS,
  VERDICT_SCHEMA,
  buildMetaInstruction,
  getMetaSchemaForMode,
  validateMetaPayload,
  type MetaExtractorOptions,
  type MetaExtractorResult,
  type MetaFieldSpec,
  type MetaSchema,
  type ParsedMeta,
  type SelectionMode,
} from "./streamMeta.js";
