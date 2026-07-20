import type { ComposerMode } from "../lib/composer";

export type BuiltInLensId = "claim-extractor" | "source-tracer";

export interface BuiltInLens {
  id: BuiltInLensId;
  label: string;
}

export interface PopupFixture {
  id: string;
  title: string;
  repoPath: string;
  bundlePath: string;
}

export interface PopupStatus {
  message: string;
  isError: boolean;
  visible: boolean;
}

export interface PopupStorageState {
  selectedLensIds: string[];
  autoRun: boolean;
  debugMode: boolean;
  showDebugOptions: boolean;
  storePageLenses: boolean;
  pageDockEnabled: boolean;
  chatActionsUseSidePanel: boolean;
  testSourceMaxCitations: number;
  testSourceUseCache: boolean;
}

export interface ComposerCopy {
  placeholder: string;
  submit: string;
  hint: string;
}

export type ComposerCopyByMode = Record<ComposerMode, ComposerCopy>;

export type PopupSidePanelOpenOptions = { tabId: number } | { windowId: number };

export interface PopupSidePanelApi {
  open(options: PopupSidePanelOpenOptions): Promise<void>;
}

export interface PageTextResult {
  text: string | null;
  missingReceiver: boolean;
  sourceKind?: "web_page" | "youtube_video";
  sourceTitle?: string;
  sourceKey?: string;
  scope?: "page" | "selection" | "transcript";
}

export interface DefuddleData {
  title?: string;
  author?: string;
  site?: string;
  description?: string;
  published?: string;
  wordCount?: number;
  parseTime?: number;
  content?: string;
  contentMarkdown?: string;
}

export interface DefuddleResult {
  result: DefuddleData | null;
  missingReceiver: boolean;
  error?: string;
}

export interface ReadabilityData {
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  length?: number;
  textContent?: string;
  content?: string;
}

export interface ReadabilityResult {
  result: ReadabilityData | null;
  missingReceiver: boolean;
  error?: string;
}

export interface DebugFinding {
  text: string;
  category: string;
  detail: string;
  confidence: number;
  sourceSpan?: { start: number; end: number };
  runId?: string;
  findingIndex?: number;
  rawResponse?: string;
  rawFinding?: unknown;
}

export interface DebugRun {
  runId: string;
  lensId: string;
  sourceText?: string;
  modelUsed?: string;
  rawResponse?: string;
  createdAt: number;
  findings: DebugFinding[];
}

export interface DebugDataResponse {
  runs?: DebugRun[];
  error?: string;
}

export interface DebugViewPayload {
  sourceUrl: string;
  pageText: string;
  runs: DebugRun[];
  defuddle: DefuddleData | null;
  readability: ReadabilityData | null;
  generatedAt: string;
  theme: "light" | "dark";
}

export interface CopyChunk {
  key: string;
  label: string;
  markdown: string;
}
