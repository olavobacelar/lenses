import { parseLensMarkdown } from "@lenses/shared";
import { verifyClaimMarkdown, locateSourceMarkdown } from "./markdown.js";

// Finding-focused lenses (focus: "finding", visible: false). Not shown in the
// picker; surfaced as click-to-chat actions on a finding via `suggestedEnrichments`.
export const verifyClaim = parseLensMarkdown(verifyClaimMarkdown);
export const locateSource = parseLensMarkdown(locateSourceMarkdown);
