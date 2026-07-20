import { z } from "zod";

export const SourceKind = z.enum(["web_page", "youtube_video", "pdf"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceScopeKind = z.enum(["page", "selection", "transcript"]);
export type SourceScopeKind = z.infer<typeof SourceScopeKind>;

export const TranscriptSegment = z.object({
  text: z.string(),
  start: z.number(),
  duration: z.number(),
  formatted: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const SourceFocus = z.object({
  kind: SourceKind,
  label: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});
export type SourceFocus = z.infer<typeof SourceFocus>;

export const SourceScope = z.object({
  kind: SourceScopeKind,
  label: z.string(),
  text: z.string(),
  focus: SourceFocus,
  transcript: z.array(TranscriptSegment).optional(),
});
export type SourceScope = z.infer<typeof SourceScope>;
