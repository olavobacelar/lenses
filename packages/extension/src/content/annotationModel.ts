import type { Annotation, Finding } from "./types.js";

function normalizeAnnotationPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildAnnotationId(lensId: string, finding: Finding) {
  const normalizedLensId = normalizeAnnotationPart(lensId) || "lens";

  if (finding.runId && typeof finding.findingIndex === "number") {
    const normalizedRunId = normalizeAnnotationPart(finding.runId) || "run";
    return `ann:${normalizedLensId}:${normalizedRunId}:${finding.findingIndex}`;
  }

  const normalizedText = finding.text.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedDetail = finding.detail.trim().toLowerCase().replace(/\s+/g, " ");
  const identityKey = [lensId, finding.category, normalizedText, normalizedDetail].join("|");
  return `ann:${normalizedLensId}:${stableHash(identityKey)}`;
}

export function dedupeAnnotationsById(annotations: Annotation[]) {
  const dedupedById = new Map<string, Annotation>();
  for (const annotation of annotations) {
    if (!dedupedById.has(annotation.id)) {
      dedupedById.set(annotation.id, annotation);
    }
  }
  return Array.from(dedupedById.values());
}

export function getAnnotationDisplayLabel(annotation: Annotation) {
  if (
    annotation.lensId === "source-tracer" &&
    annotation.finding.category === "unsourced"
  ) {
    return "Needs source";
  }
  return annotation.label;
}

export function isSourceCheckCandidate(annotation: Annotation) {
  if (annotation.finding.category === "unsourced") return true;
  return /\bunsourced\b/i.test(annotation.label);
}
