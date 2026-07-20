import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfTextRect } from "@lenses/shared";
import { fingerprintText, sha256Hex, type SourceFingerprintInput } from "./evidence-bases";

const PDF_WORKER_PATH = "pdf/pdf.worker.min.mjs";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface PdfTextItemSpan {
  start: number;
  end: number;
  rect: PdfTextRect;
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
  start: number;
  end: number;
  bodyText: string;
  bodyStart: number;
  width: number;
  height: number;
  textItems: PdfTextItemSpan[];
  ocrRequired: boolean;
}

export interface ExtractedPdfSource {
  title: string;
  text: string;
  pages: PdfPageText[];
  pageCount: number;
  fileHash: string;
  fingerprint: SourceFingerprintInput;
  ocrRequired: boolean;
}

export async function extractPdfSource(
  input: ArrayBuffer | Uint8Array,
  fallbackTitle: string
): Promise<ExtractedPdfSource> {
  configurePdfWorker();
  const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input);
  if (bytes.byteLength === 0) throw new Error("The PDF is empty.");
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("This PDF is larger than the 50 MB ingestion limit.");
  }

  const fileHash = await sha256Hex(bytes);
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    useWasm: false,
    isImageDecoderSupported: false,
    standardFontDataUrl: standardFontDataUrl(),
  });

  try {
    const pdf = await loadingTask.promise;
    const metadata = await pdf.getMetadata().catch(() => null);
    const metadataTitle = metadataTitleValue(metadata?.info);
    const pages: PdfPageText[] = [];
    let text = "";
    let extractedCharacterCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const extractedPage = pdfTextItemsToPage(content.items, viewport.transform);
      const pageBody = extractedPage.text;
      extractedCharacterCount += pageBody.replace(/\s/g, "").length;
      const pageMarker = `[PDF page ${pageNumber}]`;
      const block = `${pageMarker}${pageBody ? `\n${pageBody}` : ""}`;
      if (text) text += "\n\n";
      const start = text.length;
      text += block;
      pages.push({
        pageNumber,
        text: block,
        start,
        end: text.length,
        bodyText: pageBody,
        bodyStart: start + pageMarker.length + (pageBody ? 1 : 0),
        width: viewport.width,
        height: viewport.height,
        textItems: extractedPage.items,
        ocrRequired: pageBody.replace(/\s/g, "").length < 6,
      });
      page.cleanup();
    }

    const ocrRequired = extractedCharacterCount < Math.max(12, pdf.numPages * 6);
    return {
      title: metadataTitle || fallbackTitle || "PDF document",
      text,
      pages,
      pageCount: pdf.numPages,
      fileHash,
      fingerprint: await fingerprintText(text, { fileHash }),
      ocrRequired,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function fetchPdfSource(
  url: string,
  fallbackTitle: string
): Promise<ExtractedPdfSource> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Could not load PDF (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error("This PDF is larger than the 50 MB ingestion limit.");
  }
  return extractPdfSource(await response.arrayBuffer(), fallbackTitle);
}

export function resolvePdfUrl(rawUrl: string | undefined, title?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "chrome-extension:") {
      const embedded = parsed.searchParams.get("file");
      if (!embedded) return null;
      const embeddedUrl = new URL(embedded);
      return embeddedUrl.protocol === "http:" || embeddedUrl.protocol === "https:"
        ? embeddedUrl.href
        : null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const looksLikePdf =
      parsed.pathname.toLowerCase().endsWith(".pdf") || /\.pdf(?:\s|$)/i.test(title ?? "");
    return looksLikePdf ? parsed.href : null;
  } catch {
    return null;
  }
}

function configurePdfWorker(): void {
  if (GlobalWorkerOptions.workerSrc) return;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER_PATH);
    return;
  }
  GlobalWorkerOptions.workerSrc = new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  ).href;
}

function standardFontDataUrl(): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL("pdf/standard_fonts/");
  }
  return new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href;
}

function pdfTextItemsToPage(
  items: readonly unknown[],
  viewportTransform: readonly number[]
): { text: string; items: PdfTextItemSpan[] } {
  let text = "";
  let separator = "";
  const spans: PdfTextItemSpan[] = [];

  for (const item of items) {
    if (!isPdfTextItem(item) || !item.str) continue;
    const value = item.str.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (text) text += separator || " ";
    const start = text.length;
    text += value;
    spans.push({ start, end: text.length, rect: pdfTextItemRect(item, viewportTransform) });
    separator = item.hasEOL ? "\n" : " ";
  }

  return { text, items: spans };
}

function pdfTextItemRect(
  item: PdfTextItem,
  viewportTransform: readonly number[]
): PdfTextRect {
  const transform = multiplyTransforms(viewportTransform, item.transform);
  const height = Math.max(Math.hypot(transform[2] ?? 0, transform[3] ?? 0), item.height ?? 0);
  return {
    x: transform[4] ?? 0,
    y: (transform[5] ?? 0) - height,
    width: Math.max(0, Math.abs(item.width ?? 0)),
    height,
  };
}

function multiplyTransforms(a: readonly number[], b: readonly number[]): number[] {
  return [
    (a[0] ?? 1) * (b[0] ?? 1) + (a[2] ?? 0) * (b[1] ?? 0),
    (a[1] ?? 0) * (b[0] ?? 1) + (a[3] ?? 1) * (b[1] ?? 0),
    (a[0] ?? 1) * (b[2] ?? 0) + (a[2] ?? 0) * (b[3] ?? 1),
    (a[1] ?? 0) * (b[2] ?? 0) + (a[3] ?? 1) * (b[3] ?? 1),
    (a[0] ?? 1) * (b[4] ?? 0) + (a[2] ?? 0) * (b[5] ?? 0) + (a[4] ?? 0),
    (a[1] ?? 0) * (b[4] ?? 0) + (a[3] ?? 1) * (b[5] ?? 0) + (a[5] ?? 0),
  ];
}

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: readonly number[];
  width?: number;
  height?: number;
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== "object") return false;
  const item = value as { str?: unknown; transform?: unknown };
  return (
    typeof item.str === "string" &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    item.transform.every((entry) => typeof entry === "number")
  );
}

function metadataTitleValue(info: unknown): string {
  if (!info || typeof info !== "object") return "";
  const title = (info as { Title?: unknown }).Title;
  return typeof title === "string" ? title.trim().slice(0, 500) : "";
}
