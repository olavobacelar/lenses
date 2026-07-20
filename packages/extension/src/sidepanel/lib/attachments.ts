import type { AttachmentKind } from "../types";

export function classifyFile(
  file: File
): { mediaType: string; kind: AttachmentKind } | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return { mediaType: file.type, kind: "image" };
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return { mediaType: "application/pdf", kind: "document" };
  }
  if (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return { mediaType: "text/plain", kind: "document" };
  }
  return null;
}

export function isImageAttachment(url: string): boolean {
  return (
    url.startsWith("data:image/") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function documentAttachmentLabel(url: string): string {
  if (url.startsWith("data:application/pdf")) return "PDF";
  if (url.startsWith("data:text/")) return "Text";
  return "File";
}
