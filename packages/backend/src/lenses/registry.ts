import type { LensConfig } from "@lenses/shared";
import { claimExtractor } from "./built-in/claim-extractor.js";
import { sourceTracer } from "./built-in/source-tracer.js";
import { verifyClaim, locateSource } from "./built-in/enrichments.js";

/** Visible, source-focused lenses shown in the picker. */
export const builtInLenses: LensConfig[] = [claimExtractor, sourceTracer];

/** Hidden, finding-focused lenses offered as enrichments on findings. */
export const enrichmentLenses: LensConfig[] = [verifyClaim, locateSource];

/** Every built-in lens, for id resolution by the agent and run pipeline. */
export const allLenses: LensConfig[] = [...builtInLenses, ...enrichmentLenses];

/** Resolve any built-in lens (visible or enrichment) by id. */
export function getBuiltInLens(id: string): LensConfig | undefined {
  return allLenses.find((lens) => lens.id === id);
}

/** Lenses to show in the picker (visible source-focused lenses). */
export function getVisibleLenses(): LensConfig[] {
  return builtInLenses.filter((lens) => lens.visible !== false);
}
