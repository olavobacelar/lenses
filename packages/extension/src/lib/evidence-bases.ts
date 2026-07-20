import { readLegacyActiveEvidenceBaseId } from "./legacy-storage-compat";

export const ACTIVE_EVIDENCE_BASE_STORAGE_KEY = "evidenceBases:activeId";
const LEGACY_ACTIVE_EVIDENCE_BASES_STORAGE_KEY = "evidenceBases:activeByMode";
export const SOURCE_FINGERPRINT_EXTRACTION_VERSION = "lenses-source-v1";

export interface SourceFingerprintInput {
  contentHash: string;
  fileHash?: string;
  extractionVersion: string;
  contentLength: number;
  observedAt: number;
}

export interface EvidenceSourceCaptureInput {
  evidenceBaseId: string;
  sourceKey: string;
  kind: "web_page" | "youtube_video" | "pdf";
  url?: string;
  title?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  fingerprint: SourceFingerprintInput;
}

export async function readActiveEvidenceBaseId(): Promise<string | null> {
  const stored = await chrome.storage.local.get([
    ACTIVE_EVIDENCE_BASE_STORAGE_KEY,
    LEGACY_ACTIVE_EVIDENCE_BASES_STORAGE_KEY,
  ]);
  const current = stored[ACTIVE_EVIDENCE_BASE_STORAGE_KEY];
  if (typeof current === "string" && current) return current;

  const migrated = readLegacyActiveEvidenceBaseId(
    stored[LEGACY_ACTIVE_EVIDENCE_BASES_STORAGE_KEY]
  );
  if (migrated) {
    await chrome.storage.local.set({ [ACTIVE_EVIDENCE_BASE_STORAGE_KEY]: migrated });
  }
  await chrome.storage.local.remove(LEGACY_ACTIVE_EVIDENCE_BASES_STORAGE_KEY);
  return migrated;
}

export async function writeActiveEvidenceBaseId(
  evidenceBaseId: string | null
): Promise<void> {
  if (evidenceBaseId) {
    await chrome.storage.local.set({ [ACTIVE_EVIDENCE_BASE_STORAGE_KEY]: evidenceBaseId });
  } else {
    await chrome.storage.local.remove(ACTIVE_EVIDENCE_BASE_STORAGE_KEY);
  }
  await chrome.storage.local.remove(LEGACY_ACTIVE_EVIDENCE_BASES_STORAGE_KEY);
}

export async function fingerprintText(
  text: string,
  options: { fileHash?: string; observedAt?: number } = {}
): Promise<SourceFingerprintInput> {
  const normalized = normalizeFingerprintText(text);
  return {
    contentHash: await sha256Hex(new TextEncoder().encode(normalized)),
    fileHash: options.fileHash,
    extractionVersion: SOURCE_FINGERPRINT_EXTRACTION_VERSION,
    contentLength: normalized.length,
    observedAt: options.observedAt ?? Date.now(),
  };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeFingerprintText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim();
}

export function evidenceBaseExportFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "evidence-base"}.evidencebase.json`;
}
